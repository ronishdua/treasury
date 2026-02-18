import asyncio
import json
import os
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from models.schemas import (
    FileInfo,
    JobCreated,
    JobCreateRequest,
    UploadAck,
)
from services.compliance import check_compliance
from services.preprocess import preprocess_image
from services.vision import extract_label_data

load_dotenv(Path(__file__).resolve().parent / ".env")

MAX_FILES_PER_JOB = 300
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
MAX_JOB_BYTES = 500 * 1024 * 1024  # 500 MB
MAX_CONCURRENT_JOBS = 3
N_WORKERS = 12
API_SEMAPHORE = asyncio.Semaphore(10)
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
HEARTBEAT_INTERVAL = 15  # seconds
WATCHDOG_INTERVAL = 30  # seconds
WATCHDOG_TIMEOUT = 120  # seconds without upload before timeout
JOB_TTL = 30 * 60  # 30 minutes


@dataclass
class Job:
    job_id: str
    total_files: int
    uploads_complete: bool = False
    cancelled: bool = False
    files_received: int = 0
    files_processed: int = 0
    total_bytes: int = 0
    next_file_id: int = 0
    result_queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=300))
    last_upload_at: float = field(default_factory=time.time)
    created_at: float = field(default_factory=time.time)
    temp_dir: str = ""
    app_index: dict = field(default_factory=dict)
    matched_label_ids: set = field(default_factory=set)

    def __post_init__(self):
        self.temp_dir = tempfile.mkdtemp(prefix=f"label_job_{self.job_id[:8]}_")


jobs: dict[str, Job] = {}
work_queue: asyncio.Queue = asyncio.Queue()
worker_tasks: list[asyncio.Task] = []
background_tasks: list[asyncio.Task] = []


def _active_job_count() -> int:
    return sum(
        1 for j in jobs.values()
        if not j.cancelled and not (j.uploads_complete and j.files_processed == j.files_received)
    )


def _match_application_row(job: Job, filename: str) -> dict | None:
    """Look up the application row for a given image filename via the job's app_index."""
    if not job.app_index:
        return None
    stem = os.path.splitext(filename)[0]
    row = job.app_index.get(stem)
    if row is not None:
        return row
    # Try case-insensitive fallback
    stem_lower = stem.lower()
    for key, val in job.app_index.items():
        if key.lower() == stem_lower:
            return val
    return None


async def worker(worker_id: int):
    """Global worker: pulls items from the shared work queue, processes with real AI pipeline."""
    while True:
        item = await work_queue.get()
        job_id, file_id, client_index, filename, temp_path = item
        job = jobs.get(job_id)

        try:
            if job is None or job.cancelled:
                if job:
                    job.files_processed += 1
                continue

            # Read temp file
            with open(temp_path, "rb") as f:
                raw_bytes = f.read()

            if job.cancelled:
                job.files_processed += 1
                continue

            # Preprocess image (safety validation, resize, compress)
            processed_bytes = preprocess_image(raw_bytes)
            del raw_bytes

            if job.cancelled:
                job.files_processed += 1
                continue

            # Extract label data via Claude (gated by API_SEMAPHORE)
            async with API_SEMAPHORE:
                data = await extract_label_data(processed_bytes, filename)
            del processed_bytes

            # Match image to application data row (O(1) dict lookup)
            app_row = _match_application_row(job, filename)
            app_row_dict = app_row if isinstance(app_row, dict) else None
            if app_row_dict and app_row_dict.get("label_id"):
                job.matched_label_ids.add(app_row_dict["label_id"])

            # Run compliance checks (with optional application data comparison)
            compliance = check_compliance(data, application_row=app_row_dict)

            # Build result payload
            result_payload: dict = {
                "client_index": client_index,
                "file_id": file_id,
                "filename": filename,
                "data": data,
                "compliance": {
                    "passed": compliance["passed"],
                    "issues": compliance["issues"],
                },
            }

            # Attach comparison detail when available
            if "comparison" in compliance:
                result_payload["comparison"] = compliance["comparison"]

            await job.result_queue.put(("result", result_payload))
            job.files_processed += 1

        except asyncio.CancelledError:
            raise
        except Exception as e:
            if job and not job.cancelled:
                try:
                    await job.result_queue.put((
                        "error",
                        {
                            "client_index": client_index,
                            "file_id": file_id,
                            "filename": filename,
                            "error": str(e),
                        },
                    ))
                    job.files_processed += 1
                except Exception:
                    pass
        finally:
            if temp_path and os.path.exists(temp_path):
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass
            work_queue.task_done()


async def watchdog():
    """Checks for hung jobs that stopped receiving uploads."""
    while True:
        await asyncio.sleep(WATCHDOG_INTERVAL)
        now = time.time()
        for job in list(jobs.values()):
            if job.cancelled or job.uploads_complete:
                continue
            if now - job.last_upload_at > WATCHDOG_TIMEOUT:
                try:
                    await job.result_queue.put((
                        "error",
                        {
                            "client_index": -1,
                            "file_id": -1,
                            "filename": "",
                            "error": "Upload timed out -- no files received for 2 minutes",
                        },
                    ))
                except asyncio.QueueFull:
                    pass
                job.uploads_complete = True


async def cleanup_expired_jobs():
    """Removes jobs older than JOB_TTL and cleans up temp files."""
    while True:
        await asyncio.sleep(60)
        now = time.time()
        expired = [jid for jid, j in jobs.items() if now - j.created_at > JOB_TTL]
        for jid in expired:
            job = jobs.pop(jid, None)
            if job and job.temp_dir and os.path.isdir(job.temp_dir):
                for f in os.listdir(job.temp_dir):
                    try:
                        os.unlink(os.path.join(job.temp_dir, f))
                    except OSError:
                        pass
                try:
                    os.rmdir(job.temp_dir)
                except OSError:
                    pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    for i in range(N_WORKERS):
        worker_tasks.append(asyncio.create_task(worker(i)))
    background_tasks.append(asyncio.create_task(watchdog()))
    background_tasks.append(asyncio.create_task(cleanup_expired_jobs()))
    yield
    for t in worker_tasks + background_tasks:
        t.cancel()
    await asyncio.gather(*worker_tasks, *background_tasks, return_exceptions=True)


app = FastAPI(title="Label Compliance Checker", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/jobs", response_model=JobCreated)
async def create_job(req: JobCreateRequest):
    if req.total_files < 1 or req.total_files > MAX_FILES_PER_JOB:
        raise HTTPException(400, f"total_files must be between 1 and {MAX_FILES_PER_JOB}")

    if _active_job_count() >= MAX_CONCURRENT_JOBS:
        raise HTTPException(429, "Too many active jobs. Please wait for a current job to finish.")

    # Build application data index keyed by label_id
    app_index: dict[str, dict] = {}
    duplicates: list[str] = []
    if req.application_data:
        for row in req.application_data:
            key = row.label_id.strip()
            if key in app_index:
                duplicates.append(key)
            else:
                app_index[key] = row.model_dump()

    job_id = uuid.uuid4().hex[:12]
    job = Job(job_id=job_id, total_files=req.total_files, app_index=app_index)
    jobs[job_id] = job
    return JobCreated(job_id=job_id, duplicate_label_ids=duplicates)


@app.post("/api/jobs/{job_id}/upload", response_model=UploadAck)
async def upload_files(
    job_id: str,
    files: list[UploadFile],
    client_indices: str | None = None,
):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.cancelled:
        raise HTTPException(400, "Job has been cancelled")
    if job.uploads_complete:
        raise HTTPException(400, "Uploads already complete for this job")

    indices: list[int] = []
    if client_indices:
        try:
            indices = json.loads(client_indices)
        except (json.JSONDecodeError, TypeError):
            raise HTTPException(400, "client_indices must be a JSON array of integers")
    else:
        base = job.files_received
        indices = list(range(base, base + len(files)))

    if len(indices) != len(files):
        raise HTTPException(400, "client_indices length must match number of files")

    if job.files_received + len(files) > job.total_files:
        raise HTTPException(400, "Uploading more files than declared total_files")

    ack_files: list[FileInfo] = []

    for i, upload_file in enumerate(files):
        if upload_file.content_type and upload_file.content_type not in ALLOWED_TYPES:
            raise HTTPException(
                400,
                f"Invalid file type for {upload_file.filename}: {upload_file.content_type}. "
                f"Allowed: {', '.join(ALLOWED_TYPES)}",
            )

        file_id = job.next_file_id
        job.next_file_id += 1
        client_index = indices[i]
        filename = upload_file.filename or f"file_{file_id}"

        temp_path = os.path.join(job.temp_dir, f"{file_id}_{filename}")
        file_size = 0
        try:
            with open(temp_path, "wb") as tmp:
                while True:
                    chunk = await upload_file.read(1024 * 64)  # 64KB chunks
                    if not chunk:
                        break
                    file_size += len(chunk)
                    if file_size > MAX_FILE_SIZE:
                        os.unlink(temp_path)
                        raise HTTPException(
                            413,
                            f"File {filename} exceeds {MAX_FILE_SIZE // (1024*1024)}MB limit",
                        )
                    tmp.write(chunk)
        except HTTPException:
            raise
        except Exception as e:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            raise HTTPException(500, f"Failed to save file {filename}: {e}")

        job.total_bytes += file_size
        if job.total_bytes > MAX_JOB_BYTES:
            os.unlink(temp_path)
            raise HTTPException(
                413,
                f"Job exceeds {MAX_JOB_BYTES // (1024*1024)}MB total size limit",
            )

        await work_queue.put((job_id, file_id, client_index, filename, temp_path))
        job.files_received += 1
        job.last_upload_at = time.time()

        ack_files.append(FileInfo(file_id=file_id, client_index=client_index, filename=filename))

    if job.files_received >= job.total_files:
        job.uploads_complete = True

    return UploadAck(files=ack_files)


@app.post("/api/jobs/{job_id}/complete")
async def complete_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    job.uploads_complete = True
    return {"status": "ok"}


@app.get("/api/jobs/{job_id}/stream")
async def stream_results(job_id: str, request: Request):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    async def event_stream():
        yield f"event: meta\ndata: {json.dumps({'job_id': job.job_id, 'total_files': job.total_files})}\n\n"

        while True:
            if await request.is_disconnected():
                job.cancelled = True
                return

            is_done = job.uploads_complete and job.files_processed >= job.files_received

            if is_done and job.result_queue.empty():
                done_payload = {}
                if job.app_index:
                    unmatched = [
                        lid for lid in job.app_index
                        if lid not in job.matched_label_ids
                    ]
                    if unmatched:
                        done_payload["unmatched_csv_rows"] = unmatched
                yield f"event: done\ndata: {json.dumps(done_payload)}\n\n"
                return

            try:
                kind, payload = await asyncio.wait_for(
                    job.result_queue.get(), timeout=HEARTBEAT_INTERVAL
                )
                yield f"event: {kind}\ndata: {json.dumps(payload)}\n\n"
            except asyncio.TimeoutError:
                yield ": heartbeat\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )

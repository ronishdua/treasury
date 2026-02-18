from pydantic import BaseModel


class ApplicationRow(BaseModel):
    """Structured application data from Form 5100.31 for a single label."""
    label_id: str
    brand_name: str | None = None
    class_type: str | None = None
    alcohol_content: str | None = None
    net_contents: str | None = None
    producer_name: str | None = None
    producer_address: str | None = None


class JobCreateRequest(BaseModel):
    total_files: int
    application_data: list[ApplicationRow] | None = None


class JobCreated(BaseModel):
    job_id: str
    duplicate_label_ids: list[str] = []


class FileInfo(BaseModel):
    file_id: int
    client_index: int
    filename: str


class UploadAck(BaseModel):
    files: list[FileInfo]

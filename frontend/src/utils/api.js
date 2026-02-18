const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

export async function createJob(totalFiles, applicationData = null) {
  const body = { total_files: totalFiles };
  if (applicationData && applicationData.length > 0) {
    body.application_data = applicationData;
  }
  const res = await fetch(`${API_BASE}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to create job: ${res.status}`);
  }
  return res.json();
}

export async function uploadChunk(jobId, filesWithIndices) {
  const formData = new FormData();
  const clientIndices = [];

  for (const { file, clientIndex } of filesWithIndices) {
    formData.append('files', file);
    clientIndices.push(clientIndex);
  }
  formData.append('client_indices', JSON.stringify(clientIndices));

  const res = await fetch(`${API_BASE}/jobs/${jobId}/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Upload failed: ${res.status}`);
  }
  return res.json();
}

export async function completeJob(jobId) {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/complete`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Complete failed: ${res.status}`);
  }
  return res.json();
}

export function streamUrl(jobId) {
  return `${API_BASE}/jobs/${jobId}/stream`;
}

const CHUNK_SIZE = 3;
const MAX_CONCURRENT = 4;

export async function uploadAllChunked(jobId, files) {
  const chunks = [];
  for (let i = 0; i < files.length; i += CHUNK_SIZE) {
    const chunk = [];
    for (let j = i; j < Math.min(i + CHUNK_SIZE, files.length); j++) {
      chunk.push({ file: files[j], clientIndex: j });
    }
    chunks.push(chunk);
  }

  let active = [];
  let chunkIndex = 0;

  while (chunkIndex < chunks.length || active.length > 0) {
    while (active.length < MAX_CONCURRENT && chunkIndex < chunks.length) {
      const idx = chunkIndex++;
      const promise = uploadChunk(jobId, chunks[idx])
        .then(() => ({ status: 'ok', idx }))
        .catch((err) => ({ status: 'error', idx, error: err }));
      promise._idx = idx;
      active.push(promise);
    }

    if (active.length > 0) {
      const settled = await Promise.race(active);
      active = active.filter((p) => p._idx !== settled.idx);
      if (settled.status === 'error') {
        console.error(`Chunk ${settled.idx} failed:`, settled.error);
      }
    }
  }

  await completeJob(jobId);
}

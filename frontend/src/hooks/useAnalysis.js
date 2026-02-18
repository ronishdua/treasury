import { useState, useCallback, useRef, useEffect } from 'react';
import { createJob, uploadAllChunked, streamUrl } from '../utils/api';

export function useAnalysis() {
  const [status, setStatus] = useState('idle'); // idle | uploading | streaming | complete | error
  const [results, setResults] = useState(new Map());
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(null);
  const [duplicateIds, setDuplicateIds] = useState([]);
  const [unmatchedCsvRows, setUnmatchedCsvRows] = useState([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(null);
  const eventSourceRef = useRef(null);
  const startTimeRef = useRef(null);
  const donePayloadRef = useRef(null);

  // Derive progress from actual results — eliminates counter/map desync
  const progress = results.size;

  // Data-driven completion: mark complete only when we have all results
  useEffect(() => {
    if (
      total > 0 &&
      results.size >= total &&
      (status === 'streaming' || status === 'uploading')
    ) {
      setStatus('complete');
      if (startTimeRef.current) {
        setElapsedSeconds(Math.round((performance.now() - startTimeRef.current) / 1000));
      }
      if (donePayloadRef.current?.unmatched_csv_rows) {
        setUnmatchedCsvRows(donePayloadRef.current.unmatched_csv_rows);
      }
      // Clean up EventSource if still open
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    }
  }, [results.size, total, status]);

  const reset = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setStatus('idle');
    setResults(new Map());
    setTotal(0);
    setError(null);
    setDuplicateIds([]);
    setUnmatchedCsvRows([]);
    setElapsedSeconds(null);
    startTimeRef.current = null;
    donePayloadRef.current = null;
  }, []);

  const analyze = useCallback(async (files, applicationData = null) => {
    reset();
    setTotal(files.length);
    setStatus('uploading');
    startTimeRef.current = performance.now();

    try {
      const { job_id, duplicate_label_ids } = await createJob(files.length, applicationData);

      if (duplicate_label_ids && duplicate_label_ids.length > 0) {
        setDuplicateIds(duplicate_label_ids);
      }

      const es = new EventSource(streamUrl(job_id));
      eventSourceRef.current = es;

      es.addEventListener('meta', (e) => {
        const data = JSON.parse(e.data);
        setTotal(data.total_files);
      });

      es.addEventListener('result', (e) => {
        const data = JSON.parse(e.data);
        setResults((prev) => {
          const next = new Map(prev);
          next.set(data.client_index, data);
          return next;
        });
        setStatus((s) => (s === 'uploading' ? 'streaming' : s));
      });

      es.addEventListener('error', (e) => {
        if (!e.data) return;
        const data = JSON.parse(e.data);
        if (data.client_index >= 0) {
          setResults((prev) => {
            const next = new Map(prev);
            next.set(data.client_index, { ...data, _error: true });
            return next;
          });
        }
      });

      // Store done payload for the useEffect to pick up
      es.addEventListener('done', (e) => {
        if (e.data) {
          try {
            donePayloadRef.current = JSON.parse(e.data);
          } catch { /* ignore */ }
        }
        es.close();
        eventSourceRef.current = null;
      });

      // Connection error: clean up only, don't set status
      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          eventSourceRef.current = null;
        }
      };

      await uploadAllChunked(job_id, files);

    } catch (err) {
      setError(err.message);
      setStatus('error');
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    }
  }, [reset]);

  return { status, results, progress, total, error, duplicateIds, unmatchedCsvRows, elapsedSeconds, analyze, reset };
}

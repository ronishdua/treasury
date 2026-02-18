import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import Papa from "papaparse";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILES = 300;
const REQUIRED_CSV_COLUMN = "label_id";
const SAMPLE_CSV_URL = '/sample-data/ttb_label_verification_unique_10.csv';
const SAMPLE_IMAGE_NAMES = [
  'COLA-0001.png', 'COLA-0002.png', 'COLA-0003.png', 'COLA-0004.png', 'COLA-0005.png',
  'COLA-0006.png', 'COLA-0007.png', 'COLA-0008.png', 'COLA-0009.png', 'COLA-0010.png',
];
const RECOGNIZED_CSV_COLUMNS = [
  "label_id",
  "brand_name",
  "class_type",
  "alcohol_content",
  "net_contents",
  "producer_name",
  "producer_address",
];

function PreviewLightbox({ src, alt, onClose }) {
  return (
    <div
      className='fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-8 cursor-zoom-out'
      onClick={onClose}
    >
      <img
        src={src}
        alt={alt}
        className='max-w-full max-h-full object-contain rounded-xl shadow-2xl'
      />
      <button
        className='absolute top-6 right-6 w-10 h-10 bg-white/90 hover:bg-white rounded-full flex items-center justify-center text-gray-700 text-xl font-bold shadow-lg'
        onClick={onClose}
      >
        &times;
      </button>
    </div>
  );
}

function FilePreview({ file, onRemove }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const [lightbox, setLightbox] = useState(false);
  return (
    <div className='group'>
      {lightbox &&
        createPortal(
          <PreviewLightbox src={url} alt={file.name} onClose={() => setLightbox(false)} />,
          document.body,
        )}
      <div className='relative w-32 h-32'>
        <img
          src={url}
          alt={file.name}
          onClick={() => setLightbox(true)}
          className='w-32 h-32 object-cover rounded-xl border border-cream-200 bg-cream-50 cursor-zoom-in hover:shadow-md transition-shadow'
        />
        <button
          type='button'
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className='absolute top-1 right-1 w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded-full text-sm font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow'
          title='Remove'
        >
          &times;
        </button>
      </div>
      <p
        className='text-xs text-gray-500 mt-2 truncate w-32'
        title={file.name}
      >
        {file.name}
      </p>
    </div>
  );
}

export default function UploadZone({ onAnalyze, disabled }) {
  const [files, setFiles] = useState([]);
  const [csvRows, setCsvRows] = useState(null);
  const [csvError, setCsvError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [csvDragOver, setCsvDragOver] = useState(false);
  const imageInputRef = useRef(null);
  const csvInputRef = useRef(null);

  const handleCsvFile = useCallback((file) => {
    setCsvError(null);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        if (result.errors.length > 0) {
          setCsvError(`CSV parse error: ${result.errors[0].message}`);
          return;
        }
        const rows = result.data;
        if (rows.length === 0) {
          setCsvError("CSV file is empty.");
          return;
        }
        const columns = Object.keys(rows[0]);
        if (!columns.includes(REQUIRED_CSV_COLUMN)) {
          setCsvError(
            `Missing required column "${REQUIRED_CSV_COLUMN}". Found columns: ${columns.join(", ")}. ` +
              `Expected: ${RECOGNIZED_CSV_COLUMNS.join(", ")}`,
          );
          return;
        }
        if (rows.length > MAX_FILES) {
          setCsvError(
            `CSV has ${rows.length} rows but maximum is ${MAX_FILES}. Please reduce the number of rows.`,
          );
          return;
        }
        // Filter to recognized columns only
        const cleaned = rows
          .map((row) => {
            const out = {};
            for (const col of RECOGNIZED_CSV_COLUMNS) {
              if (row[col] !== undefined && row[col] !== "") {
                out[col] = row[col].trim();
              }
            }
            return out;
          })
          .filter((row) => row.label_id);
        setCsvRows(cleaned);
      },
      error: (err) => {
        setCsvError(`Failed to parse CSV: ${err.message}`);
      },
    });
  }, []);

  const addFiles = useCallback(
    (fileList) => {
      const allFiles = Array.from(fileList);

      // Check for CSV files first
      const csvFile = allFiles.find(
        (f) => f.name.endsWith(".csv") || f.type === "text/csv",
      );
      if (csvFile) {
        handleCsvFile(csvFile);
      }

      // Handle image files
      const images = allFiles.filter((f) =>
        ALLOWED_IMAGE_TYPES.includes(f.type),
      );
      if (images.length === 0) return;

      setFiles((prev) => {
        const existingNames = new Set(prev.map((f) => f.name + f.size));
        const deduped = images.filter(
          (f) => !existingNames.has(f.name + f.size),
        );
        const merged = [...prev, ...deduped];
        if (merged.length > MAX_FILES) {
          alert(
            `Maximum ${MAX_FILES} files. You have ${prev.length} + ${deduped.length} = ${merged.length}.`,
          );
          return prev;
        }
        return merged;
      });
    },
    [handleCsvFile],
  );

  const removeFile = useCallback((index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const removeCsv = useCallback(() => {
    setCsvRows(null);
    setCsvError(null);
    if (csvInputRef.current) csvInputRef.current.value = "";
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleCsvDrop = useCallback(
    (e) => {
      e.preventDefault();
      setCsvDragOver(false);
      const droppedFiles = Array.from(e.dataTransfer.files);
      const csvFile = droppedFiles.find(
        (f) => f.name.endsWith(".csv") || f.type === "text/csv",
      );
      if (csvFile) {
        handleCsvFile(csvFile);
      }
    },
    [handleCsvFile],
  );

  const handleCsvDragOver = useCallback((e) => {
    e.preventDefault();
    setCsvDragOver(true);
  }, []);

  const handleCsvDragLeave = useCallback(() => {
    setCsvDragOver(false);
  }, []);

  const handleImageInputChange = useCallback(
    (e) => {
      addFiles(e.target.files);
      if (imageInputRef.current) imageInputRef.current.value = "";
    },
    [addFiles],
  );

  const handleCsvInputChange = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (file) handleCsvFile(file);
      if (csvInputRef.current) csvInputRef.current.value = "";
    },
    [handleCsvFile],
  );

  const handleAnalyze = useCallback(() => {
    if (files.length > 0 && onAnalyze) {
      onAnalyze(files, csvRows);
    }
  }, [files, csvRows, onAnalyze]);

  const [loadingSampleCsv, setLoadingSampleCsv] = useState(false);
  const [loadingSampleImages, setLoadingSampleImages] = useState(false);

  const loadSampleCsv = useCallback(async () => {
    setLoadingSampleCsv(true);
    try {
      const res = await fetch(SAMPLE_CSV_URL);
      const blob = await res.blob();
      const file = new File([blob], 'ttb_label_verification_unique_10.csv', { type: 'text/csv' });
      handleCsvFile(file);
    } catch (err) {
      setCsvError(`Failed to load sample CSV: ${err.message}`);
    } finally {
      setLoadingSampleCsv(false);
    }
  }, [handleCsvFile]);

  const loadSampleImages = useCallback(async () => {
    setLoadingSampleImages(true);
    try {
      const imageFiles = await Promise.all(
        SAMPLE_IMAGE_NAMES.map(async (name) => {
          const res = await fetch(`/sample-data/images/${name}`);
          const blob = await res.blob();
          return new File([blob], name, { type: 'image/png' });
        }),
      );
      setFiles(imageFiles);
    } catch (err) {
      alert(`Failed to load sample images: ${err.message}`);
    } finally {
      setLoadingSampleImages(false);
    }
  }, []);

  const hasFiles = files.length > 0;

  return (
    <div className='w-full space-y-5'>
      {/* Hidden inputs */}
      <input
        ref={imageInputRef}
        type='file'
        multiple
        accept='.jpg,.jpeg,.png,.webp'
        onChange={handleImageInputChange}
        className='hidden'
      />
      <input
        ref={csvInputRef}
        type='file'
        accept='.csv'
        onChange={handleCsvInputChange}
        className='hidden'
      />

      {/* ── Side-by-side steps (always visible) ── */}
      <div className='grid grid-cols-1 md:grid-cols-2 gap-6 md:min-h-[540px]'>
        {/* Step 1 — CSV */}
        <div
          onDrop={handleCsvDrop}
          onDragOver={handleCsvDragOver}
          onDragLeave={handleCsvDragLeave}
          className={`
            bg-white rounded-2xl shadow-sm border border-cream-200 p-6 flex flex-col min-h-[520px] transition-colors duration-200
            ${csvDragOver ? "border-navy-600 bg-blue-50" : ""}
          `}
        >
          <div className='flex items-center gap-3 mb-4'>
            <span className='flex items-center justify-center w-9 h-9 rounded-full bg-navy-900 text-white text-sm font-bold flex-shrink-0'>
              1
            </span>
            <h3 className='text-xl font-bold text-navy-900'>
              Add Application Data
            </h3>
          </div>

          {!csvRows ? (
            <>
              <p className='text-lg text-gray-600 leading-relaxed mb-6'>
                Upload a CSV exported from COLA with your application fields.
                Image filenames should match the{" "}
                <code className='bg-cream-100 px-1.5 py-0.5 rounded text-sm font-mono'>
                  label_id
                </code>{" "}
                column.
              </p>
              <div className='flex-1 flex flex-col items-center justify-center py-6'>
                <svg
                  className='w-16 h-16 text-gray-300 mb-4'
                  fill='none'
                  viewBox='0 0 24 24'
                  stroke='currentColor'
                  strokeWidth={1}
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    d='M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12l-3-3m0 0l-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z'
                  />
                </svg>
                <p className='text-base text-gray-500'>
                  Drag & drop CSV file here
                </p>
              </div>
              <button
                type='button'
                onClick={() => csvInputRef.current?.click()}
                className='w-full bg-navy-900 hover:bg-navy-800 text-white font-semibold py-3.5 rounded-lg transition-colors text-base'
              >
                Browse Files
              </button>
              <button
                type='button'
                onClick={loadSampleCsv}
                disabled={loadingSampleCsv}
                className='w-full mt-3 py-2.5 rounded-lg text-sm font-semibold text-navy-700 hover:text-navy-900 hover:bg-cream-100 transition-colors border border-cream-200'
              >
                {loadingSampleCsv ? 'Loading...' : 'Use Sample CSV (10 rows)'}
              </button>
              {csvError && (
                <div className='mt-3 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700'>
                  {csvError}
                </div>
              )}
            </>
          ) : (
            <div className='flex flex-col flex-1'>
              <div className='flex items-center gap-2 mb-3'>
                <svg
                  className='w-5 h-5 text-green-600 flex-shrink-0'
                  fill='none'
                  viewBox='0 0 24 24'
                  stroke='currentColor'
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    d='M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
                  />
                </svg>
                <span className='text-base font-semibold text-green-700'>
                  {csvRows.length} application row
                  {csvRows.length !== 1 ? "s" : ""} loaded
                </span>
                <button
                  type='button'
                  onClick={removeCsv}
                  className='ml-auto text-sm text-red-500 hover:text-red-700 transition-colors flex-shrink-0'
                >
                  Remove CSV
                </button>
              </div>
              <div className='bg-cream-50 rounded-lg border border-cream-200 overflow-hidden flex-1'>
                <div className='overflow-auto max-h-[420px]'>
                  <table className='w-full text-sm'>
                    <thead className='sticky top-0 z-10'>
                      <tr className='bg-cream-100'>
                        {Object.keys(csvRows[0]).map((col) => (
                          <th
                            key={col}
                            className='px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap text-xs'
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.map((row, i) => (
                        <tr key={i} className='border-t border-cream-200'>
                          {Object.keys(csvRows[0]).map((col) => (
                            <td
                              key={col}
                              className='px-3 py-2 text-navy-900 whitespace-nowrap max-w-[260px] truncate'
                            >
                              {row[col] || (
                                <span className='text-gray-300'>&mdash;</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Step 2 — Images */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`
            bg-white rounded-2xl shadow-sm border border-cream-200 p-6 flex flex-col min-h-[520px] transition-colors duration-200
            ${dragOver ? "border-navy-600 bg-blue-50" : ""}
            ${disabled ? "opacity-50 pointer-events-none" : ""}
          `}
        >
          <div className='flex items-center gap-3 mb-4'>
            <span className='flex items-center justify-center w-9 h-9 rounded-full bg-navy-900 text-white text-sm font-bold flex-shrink-0'>
              2
            </span>
            <h3 className='text-xl font-bold text-navy-900'>
              Add Label Images
            </h3>
            {hasFiles ? (
              <button
                type='button'
                onClick={() => imageInputRef.current?.click()}
                className='ml-auto text-sm font-semibold text-navy-700 hover:text-navy-900 transition-colors'
              >
                + Add More
              </button>
            ) : null}
          </div>

          {!hasFiles ? (
            <>
              <p className='text-lg text-gray-600 leading-relaxed mb-6'>
                Drop label images here or click below to browse. Supports JPG,
                PNG, and WebP &mdash; up to {MAX_FILES} files.
              </p>
              <div className='flex-1 flex flex-col items-center justify-center py-6'>
                <svg
                  className='w-16 h-16 text-gray-300 mb-4'
                  fill='none'
                  viewBox='0 0 24 24'
                  stroke='currentColor'
                  strokeWidth={1}
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    d='m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21z'
                  />
                </svg>
                <p className='text-base text-gray-500'>
                  Drag & drop anywhere here
                </p>
              </div>
              <button
                type='button'
                onClick={() => imageInputRef.current?.click()}
                className='w-full bg-navy-900 hover:bg-navy-800 text-white font-semibold py-3.5 rounded-lg transition-colors text-base'
              >
                Browse Files
              </button>
              <button
                type='button'
                onClick={loadSampleImages}
                disabled={loadingSampleImages}
                className='w-full mt-3 py-2.5 rounded-lg text-sm font-semibold text-navy-700 hover:text-navy-900 hover:bg-cream-100 transition-colors border border-cream-200'
              >
                {loadingSampleImages ? 'Loading...' : 'Use Sample Images (10 labels)'}
              </button>
            </>
          ) : (
            <>
              <div className='flex items-center gap-2 mb-3'>
                <svg
                  className='w-5 h-5 text-green-600 flex-shrink-0'
                  fill='none'
                  viewBox='0 0 24 24'
                  stroke='currentColor'
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    d='M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
                  />
                </svg>
                <span className='text-base font-semibold text-green-700'>
                  {files.length} image{files.length !== 1 ? "s" : ""} loaded
                </span>
                <button
                  type='button'
                  onClick={() => {
                    setFiles([]);
                    if (imageInputRef.current) imageInputRef.current.value = "";
                  }}
                  className='ml-auto text-sm text-red-500 hover:text-red-700 transition-colors flex-shrink-0'
                >
                  Clear Images
                </button>
              </div>
              <div className='bg-cream-50 rounded-lg border border-cream-200 overflow-hidden flex-1'>
                <div className='overflow-y-auto max-h-[420px] p-5'>
                  <div className='grid grid-cols-3 sm:grid-cols-4 gap-5'>
                    {files.map((file, idx) => (
                      <FilePreview
                        key={file.name + file.size + idx}
                        file={file}
                        onRemove={() => removeFile(idx)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Analyze button (below both cards) ── */}
      {hasFiles && (
        <div>
          {files.length > 100 && (
            <div className='bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 mb-4'>
              Large batch &mdash; results will stream as they finish. This may
              take a few minutes.
            </div>
          )}
          <button
            type='button'
            onClick={handleAnalyze}
            disabled={disabled}
            className={`
              mx-auto block py-3.5 px-16 rounded-xl text-base font-bold text-white transition-colors shadow-sm
              ${disabled ? "bg-gray-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-700 active:bg-green-800"}
            `}
          >
            {csvRows ? "Analyze & Compare Labels" : "Analyze Labels"}
          </button>
        </div>
      )}
    </div>
  );
}

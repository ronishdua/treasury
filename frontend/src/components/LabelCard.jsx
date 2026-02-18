import { useMemo, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

function getOverallStatus(result) {
  if (!result) return { label: 'Pending', bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' };
  if (result._error) return { label: 'Error', bg: 'bg-red-100', text: 'text-red-900', dot: 'bg-red-600' };
  const c = result.compliance;
  if (!c) return { label: 'Analyzed', bg: 'bg-blue-100', text: 'text-blue-900', dot: 'bg-blue-500' };
  if (c.issues?.some((i) => i.severity === 'critical'))
    return { label: 'Rejected', bg: 'bg-red-100', text: 'text-red-900', dot: 'bg-red-600' };
  if (c.issues?.some((i) => i.severity === 'needs_review'))
    return { label: 'Needs Review', bg: 'bg-amber-100', text: 'text-amber-900', dot: 'bg-amber-500' };
  return { label: 'Passed', bg: 'bg-green-100', text: 'text-green-900', dot: 'bg-green-600' };
}

// ---------------------------------------------------------------------------
// Image lightbox
// ---------------------------------------------------------------------------

function Lightbox({ src, alt, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-8 cursor-zoom-out"
      onClick={onClose}
    >
      <img
        src={src}
        alt={alt}
        className="max-w-full max-h-full object-contain rounded-xl shadow-2xl"
      />
      <button
        className="absolute top-6 right-6 w-10 h-10 bg-white/90 hover:bg-white rounded-full flex items-center justify-center text-gray-700 text-xl font-bold shadow-lg"
        onClick={onClose}
      >
        &times;
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Match status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }) {
  const styles = {
    match:     'bg-green-100 text-green-900',
    mismatch:  'bg-red-100 text-red-900',
    partial:   'bg-amber-100 text-amber-900',
    not_found: 'bg-gray-200 text-gray-700',
    needs_review: 'bg-amber-100 text-amber-900',
  };
  const icons = {
    match: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>,
    mismatch: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>,
    partial: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" /></svg>,
    not_found: null,
    needs_review: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" /></svg>,
  };
  const labels = { match: 'Match', mismatch: 'Mismatch', partial: 'Partial', not_found: 'Not Found', needs_review: 'Review' };
  const cls = styles[status];
  if (!cls) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wide px-3 py-1 rounded-full ${cls}`}>
      {icons[status]}
      {labels[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Government Warning comparison block
// ---------------------------------------------------------------------------

function GovWarningComparison({ field }) {
  const s = field.status;
  const isMatch = s === 'match';
  const isMissing = s === 'not_found';

  const borderColor = isMatch ? 'border-green-300' : isMissing ? 'border-red-300' : 'border-amber-300';
  const bgColor = isMatch ? 'bg-green-100' : isMissing ? 'bg-red-100' : 'bg-amber-100';

  return (
    <div className={`rounded-xl border-2 ${borderColor} overflow-hidden`}>
      {/* Header row with status */}
      <div className={`${bgColor} px-5 py-3 flex items-center justify-between`}>
        <span className="text-sm font-black text-navy-900 uppercase tracking-wider">Government Warning</span>
        <StatusBadge status={s} />
      </div>
      {/* Expected vs Extracted */}
      <div className="grid grid-cols-2 divide-x-2 divide-gray-200">
        <div className="p-4">
          <p className="text-sm font-black text-navy-900 uppercase tracking-wider mb-2">Expected</p>
          <p className="text-sm text-navy-900 leading-relaxed">{field.expected}</p>
        </div>
        <div className="p-4">
          <p className="text-sm font-black text-navy-900 uppercase tracking-wider mb-2">Extracted</p>
          <p className="text-sm text-navy-900 leading-relaxed">
            {field.extracted || <span className="text-gray-400 italic">Not detected</span>}
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field labels
// ---------------------------------------------------------------------------

const FIELD_LABELS = {
  brand_name: 'Brand Name',
  alcohol_content: 'Alcohol Content',
  net_contents: 'Net Contents',
  class_type: 'Class / Type',
  producer_name: 'Producer',
  producer_address: 'Address',
  government_warning: 'Gov Warning',
};

// ---------------------------------------------------------------------------
// Main card
// ---------------------------------------------------------------------------

export default function LabelCard({ file, previewUrl, result, clientIndex }) {
  const status = getOverallStatus(result);
  const createdUrl = useMemo(
    () => (!previewUrl && file ? URL.createObjectURL(file) : null),
    [previewUrl, file],
  );
  const thumbUrl = previewUrl ?? createdUrl;
  useEffect(() => () => { if (createdUrl) URL.revokeObjectURL(createdUrl); }, [createdUrl]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const onImgError = useCallback(() => setImgError(true), []);

  const data = result?.data;
  const compliance = result?.compliance;
  const comparison = result?.comparison;
  const issues = compliance?.issues || [];
  const hasComparison = comparison?.fields?.length > 0;

  // Pending
  if (!result) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 flex items-center gap-6">
        {thumbUrl && (
          <img src={thumbUrl} alt={file?.name} className="w-24 h-24 object-cover rounded-xl bg-cream-100 flex-shrink-0" />
        )}
        <div>
          <p className="text-lg font-bold text-navy-900">{file?.name || `File ${clientIndex}`}</p>
          <div className="mt-3 flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-navy-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-base text-gray-500">Processing...</span>
          </div>
        </div>
      </div>
    );
  }

  // Error
  if (result._error) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 flex items-start gap-6">
        {thumbUrl && (
          <img src={thumbUrl} alt={file?.name} className="w-24 h-24 object-cover rounded-xl bg-cream-100 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-lg font-bold text-navy-900">{file?.name || `File ${clientIndex}`}</p>
          <span className="inline-flex items-center gap-2 mt-2 text-sm font-bold text-red-700 bg-red-100 px-3 py-1.5 rounded-full">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            Error
          </span>
          <p className="text-base text-red-600 mt-3">{result.error}</p>
        </div>
      </div>
    );
  }

  const actionable = issues
    .filter(i => i.severity === 'critical' || i.severity === 'needs_review')
    .filter((issue, idx, arr) => arr.findIndex(a => a.message === issue.message) === idx);

  // Split comparison fields: regular fields vs government warning
  const regularFields = comparison?.fields?.filter(f => f.field !== 'government_warning') || [];
  const govWarningField = comparison?.fields?.find(f => f.field === 'government_warning');

  // Fallback gov warning status when there's no comparison data
  const warningPresent = data?.government_warning_present;
  const warningTextIssue = issues.find(i => i.field === 'government_warning_text');
  const warningOk = warningPresent && data?.government_warning_text && !warningTextIssue;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Lightbox */}
      {lightboxOpen &&
        thumbUrl &&
        createPortal(
          <Lightbox src={thumbUrl} alt={file?.name} onClose={() => setLightboxOpen(false)} />,
          document.body,
        )}

      {/* ── Header ── */}
      <div className={`${status.bg} px-8 py-4 flex items-center justify-between border-b border-gray-200`}>
        <div className="flex items-center gap-3">
          <span className={`w-3.5 h-3.5 rounded-full ${status.dot}`} />
          <span className={`text-xl font-black ${status.text}`}>{status.label}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-base font-bold text-gray-600">
            {comparison?.matched_row || file?.name || `File ${clientIndex}`}
          </span>
          {data?._processing_time_ms != null && (
            <span className="text-sm font-semibold text-gray-400">
              {(data._processing_time_ms / 1000).toFixed(1)}s
            </span>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-col lg:flex-row">
        {/* Left column: Image + Issues */}
        <div className="lg:w-72 flex-shrink-0 flex flex-col lg:border-r-2 border-gray-200 bg-cream-50/50">
          {/* Image */}
          <div className="p-6 flex flex-col items-center">
            {thumbUrl && !imgError ? (
              <button
                type="button"
                onClick={() => setLightboxOpen(true)}
                className="group cursor-zoom-in relative"
              >
                <img
                  src={thumbUrl}
                  alt={file?.name}
                  onError={onImgError}
                  className="w-full max-w-[240px] h-auto object-contain rounded-xl bg-white border-2 border-gray-300 shadow-sm group-hover:shadow-md transition-shadow"
                />
                <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="bg-black/60 text-white text-xs font-bold px-3 py-1.5 rounded-lg">
                    Click to enlarge
                  </span>
                </span>
              </button>
            ) : (
              <div className="w-full max-w-[240px] h-48 bg-cream-100 border-2 border-gray-300 rounded-xl flex items-center justify-center">
                <div className="text-center text-gray-400">
                  <svg className="w-10 h-10 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21z" />
                  </svg>
                  <span className="text-xs">No preview</span>
                </div>
              </div>
            )}
          </div>

          {/* Issues below image */}
          {actionable.length > 0 && (
            <div className="px-5 pb-5 space-y-2.5">
              <p className="text-xs font-black text-navy-900 uppercase tracking-wider">Issues</p>
              {actionable.map((issue, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className={`flex-shrink-0 mt-1 w-2.5 h-2.5 rounded-full ${
                    issue.severity === 'critical' ? 'bg-red-500' : 'bg-amber-500'
                  }`} />
                  <span className={`text-sm font-semibold leading-snug ${
                    issue.severity === 'critical' ? 'text-red-700' : 'text-amber-700'
                  }`}>{issue.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right column: Comparison table + Gov Warning */}
        <div className="flex-1 p-8 space-y-6">

          {/* ── Comparison table (regular fields) ── */}
          {regularFields.length > 0 && (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b-2 border-navy-600">
                  <th className="text-left pb-3 w-40 text-sm font-black text-navy-900 uppercase tracking-wider">Field</th>
                  <th className="text-left pb-3 text-sm font-black text-navy-900 uppercase tracking-wider">Expected</th>
                  <th className="text-left pb-3 text-sm font-black text-navy-900 uppercase tracking-wider">Extracted</th>
                  <th className="text-right pb-3 w-32 text-sm font-black text-navy-900 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                {regularFields.map((f) => {
                  const rowBg = f.status === 'mismatch' ? 'bg-red-100'
                    : f.status === 'partial' ? 'bg-amber-100'
                    : f.status === 'not_found' ? 'bg-gray-100'
                    : '';
                  return (
                    <tr
                      key={f.field}
                      className={`border-b border-gray-200 ${rowBg}`}
                    >
                      <td className="py-4 pr-4 align-top">
                        <span className="text-sm font-bold text-navy-800 uppercase tracking-wide">
                          {FIELD_LABELS[f.field] || f.field}
                        </span>
                      </td>
                      <td className="py-4 pr-4 align-top text-base text-navy-900">
                        {f.expected || <span className="text-gray-300">&mdash;</span>}
                      </td>
                      <td className="py-4 pr-4 align-top text-base text-navy-900">
                        {f.extracted || <span className="text-gray-300">&mdash;</span>}
                      </td>
                      <td className="py-4 text-right align-top">
                        <StatusBadge status={f.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* ── Core fields (no CSV mode) ── */}
          {regularFields.length === 0 && !govWarningField && data && (
            <div className="grid grid-cols-2 gap-x-8 gap-y-4">
              {data.brand_name && (
                <div>
                  <p className="text-sm font-black text-navy-900 uppercase tracking-wider mb-0.5">Brand Name</p>
                  <p className="text-lg text-navy-900 font-semibold">{data.brand_name}</p>
                </div>
              )}
              {data.alcohol_by_volume && (
                <div>
                  <p className="text-sm font-black text-navy-900 uppercase tracking-wider mb-0.5">Alcohol Content</p>
                  <p className="text-lg text-navy-900">{data.alcohol_by_volume}</p>
                </div>
              )}
              {data.net_contents && (
                <div>
                  <p className="text-sm font-black text-navy-900 uppercase tracking-wider mb-0.5">Net Contents</p>
                  <p className="text-lg text-navy-900">{data.net_contents}</p>
                </div>
              )}
              {data.producer_name && (
                <div>
                  <p className="text-sm font-black text-navy-900 uppercase tracking-wider mb-0.5">Producer</p>
                  <p className="text-lg text-navy-900">{data.producer_name}</p>
                </div>
              )}
              {data.producer_address && (
                <div>
                  <p className="text-sm font-black text-navy-900 uppercase tracking-wider mb-0.5">Address</p>
                  <p className="text-lg text-navy-900">{data.producer_address}</p>
                </div>
              )}
            </div>
          )}

          {/* ── Gov Warning (expected vs extracted) ── */}
          {govWarningField ? (
            <GovWarningComparison field={govWarningField} />
          ) : data ? (
            <div className={`flex items-center gap-3 rounded-xl px-5 py-3 border-2 ${
              !warningPresent ? 'bg-red-100 border-red-300' : warningOk ? 'bg-green-100 border-green-300' : 'bg-amber-100 border-amber-300'
            }`}>
              {!warningPresent ? (
                <svg className="w-6 h-6 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : warningOk ? (
                <svg className="w-6 h-6 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ) : (
                <svg className="w-6 h-6 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              )}
              <span className={`text-base font-bold ${
                !warningPresent ? 'text-red-800' : warningOk ? 'text-green-800' : 'text-amber-800'
              }`}>
                Government Warning {!warningPresent ? 'not detected' : warningOk ? 'verified' : 'needs verification'}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

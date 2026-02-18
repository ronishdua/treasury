import { useState } from 'react';
import LabelCard from './LabelCard';

function computeStats(results) {
  let passed = 0, rejected = 0, needsReview = 0, errors = 0, matched = 0;
  let hasComparison = false;

  for (const r of results.values()) {
    if (r._error) { errors++; continue; }
    const c = r.compliance;
    if (!c) continue;
    if (c.issues?.some((i) => i.severity === 'critical')) rejected++;
    else if (c.issues?.some((i) => i.severity === 'needs_review')) needsReview++;
    else passed++;
    if (r.comparison) { hasComparison = true; if (r.comparison.matched_row) matched++; }
  }
  return { passed, rejected, needsReview, errors, matched, hasComparison };
}

function getResultStatus(result) {
  if (!result || result._error) return null;
  const c = result.compliance;
  if (!c) return null;
  if (c.issues?.some((i) => i.severity === 'critical')) return 'rejected';
  if (c.issues?.some((i) => i.severity === 'needs_review')) return 'needsReview';
  return 'passed';
}

function StatCard({ value, label, color, active, onClick }) {
  const base = {
    green:  { normal: 'bg-green-100 text-green-900', active: 'bg-green-200 text-green-900 ring-2 ring-green-500' },
    red:    { normal: 'bg-red-100 text-red-900', active: 'bg-red-200 text-red-900 ring-2 ring-red-500' },
    amber:  { normal: 'bg-amber-100 text-amber-900', active: 'bg-amber-200 text-amber-900 ring-2 ring-amber-500' },
  };
  const style = active ? base[color].active : base[color].normal;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-5 py-4 text-center cursor-pointer transition-all duration-150 hover:scale-[1.02] ${style}`}
    >
      <p className="text-xl font-black leading-none">
        <span className="font-black">{value}</span> {label}
      </p>
    </button>
  );
}

export default function ResultsGrid({ files, results, progress, total, isComplete, duplicateIds = [], unmatchedCsvRows = [], elapsedSeconds }) {
  const stats = computeStats(results);
  const [filter, setFilter] = useState(null);

  const toggleFilter = (f) => setFilter((prev) => (prev === f ? null : f));
  const pct = total > 0 ? Math.round((progress / total) * 100) : 0;

  return (
    <div className="w-full space-y-6">
      {/* ── CSV missing image (single line, above progress) ── */}
      {unmatchedCsvRows.length > 0 && (
        <p className="text-base text-blue-800">
          {unmatchedCsvRows.length} CSV row{unmatchedCsvRows.length !== 1 ? "s" : ""} missing image — No uploaded image matched: <span className="font-mono">{unmatchedCsvRows.join(", ")}</span>
        </p>
      )}

      {/* ── Progress hero ── */}
      <div className="bg-white rounded-2xl shadow-sm p-8">
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <p className="text-3xl font-black text-navy-900 leading-tight">
            <span>{progress}</span>
            <span className="font-bold text-gray-400">/{total}</span>
            <span className="text-xl font-medium text-gray-500 ml-2">labels analyzed</span>
          </p>
          {(isComplete || (progress > 0 && !isComplete)) && (
            <span className={`text-lg font-bold ${isComplete ? 'text-green-700' : 'text-navy-600'}`}>
              {isComplete ? `Complete${elapsedSeconds != null ? ` in ${elapsedSeconds}s` : ''}` : 'Processing...'}
            </span>
          )}
        </div>

        {/* Progress bar */}
        <div className="w-full bg-cream-200 rounded-full h-4">
          <div
            className="bg-navy-700 h-4 rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Stat cards: Passed, Needs Review, Critical */}
        {progress > 0 && (
          <>
            <div className="grid grid-cols-3 gap-4 mt-6">
              <StatCard value={stats.passed} label="Passed" color="green" active={filter === 'passed'} onClick={() => toggleFilter('passed')} />
              <StatCard value={stats.needsReview} label="Needs Review" color="amber" active={filter === 'needsReview'} onClick={() => toggleFilter('needsReview')} />
              <StatCard value={stats.rejected} label="Rejected" color="red" active={filter === 'rejected'} onClick={() => toggleFilter('rejected')} />
            </div>
            {filter && (
              <div className="mt-3 flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => setFilter(null)}
                  className="text-sm font-semibold text-navy-700 hover:text-navy-900 transition-colors"
                >
                  Show All Results
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Alerts (CSV warnings) ── */}
      {duplicateIds.length > 0 && (
        <div className='bg-amber-50 border border-amber-200 rounded-xl px-6 py-4 flex items-start gap-3'>
          <svg className="w-6 h-6 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <div>
            <p className='text-base font-bold text-amber-900'>Duplicate label IDs in CSV</p>
            <p className='text-sm text-amber-700 mt-0.5'>
              First occurrence used for: <span className='font-mono'>{duplicateIds.join(", ")}</span>
            </p>
          </div>
        </div>
      )}

      {/* ── Label cards ── */}
      <div className="space-y-6">
        {files.map((file, idx) => {
          if (filter && getResultStatus(results.get(idx)) !== filter) return null;
          return (
            <LabelCard
              key={idx}
              file={file}
              result={results.get(idx)}
              clientIndex={idx}
            />
          );
        })}
      </div>
    </div>
  );
}

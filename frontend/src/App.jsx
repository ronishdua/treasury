import { useState } from "react";
import UploadZone from "./components/UploadZone";
import ResultsGrid from "./components/ResultsGrid";
import { useAnalysis } from "./hooks/useAnalysis";

function GovBanner() {
  return (
    <div className='bg-navy-900 text-white text-xs py-1.5 px-4'>
      <div className='max-w-7xl mx-auto flex items-center gap-2'>
        <img
          src='https://flagcdn.com/20x15/us.png'
          alt='U.S. flag'
          className='w-4 h-3 object-cover'
          width='16'
          height='12'
        />
        <span className='font-semibold'>
          An unofficial website of the United States government
        </span>
      </div>
    </div>
  );
}

export default function App() {
  const [files, setFiles] = useState([]);
  const [csvData, setCsvData] = useState(null);
  const { status, results, progress, total, error, duplicateIds, unmatchedCsvRows, elapsedSeconds, analyze, reset } =
    useAnalysis();

  const handleAnalyze = (selectedFiles, applicationData = null) => {
    setFiles(selectedFiles);
    setCsvData(applicationData);
    analyze(selectedFiles, applicationData);
  };

  const handleReset = () => {
    setFiles([]);
    setCsvData(null);
    reset();
  };

  const showUpload = status === "idle" || status === "error";
  const showResults =
    status === "uploading" || status === "streaming" || status === "complete";

  return (
    <div className='min-h-screen bg-cream-100'>
      <GovBanner />

      {/* Header */}
      <header className='bg-cream-50 border-b border-cream-200 py-6 px-6'>
        <div className='max-w-7xl mx-auto flex items-end justify-between'>
          <div>
            <h1 className='font-[family-name:var(--font-family-heading)] text-3xl md:text-4xl font-black text-navy-900 leading-tight'>
              TTB Label Compliance Checker
            </h1>
            <p className='text-sm text-navy-600 mt-1'>
              AI-powered alcohol beverage label verification
            </p>
          </div>
          {showResults && (
            <button
              onClick={handleReset}
              className='font-semibold text-navy-700 hover:text-navy-900 border-2 border-navy-700 hover:border-navy-900 px-5 py-2.5 rounded-xl transition-colors flex-shrink-0 text-base'
            >
              New Analysis
            </button>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className='max-w-7xl mx-auto px-6 py-8'>
        {showUpload && (
          <div className='space-y-6'>
            <UploadZone
              onAnalyze={handleAnalyze}
              disabled={status === "uploading" || status === "streaming"}
            />
            {error && (
              <div className='max-w-3xl mx-auto bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700'>
                <p className='font-semibold'>Error</p>
                <p>{error}</p>
              </div>
            )}
          </div>
        )}

        {showResults && (
          <ResultsGrid
            files={files}
            results={results}
            progress={progress}
            total={total}
            isComplete={status === "complete"}
            duplicateIds={duplicateIds}
            unmatchedCsvRows={unmatchedCsvRows}
            elapsedSeconds={elapsedSeconds}
          />
        )}
      </main>
    </div>
  );
}

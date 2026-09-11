import React, { useState } from 'react';
import axios from 'axios';
import { API_ENDPOINTS, API_CONFIG } from '../../utils/config';
import ConcordanceDashboard from './ConcordanceDashboard';
import './BioSampleAnalysis.css';

const VALIDATION_EXAMPLES = [
  { accession: 'SAMN03177674', note: 'Standard isolate profile' },
  { accession: 'SAMN03177676', note: 'Streptomycin discordance' },
  { accession: 'SAMN03177659', note: 'Ampicillin discordance' },
  { accession: 'SAMN03177675', note: 'Multiple beta-lactamases' },
  { accession: 'SAMN03177664', note: 'Multidrug resistance profile' },
];

export default function BioSampleAnalysis() {
  const [accession, setAccession] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const handleAnalyze = async (e) => {
    if (e) e.preventDefault();
    const cleanAcc = (accession || '').trim().toUpperCase();

    if (!cleanAcc) {
      setError('Please enter an NCBI BioSample accession.');
      setResult(null);
      return;
    }

    setError('');
    setLoading(true);
    setResult(null);

    try {
      const endpointUrl = `${API_ENDPOINTS.amrIsolate}/${encodeURIComponent(cleanAcc)}`;
      const response = await axios.get(endpointUrl, API_CONFIG);

      if (response.data && response.data.status === 'success') {
        setResult(response.data);
      } else {
        setError('Unexpected API response format.');
      }
    } catch (err) {
      if (err.response) {
        if (err.response.status === 404) {
          setError('BioSample not available in the current validation dataset.');
        } else {
          setError(
            err.response.data?.error ||
            err.response.data?.details ||
            `Server returned error (${err.response.status}).`
          );
        }
      } else if (err.request) {
        setError('Unable to connect to the backend server. Please verify the backend service is active.');
      } else {
        setError(`Request failed: ${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSelectExample = (acc) => {
    setAccession(acc);
    setError('');
  };

  const handleClear = () => {
    setAccession('');
    setError('');
    setResult(null);
  };

  return (
    <div className="biosample-analysis-container fade-in">
      {/* Header Section */}
      <div className="analysis-header-section">
        <h2 className="analysis-main-title">BioSample AMR Analysis</h2>
        <p className="analysis-sub-text">
          Evaluate documented genotype–phenotype relationships for NCBI BioSample isolates against observed antibiograms.
        </p>
      </div>

      {/* Search Input Card */}
      <div className="biosample-search-card">
        <form onSubmit={handleAnalyze}>
          <div className="search-form-group">
            <div className="search-input-wrapper">
              <input
                type="text"
                className="biosample-text-input"
                placeholder="Enter NCBI BioSample accession (e.g. SAMN03177675)"
                value={accession}
                onChange={(e) => setAccession(e.target.value)}
                disabled={loading}
              />
            </div>
            <button
              type="submit"
              className="biosample-submit-btn"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="loading-spinner" style={{ width: 16, height: 16, marginRight: 4 }} />
                  Analyzing...
                </>
              ) : (
                <>
                  <span>Analyze BioSample</span>
                  <span>→</span>
                </>
              )}
            </button>
            {(accession || result || error) && (
              <button
                type="button"
                className="biosample-clear-btn"
                onClick={handleClear}
                disabled={loading}
              >
                Clear
              </button>
            )}
          </div>
        </form>

        {/* Validated Examples Section */}
        <div className="examples-section">
          <div className="examples-header-label">
            Five-Isolate Preliminary Validation Set
          </div>
          <div className="example-chips-list">
            {VALIDATION_EXAMPLES.map((ex) => (
              <button
                key={ex.accession}
                type="button"
                className="example-chip-btn"
                onClick={() => handleSelectExample(ex.accession)}
                title={`Click to load ${ex.accession} (${ex.note})`}
              >
                <span>{ex.accession}</span>
                <span className="example-chip-note">({ex.note})</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="amr-alert error slide-down">
          <span style={{ fontSize: '1.2rem', fontWeight: 700 }}>!</span>
          <div>
            <strong>Validation Error:</strong> {error}
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="amr-loading-container">
          <div className="amr-loading-spinner" />
          <div className="amr-loading-text">
            Evaluating genomic determinants against AST records for isolate...
          </div>
        </div>
      )}

      {/* Concordance Dashboard Result */}
      {result && !loading && (
        <ConcordanceDashboard isolateData={result} />
      )}
    </div>
  );
}

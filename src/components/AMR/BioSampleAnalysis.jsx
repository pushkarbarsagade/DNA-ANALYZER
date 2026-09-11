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

export default function BioSampleAnalysis({ onNavigateReconciliation }) {
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

      if (response.data && (response.data.status === 'success' || response.data.status === 'partial')) {
        setResult(response.data);
      } else {
        setError('Unexpected API response format.');
      }
    } catch (err) {
      if (err.response) {
        const respData = err.response.data || {};
        if (err.response.status === 404) {
          setError(
            respData.error ||
            'BioSample not found in NCBI Pathogen Detection or validation fixture.'
          );
        } else if (err.response.status === 504 || respData.availability_state === 'ncbi_timeout') {
          setError(
            respData.error ||
            'NCBI lookup timed out. The upstream data query took too long to complete. Please try again.'
          );
        } else if (respData.availability_state === 'dynamic_provider_not_configured') {
          setError(
            respData.error ||
            'Live multi-organism NCBI lookup requires Google BigQuery provider configuration. The five validation isolates remain accessible.'
          );
        } else if (err.response.status === 503) {
          setError(
            respData.error ||
            'NCBI Pathogen Detection or BigQuery service is currently unreachable. Please retry shortly.'
          );
        } else if (err.response.status === 400) {
          setError(
            respData.details ||
            respData.error ||
            'Invalid BioSample accession format.'
          );
        } else {
          setError(
            respData.error ||
            respData.details ||
            `Server returned error (${err.response.status}).`
          );
        }
      } else if (err.code === 'ECONNABORTED' || (err.message && err.message.includes('timeout'))) {
        setError('Request timed out while waiting for NCBI data. Please verify your connection or try again.');
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
          Evaluate documented genotype–phenotype relationships for NCBI Pathogen Detection isolates across bacterial organisms. Organism and assembly metadata are detected automatically from NCBI.
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
                placeholder="Enter NCBI BioSample accession (e.g. SAMN03177675, SAMN02138670, or any pathogen BioSample)"
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
            Five-Isolate Preliminary Validation Benchmarks
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
            <strong>Error:</strong> {error}
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="amr-loading-container">
          <div className="amr-loading-spinner" />
          <div className="amr-loading-text">
            {VALIDATION_EXAMPLES.some((v) => v.accession === (accession || '').trim().toUpperCase())
              ? 'Evaluating genomic determinants against AST records for validation isolate...'
              : 'Searching NCBI Pathogen Detection and retrieving isolate metadata...'}
          </div>
        </div>
      )}

      {/* Concordance Dashboard Result */}
      {result && !loading && (
        <ConcordanceDashboard
          isolateData={result}
          onNavigateReconciliation={onNavigateReconciliation}
        />
      )}
    </div>
  );
}

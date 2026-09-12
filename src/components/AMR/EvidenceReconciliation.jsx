import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_ENDPOINTS, API_CONFIG } from '../../utils/config';
import { formatGenotypeEntries } from '../../utils/amrFormatters';
import { exportReconciliationReportPdf } from '../../utils/amrPdfExport';
import './EvidenceReconciliation.css';

const COMMON_ANTIBIOTICS = [
  'ampicillin',
  'ceftriaxone',
  'ciprofloxacin',
  'streptomycin',
  'gentamicin',
  'tetracycline',
  'trimethoprim-sulfamethoxazole',
  'chloramphenicol',
  'nalidixic acid',
  'amikacin',
  'azithromycin',
  'meropenem'
];

const VALIDATION_BIOSAMPLES = [
  'SAMN03177674',
  'SAMN03177676',
  'SAMN03177659',
  'SAMN03177675',
  'SAMN03177664'
];

export default function EvidenceReconciliation({ activeBioSample, onNavigateAnalysis }) {
  const [currentBioSample, setCurrentBioSample] = useState(activeBioSample || 'SAMN03177675');

  // Synchronize when activeBioSample prop changes from parent navigation
  useEffect(() => {
    if (activeBioSample && activeBioSample !== currentBioSample) {
      setCurrentBioSample(activeBioSample);
    }
  }, [activeBioSample]);

  const [isolateDetails, setIsolateDetails] = useState(null);
  const [userLabRecords, setUserLabRecords] = useState([]);
  
  // User Lab form fields
  const [formAbx, setFormAbx] = useState('ceftriaxone');
  const [formPhenotype, setFormPhenotype] = useState('Resistant');
  const [formMic, setFormMic] = useState('');
  const [formUnit] = useState('ug/mL');
  const [formMethod, setFormMethod] = useState('Broth Microdilution');
  const [formNote, setFormNote] = useState('');

  // Reconciliation state
  const [reconciling, setReconciling] = useState(false);
  const [reconciliationResult, setReconciliationResult] = useState(null);
  const [reconcileError, setReconcileError] = useState('');

  // AI Explanation state
  const [explaining, setExplaining] = useState(false);
  const [aiExplanation, setAiExplanation] = useState(null);
  const [aiError, setAiError] = useState('');

  // Phase 9: ML Research Prediction state
  const [mlPrediction, setMlPrediction] = useState(null);
  const [mlLoading, setMlLoading] = useState(false);

  // PDF Export state
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [pdfSuccess, setPdfSuccess] = useState(false);
  const [pdfError, setPdfError] = useState('');

  const handleDownloadPdf = () => {
    if (!isolateDetails && !reconciliationResult) {
      setPdfError('No isolate data available to export.');
      return;
    }

    setPdfGenerating(true);
    setPdfError('');
    setPdfSuccess(false);

    try {
      exportReconciliationReportPdf({
        isolateDetails,
        reconciliationResult,
        userLabRecords,
        mlPrediction,
        aiExplanation,
        currentBioSample
      });
      setPdfSuccess(true);
      setTimeout(() => setPdfSuccess(false), 4500);
    } catch (err) {
      setPdfError(err.message || 'Failed to generate PDF report.');
    } finally {
      setPdfGenerating(false);
    }
  };

  // Load BioSample isolate details whenever accession changes
  useEffect(() => {
    if (!currentBioSample) return;
    const fetchIsolate = async () => {
      try {
        const url = `${API_ENDPOINTS.amrIsolate}/${encodeURIComponent(currentBioSample.trim().toUpperCase())}`;
        const res = await axios.get(url, API_CONFIG);
        if (res.data && res.data.status === 'success') {
          setIsolateDetails(res.data);
          // Reset previous reconciliation and AI results on BioSample change
          setReconciliationResult(null);
          setAiExplanation(null);
        }
      } catch {
        setIsolateDetails(null);
      }
    };
    fetchIsolate();
  }, [currentBioSample]);

  // Handle adding a user lab record
  const handleAddLabRecord = (e) => {
    e.preventDefault();
    if (!formAbx) return;

    const newRecord = {
      antibiotic: formAbx.trim(),
      phenotype: formPhenotype,
      mic: formMic.trim() ? `${formMic.trim()} ${formUnit}`.trim() : '',
      unit: formUnit,
      method: formMethod,
      note: formNote.trim()
    };

    // Replace if exists for same abx or append
    setUserLabRecords((prev) => {
      const filtered = prev.filter(
        (r) => r.antibiotic.toLowerCase() !== formAbx.trim().toLowerCase()
      );
      return [...filtered, newRecord];
    });

    // Reset optional fields
    setFormMic('');
    setFormNote('');
  };

  const handleRemoveLabRecord = (abxName) => {
    setUserLabRecords((prev) =>
      prev.filter((r) => r.antibiotic.toLowerCase() !== abxName.toLowerCase())
    );
  };

  // Pre-configured Scenarios
  const handleLoadScenario = (scenarioNum) => {
    setAiExplanation(null);
    if (scenarioNum === 1) {
      // Scenario 1: Agreement (SAMN03177675 + Ceftriaxone=Resistant)
      setCurrentBioSample('SAMN03177675');
      setUserLabRecords([
        {
          antibiotic: 'ceftriaxone',
          phenotype: 'Resistant',
          mic: '16 ug/mL',
          method: 'Broth Microdilution',
          note: 'Scenario 1: Agreement test'
        }
      ]);
    } else if (scenarioNum === 2) {
      // Scenario 2: User conflict (SAMN03177675 + Ceftriaxone=Susceptible)
      setCurrentBioSample('SAMN03177675');
      setUserLabRecords([
        {
          antibiotic: 'ceftriaxone',
          phenotype: 'Susceptible',
          mic: '0.5 ug/mL',
          method: 'Disk Diffusion',
          note: 'Scenario 2: User conflict test'
        }
      ]);
    } else if (scenarioNum === 3) {
      // Scenario 3: NCBI Discordance (SAMN03177676 Streptomycin)
      setCurrentBioSample('SAMN03177676');
      setUserLabRecords([]);
    } else if (scenarioNum === 4) {
      // Scenario 4: Not Comparable (SAMN03177675 Amikacin)
      setCurrentBioSample('SAMN03177675');
      setUserLabRecords([
        {
          antibiotic: 'amikacin',
          phenotype: 'Susceptible',
          mic: '2 ug/mL',
          method: 'Broth Microdilution',
          note: 'Scenario 4: Not comparable test'
        }
      ]);
    }
  };

  // Run Deterministic Reconciliation API
  const handleRunReconciliation = async () => {
    if (!currentBioSample) {
      setReconcileError('Please select a BioSample to reconcile.');
      return;
    }

    setReconcileError('');
    setReconciling(true);
    setAiExplanation(null);
    setAiError('');
    setMlPrediction(null);

    try {
      const payload = {
        biosample: currentBioSample,
        user_lab: userLabRecords
      };
      const response = await axios.post(API_ENDPOINTS.amrReconcile, payload, API_CONFIG);
      if (response.data && response.data.status === 'success') {
        setReconciliationResult(response.data);
        // Phase 9: Extract ML prediction from response if present
        if (response.data.ml_prediction) {
          setMlPrediction(response.data.ml_prediction);
        } else {
          // Fetch ML prediction separately as fallback
          fetchMlPrediction(currentBioSample);
        }
      } else {
        setReconcileError('Unexpected response from reconciliation endpoint.');
      }
    } catch (err) {
      setReconcileError(
        err.response?.data?.error ||
        err.response?.data?.details ||
        'Failed to execute evidence reconciliation.'
      );
    } finally {
      setReconciling(false);
    }
  };

  // Phase 9: Fetch ML prediction separately
  const fetchMlPrediction = async (biosample) => {
    setMlLoading(true);
    try {
      const url = `${API_ENDPOINTS.amrMlPredict}/${encodeURIComponent(biosample.trim().toUpperCase())}`;
      const res = await axios.get(url, API_CONFIG);
      if (res.data) {
        setMlPrediction(res.data);
      }
    } catch {
      // ML failure is non-critical; silently ignore
      setMlPrediction(null);
    } finally {
      setMlLoading(false);
    }
  };

  // Run AI Explanation
  const handleRequestAiExplanation = async () => {
    if (!reconciliationResult || !reconciliationResult.findings) {
      setAiError('Please run deterministic evidence reconciliation first.');
      return;
    }

    setAiError('');
    setExplaining(true);

    try {
      const payload = {
        biosample: currentBioSample,
        findings: reconciliationResult.findings
      };
      const response = await axios.post(API_ENDPOINTS.amrExplain, payload, API_CONFIG);
      if (response.data && response.data.status === 'success') {
        setAiExplanation(response.data);
      } else {
        setAiError('Failed to generate AI explanation.');
      }
    } catch (err) {
      setAiError(
        err.response?.data?.error ||
        'Unable to connect to AI explanation service.'
      );
    } finally {
      setExplaining(false);
    }
  };

  return (
    <div className="reconciliation-container fade-in">
      {/* HEADER & SCIENTIFIC DISCLAIMER */}
      <div className="reconciliation-header">
        <div className="reconciliation-title-action-row">
          <div>
            <h2 className="reconciliation-main-title">Multi-Source Evidence Reconciliation</h2>
            <p className="reconciliation-sub-text">
              Evaluate consistency across Genomic AMR Determinants, NCBI Reference AST observations, and optional User Laboratory results.
            </p>
          </div>
          <div className="reconciliation-header-actions">
            <button
              type="button"
              className="export-pdf-btn"
              onClick={handleDownloadPdf}
              disabled={pdfGenerating || !isolateDetails}
              title="Download Complete Evidence Reconciliation PDF Report"
            >
              {pdfGenerating ? (
                <>
                  <span className="loading-spinner" style={{ width: 14, height: 14 }} />
                  <span>Generating PDF...</span>
                </>
              ) : (
                <>
                  <span>📄</span>
                  <span>Download PDF Report</span>
                </>
              )}
            </button>
            {pdfSuccess && (
              <span className="pdf-status-toast success fade-in">
                ✓ PDF generated successfully
              </span>
            )}
            {pdfError && (
              <span className="pdf-status-toast error fade-in">
                ⚠️ {pdfError}
              </span>
            )}
          </div>
        </div>

        {/* Deterministic Architecture Flow */}
        <div className="reconciliation-architecture-pipeline">
          <span className="pipeline-step active">Data</span>
          <span className="pipeline-arrow">→</span>
          <span className="pipeline-step active">Rules</span>
          <span className="pipeline-arrow">→</span>
          <span className="pipeline-step active">Evidence</span>
          <span className="pipeline-arrow">→</span>
          <span className="pipeline-step active">Conflict</span>
          <span className="pipeline-arrow">→</span>
          <span className="pipeline-step ai">AI Explanation</span>
        </div>
      </div>

      {/* TOP DISCLAIMER */}
      <div className="amr-alert info">
        <span style={{ fontSize: '1.2rem', fontWeight: 700 }}>ℹ️</span>
        <div>
          <strong>Research &amp; Educational Platform:</strong> Research interpretation only — not a clinical or diagnostic result. User-provided laboratory results are analyzed as supplied and should be verified by qualified professionals.
        </div>
      </div>

      {/* QUICK SCENARIO PRESETS BAR */}
      <div className="reconciliation-section-card">
        <div className="section-card-header">
          <span className="section-card-title">
            <span>🧪</span> Load Standard Research Scenarios
          </span>
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Quick Test Cases</span>
        </div>
        <div className="presets-strip">
          <button className="preset-chip-btn" onClick={() => handleLoadScenario(1)}>
            Scenario 1: Agreement (Ceftriaxone = R)
          </button>
          <button className="preset-chip-btn" onClick={() => handleLoadScenario(2)}>
            Scenario 2: User Conflict (Ceftriaxone = S)
          </button>
          <button className="preset-chip-btn" onClick={() => handleLoadScenario(3)}>
            Scenario 3: NCBI Discordance (Streptomycin S)
          </button>
          <button className="preset-chip-btn" onClick={() => handleLoadScenario(4)}>
            Scenario 4: Not Comparable (Amikacin)
          </button>
        </div>
      </div>

      {/* SECTION A: SELECTED BIOSAMPLE */}
      <div className="reconciliation-section-card">
        <div className="section-card-header">
          <span className="section-card-title">
            <span>🔬</span> Section A — Selected BioSample Target
          </span>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>Select Isolate:</span>
            {VALIDATION_BIOSAMPLES.map((acc) => (
              <button
                key={acc}
                className={`filter-chip ${currentBioSample === acc ? 'active' : ''}`}
                style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }}
                onClick={() => setCurrentBioSample(acc)}
              >
                {acc}
              </button>
            ))}
          </div>
        </div>

        {isolateDetails ? (
          <div className="isolate-meta-grid">
            <div className="isolate-meta-item">
              <span className="isolate-meta-label">Accession</span>
              <span className="isolate-meta-val" style={{ color: '#38bdf8' }}>
                {isolateDetails.biosample_accession}
              </span>
            </div>
            <div className="isolate-meta-item">
              <span className="isolate-meta-label">Organism</span>
              <span className="isolate-meta-val">{isolateDetails.organism || 'Escherichia coli'}</span>
            </div>
            <div className="isolate-meta-item">
              <span className="isolate-meta-label">Assembly</span>
              <span className="isolate-meta-val">{isolateDetails.assembly_accession || 'N/A'}</span>
            </div>
            <div className="isolate-meta-item">
              <span className="isolate-meta-label">Total NCBI AST Records</span>
              <span className="isolate-meta-val">{isolateDetails.ast_records?.length || 0}</span>
            </div>
          </div>
        ) : (
          <div className="no-biosample-card">
            <p style={{ color: '#cbd5e1' }}>Analyze a BioSample first to begin evidence reconciliation.</p>
            {onNavigateAnalysis && (
              <button className="amr-nav-btn primary" onClick={onNavigateAnalysis}>
                Go to BioSample Analysis →
              </button>
            )}
          </div>
        )}
      </div>

      {/* SECTION B & C: EVIDENCE SUMMARY */}
      {isolateDetails && (
        <div className="evidence-sources-row">
          {/* Section B: Genomic Evidence */}
          <div className="evidence-source-box genomic">
            <span className="evidence-source-label">🧬 Section B — Genomic AMR Evidence</span>
            <span className="evidence-source-sub">
              AMR genotype information from the validated NCBI Pathogen Detection workflow.
            </span>
            <div className="genotype-tags-list" style={{ marginTop: '0.5rem' }}>
              {isolateDetails.amr_genotypes ? (
                formatGenotypeEntries(isolateDetails.amr_genotypes).map((g, i) => (
                  <span key={i} className="genotype-tag">{g}</span>
                ))
              ) : (
                <span className="gene-evidence-none">No mapped determinants</span>
              )}
            </div>
          </div>

          {/* Section C: NCBI AST */}
          <div className="evidence-source-box ncbi">
            <span className="evidence-source-label">🧪 Section C — NCBI Reference AST</span>
            <span className="evidence-source-sub">
              Experimental antibiogram observations from NCBI BioSample XML records.
            </span>
            <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#cbd5e1' }}>
              <strong>{isolateDetails.ast_records?.length || 0}</strong> standard antibiotic susceptibility records available.
            </div>
          </div>

          {/* Section D Preview: User Lab */}
          <div className="evidence-source-box user">
            <span className="evidence-source-label">🔬 Section D — User Lab Evidence</span>
            <span className="evidence-source-sub">
              Optional experimental results supplied for multi-source reconciliation.
            </span>
            <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#f59e0b', fontWeight: 600 }}>
              {userLabRecords.length} user laboratory observation(s) entered.
            </div>
          </div>
        </div>
      )}

      {/* SECTION D: USER LABORATORY INPUT */}
      <div className="reconciliation-section-card">
        <div className="section-card-header">
          <span className="section-card-title">
            <span>📝</span> Section D — User Laboratory Evidence (Optional)
          </span>
          <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>Manual Structured Entry</span>
        </div>
        <p style={{ fontSize: '0.88rem', color: '#94a3b8', margin: 0 }}>
          Optionally enter an experimentally observed antibiotic susceptibility result to compare with the genomic and NCBI evidence.
        </p>

        {/* Input Form */}
        <form onSubmit={handleAddLabRecord} className="user-lab-form">
          <div className="form-grid-user-lab">
            <div className="form-field-group">
              <label className="form-field-label">Antibiotic</label>
              <select
                className="form-field-select"
                value={formAbx}
                onChange={(e) => setFormAbx(e.target.value)}
              >
                {COMMON_ANTIBIOTICS.map((abx) => (
                  <option key={abx} value={abx}>
                    {abx.charAt(0).toUpperCase() + abx.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field-group">
              <label className="form-field-label">Observed Phenotype</label>
              <select
                className="form-field-select"
                value={formPhenotype}
                onChange={(e) => setFormPhenotype(e.target.value)}
              >
                <option value="Resistant">Resistant (R)</option>
                <option value="Susceptible">Susceptible (S)</option>
                <option value="Intermediate">Intermediate (I)</option>
              </select>
            </div>

            <div className="form-field-group">
              <label className="form-field-label">MIC (Optional)</label>
              <input
                type="text"
                className="form-field-input"
                placeholder="e.g. 16 or <=2"
                value={formMic}
                onChange={(e) => setFormMic(e.target.value)}
              />
            </div>

            <div className="form-field-group">
              <label className="form-field-label">Method (Optional)</label>
              <select
                className="form-field-select"
                value={formMethod}
                onChange={(e) => setFormMethod(e.target.value)}
              >
                <option value="Broth Microdilution">Broth Microdilution</option>
                <option value="Disk Diffusion">Disk Diffusion</option>
                <option value="E-test / Gradient Strip">E-test / Gradient Strip</option>
                <option value="Automated System">Automated System (VITEK/Phoenix)</option>
              </select>
            </div>

            <div className="form-field-group">
              <label className="form-field-label">Laboratory Note (Optional)</label>
              <input
                type="text"
                className="form-field-input"
                placeholder="e.g. Repeat isolate assay"
                value={formNote}
                onChange={(e) => setFormNote(e.target.value)}
              />
            </div>
          </div>

          <button type="submit" className="add-lab-btn">
            <span>+</span> Add Laboratory Observation
          </button>
        </form>

        {/* User Lab Records List */}
        {userLabRecords.length > 0 && (
          <div className="user-lab-records-list">
            <span className="isolate-meta-label">Supplied Laboratory Observations:</span>
            {userLabRecords.map((rec, idx) => (
              <div key={idx} className="user-lab-record-row">
                <div className="user-lab-record-details">
                  <span className="user-abx-title">{rec.antibiotic}</span>
                  <span className={`ast-phenotype-pill ${rec.phenotype.toLowerCase()}`}>
                    {rec.phenotype}
                  </span>
                  {rec.mic && <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>MIC: {rec.mic}</span>}
                  {rec.method && <span style={{ fontSize: '0.82rem', color: '#64748b' }}>({rec.method})</span>}
                  {rec.note && <span style={{ fontSize: '0.82rem', color: '#7dd3fc', fontStyle: 'italic' }}>Note: {rec.note}</span>}
                </div>
                <button
                  type="button"
                  className="delete-record-btn"
                  onClick={() => handleRemoveLabRecord(rec.antibiotic)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* RECONCILE ACTION TRIGGER */}
      <div className="reconcile-action-bar">
        <button
          className="run-reconciliation-btn"
          onClick={handleRunReconciliation}
          disabled={reconciling || !isolateDetails}
        >
          {reconciling ? (
            <>
              <span className="loading-spinner" style={{ width: 18, height: 18 }} />
              Reconciling Evidence...
            </>
          ) : (
            <>
              <span>⚖️ Run Deterministic Evidence Reconciliation</span>
              <span>→</span>
            </>
          )}
        </button>
      </div>

      {reconcileError && (
        <div className="amr-alert error slide-down">
          <strong>Reconciliation Error:</strong> {reconcileError}
        </div>
      )}

      {/* SECTION E: DETERMINISTIC RECONCILIATION FINDINGS */}
      {reconciliationResult && (
        <div className="reconciliation-section-card fade-in">
          <div className="section-card-header">
            <span className="section-card-title">
              <span>📋</span> Section E — Structured Reconciliation Findings
            </span>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="formula-part conc">
                Concordant: {reconciliationResult.reconciliation_summary?.concordant || 0}
              </span>
              <span className="formula-part disc">
                Conflicts: {reconciliationResult.reconciliation_summary?.conflicts || 0}
              </span>
              <span className="formula-part notcomp">
                Not Comparable: {reconciliationResult.reconciliation_summary?.not_comparable || 0}
              </span>
              <button
                type="button"
                className="export-pdf-btn compact"
                onClick={handleDownloadPdf}
                disabled={pdfGenerating}
                title="Download Complete Evidence Reconciliation PDF Report"
              >
                <span>📄</span> Export PDF
              </button>
            </div>
          </div>

          <div className="findings-grid">
            {reconciliationResult.findings.map((f, idx) => {
              const isConflict = f.has_conflict;
              const isConcordant = f.reconciliation_category?.startsWith('concordant');

              return (
                <div
                  key={idx}
                  className={`finding-card ${isConflict ? 'has-conflict' : isConcordant ? 'concordant' : ''}`}
                >
                  {/* Finding Header */}
                  <div className="finding-card-header">
                    <div className="finding-abx-title">{f.antibiotic}</div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span className={`classification-badge ${isConflict ? 'discordant' : isConcordant ? 'concordant' : 'not-comparable'}`}>
                        {f.reconciliation_status}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8', background: 'rgba(15,23,42,0.8)', padding: '0.2rem 0.5rem', borderRadius: 4 }}>
                        Strength: {f.evidence_strength}
                      </span>
                    </div>
                  </div>

                  {/* 3-Source Columns */}
                  <div className="evidence-sources-row">
                    {/* Source 1: Genomic */}
                    <div className="evidence-source-box genomic">
                      <span className="evidence-source-label">GENOMIC EVIDENCE</span>
                      <span className="evidence-source-val">
                        {f.genomic_evidence?.has_determinant ? (
                          <span className="gene-evidence-code">
                            {formatGenotypeEntries(f.genomic_evidence.evidence_str).join(', ') || f.genomic_evidence.evidence_str}
                          </span>
                        ) : (
                          <span className="gene-evidence-none">—</span>
                        )}
                      </span>
                      <span className="evidence-source-sub">
                        {f.genomic_evidence?.mapping_basis || f.genomic_evidence?.note || 'No determinant'}
                      </span>
                    </div>

                    {/* Source 2: NCBI AST */}
                    <div className="evidence-source-box ncbi">
                      <span className="evidence-source-label">NCBI AST</span>
                      <span className="evidence-source-val">
                        <span className={`ast-phenotype-pill ${(f.ncbi_ast?.phenotype || '').toLowerCase()}`}>
                          {f.ncbi_ast?.phenotype || 'Not available'}
                        </span>
                      </span>
                      {f.ncbi_ast?.mic && (
                        <span className="evidence-source-sub">MIC: {f.ncbi_ast.mic}</span>
                      )}
                    </div>

                    {/* Source 3: User Lab */}
                    <div className="evidence-source-box user">
                      <span className="evidence-source-label">USER LABORATORY</span>
                      <span className="evidence-source-val">
                        {f.user_lab?.available ? (
                          <span className={`ast-phenotype-pill ${f.user_lab.phenotype.toLowerCase()}`}>
                            {f.user_lab.phenotype}
                          </span>
                        ) : (
                          <span className="gene-evidence-none">Not supplied</span>
                        )}
                      </span>
                      {f.user_lab?.mic && (
                        <span className="evidence-source-sub">MIC: {f.user_lab.mic}</span>
                      )}
                    </div>
                  </div>

                  {/* Conflict / Research Factor Callout */}
                  {isConflict && f.explanation_factors && (
                    <div className="conflict-reasons-box">
                      <div className="conflict-reasons-title">
                        ⚠️ Discrepancy Detected: {f.conflict_summary}
                      </div>
                      <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                        Possible research explanations include:
                      </span>
                      <ul className="conflict-factors-list">
                        {f.explanation_factors.slice(0, 3).map((factor, fIdx) => (
                          <li key={fIdx}>{factor}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* SECTION F: AI-ASSISTED EXPLANATION TRIGGER */}
          <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
            <button
              className="run-reconciliation-btn"
              style={{ margin: '0 auto', background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' }}
              onClick={handleRequestAiExplanation}
              disabled={explaining}
            >
              {explaining ? (
                <>
                  <span className="loading-spinner" style={{ width: 16, height: 16 }} />
                  Synthesizing Research Interpretation...
                </>
              ) : (
                <>
                  <span>🤖 Generate AI-Assisted Research Interpretation</span>
                  <span>→</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* PHASE 9: ML RESEARCH PREDICTION PANEL */}
      {reconciliationResult && (mlPrediction || mlLoading) && (
        <div className="ml-prediction-panel fade-in">
          <div className="section-card-header">
            <span className="section-card-title">
              <span>🧠</span> ML Research Prediction
              <span className="ml-research-badge">RESEARCH ONLY</span>
            </span>
            <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
              Informational — does not override deterministic classification
            </span>
          </div>

          {mlLoading ? (
            <div style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8' }}>
              <span className="loading-spinner" style={{ width: 16, height: 16, display: 'inline-block', marginRight: '0.5rem' }} />
              Loading ML predictions for BioSample...
            </div>
          ) : mlPrediction ? (
            <div className="ml-prediction-content">
              {/* Target Organism & Coverage Banner */}
              <div className="ml-scope-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(11, 18, 32, 0.6)', padding: '0.75rem 1rem', borderRadius: 8, border: '1px solid rgba(255, 255, 255, 0.05)', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <span className="ml-info-label">Target Organism: </span>
                  <span className="ml-info-val" style={{ color: '#38bdf8', fontSize: '0.95rem' }}>{mlPrediction.organism || isolateDetails?.organism || 'Escherichia coli'}</span>
                </div>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                  {mlPrediction.available_count !== undefined ? (
                    <span><strong>{mlPrediction.available_count}</strong> of {mlPrediction.total_drugs || 1} evaluated drug(s) have validated ML models</span>
                  ) : (
                    <span>Model: {mlPrediction.model_version || mlPrediction.model}</span>
                  )}
                </div>
              </div>

              {/* Dynamic Predictions List */}
              <div className="ml-drug-predictions-grid">
                {(mlPrediction.predictions && Array.isArray(mlPrediction.predictions) ? mlPrediction.predictions : [mlPrediction]).map((pred, pIdx) => (
                  <div key={pIdx} className={`ml-drug-card ${pred.available ? 'available' : 'unavailable'}`}>
                    <div className="ml-drug-header">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                        <span className="ml-drug-title">{pred.antibiotic || 'Ampicillin'}</span>
                        {pred.available && (
                          <span className="ml-model-badge">{pred.model_version || pred.model}</span>
                        )}
                      </div>

                      {pred.available ? (
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <span className="ml-pred-label">Prediction:</span>
                          <span className={`ml-pred-class ${pred.prediction === 'Resistant' ? 'resistant' : 'susceptible'}`}>
                            {pred.prediction}
                          </span>
                        </div>
                      ) : (
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8', background: 'rgba(255,255,255,0.05)', padding: '0.2rem 0.5rem', borderRadius: 4 }}>
                          No Validated Model
                        </span>
                      )}
                    </div>

                    {pred.available ? (
                      <>
                        {/* Probability Bar */}
                        <div className="ml-prob-bar-container">
                          <div className="ml-prob-bar-label-row">
                            <span>Susceptible ({((pred.probability_susceptible || 0) * 100).toFixed(1)}%)</span>
                            <span>Predicted Resistance Probability: <strong>{((pred.predicted_probability || pred.probability_resistant || 0) * 100).toFixed(1)}%</strong></span>
                          </div>
                          <div className="ml-prob-bar">
                            <div
                              className="ml-prob-bar-fill susceptible"
                              style={{ width: `${(pred.probability_susceptible || 0) * 100}%` }}
                            />
                            <div
                              className="ml-prob-bar-fill resistant"
                              style={{ width: `${((pred.predicted_probability || pred.probability_resistant || 0)) * 100}%` }}
                            />
                          </div>
                          <div className="ml-threshold-marker" style={{ left: '50%' }}>
                            <span>Threshold: {pred.threshold !== undefined ? pred.threshold.toFixed(2) : '0.50'}</span>
                          </div>
                        </div>

                        {/* Model Meta Row */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#94a3b8', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <span>Recognized Genomic Features: <strong>{pred.recognized_features || 0}</strong> of {pred.total_determinants || 0} determinants</span>
                          <span>Algorithm: {pred.algorithm || 'Logistic Regression (L2)'}</span>
                          <span>Training Isolates: {pred.training_sample_count || 'Validated'}</span>
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: '0.82rem', color: '#94a3b8', fontStyle: 'italic' }}>
                        No validated ML model is currently available for this organism–antibiotic combination.
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Research Disclaimer */}
              <div className="ml-disclaimer-box">
                {mlPrediction.disclaimer || 'Machine-learning predictions are statistical research estimates from validated models developed for specific organism–antibiotic combinations. They are intended for educational and preliminary research use only and must not be interpreted as clinical diagnostic results, susceptibility testing, or treatment recommendations.'}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {aiError && (
        <div className="amr-alert error slide-down">
          <strong>AI Interpretation Error:</strong> {aiError}
        </div>
      )}

      {/* SECTION F OUTPUT: AI EXPLANATION CARD */}
      {aiExplanation && (
        <div className="ai-explanation-card fade-in">
          <div className="section-card-header">
            <span className="section-card-title">
              <span>🤖</span> AI-Assisted Research Interpretation
            </span>
            <span style={{ fontSize: '0.78rem', color: '#00BFA5', background: 'rgba(0,163,137,0.15)', padding: '0.2rem 0.5rem', borderRadius: 4 }}>
              Provider: {aiExplanation.ai_provider || 'Groq Llama-3.3'}
            </span>
          </div>

          <div className="ai-output-box">
            {aiExplanation.explanation}
          </div>

          <div className="ai-disclaimer-strip">
            {aiExplanation.disclaimer || 'AI-generated interpretation is based on the structured evidence shown above and is intended for educational and preliminary research use. It does not constitute a clinical diagnosis or treatment recommendation.'}
          </div>
        </div>
      )}
    </div>
  );
}

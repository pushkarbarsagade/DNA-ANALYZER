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

  // Phase 9 & 13: ML Research Prediction state
  const [mlPrediction, setMlPrediction] = useState(null);
  const [mlLoading, setMlLoading] = useState(false);
  const [selectedMlDrug, setSelectedMlDrug] = useState('ALL');

  // Antibiotic-specific selector & ML target state
  const [selectedAntibiotic, setSelectedAntibiotic] = useState('Ampicillin');
  const [singleMlResult, setSingleMlResult] = useState(null);
  const [singleMlLoading, setSingleMlLoading] = useState(false);

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

  // Derived available antibiotics from current isolate's AST observations & findings
  const availableAntibiotics = React.useMemo(() => {
    const list = [];
    const seen = new Set();

    const addDrug = (drug) => {
      if (!drug) return;
      const clean = drug.trim();
      const lower = clean.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        // Format with first letter capitalized
        const formatted = clean.charAt(0).toUpperCase() + clean.slice(1);
        list.push(formatted);
      }
    };

    if (isolateDetails?.ast_records) {
      isolateDetails.ast_records.forEach((r) => addDrug(r.antibiotic || r.drug));
    }
    if (reconciliationResult?.findings) {
      reconciliationResult.findings.forEach((f) => addDrug(f.antibiotic));
    }
    if (mlPrediction?.predictions) {
      mlPrediction.predictions.forEach((p) => addDrug(p.antibiotic));
    }

    list.sort((a, b) => a.localeCompare(b));
    return list.length > 0 ? list : ['Ampicillin', 'Ceftriaxone', 'Ciprofloxacin', 'Streptomycin', 'Tetracycline'];
  }, [isolateDetails, reconciliationResult, mlPrediction]);

  // Automatically synchronize selectedAntibiotic with available isolate antibiotics
  useEffect(() => {
    if (availableAntibiotics.length > 0) {
      const match = availableAntibiotics.find(
        (a) => a.toLowerCase() === selectedAntibiotic.toLowerCase()
      );
      if (!match) {
        // Favor Ampicillin if present, else default to first available
        const hasAmp = availableAntibiotics.find((a) => a.toLowerCase() === 'ampicillin');
        const defaultDrug = hasAmp || availableAntibiotics[0];
        setSelectedAntibiotic(defaultDrug);
        setFormAbx(defaultDrug.toLowerCase());
      }
    }
  }, [availableAntibiotics]);

  // Fetch antibiotic-specific ML inference dynamically for current organism + selected antibiotic
  useEffect(() => {
    if (!currentBioSample || !selectedAntibiotic) return;
    let isMounted = true;
    const fetchTargetMl = async () => {
      setSingleMlLoading(true);
      try {
        const url = `${API_ENDPOINTS.amrMlPredict}/${encodeURIComponent(currentBioSample.trim().toUpperCase())}?antibiotic=${encodeURIComponent(selectedAntibiotic.trim())}`;
        const res = await axios.get(url, API_CONFIG);
        if (isMounted && res.data) {
          setSingleMlResult(res.data);
        }
      } catch {
        if (isMounted) setSingleMlResult(null);
      } finally {
        if (isMounted) setSingleMlLoading(false);
      }
    };
    fetchTargetMl();
    return () => {
      isMounted = false;
    };
  }, [currentBioSample, selectedAntibiotic]);

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

  // Target Antibiotic Multi-Source & ML Metrics
  const targetOrganism = isolateDetails?.organism || 'Escherichia coli';
  const targetFinding = reconciliationResult?.findings?.find(
    (f) => (f.antibiotic || '').toLowerCase() === selectedAntibiotic.toLowerCase()
  );
  const targetAstRecord = (isolateDetails?.ast_records || []).find(
    (r) => (r.antibiotic || r.drug || '').toLowerCase() === selectedAntibiotic.toLowerCase()
  );
  const targetUserLab = userLabRecords.find(
    (r) => (r.antibiotic || '').toLowerCase() === selectedAntibiotic.toLowerCase()
  );

  // Model status resolution
  const hasSpec = !!singleMlResult?.has_specialist;
  const hasExp = !hasSpec && !!singleMlResult?.has_experimental;
  const hasBroad = !hasSpec && !hasExp && (!!singleMlResult?.has_broad || (singleMlResult?.available && singleMlResult?.model_family === 'broad'));
  const hasNoModel = !hasSpec && !hasExp && !hasBroad && !singleMlResult?.available;

  let modelStatusLabel = 'No applicable ML model available for this organism–antibiotic combination.';
  let modelStatusClass = 'none';
  if (hasSpec) {
    modelStatusLabel = 'Validated Specialist Model';
    modelStatusClass = 'validated';
  } else if (hasExp) {
    modelStatusLabel = 'Experimental Research Model';
    modelStatusClass = 'experimental';
  } else if (hasBroad || singleMlResult?.available) {
    modelStatusLabel = 'Broad ML1 Research Model';
    modelStatusClass = 'broad';
  }

  // Active prediction object for selected antibiotic
  const activeMlPred = hasSpec
    ? (singleMlResult?.specialist_prediction || singleMlResult)
    : (singleMlResult?.broad_prediction || singleMlResult);

  const isModelApplicable = (hasSpec || hasExp || hasBroad || singleMlResult?.available) && activeMlPred && activeMlPred.prediction;

  const predProbability = isModelApplicable && activeMlPred.predicted_probability !== undefined
    ? (activeMlPred.predicted_probability * 100).toFixed(1)
    : null;

  const predClass = isModelApplicable ? (activeMlPred.prediction || 'Unknown') : 'N/A';

  const observedPhenotype = targetAstRecord?.phenotype || targetFinding?.ncbi_ast?.phenotype || 'Not available';

  // Prediction vs. Observed Phenotype calculation
  let predVsObsStatus = 'Not comparable';
  let predVsObsBadgeClass = 'not-comparable';
  let predVsObsExplanation = 'Requires an applicable ML model and recorded experimental AST.';

  if (isModelApplicable && observedPhenotype && observedPhenotype.toLowerCase() !== 'not available') {
    const pNorm = (predClass || '').toLowerCase();
    const oNorm = observedPhenotype.toLowerCase();
    if (pNorm === oNorm) {
      predVsObsStatus = 'Agreement';
      predVsObsBadgeClass = 'agreement';
      predVsObsExplanation = `Predicted ${predClass} matches experimentally observed ${observedPhenotype}.`;
    } else if ((pNorm === 'resistant' && oNorm === 'susceptible') || (pNorm === 'susceptible' && oNorm === 'resistant')) {
      predVsObsStatus = 'Disagreement';
      predVsObsBadgeClass = 'disagreement';
      predVsObsExplanation = `Predicted ${predClass} disagrees with experimentally observed ${observedPhenotype}.`;
    } else {
      predVsObsStatus = 'Not comparable';
      predVsObsBadgeClass = 'not-comparable';
      predVsObsExplanation = 'Intermediate or non-standard phenotype cannot be strictly categorized.';
    }
  }

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

      {/* TARGET ANTIBIOTIC SELECTOR BANNER */}
      {isolateDetails && (
        <div className="antibiotic-selector-banner slide-down">
          <div className="antibiotic-selector-label">
            <span>🎯</span> Target Antibiotic:
          </div>
          <select
            id="target-abx-select"
            className="antibiotic-dropdown"
            value={selectedAntibiotic}
            onChange={(e) => {
              const newAbx = e.target.value;
              setSelectedAntibiotic(newAbx);
              setFormAbx(newAbx.toLowerCase());
            }}
          >
            {availableAntibiotics.map((abx) => (
              <option key={abx} value={abx}>
                {abx}
              </option>
            ))}
          </select>
          <div className="antibiotic-selector-count">
            <span>{availableAntibiotics.length} tested antibiotic(s) identified for this isolate</span>
          </div>
        </div>
      )}

      {/* 4-SOURCE EVIDENCE RECONCILIATION SYNTHESIS */}
      {isolateDetails && (
        <div className="reconciliation-section-card fade-in">
          <div className="section-card-header">
            <span className="section-card-title">
              <span>⚖️</span> Multi-Source Evidence Synthesis — {selectedAntibiotic}
            </span>
            <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
              [Genomic Evidence] + [Public AST] + [User Laboratory AST] + [ML Research Result] → Evidence Summary
            </span>
          </div>

          <div className="four-boxes-synthesis-grid">
            {/* Box 1: Genomic Evidence */}
            <div className="synthesis-box genomic-box">
              <span className="synthesis-box-title">🧬 Genomic Evidence</span>
              <div className="synthesis-box-value">
                {targetFinding?.genomic_evidence?.has_determinant ? (
                  <span className="gene-evidence-code">
                    {formatGenotypeEntries(targetFinding.genomic_evidence.evidence_str).join(', ') || targetFinding.genomic_evidence.evidence_str}
                  </span>
                ) : isolateDetails.amr_genotypes ? (
                  <span style={{ fontSize: '0.86rem', color: '#cbd5e1' }}>
                    {formatGenotypeEntries(isolateDetails.amr_genotypes).slice(0, 2).join(', ')}
                    {formatGenotypeEntries(isolateDetails.amr_genotypes).length > 2 ? ' ...' : ''}
                  </span>
                ) : (
                  <span className="gene-evidence-none">No determinant detected</span>
                )}
              </div>
              <div className="synthesis-box-sub">
                {targetFinding?.genomic_evidence?.mapping_basis || 'NCBI AMRFinderPlus / ResFinder'}
              </div>
            </div>

            {/* Box 2: Public AST */}
            <div className="synthesis-box ast-box">
              <span className="synthesis-box-title">🧪 Public AST</span>
              <div className="synthesis-box-value">
                <span className={`ast-phenotype-pill ${observedPhenotype.toLowerCase()}`}>
                  {observedPhenotype}
                </span>
              </div>
              <div className="synthesis-box-sub">
                {targetAstRecord?.measurement ? `MIC: ${targetAstRecord.measurement}` : 'NCBI Reference Antibiogram'}
              </div>
            </div>

            {/* Box 3: User Laboratory AST */}
            <div className="synthesis-box user-box">
              <span className="synthesis-box-title">🔬 User Laboratory AST</span>
              <div className="synthesis-box-value">
                {targetUserLab ? (
                  <span className={`ast-phenotype-pill ${targetUserLab.phenotype.toLowerCase()}`}>
                    {targetUserLab.phenotype}
                  </span>
                ) : (
                  <span style={{ fontSize: '0.86rem', color: '#64748b', fontStyle: 'italic' }}>
                    None entered (optional)
                  </span>
                )}
              </div>
              <div className="synthesis-box-sub">
                {targetUserLab?.mic ? `MIC: ${targetUserLab.mic}` : 'In-House Testing (Section D)'}
              </div>
            </div>

            {/* Box 4: ML Research Result */}
            <div className="synthesis-box ml-box">
              <span className="synthesis-box-title">🧠 ML Research Result</span>
              <div className="synthesis-box-value">
                {singleMlLoading ? (
                  <span style={{ fontSize: '0.84rem', color: '#94a3b8' }}>Evaluating...</span>
                ) : isModelApplicable ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span className={`ml-pred-class ${predClass.toLowerCase()}`}>
                      {predClass}
                    </span>
                    <span style={{ fontSize: '0.9rem', color: '#fbbf24', fontWeight: 700 }}>
                      ({predProbability}%)
                    </span>
                  </div>
                ) : (
                  <span style={{ fontSize: '0.84rem', color: '#94a3b8', fontStyle: 'italic' }}>
                    No applicable model
                  </span>
                )}
              </div>
              <div className="synthesis-box-sub">
                {modelStatusLabel}
              </div>
            </div>
          </div>

          {/* Synthesis Card Summary */}
          <div className="synthesis-summary-card">
            <div className="synthesis-summary-row">
              <div>
                <span style={{ fontSize: '0.78rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
                  Reconciliation Outcome:
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.25rem' }}>
                  {targetFinding ? (
                    <>
                      <span className={`classification-badge ${targetFinding.has_conflict ? 'discordant' : targetFinding.reconciliation_category?.startsWith('concordant') ? 'concordant' : 'not-comparable'}`}>
                        {targetFinding.reconciliation_status}
                      </span>
                      <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                        Strength: <strong>{targetFinding.evidence_strength}</strong>
                      </span>
                    </>
                  ) : (
                    <span style={{ fontSize: '0.88rem', color: '#f59e0b' }}>
                      Ready for reconciliation — click &quot;Run Deterministic Evidence Reconciliation&quot; below to compare sources.
                    </span>
                  )}
                </div>
              </div>
              {targetFinding?.summary_statement && (
                <div style={{ fontSize: '0.85rem', color: '#cbd5e1', maxWidth: '580px' }}>
                  {targetFinding.summary_statement}
                </div>
              )}
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
                onChange={(e) => {
                  setFormAbx(e.target.value);
                  const match = availableAntibiotics.find(a => a.toLowerCase() === e.target.value.toLowerCase());
                  if (match) setSelectedAntibiotic(match);
                }}
              >
                <optgroup label="Tested on this Isolate">
                  {availableAntibiotics.map((abx) => (
                    <option key={abx} value={abx.toLowerCase()}>
                      {abx}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Other Standard Antibiotics">
                  {COMMON_ANTIBIOTICS.filter(a => !availableAntibiotics.some(avail => avail.toLowerCase() === a.toLowerCase())).map((abx) => (
                    <option key={abx} value={abx}>
                      {abx.charAt(0).toUpperCase() + abx.slice(1)}
                    </option>
                  ))}
                </optgroup>
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

              {/* DEDICATED MACHINE LEARNING ANALYSIS SECTION */}
              <div className="ml-analysis-section reconciliation-section-card">
                <div className="section-card-header" style={{ paddingBottom: '0.5rem' }}>
                  <span className="section-card-title">
                    <span>🔬</span> Machine Learning Analysis — {selectedAntibiotic}
                  </span>
                  <span className={`ml-status-pill ${modelStatusClass}`}>
                    {modelStatusLabel}
                  </span>
                </div>

                <div className="ml-analysis-details-grid">
                  {/* Item 1: Target Organism */}
                  <div className="ml-metric-card">
                    <span className="ml-metric-title">Target Organism</span>
                    <div className="ml-metric-value highlight">
                      {targetOrganism}
                    </div>
                    <span className="ml-metric-sub">
                      Host pathogen taxonomic classification
                    </span>
                  </div>

                  {/* Item 2: Target Antibiotic */}
                  <div className="ml-metric-card">
                    <span className="ml-metric-title">Target Antibiotic</span>
                    <div className="ml-metric-value highlight">
                      {selectedAntibiotic}
                    </div>
                    <span className="ml-metric-sub">
                      Selected compound for model inference
                    </span>
                  </div>

                  {/* Item 3: Model Status */}
                  <div className="ml-metric-card">
                    <span className="ml-metric-title">Model Status</span>
                    <div style={{ marginTop: '0.2rem' }}>
                      <span className={`ml-status-pill ${modelStatusClass}`}>
                        {modelStatusLabel}
                      </span>
                    </div>
                    <span className="ml-metric-sub">
                      {hasSpec
                        ? (singleMlResult?.specialist_prediction?.model_version || singleMlResult?.model || 'AMR Specialist Model')
                        : hasExp
                        ? (singleMlResult?.experimental_model || 'Specialist candidate (pending validation)')
                        : hasBroad
                        ? (singleMlResult?.broad_prediction?.model_version || 'AMR-ML1-BROAD-v0.2')
                        : 'No validated model registered'}
                    </span>
                  </div>

                  {/* Item 4: Predicted Resistance Probability */}
                  <div className="ml-metric-card">
                    <span className="ml-metric-title">Predicted Resistance Probability</span>
                    <div className="ml-metric-value prob">
                      {isModelApplicable ? `${predProbability}%` : 'N/A'}
                    </div>
                    {isModelApplicable && (
                      <div className="ml-mini-prob-bar">
                        <div
                          className="ml-mini-fill"
                          style={{ width: `${Math.min(100, Math.max(0, (activeMlPred.predicted_probability || 0) * 100))}%` }}
                        />
                      </div>
                    )}
                    <span className="ml-metric-sub">
                      Decision Threshold: 0.50 (50.0%)
                    </span>
                  </div>

                  {/* Item 5: Predicted Classification */}
                  <div className="ml-metric-card">
                    <span className="ml-metric-title">Predicted Classification</span>
                    <div className="ml-metric-value">
                      {isModelApplicable ? (
                        <span className={`ml-pred-class ${predClass.toLowerCase()}`}>
                          {predClass}
                        </span>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>N/A</span>
                      )}
                    </div>
                    <span className="ml-metric-sub">
                      Binary classification derived from genomic features
                    </span>
                  </div>

                  {/* Item 6: Observed AST (Reference Only) */}
                  <div className="ml-metric-card">
                    <span className="ml-metric-title">Observed AST (Reference)</span>
                    <div className="ml-metric-value">
                      <span className={`ast-phenotype-pill ${observedPhenotype.toLowerCase()}`}>
                        {observedPhenotype}
                      </span>
                    </div>
                    <span className="ml-metric-sub">
                      {targetAstRecord?.measurement ? `MIC: ${targetAstRecord.measurement}` : 'From isolate experimental record (AST is never an ML input)'}
                    </span>
                  </div>

                  {/* Item 7: Prediction vs Observed Phenotype */}
                  <div className="ml-metric-card full-width">
                    <span className="ml-metric-title">Prediction vs. Observed Phenotype</span>
                    <div className="ml-comparison-row" style={{ marginTop: '0.35rem' }}>
                      <span className={`ml-agreement-badge ${predVsObsBadgeClass}`}>
                        {predVsObsStatus}
                      </span>
                      <span className="ml-comparison-explanation">
                        {predVsObsExplanation}
                      </span>
                    </div>
                  </div>

                  {/* Item 8: Notice if no model is applicable */}
                  {hasNoModel && (
                    <div className="ml-no-model-alert">
                      ℹ️ No applicable ML model available for this organism–antibiotic combination. Predictions are only produced for combinations with validated training data.
                    </div>
                  )}
                </div>

                {/* Specific Research Disclaimer */}
                <div className="ml-disclaimer-box" style={{ marginTop: '0.75rem' }}>
                  ML predictions are research-oriented and should not replace laboratory antimicrobial susceptibility testing or be used for clinical treatment decisions.
                </div>
              </div>

              {/* SECTION G SUBHEADER: MULTI-DRUG PAN-PATHOGEN OVERVIEW */}
              <div style={{ marginTop: '1.25rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  📊 Multi-Drug Research Evaluation Grid
                </span>
                <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                  Click chips below to inspect other drugs tested for this isolate
                </span>
              </div>

              {/* Antibiotic Selector Tabs */}
              {(() => {
                const allPredictions = mlPrediction.predictions && Array.isArray(mlPrediction.predictions)
                  ? mlPrediction.predictions
                  : [mlPrediction];
                const displayedPredictions = selectedMlDrug === 'ALL'
                  ? allPredictions
                  : allPredictions.filter(p => (p.antibiotic || '').toLowerCase() === selectedMlDrug.toLowerCase());

                return (
                  <>
                    <div className="ml-drug-selector-bar">
                      <button
                        type="button"
                        className={`ml-drug-filter-chip ${selectedMlDrug === 'ALL' ? 'active' : ''}`}
                        onClick={() => setSelectedMlDrug('ALL')}
                      >
                        All Evaluated Drugs ({allPredictions.length})
                      </button>
                      {allPredictions.map((p, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className={`ml-drug-filter-chip ${selectedMlDrug.toLowerCase() === (p.antibiotic || '').toLowerCase() ? 'active' : ''}`}
                          onClick={() => setSelectedMlDrug(p.antibiotic || '')}
                        >
                          {p.antibiotic || '(Unknown)'} {(p.available || p.has_broad) ? '✓' : ''}
                        </button>
                      ))}
                    </div>

                    {/* Predictions Grid */}
                    <div className="ml-drug-predictions-grid">
                      {displayedPredictions.map((pred, pIdx) => {
                        const broad = pred.broad_prediction || {};
                        const specialist = pred.specialist_prediction || {};
                        const hasBoth = pred.selection_case === 'both' || (pred.has_broad && pred.has_specialist);
                        const hasBroadOnly = pred.selection_case === 'broad_only' || (pred.has_broad && !pred.has_specialist);
                        const hasSpecOnly = pred.selection_case === 'specialist_only' || (!pred.has_broad && pred.has_specialist);

                        return (
                          <div key={pIdx} className={`ml-drug-card ${(pred.available || pred.has_broad) ? 'available' : 'unavailable'}`}>
                            <div className="ml-drug-header">
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                                <span className="ml-drug-title">{pred.antibiotic || '(Unknown Drug)'}</span>
                                {hasBoth ? (
                                  <>
                                    <span className="ml-badge-specialist">Specialist</span>
                                    <span className="ml-badge-broad">Broad ML1</span>
                                  </>
                                ) : hasBroadOnly ? (
                                  <span className="ml-badge-broad">Broad ML1 Only</span>
                                ) : hasSpecOnly ? (
                                  <span className="ml-badge-specialist">Specialist Only</span>
                                ) : pred.reason === 'ML_SERVICE_ERROR' ? (
                                  <span style={{ fontSize: '0.75rem', color: '#f87171', background: 'rgba(239,68,68,0.08)', padding: '0.2rem 0.5rem', borderRadius: 4 }}>
                                    ML Service Unavailable
                                  </span>
                                ) : (
                                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', background: 'rgba(255,255,255,0.05)', padding: '0.2rem 0.5rem', borderRadius: 4 }}>
                                    No Validated Model
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Informational Selection Case Note */}
                            {pred.display_note && (
                              <div className="ml-case-note">
                                {pred.display_note}
                              </div>
                            )}

                            {pred.available ? (
                              <div className={`ml-dual-models-container ${hasBoth ? 'two-columns' : ''}`}>
                                {/* Broad ML1 Subcard */}
                                {broad.available && (
                                  <div className="ml-subcard broad">
                                    <div className="ml-subcard-header">
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                        <span className="ml-badge-broad">Broad ML1</span>
                                        <span className="ml-subcard-title">{broad.model_version || 'AMR-ML1-BROAD-v0.1'}</span>
                                      </div>
                                      <span className={`ml-pred-class ${broad.prediction === 'Resistant' ? 'resistant' : 'susceptible'}`}>
                                        {broad.prediction}
                                      </span>
                                    </div>

                                    {/* Probability Bar */}
                                    <div className="ml-prob-bar-container">
                                      <div className="ml-prob-bar-label-row">
                                        <span>Susceptible ({((broad.probability_susceptible || 0) * 100).toFixed(1)}%)</span>
                                        <span>Predicted Resistance Probability: <strong>{((broad.predicted_probability || 0) * 100).toFixed(1)}%</strong></span>
                                      </div>
                                      <div className="ml-prob-bar">
                                        <div
                                          className="ml-prob-bar-fill susceptible"
                                          style={{ width: `${(broad.probability_susceptible || 0) * 100}%` }}
                                        />
                                        <div
                                          className="ml-prob-bar-fill resistant"
                                          style={{ width: `${(broad.predicted_probability || 0) * 100}%` }}
                                        />
                                      </div>
                                      <div className="ml-threshold-marker" style={{ left: '50%' }}>
                                        <span>Threshold: 0.50</span>
                                      </div>
                                    </div>

                                    <div style={{ fontSize: '0.74rem', color: '#94a3b8', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '0.35rem' }}>
                                      Scope: Multi-Organism / Multi-Antibiotic Pan-Pathogen | Features: {broad.recognized_features || 0}/{broad.total_determinants || 0}
                                    </div>
                                  </div>
                                )}

                                {/* Specialist Model Subcard */}
                                {specialist.available && (
                                  <div className="ml-subcard specialist">
                                    <div className="ml-subcard-header">
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                        <span className="ml-badge-specialist">Specialist</span>
                                        <span className="ml-subcard-title">{specialist.model_version || specialist.model}</span>
                                      </div>
                                      <span className={`ml-pred-class ${specialist.prediction === 'Resistant' ? 'resistant' : 'susceptible'}`}>
                                        {specialist.prediction}
                                      </span>
                                    </div>

                                    {/* Probability Bar */}
                                    <div className="ml-prob-bar-container">
                                      <div className="ml-prob-bar-label-row">
                                        <span>Susceptible ({((specialist.probability_susceptible || 0) * 100).toFixed(1)}%)</span>
                                        <span>Predicted Resistance Probability: <strong>{((specialist.predicted_probability || 0) * 100).toFixed(1)}%</strong></span>
                                      </div>
                                      <div className="ml-prob-bar">
                                        <div
                                          className="ml-prob-bar-fill susceptible"
                                          style={{ width: `${(specialist.probability_susceptible || 0) * 100}%` }}
                                        />
                                        <div
                                          className="ml-prob-bar-fill resistant"
                                          style={{ width: `${(specialist.predicted_probability || 0) * 100}%` }}
                                        />
                                      </div>
                                      <div className="ml-threshold-marker" style={{ left: '50%' }}>
                                        <span>Threshold: 0.50</span>
                                      </div>
                                    </div>

                                    <div style={{ fontSize: '0.74rem', color: '#94a3b8', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '0.35rem' }}>
                                      Scope: {specialist.organism} + {specialist.antibiotic} | Training N = {specialist.training_sample_count || 'Validated'}
                                    </div>
                                  </div>
                                )}

                                {/* Specialist Unavailable notice when only Broad is present */}
                                {hasBroadOnly && (
                                  <div style={{ fontSize: '0.76rem', color: '#64748b', fontStyle: 'italic', padding: '0.35rem 0' }}>
                                    Broad model prediction available; no specialist model currently validated for this combination.
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div style={{ fontSize: '0.82rem', color: '#94a3b8', fontStyle: 'italic' }}>
                                No validated ML prediction available for this organism–antibiotic combination.
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}

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

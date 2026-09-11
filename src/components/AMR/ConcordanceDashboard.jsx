import React, { useState } from 'react';
import './ConcordanceDashboard.css';

export default function ConcordanceDashboard({ isolateData }) {
  const [activeFilter, setActiveFilter] = useState('ALL');

  if (!isolateData) return null;

  const {
    biosample_accession,
    assembly_accession,
    organism,
    amr_genotypes,
    comparisons = [],
    summary_metrics = {}
  } = isolateData;

  const totalAstRecords = summary_metrics.total_ast_records ?? comparisons.length;
  const concordantCount = summary_metrics.concordant ?? 0;
  const discordantCount = summary_metrics.discordant ?? 0;
  const notComparableCount = summary_metrics.not_comparable ?? 0;
  const notEvaluableCount = summary_metrics.not_evaluable ?? 0;

  // Split genotype string into clean array for visual tags
  const genotypeList = amr_genotypes
    ? amr_genotypes.split(',').map((g) => g.trim()).filter(Boolean)
    : [];

  // Whole-isolate empty state check (Total AST Records == 0)
  if (totalAstRecords === 0) {
    return (
      <div className="concordance-dashboard fade-in">
        {/* Isolate Header */}
        <div className="isolate-header-card">
          <div className="isolate-header-top">
            <div className="isolate-title-area">
              <span style={{ fontSize: '1.2rem' }}>🔬</span>
              <span className="isolate-accession-badge">{biosample_accession}</span>
            </div>
            <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
              Organism: <strong style={{ color: '#f1f5f9' }}>{organism || 'Escherichia coli'}</strong>
            </span>
          </div>
          <div className="isolate-meta-grid">
            <div className="isolate-meta-item">
              <span className="isolate-meta-label">Assembly</span>
              <span className="isolate-meta-val">{assembly_accession || 'N/A'}</span>
            </div>
            <div className="isolate-meta-item">
              <span className="isolate-meta-label">Total AST Records</span>
              <span className="isolate-meta-val">0</span>
            </div>
          </div>
        </div>

        {/* Whole Isolate Not Evaluable Notice */}
        <div className="whole-isolate-empty-state">
          <div className="empty-state-icon">⚠️</div>
          <h3 className="empty-state-title">No eligible AST data available</h3>
          <p className="empty-state-text">
            Genomic AMR information may be available for this BioSample, but no eligible S/I/R AST records were found for genotype–phenotype comparison.
          </p>
          <div className="empty-state-status-badge">
            Comparison status: Not evaluable
          </div>
        </div>
      </div>
    );
  }

  // Filtered comparison rows
  const filteredComparisons = comparisons.filter((row) => {
    if (activeFilter === 'ALL') return true;
    return (row.classification || '').toLowerCase() === activeFilter.toLowerCase();
  });

  return (
    <div className="concordance-dashboard fade-in">
      {/* 1. ISOLATE METADATA CARD */}
      <div className="isolate-header-card">
        <div className="isolate-header-top">
          <div className="isolate-title-area">
            <span style={{ fontSize: '1.25rem' }}>🔬</span>
            <span className="isolate-accession-badge">{biosample_accession}</span>
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
            <span className="isolate-meta-label" style={{ margin: 0 }}>Organism:</span>
            <span style={{ fontSize: '0.92rem', color: '#f1f5f9', fontWeight: 600 }}>
              {organism || 'Escherichia coli'}
            </span>
          </div>
        </div>

        <div className="isolate-meta-grid">
          <div className="isolate-meta-item">
            <span className="isolate-meta-label">Assembly Accession</span>
            <span className="isolate-meta-val">{assembly_accession || '—'}</span>
          </div>
          <div className="isolate-meta-item">
            <span className="isolate-meta-label">Total AST Records</span>
            <span className="isolate-meta-val">{totalAstRecords}</span>
          </div>
          <div className="isolate-meta-item">
            <span className="isolate-meta-label">Comparable Pairs</span>
            <span className="isolate-meta-val">
              {summary_metrics.comparable_pairs ?? (concordantCount + discordantCount)}
            </span>
          </div>
          <div className="isolate-meta-item">
            <span className="isolate-meta-label">Concordance Rate</span>
            <span className="isolate-meta-val" style={{ color: '#10b981' }}>
              {summary_metrics.concordance_percentage !== undefined
                ? `${summary_metrics.concordance_percentage}%`
                : '—'}
            </span>
          </div>
        </div>

        {genotypeList.length > 0 && (
          <div className="isolate-genotypes-box">
            <span className="isolate-meta-label">Detected Genomic AMR Determinants ({genotypeList.length})</span>
            <div className="genotype-tags-list">
              {genotypeList.map((g, idx) => (
                <span key={idx} className="genotype-tag">{g}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 2. FOUR-CATEGORY SUMMARY METRICS */}
      <div className="metrics-grid-four">
        {/* Total */}
        <div className="metric-card-four total">
          <div className="metric-header">
            <span className="metric-name">Total AST</span>
            <span>📊</span>
          </div>
          <div className="metric-value-num">{totalAstRecords}</div>
          <p className="metric-desc">Total antibiotic susceptibility records evaluated for this isolate.</p>
        </div>

        {/* Concordant */}
        <div className="metric-card-four concordant">
          <div className="metric-header">
            <span className="metric-name">Concordant</span>
            <span>✓</span>
          </div>
          <div className="metric-value-num">{concordantCount}</div>
          <p className="metric-desc">Genomic evidence agrees with the observed AST phenotype.</p>
        </div>

        {/* Discordant */}
        <div className="metric-card-four discordant">
          <div className="metric-header">
            <span className="metric-name">Discordant</span>
            <span>✕</span>
          </div>
          <div className="metric-value-num">{discordantCount}</div>
          <p className="metric-desc">Genomic evidence conflicts with the observed AST phenotype.</p>
        </div>

        {/* Not Comparable */}
        <div className="metric-card-four not-comparable">
          <div className="metric-header">
            <span className="metric-name">Not Comparable</span>
            <span>—</span>
          </div>
          <div className="metric-value-num">{notComparableCount}</div>
          <p className="metric-desc">AST data available, but no documented genotype–antibiotic relationship exists.</p>
        </div>

        {/* Not Evaluable */}
        <div className="metric-card-four not-evaluable">
          <div className="metric-header">
            <span className="metric-name">Not Evaluable</span>
            <span>?</span>
          </div>
          <div className="metric-value-num">{notEvaluableCount}</div>
          <p className="metric-desc">AST phenotype was not defined or no eligible S/I/R data are available.</p>
        </div>
      </div>

      {/* 3. TOTAL RECONCILIATION BAR */}
      <div className="reconciliation-card">
        <div className="reconciliation-title">
          <span>⚖️</span> Total Reconciliation
        </div>
        <div className="reconciliation-formula">
          <span className="formula-part conc">Concordant: {concordantCount}</span>
          <span className="formula-op">+</span>
          <span className="formula-part disc">Discordant: {discordantCount}</span>
          <span className="formula-op">+</span>
          <span className="formula-part notcomp">Not Comparable: {notComparableCount}</span>
          <span className="formula-op">+</span>
          <span className="formula-part noteval">Not Evaluable: {notEvaluableCount}</span>
          <span className="formula-op">=</span>
          <span className="formula-part total">Total AST: {totalAstRecords}</span>
        </div>
      </div>

      {/* 4. COMPARISON TABLE WITH FILTERS */}
      <div>
        <div className="table-controls-bar">
          <div className="table-filter-chips">
            <button
              className={`filter-chip ${activeFilter === 'ALL' ? 'active' : ''}`}
              onClick={() => setActiveFilter('ALL')}
            >
              All ({totalAstRecords})
            </button>
            <button
              className={`filter-chip ${activeFilter === 'Concordant' ? 'active' : ''}`}
              onClick={() => setActiveFilter('Concordant')}
            >
              Concordant ({concordantCount})
            </button>
            <button
              className={`filter-chip ${activeFilter === 'Discordant' ? 'active' : ''}`}
              onClick={() => setActiveFilter('Discordant')}
            >
              Discordant ({discordantCount})
            </button>
            <button
              className={`filter-chip ${activeFilter === 'Not comparable' ? 'active' : ''}`}
              onClick={() => setActiveFilter('Not comparable')}
            >
              Not Comparable ({notComparableCount})
            </button>
            <button
              className={`filter-chip ${activeFilter === 'Not evaluable' ? 'active' : ''}`}
              onClick={() => setActiveFilter('Not evaluable')}
            >
              Not Evaluable ({notEvaluableCount})
            </button>
          </div>
          <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
            Showing {filteredComparisons.length} of {totalAstRecords} records
          </span>
        </div>

        <div className="table-wrapper">
          <table className="concordance-table">
            <thead>
              <tr>
                <th>Antibiotic</th>
                <th>Genomic Evidence</th>
                <th>AST Phenotype</th>
                <th>Classification</th>
                <th>Evaluation Details</th>
              </tr>
            </thead>
            <tbody>
              {filteredComparisons.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                    No records match the selected filter ({activeFilter}).
                  </td>
                </tr>
              ) : (
                filteredComparisons.map((row, idx) => {
                  const isDiscordant = (row.classification || '').toLowerCase() === 'discordant';
                  const hasGene = row.genotype_evidence && row.genotype_evidence !== '(none)';
                  const phClass = (row.phenotype || '').toLowerCase();

                  return (
                    <tr
                      key={idx}
                      className={isDiscordant ? 'row-discordant' : ''}
                    >
                      {/* Antibiotic */}
                      <td className="abx-name-cell">
                        {row.antibiotic || '—'}
                      </td>

                      {/* Genomic Evidence */}
                      <td>
                        {hasGene ? (
                          <span className="gene-evidence-code">{row.genotype_evidence}</span>
                        ) : (
                          <span className="gene-evidence-none">—</span>
                        )}
                      </td>

                      {/* AST Phenotype */}
                      <td>
                        <span className={`ast-phenotype-pill ${phClass}`}>
                          {row.phenotype || 'Not defined'}
                        </span>
                        {row.mic && (
                          <span className="mic-subtext">MIC: {row.mic}</span>
                        )}
                      </td>

                      {/* Classification */}
                      <td>
                        <span className={`classification-badge ${(row.classification || 'not-comparable').toLowerCase().replace(/\s+/g, '-')}`}>
                          {row.classification || 'Not comparable'}
                        </span>
                      </td>

                      {/* Details / Reason */}
                      <td>
                        <span className="eval-reason-text">
                          {row.reason || row.mapping_basis || '—'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. PRELIMINARY VALIDATION BENCHMARK NOTE */}
      <div className="validation-benchmark-panel">
        <span className="benchmark-badge">Preliminary Validation</span>
        <p className="benchmark-text">
          26 of 28 comparable genotype–phenotype pairs were concordant (92.9%) in a preliminary five-isolate validation set.
          This metric represents preliminary research concordance across frozen validation data and is not representative of all clinical isolates.
        </p>
      </div>
    </div>
  );
}

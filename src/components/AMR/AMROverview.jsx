import React from 'react';
import './AMROverview.css';

export default function AMROverview({ onNavigateAnalysis, onNavigateHome, onNavigateDna }) {
  return (
    <div className="amr-overview-container fade-in">
      {/* HEADER SECTION */}
      <header className="amr-overview-header">
        <div className="amr-overview-badge">AMR Research Module &bull; Phase 4</div>
        <h1 className="amr-overview-title">Antimicrobial Resistance Research</h1>
        <p className="amr-overview-explanation">
          Detection of a resistance-associated genomic determinant does not necessarily guarantee phenotypic resistance. This module evaluates documented genotype–antibiotic relationships against isolate-level AST observations and highlights potentially discordant cases.
        </p>
      </header>

      {/* WORKFLOW ARCHITECTURE CARD */}
      <section className="amr-diagram-card">
        <h2 className="amr-diagram-title">Genotype–Phenotype Concordance Pipeline</h2>
        <p className="amr-diagram-subtitle">Standardized four-state comparison model for isolate resistance determinants</p>

        <div className="amr-flow-diagram">
          <div className="amr-flow-box genomic">
            GENOMIC EVIDENCE (NCBI BioSample / AMRFinderPlus)
          </div>
          <div className="amr-flow-arrow">↓</div>
          
          <div className="amr-flow-box genotype">
            AMR GENOTYPE DETERMINATION
          </div>
          <div className="amr-flow-arrow">↓</div>

          <div className="amr-flow-converge">
            <div className="amr-flow-box comparison">
              ⚖️ COMPARISON ENGINE
            </div>
            <div className="amr-flow-box phenotype">
              AST PHENOTYPE (NCBI Antibiogram)
            </div>
          </div>
          <div className="amr-flow-arrow">↓</div>

          <div className="amr-flow-outcomes">
            <div className="amr-outcome-pill concordant">
              CONCORDANT
            </div>
            <div className="amr-outcome-pill discordant">
              DISCORDANT
            </div>
            <div className="amr-outcome-pill not-comparable">
              NOT COMPARABLE
            </div>
            <div className="amr-outcome-pill not-evaluable">
              NOT EVALUABLE
            </div>
          </div>
        </div>
      </section>

      {/* CTA SECTION */}
      <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
        <button
          className="amr-nav-btn primary"
          style={{ margin: '0 auto', fontSize: '1.05rem', padding: '0.9rem 2rem' }}
          onClick={onNavigateAnalysis}
        >
          <span>Analyze a BioSample</span>
          <span>→</span>
        </button>
      </div>

      {/* RESEARCH DISCLAIMER */}
      <section className="amr-disclaimer-card">
        <h3 className="amr-disclaimer-title">Research &amp; Educational Use</h3>
        <p className="amr-disclaimer-text">
          This module is intended for educational and preliminary research purposes. Genomic AMR findings and concordance analyses should not be interpreted as clinical diagnoses or treatment recommendations.
        </p>
      </section>

      {/* NAVIGATION CONTROLS */}
      <div className="amr-nav-actions">
        {onNavigateHome && (
          <button
            className="amr-nav-btn secondary"
            onClick={onNavigateHome}
          >
            <span>←</span> Platform Hub
          </button>
        )}
        {onNavigateDna && (
          <button
            className="amr-nav-btn secondary"
            onClick={onNavigateDna}
          >
            DNA Analyzer <span>→</span>
          </button>
        )}
      </div>
    </div>
  );
}

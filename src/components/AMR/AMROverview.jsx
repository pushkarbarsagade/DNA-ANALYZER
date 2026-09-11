import React from 'react';
import './AMROverview.css';

export default function AMROverview({ onNavigateHome, onNavigateDna }) {
  return (
    <div className="amr-overview-container fade-in">
      {/* HEADER SECTION */}
      <header className="amr-overview-header">
        <div className="amr-overview-badge">Research Module &bull; In Development</div>
        <h1 className="amr-overview-title">AMR Research</h1>
        <p className="amr-overview-explanation">
          Antimicrobial resistance can be studied by comparing resistance-associated genomic determinants with experimentally observed antibiotic susceptibility. This research module is being developed to evaluate those relationships at the isolate level and identify potentially discordant genotype–phenotype observations.
        </p>
      </header>

      {/* DIAGRAM SECTION */}
      <section className="amr-diagram-card">
        <h2 className="amr-diagram-title">Genotype–Phenotype Comparison Architecture</h2>
        <p className="amr-diagram-subtitle">Standardized evaluation pipeline for isolate resistance profiles</p>

        <div className="amr-flow-diagram">
          <div className="amr-flow-box genomic">
            GENOMIC EVIDENCE (NCBI / AMRFinderPlus)
          </div>
          <div className="amr-flow-arrow">↓</div>
          
          <div className="amr-flow-box genotype">
            AMR GENOTYPE DETERMINATION
          </div>
          <div className="amr-flow-arrow">↓</div>

          <div className="amr-flow-converge">
            <div className="amr-flow-box comparison">
              ⚖️ COMPARISON &amp; EVALUATION
            </div>
            <div className="amr-flow-box phenotype">
              AST PHENOTYPE (Antibiogram)
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

      {/* CURRENT RESEARCH STATUS SECTION */}
      <section className="amr-status-card">
        <h3 className="amr-status-title">
          <span>📋</span> Current Research Status
        </h3>
        <div className="amr-status-items">
          <div className="amr-status-item">
            <span className="amr-status-check complete">✓</span>
            <div>
              <strong>Validated backend workflow available</strong>
              <div style={{ fontSize: '0.84rem', color: '#94a3b8' }}>
                Standardized comparison engine and isolate classification logic verified across frozen validation isolates.
              </div>
            </div>
          </div>

          <div className="amr-status-item">
            <span className="amr-status-check upcoming">⏳</span>
            <div>
              <strong>Interactive AMR analysis interface will be added in the next phase</strong>
              <div style={{ fontSize: '0.84rem', color: '#94a3b8' }}>
                Interactive isolate explorer, concordance tables, and discrepancy inspector are queued for Phase 4.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* NAVIGATION CONTROLS */}
      <div className="amr-nav-actions">
        <button
          className="amr-nav-btn secondary"
          onClick={onNavigateHome}
        >
          <span>←</span> Back to Platform Hub
        </button>
        <button
          className="amr-nav-btn primary"
          onClick={onNavigateDna}
        >
          Explore DNA Analyzer <span>→</span>
        </button>
      </div>
    </div>
  );
}

import React from 'react';
import './LandingPage.css';

const DNA_FEATURES = [
  'Sequence Analysis',
  'Mutation Analysis',
  'Sequence Alignment',
  'CRISPR Analysis',
  'Primer Design',
  'Cancer Gene Analysis',
  'Structural Annotation',
  'Research Mode'
];

const AMR_FEATURES = [
  'BioSample Analysis',
  'AMR Genotype',
  'AST Phenotype',
  'Concordance Analysis',
  'Discordance Detection',
  'Evidence Reconciliation',
  'User Lab Results',
  'AI-Assisted Interpretation'
];

export default function LandingPage({ onSelectBranch }) {
  return (
    <div className="landing-container fade-in">
      {/* SECTION A: HERO */}
      <section className="landing-hero">
        <div className="landing-badge">Bioinformatics & Genomic Intelligence</div>
        <h1 className="landing-headline">
          DNA Analyzer — Integrated Bioinformatics &amp; Antimicrobial Resistance Research Platform
        </h1>
        <p className="landing-subheading">
          Explore genomic data through integrated bioinformatics tools or investigate antimicrobial resistance using genotype–phenotype concordance analysis.
        </p>
      </section>

      {/* SECTION B: TWO WORKFLOW CARDS */}
      <section className="landing-branches">
        <h2 className="landing-section-title">Select Research Workspace</h2>
        <p className="landing-section-subtitle">Choose a specialized module to begin analysis</p>

        <div className="branches-grid">
          {/* Card 1: DNA & Genomic Analysis */}
          <div className="branch-card dna">
            <div className="branch-header">
              <div className="branch-icon-tag">
                <span>🧬</span> Workspace 01
              </div>
              <h3 className="branch-title">DNA &amp; Genomic Analysis</h3>
              <p className="branch-description">
                Analyze sequences, mutations, and genomic features using an integrated collection of bioinformatics tools.
              </p>
            </div>

            <div>
              <div className="branch-features-title">Platform Capabilities</div>
              <ul className="branch-features-list">
                {DNA_FEATURES.map((feature, idx) => (
                  <li key={idx} className="branch-feature-item">
                    <span className="branch-feature-bullet" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <button
                className="branch-cta-btn"
                onClick={() => onSelectBranch('dna')}
              >
                <span>Explore DNA Analyzer</span>
                <span>→</span>
              </button>
            </div>
          </div>

          {/* Card 2: AMR Research */}
          <div className="branch-card amr">
            <div className="branch-header">
              <div className="branch-icon-tag">
                <span>🔬</span> Workspace 02
              </div>
              <h3 className="branch-title">AMR Research</h3>
              <p className="branch-description">
                Compare genomic antimicrobial-resistance determinants with experimentally observed antibiotic susceptibility and investigate genotype–phenotype discordance.
              </p>
            </div>

            <div>
              <div className="branch-features-title">Planned Research Capabilities</div>
              <ul className="branch-features-list">
                {AMR_FEATURES.map((feature, idx) => (
                  <li key={idx} className="branch-feature-item">
                    <span className="branch-feature-bullet" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <button
                className="branch-cta-btn"
                onClick={() => onSelectBranch('amr')}
              >
                <span>Explore AMR Research</span>
                <span>→</span>
              </button>
              <span className="branch-badge-status">
                Under Active Research Development
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION C: DUAL WORKFLOW DIAGRAM */}
      <section className="landing-diagram-section">
        <h2 className="landing-section-title">Dual Platform Workflows</h2>
        <p className="landing-section-subtitle">Parallel investigative pipelines tailored for sequence biology and resistance analytics</p>

        <div className="diagram-grid">
          {/* DNA Analyzer Workflow */}
          <div className="workflow-column dna">
            <div className="workflow-col-header">
              <span>🧬</span>
              <span>DNA &amp; Genomic Analysis Pipeline</span>
            </div>
            <div className="workflow-steps">
              <div className="workflow-step-box">DNA / FASTA Sequence Input</div>
              <div className="workflow-arrow">↓</div>
              <div className="workflow-step-box">Sequence Analysis &amp; Feature Detection</div>
              <div className="workflow-arrow">↓</div>
              <div className="workflow-step-box">Mutations • Alignment • CRISPR • Primers</div>
              <div className="workflow-arrow">↓</div>
              <div className="workflow-step-box">Biological Interpretation &amp; Export</div>
            </div>
          </div>

          {/* AMR Research Workflow */}
          <div className="workflow-column amr">
            <div className="workflow-col-header">
              <span>🔬</span>
              <span>AMR Research Pipeline</span>
            </div>
            <div className="workflow-steps">
              <div className="workflow-step-box">AMR Isolate Profile</div>
              <div className="workflow-arrow">↓</div>
              <div className="workflow-step-box">Genomic AMR Determinants + AST Phenotype</div>
              <div className="workflow-arrow">↓</div>
              <div className="workflow-step-box">Genotype–Phenotype Concordance Analysis</div>
              <div className="workflow-arrow">↓</div>
              <div className="workflow-step-box">Evidence Reconciliation &amp; Investigation</div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION D: PLATFORM DISCLAIMER */}
      <footer className="landing-disclaimer">
        <div className="disclaimer-title">Research &amp; Educational Platform</div>
        <p className="disclaimer-text">
          Results are intended for educational and preliminary research use and should not be interpreted as clinical diagnoses or treatment recommendations.
        </p>
      </footer>
    </div>
  );
}

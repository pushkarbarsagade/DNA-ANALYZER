import { useState, useEffect, useRef } from "react";
import { summary } from "./utils/dnaUtils";
import "./App.css";

// Import components
import OverviewTab from './components/OverviewTab';
import MutationFinder from './components/MutationFinder';
import SequenceAlignment from './components/SequenceAlignment';
import CRISPRFinder from './components/CRISPRFinder';
import PrimerDesigner from './components/PrimerDesigner';
import LandingPage from './components/LandingPage';
import AMROverview from './components/AMR/AMROverview';


// Loading Spinner Component
const LoadingSpinner = () => (
  <div className="loading-spinner"></div>
);

// Sample sequences for quick testing
const SAMPLE_SEQUENCES = {
  short: {
    name: "Short Sample (100bp)",
    sequence: "ATGCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGA"
  },
  medium: {
    name: "Medium Sample (300bp)",
    sequence: "ATGCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGA"
  },
  gene: {
    name: "Gene Fragment (500bp)",
    sequence: "ATGGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAG"
  }
};

const ONBOARDING_PREF_KEY = 'dna_analyzer_onboarding_opt_out';

function App() {
  // Navigation branch state ('landing' | 'dna' | 'amr')
  const [currentBranch, setCurrentBranch] = useState('landing');

  // Input state
  const [dna, setDna] = useState("");
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(false);
  const [showSampleMenu, setShowSampleMenu] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const darkMode = true; // Always dark mode
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [tourTargetRect, setTourTargetRect] = useState(null);
  const [isTourMobile, setIsTourMobile] = useState(false);
  const [tourPanelReady, setTourPanelReady] = useState(false);
  const [tourOptOut, setTourOptOut] = useState(() => {
    try {
      return localStorage.getItem(ONBOARDING_PREF_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [didAutoLaunchTour, setDidAutoLaunchTour] = useState(false);
  const highlightedElRef = useRef(null);

  const onboardingSteps = [
    {
      title: '👋 Welcome!',
      lines: [
        'Paste your DNA sequence here or click "Load Sample" to try instantly.'
      ],
      selectors: ['[data-tour="dna-input"]']
    },
    {
      title: '⚡ Run Analysis',
      lines: [
        'Click here to analyze your sequence and generate results across all tools.'
      ],
      selectors: ['[data-tour="analyze-btn"]']
    },
    {
      title: '📊 Overview',
      lines: [
        'Start here to see basic stats like sequence length, GC content, and melting temperature.'
      ],
      selectors: ['[data-tour="overview-tab"]'],
      setTab: 'overview'
    },
    {
      title: '📈 Quick Insights',
      lines: [
        'These cards give you a fast summary of your DNA before deeper analysis.'
      ],
      selectors: ['[data-tour="overview-stats"]', '[data-tour="quick-insights"]', '.results-section'],
      setTab: 'overview'
    },
    {
      title: '🧬 Mutation Analysis',
      lines: [
        'This section shows changes in your DNA sequence that may affect function or structure.'
      ],
      selectors: ['[data-tour="mutations-tab"]'],
      setTab: 'mutations'
    },
    {
      title: '🔍 Detailed View',
      lines: [
        'Explore mutations by position, type, and impact in this detailed panel.',
        'You may also see 2D or 3D views that explain structural effects.'
      ],
      selectors: ['[data-tour="mutation-details"]', '[data-tour="mutation-panel"]'],
      setTab: 'mutations'
    },
    {
      title: '🧪 Structural Insight',
      lines: [
        'Visualize mutation effects in 2D or 3D to understand possible shape and behavior changes.'
      ],
      selectors: ['[data-tour="mutation-structure"]', '[data-tour="mutation-panel"]'],
      setTab: 'mutations'
    },
    {
      title: '🚀 Try It Yourself',
      lines: [
        'All tools follow one workflow: Load sequence → Analyze → Explore → Download or get AI insights.',
        'Start with "Load Sample" and explore freely.'
      ],
      selectors: ['[data-tour="load-sample"]']
    }
  ];

  // ============================================================
  // CENTRALIZED STATE MANAGEMENT FOR ALL TOOL RESULTS
  // ============================================================
  // This is the key architectural change: all tool results are now
  // stored at the App level instead of within individual components.
  // This ensures results persist when switching between tools.
  // ============================================================

  const [overviewResult, setOverviewResult] = useState(null);
  const [mutationResult, setMutationResult] = useState(null);
  const [alignmentResult, setAlignmentResult] = useState(null);
  const [crisprResult, setCrisprResult] = useState(null);
  const [primerResult, setPrimerResult] = useState(null);


  // Close sample menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setShowSampleMenu(false);
    if (showSampleMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showSampleMenu]);

  useEffect(() => {
    const onResize = () => setIsTourMobile(window.innerWidth < 700);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (tourOptOut || showOnboarding || didAutoLaunchTour || currentBranch !== 'dna') return;
    const timer = setTimeout(() => {
      setTourStep(0);
      setShowOnboarding(true);
      setDidAutoLaunchTour(true);
    }, 1100);
    return () => clearTimeout(timer);
  }, [tourOptOut, showOnboarding, didAutoLaunchTour, currentBranch]);

  useEffect(() => {
    if (!showOnboarding) {
      if (highlightedElRef.current) {
        highlightedElRef.current.classList.remove('tour-highlighted');
        highlightedElRef.current = null;
      }
      setTourTargetRect(null);
      setTourPanelReady(false);
      return;
    }

    const step = onboardingSteps[tourStep];
    if (!step) return;

    if (step.setTab && activeTab !== step.setTab) {
      setActiveTab(step.setTab);
    }

    let t1 = null;
    let t2 = null;
    let onViewportMove = null;

    const timer = setTimeout(() => {
      const target = step.selectors
        .map((s) => document.querySelector(s))
        .find(Boolean);

      if (highlightedElRef.current && highlightedElRef.current !== target) {
        highlightedElRef.current.classList.remove('tour-highlighted');
        highlightedElRef.current = null;
      }

      if (target) {
        target.classList.add('tour-highlighted');
        highlightedElRef.current = target;
        setTourPanelReady(false);
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

        const syncRect = () => {
          if (!highlightedElRef.current) return;
          const r = highlightedElRef.current.getBoundingClientRect();
          setTourTargetRect({ top: r.top, left: r.left, width: r.width, height: r.height });
          setTourPanelReady(true);
        };

        syncRect();
        t1 = setTimeout(syncRect, 220);
        t2 = setTimeout(syncRect, 420);
        onViewportMove = () => syncRect();
        window.addEventListener('scroll', onViewportMove, true);
        window.addEventListener('resize', onViewportMove);
      } else {
        setTourTargetRect(null);
        setTourPanelReady(true);
      }
    }, 180);

    return () => {
      clearTimeout(timer);
      if (t1) clearTimeout(t1);
      if (t2) clearTimeout(t2);
      if (onViewportMove) {
        window.removeEventListener('scroll', onViewportMove, true);
        window.removeEventListener('resize', onViewportMove);
      }
    };
  }, [showOnboarding, tourStep, activeTab]);

  useEffect(() => {
    if (!showOnboarding) return;
    const onKey = (e) => {
      if (e.key === 'Escape') closeOnboarding();
      if (e.key === 'ArrowRight') nextTourStep();
      if (e.key === 'ArrowLeft') prevTourStep();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showOnboarding, tourStep]);

  const startOnboarding = () => {
    setCurrentBranch('dna');
    setShowHelp(false);
    setDidAutoLaunchTour(true);
    setTourStep(0);
    setShowOnboarding(true);
  };

  const closeOnboarding = () => {
    setShowOnboarding(false);
  };

  const toggleTourOptOut = () => {
    const next = !tourOptOut;
    setTourOptOut(next);
    try {
      localStorage.setItem(ONBOARDING_PREF_KEY, next ? '1' : '0');
    } catch {
      // no-op if storage is unavailable
    }
  };

  const nextTourStep = () => {
    if (tourStep >= onboardingSteps.length - 1) {
      closeOnboarding();
      return;
    }
    setTourStep((s) => s + 1);
  };

  const prevTourStep = () => {
    setTourStep((s) => Math.max(0, s - 1));
  };

  const handleAnalyze = () => {
    setError("");
    setLoading(true);

    if (!dna.trim()) {
      setError("Please enter a DNA sequence");
      setLoading(false);
      return;
    }

    const cleaned = dna.toUpperCase().replace(/[^ATGC]/g, "");
    if (cleaned.length === 0) {
      setError("No valid DNA nucleotides (A, T, G, C) found");
      setLoading(false);
      return;
    }

    if (cleaned.length < 3) {
      setError("Sequence too short for analysis (minimum 3 nucleotides)");
      setLoading(false);
      return;
    }

    try {
      setTimeout(() => {
        const res = summary(cleaned);
        setOverviewResult(res); // Store in centralized state
        setActiveTab("overview");
        setLoading(false);
        setShowSuccessMessage(true);
        setTimeout(() => setShowSuccessMessage(false), 3000);
      }, 600);
    } catch (err) {
      setError("Error analyzing DNA: " + err.message);
      setLoading(false);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        let content = event.target.result;
        if (content.startsWith('>')) {
          content = content.split('\n').slice(1).join('').replace(/\s/g, '');
        }
        setDna(content);
      };
      reader.readAsText(file);
    }
  };

  const loadSampleSequence = (key) => {
    setDna(SAMPLE_SEQUENCES[key].sequence);
    setShowSampleMenu(false);
  };

  // ============================================================
  // CLEAR FUNCTIONS - Updated to clear all results
  // ============================================================
  const clearSequence = () => {
    setDna("");
    setOverviewResult(null);
    setMutationResult(null);
    setAlignmentResult(null);
    setCrisprResult(null);
    setPrimerResult(null);
    setPrimerEvalResult(null);
    setError("");
    setActiveTab("overview");
  };

  // Individual tool clear functions (optional - for per-tool clearing)
  const clearToolResult = (toolName) => {
    switch (toolName) {
      case 'overview':
        setOverviewResult(null);
        break;
      case 'mutations':
        setMutationResult(null);
        break;
      case 'alignment':
        setAlignmentResult(null);
        break;
      case 'crispr':
        setCrisprResult(null);
        break;
      case 'primers':
        setPrimerResult(null);
        break;

      default:
        break;
    }
  };

  const copySequence = (e) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(dna).then(() => {
        const btn = e.target;
        const originalText = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(() => {
          btn.textContent = originalText;
        }, 2000);
      });
    }
  };

  const downloadSequence = () => {
    const blob = new Blob([dna], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dna_sequence_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getSequenceStats = () => {
    const cleaned = dna.toUpperCase().replace(/[^ATGC]/g, "");
    return {
      length: cleaned.length,
      a: (cleaned.match(/A/g) || []).length,
      t: (cleaned.match(/T/g) || []).length,
      g: (cleaned.match(/G/g) || []).length,
      c: (cleaned.match(/C/g) || []).length
    };
  };

  const stats = getSequenceStats();

  return (
    <div className="app dark-mode" style={{ fontFamily: 'Inter, sans-serif' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Montserrat:wght@600;700;800&display=swap');
        
        .app {
          transition: background-color 0.3s ease, color 0.3s ease;
        }
        
        /* UPDATED: Professional research-grade dark theme with subtle vertical gradient */
        .dark-mode {
          background: linear-gradient(180deg, #0b1220 0%, #0e1626 50%, #0b1220 100%);
          color: #e2e8f0;
          min-height: 100vh;
        }
        
        .dark-mode .container {
          background: transparent;
        }
        
        /* UPDATED: Header with subtle bottom border for visual separation */
        .dark-mode .header {
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          padding-bottom: 1.5rem;
          margin-bottom: 2rem;
        }
        
        /* UPDATED: Improved contrast for cards */
        .dark-mode .input-section,
        .dark-mode .results-section {
          background: rgba(15, 23, 42, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.08);
          backdrop-filter: blur(10px);
        }
        
        /* UPDATED: Higher contrast for text inputs */
        .dark-mode .dna-input,
        .dark-mode textarea {
          background: rgba(11, 18, 32, 0.8);
          color: #f1f5f9;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .dark-mode .dna-input:focus,
        .dark-mode textarea:focus {
          border-color: rgba(0, 191, 165, 0.5);
          outline: none;
        }
        
        .dark-mode .tab-btn {
          background: rgba(15, 23, 42, 0.6);
          color: #94a3b8;
          border: 1px solid rgba(255, 255, 255, 0.08);
        }
        
        .dark-mode .tab-btn.active {
          background: linear-gradient(135deg, #00A389, #00BFA5);
          color: white;
          border-color: transparent;
        }
        
        .dark-mode .tab-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        
        .fade-in {
          animation: fadeIn 0.5s ease-out;
        }
        
        .slide-down {
          animation: slideDown 0.3s ease-out;
        }
        
        .tool-card {
          background: white;
          border-radius: 12px;
          padding: 1.5rem;
          margin-bottom: 1.5rem;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        
        .tool-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        
        /* UPDATED: Tool card with improved contrast */
        .dark-mode .tool-card {
          background: rgba(15, 23, 42, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }
        
        .dark-mode .tool-card:hover {
          box-shadow: 0 4px 12px rgba(0,0,0,0.4);
          border-color: rgba(255, 255, 255, 0.12);
        }
        
        /* UPDATED: Quick action buttons with better contrast */
        .quick-action-btn {
          padding: 0.5rem 1rem;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(15, 23, 42, 0.6);
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.875rem;
          font-weight: 500;
          transition: all 0.2s ease;
          font-family: 'Inter', sans-serif;
          color: #e2e8f0;
        }
        
        .quick-action-btn:hover {
          background: rgba(30, 41, 59, 0.8);
          border-color: rgba(255, 255, 255, 0.15);
          transform: translateY(-1px);
        }
        
        .dark-mode .quick-action-btn {
          background: rgba(15, 23, 42, 0.6);
          border-color: rgba(255, 255, 255, 0.1);
          color: #e2e8f0;
        }
        
        .dark-mode .quick-action-btn:hover {
          background: rgba(30, 41, 59, 0.8);
          border-color: rgba(255, 255, 255, 0.15);
        }
        
        /* UPDATED: Sample menu with improved visibility */
        .sample-menu {
          position: absolute;
          top: 100%;
          right: 0;
          background: rgba(15, 23, 42, 0.95);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          padding: 0.5rem;
          z-index: 100;
          min-width: 220px;
          margin-top: 0.5rem;
          backdrop-filter: blur(10px);
        }
        
        .dark-mode .sample-menu {
          background: rgba(15, 23, 42, 0.95);
          border-color: rgba(255, 255, 255, 0.1);
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        }
        
        .sample-menu-item {
          padding: 0.75rem 1rem;
          cursor: pointer;
          border-radius: 6px;
          transition: background 0.2s ease;
          font-size: 0.875rem;
          color: #e2e8f0;
        }
        
        .sample-menu-item:hover {
          background: rgba(30, 41, 59, 0.8);
        }
        
        .dark-mode .sample-menu-item {
          color: #e2e8f0;
        }
        
        .dark-mode .sample-menu-item:hover {
          background: rgba(30, 41, 59, 0.8);
        }
        
        /* UPDATED: Help modal with improved readability */
        .help-modal {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 2rem;
          animation: fadeIn 0.3s ease-out;
        }
        
        .help-content {
          background: rgba(15, 23, 42, 0.98);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 2rem;
          max-width: 700px;
          max-height: 80vh;
          overflow-y: auto;
          box-shadow: 0 8px 24px rgba(0,0,0,0.4);
          animation: slideDown 0.3s ease-out;
        }
        
        .dark-mode .help-content {
          background: rgba(15, 23, 42, 0.98);
          color: #f1f5f9;
        }
        
        /* UPDATED: Stats bar with better contrast */
        .stats-bar {
          display: flex;
          gap: 1rem;
          padding: 0.75rem;
          background: rgba(11, 18, 32, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          margin-top: 0.5rem;
          font-size: 0.875rem;
          flex-wrap: wrap;
        }
        
        .dark-mode .stats-bar {
          background: rgba(11, 18, 32, 0.6);
          border-color: rgba(255, 255, 255, 0.05);
        }
        
        .stat-item {
          display: flex;
          gap: 0.25rem;
          align-items: center;
        }
        
        .success-toast {
          position: fixed;
          top: 2rem;
          right: 2rem;
          background: linear-gradient(135deg, #10B981, #059669);
          color: white;
          padding: 1rem 1.5rem;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          z-index: 1000;
          animation: slideInRight 0.3s ease-out;
          font-family: 'Inter', sans-serif;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        
        .dark-mode .help-content h3 {
          color: #00BFA5;
        }

        .tour-highlighted {
          position: relative;
          z-index: 1202 !important;
          border-radius: 12px !important;
          box-shadow: 0 0 0 3px rgba(0, 191, 165, 0.95), 0 0 0 6px rgba(0, 191, 165, 0.2), 0 0 18px rgba(0, 191, 165, 0.45) !important;
          transition: box-shadow 0.25s ease;
        }

        .onboarding-overlay {
          position: fixed;
          inset: 0;
          z-index: 1200;
          background: rgba(2, 6, 23, 0.58);
          backdrop-filter: blur(1.3px);
          animation: tourOverlayIn 220ms ease-out;
        }

        .onboarding-panel {
          position: fixed;
          z-index: 1203;
          width: min(360px, calc(100vw - 1.2rem));
          background: linear-gradient(180deg, rgba(14, 24, 43, 0.97), rgba(13, 20, 34, 0.97));
          border: 1px solid rgba(0, 191, 165, 0.28);
          border-radius: 12px;
          box-shadow: 0 14px 40px rgba(0, 0, 0, 0.48);
          padding: 1rem;
          font-family: 'Inter', sans-serif;
          transform-origin: top center;
          animation: tourPanelIn 260ms cubic-bezier(.2,.7,.2,1);
          transition: top 220ms ease, left 220ms ease, right 220ms ease, bottom 220ms ease;
        }

        .onboarding-title {
          font-family: 'Montserrat', sans-serif;
          font-weight: 700;
          font-size: 1rem;
          color: #e2f7f2;
          margin-bottom: 0.45rem;
        }

        .onboarding-line {
          color: #cbd5e1;
          font-size: 0.9rem;
          line-height: 1.5;
          margin: 0 0 0.22rem 0;
        }

        .onboarding-footer {
          margin-top: 0.8rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.6rem;
        }

        .onboarding-nav {
          display: flex;
          align-items: center;
          gap: 0.4rem;
        }

        .onboarding-btn {
          border: 1px solid rgba(148, 163, 184, 0.25);
          background: rgba(15, 23, 42, 0.8);
          color: #e2e8f0;
          border-radius: 7px;
          padding: 0.45rem 0.75rem;
          font-size: 0.82rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 180ms ease;
        }

        .onboarding-btn:hover {
          transform: translateY(-1px);
          border-color: rgba(148, 163, 184, 0.4);
        }

        .onboarding-btn.primary {
          border-color: rgba(0, 191, 165, 0.45);
          background: linear-gradient(135deg, #00A389, #00BFA5);
          color: #fff;
        }

        .onboarding-dots {
          display: flex;
          align-items: center;
          gap: 0.28rem;
        }

        .onboarding-dot {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: rgba(148, 163, 184, 0.4);
        }

        .onboarding-dot.active {
          width: 18px;
          background: #00BFA5;
        }

        @keyframes tourOverlayIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes tourPanelIn {
          from { opacity: 0; transform: translateY(8px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        
        .dark-mode .help-content ul {
          color: #cbd5e1;
        }
        
        /* UPDATED: Footer with subtle top border */
        .dark-mode .app-footer {
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          margin-top: 3rem;
          padding-top: 2rem;
        }
        
        @media (max-width: 768px) {
          .stats-bar {
            font-size: 0.75rem;
            gap: 0.5rem;
          }
          
          .success-toast {
            top: 1rem;
            right: 1rem;
            left: 1rem;
          }
          
          .sample-menu {
            right: auto;
            left: 0;
          }
          
          .help-content {
            padding: 1.5rem;
            max-width: 95%;
          }

          .onboarding-panel {
            width: calc(100vw - 1rem);
            left: 0.5rem !important;
            right: 0.5rem !important;
            top: auto !important;
            bottom: 0.7rem !important;
          }
        }
      `}</style>

      <div className="container">
        <header className="header fade-in">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
            <button
              onClick={() => setCurrentBranch('landing')}
              className="platform-brand-btn"
              title="Return to Platform Hub"
            >
              <h1 className="title" style={{ fontFamily: 'Montserrat, sans-serif', margin: 0, textAlign: 'left' }}>
                DNA Analyzer
              </h1>
              <p className="subtitle" style={{ margin: '0.5rem 0 0 0', textAlign: 'left' }}>
                Integrated Bioinformatics &amp; AMR Research Platform
              </p>
            </button>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {currentBranch !== 'landing' && (
                <button
                  onClick={() => setCurrentBranch('landing')}
                  className="platform-back-home-btn"
                >
                  <span>🏠</span> Platform Hub
                </button>
              )}
              <button
                onClick={startOnboarding}
                className="quick-action-btn"
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                Start Tour
              </button>
              <button
                onClick={() => setShowHelp(true)}
                className="quick-action-btn"
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                Help
              </button>
            </div>
          </div>
        </header>

        {currentBranch !== 'landing' && (
          <div className="platform-workspace-bar fade-in">
            <div className="platform-workspace-tabs">
              <button
                className={`workspace-nav-tab ${currentBranch === 'dna' ? 'active dna' : ''}`}
                onClick={() => setCurrentBranch('dna')}
              >
                <span>🧬</span> DNA &amp; Genomic Analysis
              </button>
              <button
                className={`workspace-nav-tab ${currentBranch === 'amr' ? 'active amr' : ''}`}
                onClick={() => setCurrentBranch('amr')}
              >
                <span>🔬</span> AMR Research
              </button>
            </div>
            <button
              className="platform-back-home-btn"
              onClick={() => setCurrentBranch('landing')}
            >
              <span>←</span> Platform Hub
            </button>
          </div>
        )}

        {currentBranch === 'landing' && (
          <LandingPage onSelectBranch={(branch) => setCurrentBranch(branch)} />
        )}

        {currentBranch === 'amr' && (
          <AMROverview
            onNavigateHome={() => setCurrentBranch('landing')}
            onNavigateDna={() => setCurrentBranch('dna')}
          />
        )}

        {currentBranch === 'dna' && (
          <>
            <div className="input-section fade-in" style={{ animationDelay: '0.1s' }}>
              <div className="input-header">
                <label className="input-label" style={{ fontFamily: 'Inter, sans-serif' }}>
                  DNA Sequence Input
                </label>
                <div style={{ display: 'flex', gap: '0.5rem', position: 'relative' }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowSampleMenu(!showSampleMenu);
                    }}
                    className="quick-action-btn sample-shine"
                    data-tour="load-sample"
                  >
                    Load Sample
                  </button>
                  {showSampleMenu && (
                    <div className="sample-menu slide-down" onClick={(e) => e.stopPropagation()}>
                      {Object.entries(SAMPLE_SEQUENCES).map(([key, sample]) => (
                        <div
                          key={key}
                          className="sample-menu-item"
                          onClick={() => loadSampleSequence(key)}
                        >
                          {sample.name}
                        </div>
                      ))}
                    </div>
                  )}
                  <label htmlFor="file-upload" className="upload-btn">
                    Upload FASTA
                    <input
                      id="file-upload"
                      type="file"
                      accept=".fasta,.fa,.txt"
                      onChange={handleFileUpload}
                      style={{ display: 'none' }}
                    />
                  </label>
                </div>
              </div>

              <textarea
                value={dna}
                onChange={(e) => setDna(e.target.value)}
                placeholder="Paste your DNA sequence here (A, T, G, C)..."
                className="dna-input"
                data-tour="dna-input"
                rows={6}
                disabled={loading}
                style={{ fontFamily: 'monospace' }}
              />

              {dna && (
                <div className="stats-bar slide-down" data-tour="quick-insights">
                  <div className="stat-item">
                    <strong>Length:</strong> {stats.length} bp
                  </div>
                  <div className="stat-item" style={{ color: '#10B981' }}>
                    <strong>A:</strong> {stats.a}
                  </div>
                  <div className="stat-item" style={{ color: '#F59E0B' }}>
                    <strong>T:</strong> {stats.t}
                  </div>
                  <div className="stat-item" style={{ color: '#3B82F6' }}>
                    <strong>G:</strong> {stats.g}
                  </div>
                  <div className="stat-item" style={{ color: '#EF4444' }}>
                    <strong>C:</strong> {stats.c}
                  </div>
                </div>
              )}

              <div className="input-footer" style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                <button
                  onClick={handleAnalyze}
                  className="analyze-btn"
                  data-tour="analyze-btn"
                  disabled={loading}
                  style={{ flex: 1, minWidth: '200px' }}
                >
                  {loading && <LoadingSpinner />}
                  {loading ? 'Analyzing Sequence...' : 'Analyze Sequence'}
                </button>
                {dna && (
                  <>
                    <button
                      onClick={copySequence}
                      className="quick-action-btn"
                      title="Copy to clipboard"
                    >
                      Copy
                    </button>
                    <button
                      onClick={downloadSequence}
                      className="quick-action-btn"
                      title="Download sequence"
                    >
                      Download
                    </button>
                    <button
                      onClick={clearSequence}
                      className="quick-action-btn"
                      title="Clear sequence and all results"
                      style={{ color: '#EF4444' }}
                    >
                      Clear All
                    </button>
                  </>
                )}
              </div>
            </div>

            {error && (
              <div className="error-alert slide-down">
                <span className="error-icon">!</span>
                {error}
              </div>
            )}

            {showSuccessMessage && (
              <div className="success-toast">
                <span>✓</span>
                <span>Analysis completed successfully!</span>
              </div>
            )}

            {/* Tools Section - Always Visible in DNA branch */}
            <div className="results-section fade-in" style={{ animationDelay: '0.2s' }}>
              <div className="tab-nav">
                <button
                  onClick={() => setActiveTab("overview")}
                  data-tour="overview-tab"
                  className={`tab-btn ${activeTab === "overview" ? "active" : ""}`}
                  disabled={!overviewResult}
                >
                  Overview
                </button>
                <button
                  onClick={() => setActiveTab("mutations")}
                  data-tour="mutations-tab"
                  className={`tab-btn ${activeTab === "mutations" ? "active" : ""}`}
                >
                  Mutations
                </button>
                <button
                  onClick={() => setActiveTab("alignment")}
                  className={`tab-btn ${activeTab === "alignment" ? "active" : ""}`}
                >
                  Alignment
                </button>
                <button
                  onClick={() => setActiveTab("crispr")}
                  className={`tab-btn ${activeTab === "crispr" ? "active" : ""}`}
                >
                  CRISPR
                </button>
                <button
                  onClick={() => setActiveTab("primers")}
                  className={`tab-btn ${activeTab === "primers" ? "active" : ""}`}
                >
                  Primers
                </button>
              </div>

              {/* ============================================================ */}
              {/* PERSISTENT RESULT RENDERING */}
              {/* All tool components receive their result state and setter */}
              {/* as props. This ensures results persist across tab switches. */}
              {/* ============================================================ */}
              <div className="tab-content" data-tour="tab-content">
                {activeTab === "overview" && overviewResult && (
                  <OverviewTab
                    result={overviewResult}
                    originalSequence={dna}
                    onClear={() => clearToolResult('overview')}
                  />
                )}
                {activeTab === "overview" && !overviewResult && (
                  <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>
                    <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                      Analyze a DNA sequence to view overview
                    </p>
                    <p style={{ fontSize: '0.9rem' }}>
                      Enter a sequence above and click "Analyze Sequence"
                    </p>
                  </div>
                )}
                {activeTab === "mutations" && (
                  <MutationFinder
                    result={mutationResult}
                    setResult={setMutationResult}
                    onClear={() => clearToolResult('mutations')}
                  />
                )}
                {activeTab === "alignment" && (
                  <SequenceAlignment
                    result={alignmentResult}
                    setResult={setAlignmentResult}
                    onClear={() => clearToolResult('alignment')}
                  />
                )}
                {activeTab === "crispr" && (
                  <CRISPRFinder
                    result={crisprResult}
                    setResult={setCrisprResult}
                    onClear={() => clearToolResult('crispr')}
                  />
                )}
                {activeTab === "primers" && (
                  <PrimerDesigner
                    result={primerResult}
                    setResult={setPrimerResult}
                    onClear={() => clearToolResult('primers')}
                  />
                )}
              </div>
            </div>
          </>
        )}

        {/* Help Modal - UPDATED */}
        {showHelp && (
          <div className="help-modal" onClick={() => setShowHelp(false)}>
            <div className="help-content" onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h2 style={{ fontFamily: 'Montserrat, sans-serif', margin: 0, color: '#00BFA5' }}>
                  🧬 Help & Guide
                </h2>
                <button
                  onClick={() => setShowHelp(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '1.5rem',
                    cursor: 'pointer',
                    color: '#94a3b8'
                  }}
                >
                  ×
                </button>
              </div>

              <div style={{ lineHeight: '1.8' }}>
                <h3 style={{ fontFamily: 'Montserrat, sans-serif', color: '#00BFA5', marginTop: '1.5rem' }}>
                  Available Tools
                </h3>
                <ul style={{ marginLeft: '1.5rem' }}>
                  <li><strong>Overview:</strong> Comprehensive sequence statistics, GC content, melting temperature, and ORF analysis</li>
                  <li><strong>Mutations:</strong> Compare two sequences to identify SNPs, insertions, and deletions with functional impact</li>
                  <li><strong>Alignment:</strong> Perform global (Needleman-Wunsch) or local (Smith-Waterman) sequence alignment</li>
                  <li><strong>CRISPR:</strong> Find PAM sites for CRISPR-Cas9/Cas12a gene editing with multiple enzyme support</li>
                  <li><strong>Primers:</strong> Design optimized PCR primers with application-specific parameters (qPCR, cloning, diagnostic)</li>

                </ul>

                <h3 style={{ fontFamily: 'Montserrat, sans-serif', color: '#00BFA5', marginTop: '1.5rem' }}>
                  Quick Tips
                </h3>
                <ul style={{ marginLeft: '1.5rem' }}>
                  <li>Use "Load Sample" to quickly test with example sequences (100bp, 300bp, 500bp)</li>
                  <li>Upload FASTA files (.fasta, .fa) or text files for easy sequence input</li>
                  <li><strong>✨ NEW:</strong> Tool results now persist when switching tabs - your work is never lost!</li>
                  <li>Click "Get AI Analysis" in any tool for detailed biological insights and recommendations</li>
                  <li>Download comprehensive reports as TXT or PDF for documentation and sharing</li>
                  <li>Use "Copy" button to quickly copy sequences to clipboard</li>
                  <li>Real-time sequence statistics update as you type (A, T, G, C counts)</li>
                  <li>Use "Clear All" to reset all sequences and results at once</li>
                </ul>

                <h3 style={{ fontFamily: 'Montserrat, sans-serif', color: '#00BFA5', marginTop: '1.5rem' }}>
                  Supported Formats
                </h3>
                <ul style={{ marginLeft: '1.5rem' }}>
                  <li>Plain DNA sequence (A, T, G, C nucleotides only)</li>
                  <li>FASTA format files (.fasta, .fa)</li>
                  <li>Text files (.txt)</li>
                  <li>Sequences up to 100,000 bp (100 kb)</li>
                </ul>

                <h3 style={{ fontFamily: 'Montserrat, sans-serif', color: '#00BFA5', marginTop: '1.5rem' }}>
                  Pro Tips
                </h3>
                <ul style={{ marginLeft: '1.5rem' }}>
                  <li>For primer design, use application mode selector (Diagnostic, Cloning, qPCR, Mutation Detection)</li>
                  <li>CRISPR tool supports multiple Cas enzymes - choose based on your target organism</li>
                  <li>Alignment tool automatically handles sequences up to 10,000 bp</li>
                  <li>All analyses include actionable recommendations for experimental optimization</li>
                </ul>
              </div>

              <button
                onClick={startOnboarding}
                style={{
                  width: '100%',
                  marginTop: '0.75rem',
                  padding: '0.75rem',
                  background: 'linear-gradient(135deg, #0EA5E9, #0284C7)',
                  border: 'none',
                  borderRadius: '8px',
                  color: 'white',
                  fontWeight: 600,
                  fontFamily: 'Inter, sans-serif',
                  cursor: 'pointer'
                }}
              >
                Start Interactive Tour
              </button>

              <button
                onClick={() => setShowHelp(false)}
                style={{
                  width: '100%',
                  marginTop: '1.5rem',
                  padding: '0.75rem',
                  background: 'linear-gradient(135deg, #00A389, #00BFA5)',
                  border: 'none',
                  borderRadius: '8px',
                  color: 'white',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'Inter, sans-serif',
                  fontSize: '1rem'
                }}
              >
                Got it!
              </button>
            </div>
          </div>
        )}

        <footer className="app-footer">
          <div className="footer-content">
            <p className="footer-text" style={{ fontFamily: 'Inter, sans-serif' }}>
              DNA Sequence Analyzer | Professional Bioinformatics Tool
            </p>
            <p className="footer-text" style={{ fontFamily: 'Inter, sans-serif' }}>
              Developed by Pushkar Barsagade | <a href="mailto:barsagadepushkar26@gmail.com" className="footer-link">
                barsagadepushkar26@gmail.com
              </a>
            </p>
          </div>
        </footer>
      </div>

      {showOnboarding && (
        <>
          <div className="onboarding-overlay"></div>
          <div
            key={`tour-step-${tourStep}`}
            className="onboarding-panel"
            style={(() => {
              const defaultTop = isTourMobile ? undefined : 84;
              if (!tourTargetRect || isTourMobile) {
                return isTourMobile ? { left: '0.5rem', right: '0.5rem', bottom: '0.7rem', opacity: tourPanelReady ? 1 : 0.15 } : { top: defaultTop, right: 20, opacity: tourPanelReady ? 1 : 0.15 };
              }
              const panelWidth = 360;
              const spaceBelow = window.innerHeight - (tourTargetRect.top + tourTargetRect.height);
              const top = spaceBelow > 240
                ? Math.min(window.innerHeight - 260, tourTargetRect.top + tourTargetRect.height + 12)
                : Math.max(12, tourTargetRect.top - 230);
              const centeredLeft = tourTargetRect.left + (tourTargetRect.width / 2) - (panelWidth / 2);
              const left = Math.max(12, Math.min(window.innerWidth - panelWidth - 12, centeredLeft));
              return { top, left, opacity: tourPanelReady ? 1 : 0.15 };
            })()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="onboarding-title">{onboardingSteps[tourStep].title}</div>
            {onboardingSteps[tourStep].lines.map((line, idx) => (
              <p key={idx} className="onboarding-line">{line}</p>
            ))}
            <div style={{ marginTop: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <input
                id="tour-optout"
                type="checkbox"
                checked={tourOptOut}
                onChange={toggleTourOptOut}
                style={{ accentColor: '#00BFA5', width: 14, height: 14 }}
              />
              <label htmlFor="tour-optout" style={{ fontSize: '0.78rem', color: '#94a3b8', cursor: 'pointer' }}>
                Do not auto-show this tour again
              </label>
            </div>
            <div className="onboarding-footer">
              <div>
                <span style={{ fontSize: '0.78rem', color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>Step {tourStep + 1}/{onboardingSteps.length}</span>
                <div className="onboarding-dots">
                  {onboardingSteps.map((_, i) => (
                    <span key={i} className={`onboarding-dot ${i === tourStep ? 'active' : ''}`}></span>
                  ))}
                </div>
              </div>
              <div className="onboarding-nav">
                <button className="onboarding-btn" onClick={closeOnboarding}>Close</button>
                {tourStep > 0 && <button className="onboarding-btn" onClick={prevTourStep}>Back</button>}
                <button className="onboarding-btn primary" onClick={nextTourStep}>{tourStep === onboardingSteps.length - 1 ? 'Finish' : 'Next'}</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
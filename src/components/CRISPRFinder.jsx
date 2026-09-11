import { useState, useEffect } from 'react';

/* ─── API CONFIG ─────────────────────────────────────────────────────────── */
const API_URL = import.meta.env?.VITE_API_URL || 'https://dna-analyzer-ousa.onrender.com';

// ─── SAMPLE SEQUENCE ────────────────────────────────────────────────────────
const SAMPLE_SEQUENCE = [
  'ATGCGATCGTAGCTAGCTAGCTAGCTGATCGTAGCTAGCATGCGATCGTAGCTAGCTAGC',
  'TAGCTGATCGTAGCTAGCATGCGATCGTAGCTAGCTAGCTAGCTGATCGTAGCTAGCATG',
  'CGATCGTAGCTAGCTAGCTAGCTGATCGTAGCTAGCAAGGTCGATCGTAGCTAGCTAGCT',
  'AGCTGATCGTAGCTAGCATGCAGGCGTAGCTAGCTAGCTAGCTGATCGTAGCTAGCATGC',
  'GATCGTAGCTAGCTAGCTAGCTGATCGTGGCTAGCATGCGATCGTAGCTAGCTAGCTAGC',
  'TGATCGTAGCTAGCATGCGATCGTAGCTAGCTAGCTAGCTGATCGTAGCTAGCATGCGAT',
  'CGTAGCTAGCTAGCTAGCTGATCGTAGCTAGCATGCGATCGTAGCTAGCTAGCTAGCTGA',
  'TCGTAGCTAGCATGCGATCGTAGCTAGCTAGCTAGCTGATCGTAGCTAGCATGCGATCGT',
  'AGCTAGCTAGCTAGCTGATCGTAGCTAGCATGCGATCGTAGCTAGCTAGCTAGCTGATCG',
  'TAGCTAGCATGCGATCGTAGCTAGCTAGCTAGCTGATCGTAGCTAGCATGCGATCGTAGC'
].join('');

// ─── CAS ENZYME CONFIGS ─────────────────────────────────────────────────────
const CAS_ENZYMES = {
  spCas9: { name: 'SpCas9 (S. pyogenes)', pam: 'NGG', pamLength: 3, guideLength: 20, pamPosition: 'downstream', color: '#34D399' },
  saCas9: { name: 'SaCas9 (S. aureus)', pam: 'NNGRRT', pamLength: 6, guideLength: 21, pamPosition: 'downstream', color: '#60A5FA' },
  cas12a: { name: 'Cas12a / Cpf1', pam: 'TTTV', pamLength: 4, guideLength: 20, pamPosition: 'upstream', color: '#FBBF24' },
  custom: { name: 'Custom PAM', pam: '', pamLength: 0, guideLength: 20, pamPosition: 'downstream', color: '#A78BFA' }
};

// ─── IUPAC → REGEX ──────────────────────────────────────────────────────────
const IUPAC = { N: '[ATGC]', R: '[AG]', Y: '[CT]', M: '[AC]', K: '[GT]', S: '[GC]', W: '[AT]', H: '[ACT]', B: '[CGT]', V: '[ACG]', D: '[AGT]', A: 'A', T: 'T', G: 'G', C: 'C' };
const pamToRegex = p => new RegExp('^' + [...p.toUpperCase()].map(c => IUPAC[c] || '[ATGC]').join('') + '$');

// ─── HELPERS ────────────────────────────────────────────────────────────────
const revComp = seq => { const m = { A: 'T', T: 'A', G: 'C', C: 'G' }; return seq.split('').reverse().map(b => m[b] || b).join(''); };
const gcContent = seq => ((seq.match(/[GC]/g) || []).length / seq.length) * 100;
const efficiency = (guide, gc) => { if (gc < 30 || gc > 80) return 'Low'; if (gc >= 40 && gc <= 60 && guide.length >= 20) return 'High'; return 'Medium'; };

// ─── MAIN COMPONENT ─────────────────────────────────────────────────────────
export default function CRISPRFinder() {
  const [sequence, setSequence] = useState('');
  const [selectedCas, setSelectedCas] = useState('spCas9');
  const [customPAM, setCustomPAM] = useState('');
  const [customGuideLen, setCustomGuideLen] = useState(20);
  const [customPAMPos, setCustomPAMPos] = useState('downstream');
  const [pamSites, setPamSites] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showInfo, setShowInfo] = useState(false);
  const [aiExplanation, setAiExplanation] = useState('');
  const [loadingAI, setLoadingAI] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  // ── close export menu on outside click ──
  useEffect(() => {
    const close = () => setShowExportMenu(false);
    if (showExportMenu) {
      document.addEventListener('click', close);
      return () => document.removeEventListener('click', close);
    }
  }, [showExportMenu]);

  // ── config ──
  const casConfig = selectedCas === 'custom'
    ? { ...CAS_ENZYMES.custom, pam: customPAM.toUpperCase(), pamLength: customPAM.length, guideLength: customGuideLen, pamPosition: customPAMPos }
    : CAS_ENZYMES[selectedCas];

  // ── FASTA upload ──
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result;
      if (typeof content === 'string') {
        // Strip FASTA headers (lines starting with >)
        const cleanSeq = content
          .split('\n')
          .filter(line => !line.startsWith('>'))
          .join('')
          .replace(/\s/g, '');
        setSequence(cleanSeq);
        setError('');
        setPamSites(null);
        setAiExplanation('');
      }
    };
    reader.readAsText(file);
  };

  // ── Export functions ──
  const exportTXT = (detailed = false) => {
    if (!pamSites) return;
    let content = `CRISPR PAM Site Finder Results\n`;
    content += `${'='.repeat(50)}\n\n`;
    content += `Enzyme: ${casConfig.name}\n`;
    content += `PAM Pattern: ${casConfig.pam}\n`;
    content += `Sequence Length: ${pamSites.seqLen} bp\n`;
    content += `Total PAM Sites: ${pamSites.total}\n`;
    content += `Forward Strand: ${pamSites.forward}\n`;
    content += `Reverse Strand: ${pamSites.reverse}\n\n`;

    if (detailed && pamSites.sites.length > 0) {
      content += `${'='.repeat(50)}\n`;
      content += `DETAILED SITE INFORMATION\n`;
      content += `${'='.repeat(50)}\n\n`;
      pamSites.sites.forEach((site, i) => {
        content += `Site ${i + 1}:\n`;
        content += `  Position: ${site.position}-${site.positionEnd}\n`;
        content += `  Strand: ${site.strand}\n`;
        content += `  PAM Sequence: ${site.pamSequence}\n`;
        content += `  Guide RNA: ${site.guideRNA}\n`;
        content += `  GC Content: ${site.gcContent}%\n`;
        content += `  Efficiency: ${site.efficiency}\n`;
        content += `  Context: ${site.context}\n\n`;
      });
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CRISPR_Results_${detailed ? 'Detailed_' : ''}${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  };

  const exportPDF = (detailed = false) => {
    if (!pamSites) return;
    let content = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>CRISPR PAM Site Finder Results</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
    h1 { color: #34D399; border-bottom: 3px solid #34D399; padding-bottom: 10px; }
    h2 { color: #555; margin-top: 30px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
    th { background-color: #34D399; color: white; }
    tr:nth-child(even) { background-color: #f9f9f9; }
    .summary { background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .summary-item { margin: 10px 0; }
    .label { font-weight: bold; color: #555; }
    .site-detail { margin: 20px 0; padding: 15px; border-left: 4px solid #34D399; background: #f9f9f9; }
    code { background: #e5e5e5; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
  </style>
</head>
<body>
  <h1>CRISPR PAM Site Finder Results</h1>
  
  <div class="summary">
    <div class="summary-item"><span class="label">Enzyme:</span> ${casConfig.name}</div>
    <div class="summary-item"><span class="label">PAM Pattern:</span> ${casConfig.pam}</div>
    <div class="summary-item"><span class="label">Sequence Length:</span> ${pamSites.seqLen} bp</div>
    <div class="summary-item"><span class="label">Total PAM Sites:</span> ${pamSites.total}</div>
    <div class="summary-item"><span class="label">Forward Strand:</span> ${pamSites.forward}</div>
    <div class="summary-item"><span class="label">Reverse Strand:</span> ${pamSites.reverse}</div>
    <div class="summary-item"><span class="label">Generated:</span> ${new Date().toLocaleString()}</div>
  </div>`;

    if (detailed && pamSites.sites.length > 0) {
      content += `<h2>Detailed Site Information</h2>`;
      pamSites.sites.forEach((site, i) => {
        content += `
  <div class="site-detail">
    <h3>Site ${i + 1}</h3>
    <p><span class="label">Position:</span> ${site.position}-${site.positionEnd}</p>
    <p><span class="label">Strand:</span> ${site.strand}</p>
    <p><span class="label">PAM Sequence:</span> <code>${site.pamSequence}</code></p>
    <p><span class="label">Guide RNA:</span> <code>${site.guideRNA}</code></p>
    <p><span class="label">GC Content:</span> ${site.gcContent}%</p>
    <p><span class="label">Efficiency:</span> ${site.efficiency}</p>
    <p><span class="label">Context:</span> <code>${site.context}</code></p>
  </div>`;
      });
    }

    content += `</body></html>`;

    const blob = new Blob([content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CRISPR_Results_${detailed ? 'Detailed_' : ''}${new Date().toISOString().split('T')[0]}.html`;
    a.click();
    URL.revokeObjectURL(url);

    // Open in new window for printing to PDF
    const printWindow = window.open(url);
    if (printWindow) {
      printWindow.onload = () => {
        setTimeout(() => printWindow.print(), 250);
      };
    }
    setShowExportMenu(false);
  };

  // ── find sites ──
  const findPAMSites = (seq, cfg) => {
    const sites = [];
    const rx = pamToRegex(cfg.pam);

    const addSites = (strand, src, toForward) => {
      for (let i = 0; i <= src.length - cfg.pamLength; i++) {
        const pamSeq = src.substring(i, i + cfg.pamLength);
        if (!rx.test(pamSeq)) continue;
        const fPos = strand === 'forward' ? i : toForward(i);
        const pamEnd = fPos + cfg.pamLength;
        let gS, gE;
        if (cfg.pamPosition === 'downstream') { gE = fPos; gS = Math.max(0, gE - cfg.guideLength); }
        else { gS = pamEnd; gE = Math.min(seq.length, gS + cfg.guideLength); }
        const guide = seq.substring(gS, gE);
        const gc = gcContent(guide);
        const ctxS = Math.max(0, Math.min(gS, fPos) - 10);
        const ctxE = Math.min(seq.length, Math.max(gE, pamEnd) + 10);
        sites.push({
          position: fPos + 1, positionEnd: pamEnd, strand, pamSequence: pamSeq,
          guideRNA: guide, guideLength: guide.length, guideStart: gS + 1, guideEnd: gE,
          context: seq.substring(ctxS, ctxE), contextStart: ctxS + 1,
          gcContent: gc.toFixed(1), efficiency: efficiency(guide, gc)
        });
      }
    };
    addSites('forward', seq, i => i);
    const rc = revComp(seq);
    addSites('reverse', rc, i => seq.length - i - cfg.pamLength);
    sites.sort((a, b) => a.position - b.position);
    return sites;
  };

  // ── submit ──
  const handleFind = () => {
    setError('');
    if (!sequence.trim()) { setError('Please enter a DNA sequence.'); return; }
    if (selectedCas === 'custom' && !customPAM.trim()) { setError('Enter a custom PAM pattern.'); return; }
    const clean = sequence.toUpperCase().replace(/[^ATGC]/g, '');
    if (clean.length < 20) { setError('Sequence must be at least 20 bp.'); return; }
    setLoading(true);
    setPamSites(null);
    setAiExplanation('');
    setTimeout(() => {
      const sites = findPAMSites(clean, casConfig);
      setPamSites({
        sites,
        total: sites.length,
        forward: sites.filter(s => s.strand === 'forward').length,
        reverse: sites.filter(s => s.strand === 'reverse').length,
        seqLen: clean.length
      });
      setLoading(false);
    }, 420);
  };

  // ── load sample ──
  const loadSample = () => { setSequence(SAMPLE_SEQUENCE); setError(''); setPamSites(null); setAiExplanation(''); };

  /* ── AI explain ── */
  const handleAI = async () => {
    if (!pamSites) return;
    setLoadingAI(true); setError(''); setAiExplanation('');
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 60000);
      const res = await fetch(`${API_URL}/api/explain`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'CRISPR PAM Site Finder', data: pamSites }),
        signal: ctrl.signal
      });
      clearTimeout(t);
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'AI failed'); }
      const data = await res.json();
      const txt = data.explanation || data.output_text || data.data?.explanation || data.choices?.[0]?.message?.content;
      if (!txt) throw new Error('No explanation returned');
      setAiExplanation(txt);
    } catch (e) { setError(e.name === 'AbortError' ? 'AI timed out' : (e.message || 'AI failed')); }
    finally { setLoadingAI(false); }
  };

  // ── efficiency colour ──
  const effColor = e => ({ High: '#34D399', Medium: '#FBBF24', Low: '#F87171' }[e]);
  const effBg = e => ({ High: 'rgba(52,211,153,0.12)', Medium: 'rgba(251,191,36,0.12)', Low: 'rgba(248,113,113,0.12)' }[e]);

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', color: '#e2e4e9', fontFamily: '"Sora", sans-serif' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
        *{ box-sizing:border-box; margin:0; padding:0; }
        ::-webkit-scrollbar { width:6px; }
        ::-webkit-scrollbar-track { background:#1a1d27; }
        ::-webkit-scrollbar-thumb { background:#2e3240; border-radius:3px; }

        .card {
          background:#161821;
          border:1px solid #2a2d3a;
          border-radius:12px;
          padding:1.5rem;
          margin-bottom:1.25rem;
        }
        .card-sm { padding:1rem; }

        .btn-primary {
          display:flex; align-items:center; justify-content:center; gap:0.5rem;
          width:100%; padding:0.85rem 1.5rem;
          background:linear-gradient(135deg,#34D399,#059669);
          border:none; border-radius:10px;
          color:#0f1117; font-family:'Sora',sans-serif; font-weight:600; font-size:0.95rem;
          cursor:pointer; transition:all 0.25s;
          letter-spacing:0.02em;
        }
        .btn-primary:hover { filter:brightness(1.15); transform:translateY(-1px); box-shadow:0 4px 20px rgba(52,211,153,0.35); }
        .btn-primary:disabled { filter:brightness(0.6); cursor:not-allowed; transform:none; box-shadow:none; }

        .btn-ai {
          display:flex; align-items:center; justify-content:center; gap:0.5rem;
          width:100%; padding:0.82rem 1.25rem;
          background:linear-gradient(135deg,#6366f1,#4f46e5);
          border:none; border-radius:10px;
          color:#fff; font-family:'Sora',sans-serif; font-weight:600; font-size:0.92rem;
          cursor:pointer; transition:all 0.22s;
        }
        .btn-ai:hover { filter:brightness(1.12); transform:translateY(-1px); box-shadow:0 6px 20px rgba(99,102,241,0.35); }
        .btn-ai:disabled { filter:brightness(0.5); cursor:not-allowed; transform:none; box-shadow:none; }

        .ai-box { background:rgba(99,102,241,0.08); border:1px solid rgba(99,102,241,0.3); border-radius:12px; padding:1.2rem; margin-bottom:1rem; }

        .btn-ghost {
          display:inline-flex; align-items:center; gap:0.4rem;
          padding:0.5rem 1rem;
          background:transparent; border:1px solid #2e3240; border-radius:8px;
          color:#a0a3b1; font-family:'Sora',sans-serif; font-size:0.82rem; font-weight:500;
          cursor:pointer; transition:all 0.2s;
        }
        .btn-ghost:hover { border-color:#34D399; color:#34D399; background:rgba(52,211,153,0.06); }

        .btn-sample {
          display:inline-flex; align-items:center; gap:0.35rem;
          padding:0.42rem 0.85rem;
          background:rgba(52,211,153,0.1); border:1px solid rgba(52,211,153,0.3); border-radius:7px;
          color:#34D399; font-family:'JetBrains Mono',monospace; font-size:0.75rem; font-weight:500;
          cursor:pointer; transition:all 0.2s;
        }
        .btn-sample:hover { background:rgba(52,211,153,0.18); border-color:rgba(52,211,153,0.55); }

        .btn-export {
          display:inline-flex; align-items:center; gap:0.35rem;
          padding:0.4rem 0.82rem; background:rgba(96,165,250,0.1);
          border:1px solid rgba(96,165,250,0.28); border-radius:7px;
          color:#60A5FA; font-family:'Sora',sans-serif; font-size:0.78rem; font-weight:500;
          cursor:pointer; transition:all 0.2s; position:relative;
        }
        .btn-export:hover { background:rgba(96,165,250,0.18); border-color:rgba(96,165,250,0.5); }

        .export-menu {
          position:absolute; top:calc(100% + 0.35rem); right:0;
          background:#141720; border:1px solid #24272f; border-radius:10px;
          box-shadow:0 12px 32px rgba(0,0,0,0.45); padding:0.55rem;
          z-index:100; min-width:220px;
        }
        .export-item {
          padding:0.6rem 0.7rem; border-radius:7px; cursor:pointer;
          border:1px solid transparent; margin-bottom:0.28rem; transition:all 0.18s;
          font-size:0.82rem; color:#8a8f9e;
        }
        .export-item:hover { border-color:#60A5FA; background:rgba(96,165,250,0.07); color:#60A5FA; }
        .export-item:last-child { margin-bottom:0; }

        label.lbl {
          display:block; font-size:0.78rem; font-weight:600;
          color:#6b7280; text-transform:uppercase; letter-spacing:0.08em;
          margin-bottom:0.45rem;
        }
        select, textarea {
          width:100%; background:#1a1d27; border:1px solid #2e3240; border-radius:8px;
          color:#e2e4e9; font-family:'Sora',sans-serif; font-size:0.88rem;
          padding:0.7rem 0.85rem; outline:none; transition:border 0.2s;
        }
        select:focus, textarea:focus { border-color:#34D399; }
        textarea { resize:vertical; font-family:'JetBrains Mono',monospace; font-size:0.78rem; line-height:1.7; }
        textarea::placeholder { color:#3d4050; }

        .stat-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:0.75rem; }
        .stat-box {
          background:#1a1d27; border:1px solid #2a2d3a; border-radius:10px;
          padding:0.85rem 0.75rem; text-align:center;
        }
        .stat-val { font-size:1.55rem; font-weight:700; line-height:1.2; }
        .stat-lbl { font-size:0.7rem; color:#6b7280; text-transform:uppercase; letter-spacing:0.06em; margin-top:0.3rem; }

        .results-table { width:100%; border-collapse:collapse; font-size:0.8rem; }
        .results-table th {
          background:#1a1d27; color:#6b7280; font-weight:600; font-size:0.68rem;
          text-transform:uppercase; letter-spacing:0.07em; padding:0.6rem 0.7rem;
          text-align:left; border-bottom:1px solid #2a2d3a; position:sticky; top:0;
        }
        .results-table td {
          padding:0.55rem 0.7rem; border-bottom:1px solid #1e2130;
          font-family:'JetBrains Mono',monospace;
        }
        .results-table tr:hover td { background:#1c1f2a; }

        .eff-badge {
          display:inline-block; padding:0.2rem 0.55rem; border-radius:5px;
          font-size:0.7rem; font-weight:600; letter-spacing:0.03em;
        }
        .strand-badge {
          display:inline-block; padding:0.18rem 0.5rem; border-radius:5px;
          font-size:0.72rem; font-weight:600;
        }

        .seq-display {
          background:#12141c; border:1px solid #2a2d3a; border-radius:8px;
          padding:0.9rem 1rem; font-family:'JetBrains Mono',monospace;
          font-size:0.72rem; line-height:1.9; word-break:break-all; color:#a0a3b1;
        }
        .pam-fwd { background:rgba(52,211,153,0.22); color:#34D399; font-weight:700; padding:1px 3px; border-radius:3px; }
        .pam-rev { background:rgba(96,165,250,0.22); color:#60A5FA; font-weight:700; padding:1px 3px; border-radius:3px; }
        .guide-fwd { border-bottom:2px solid #34D399; padding-bottom:1px; }
        .guide-rev { border-bottom:2px solid #60A5FA; padding-bottom:1px; }

        .info-panel { overflow:hidden; transition:max-height 0.4s cubic-bezier(0.4,0,0.2,1), opacity 0.3s; }
        .info-panel.closed { max-height:0; opacity:0; }
        .info-panel.open { max-height:800px; opacity:1; }

        .bar-track { height:5px; background:#1a1d27; border-radius:3px; overflow:hidden; margin-top:0.35rem; }
        .bar-fill { height:100%; border-radius:3px; transition:width 0.6s cubic-bezier(0.4,0,0.2,1); }

        @media(max-width:600px){
          .stat-grid { grid-template-columns:repeat(2,1fr); }
          .card { padding:1rem; }
          .export-menu { 
            right:auto; 
            left:0; 
            max-width:calc(100vw - 2.5rem);
          }
        }

        @keyframes spin{ to{ transform:rotate(360deg); } }
        .spin{ display:inline-block; width:16px; height:16px; border:2px solid rgba(255,255,255,0.25); border-top-color:#fff; border-radius:50%; animation:spin 0.5s linear infinite; }
      `}</style>

      {/* ── HEADER ── */}
      <div style={{ background: 'linear-gradient(180deg,#151821 0%,#0f1117 100%)', borderBottom: '1px solid #2a2d3a', padding: '1.8rem 1.5rem 1.4rem' }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.55rem' }}>
            <span style={{ background: 'linear-gradient(135deg,#34D399,#059669)', color: '#0f1117', fontSize: '0.65rem', fontWeight: 800, padding: '0.32rem 0.52rem', borderRadius: 7, letterSpacing: '0.04em' }}>CRISPR</span>
            <h1 style={{ fontFamily: 'Sora', fontWeight: 700, fontSize: '1.45rem', color: '#fff', letterSpacing: '-0.01em' }}>
              CRISPR PAM Site Finder
            </h1>
            <span style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)', color: '#34D399', fontSize: '0.62rem', fontWeight: 600, padding: '0.22rem 0.55rem', borderRadius: 20, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Research Grade
            </span>
          </div>
          <p style={{ color: '#6b7280', fontSize: '0.82rem', lineHeight: 1.5, maxWidth: 600 }}>
            Identify Protospacer Adjacent Motif sites across both strands for CRISPR-Cas gene editing. Supports SpCas9, SaCas9, Cas12a, and custom PAM patterns.
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '1.25rem 1.25rem 3rem' }}>

        {/* ── INFO TOGGLE ── */}
        <button className="btn-ghost" onClick={() => setShowInfo(v => !v)} style={{ marginBottom: '1rem', width: '100%', justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            Why This Tool Matters & How to Use It
          </span>
          <span style={{ fontSize: '0.7rem', color: '#6b7280', transition: 'transform 0.25s', transform: showInfo ? 'rotate(180deg)' : 'rotate(0deg)', display: 'inline-block' }}>▼</span>
        </button>

        <div className={`info-panel ${showInfo ? 'open' : 'closed'}`}>
          <div className="card card-sm" style={{ marginBottom: '1.25rem', borderColor: '#2e3240' }}>
            {/* Why matters */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.4rem' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#34D399', display: 'inline-block', boxShadow: '0 0 6px #34D39988' }}></span>
                  <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#34D399', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Why It Matters</span>
                </div>
                <p style={{ fontSize: '0.78rem', color: '#8a8d9a', lineHeight: 1.65 }}>
                  CRISPR-Cas systems require a specific <strong style={{ color: '#a0a3b1' }}>PAM sequence</strong> adjacent to the target site to initiate DNA cleavage. Without a valid PAM, the Cas protein cannot bind or cut. This tool scans your entire sequence on <em style={{ color: '#a0a3b1' }}>both strands</em>, extracts every viable target, and scores them by predicted GC-based efficiency — saving hours of manual work.
                </p>
              </div>
            </div>
            {/* How to use */}
            <div style={{ borderTop: '1px solid #2a2d3a', paddingTop: '0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.5rem' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#60A5FA', display: 'inline-block', boxShadow: '0 0 6px #60A5FA88' }}></span>
                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#60A5FA', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Workflow & Next Steps</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: '0.6rem' }}>
                {[
                  ['1', 'Select Enzyme', 'Choose SpCas9 (NGG) for broad targeting, SaCas9 for smaller delivery vectors, or Cas12a for T-rich regions.'],
                  ['2', 'Paste Sequence', 'Input your target gene region. The tool strips whitespace and numbers automatically.'],
                  ['3', 'Scan & Score', 'Hit Find PAM Sites. Each hit is scored by GC content — aim for 40–60 % (High efficiency).'],
                  ['4', 'Downstream Use', 'Export the sgRNA sequences directly into primer design tools, order as oligos, or clone into a guide-RNA expression vector.']
                ].map(([n, title, desc]) => (
                  <div key={n} style={{ background: '#12141c', border: '1px solid #2a2d3a', borderRadius: 8, padding: '0.65rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.3rem' }}>
                      <span style={{ background: '#34D399', color: '#0f1117', fontSize: '0.62rem', fontWeight: 700, width: 18, height: 18, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span>
                      <span style={{ fontSize: '0.74rem', fontWeight: 600, color: '#e2e4e9' }}>{title}</span>
                    </div>
                    <p style={{ fontSize: '0.7rem', color: '#6b7280', lineHeight: 1.55, paddingLeft: '0.05rem' }}>{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── CAS SELECTION ── */}
        <div className="card">
          <label className="lbl">Cas Enzyme</label>
          <select value={selectedCas} onChange={e => setSelectedCas(e.target.value)}>
            <option value="spCas9">SpCas9 — NGG  ·  Standard, broadest target range</option>
            <option value="saCas9">SaCas9 — NNGRRT  ·  Compact, ideal for AAV delivery</option>
            <option value="cas12a">Cas12a / Cpf1 — TTTV  ·  T-rich PAM, staggered cut</option>
            <option value="custom">Custom PAM Pattern</option>
          </select>

          {selectedCas === 'custom' && (
            <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: '1fr 140px 180px', gap: '0.75rem' }}>
              <div>
                <label className="lbl">PAM Pattern <span style={{ textTransform: 'none', color: '#4a4d5a', fontWeight: 400 }}>(IUPAC: N R Y …)</span></label>
                <input type="text" value={customPAM} onChange={e => setCustomPAM(e.target.value.toUpperCase())} placeholder="e.g. NGG"
                  style={{ width: '100%', background: '#1a1d27', border: '1px solid #2e3240', borderRadius: 8, color: '#e2e4e9', fontFamily: '"JetBrains Mono",monospace', fontSize: '0.85rem', padding: '0.7rem 0.85rem', outline: 'none' }}
                  onFocus={e => e.target.style.borderColor = '#34D399'} onBlur={e => e.target.style.borderColor = '#2e3240'}
                />
              </div>
              <div>
                <label className="lbl">Guide Length</label>
                <input type="number" value={customGuideLen} onChange={e => setCustomGuideLen(parseInt(e.target.value) || 20)} min={15} max={25}
                  style={{ width: '100%', background: '#1a1d27', border: '1px solid #2e3240', borderRadius: 8, color: '#e2e4e9', fontFamily: 'Sora', fontSize: '0.85rem', padding: '0.7rem 0.85rem', outline: 'none' }}
                  onFocus={e => e.target.style.borderColor = '#34D399'} onBlur={e => e.target.style.borderColor = '#2e3240'}
                />
              </div>
              <div>
                <label className="lbl">PAM Position</label>
                <select value={customPAMPos} onChange={e => setCustomPAMPos(e.target.value)}>
                  <option value="downstream">Downstream (3′)</option>
                  <option value="upstream">Upstream (5′)</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* ── SEQUENCE INPUT ── */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.45rem', flexWrap: 'wrap', gap: '0.4rem' }}>
            <label className="lbl" style={{ margin: 0 }}>DNA Sequence</label>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              <label className="btn-sample" style={{ cursor: 'pointer', margin: 0 }}>
                Upload FASTA
                <input type="file" accept=".fasta,.fa,.txt" onChange={handleFileUpload} style={{ display: 'none' }} />
              </label>
              <button className="btn-sample sample-shine" onClick={loadSample}>
                Load Sample
              </button>
            </div>
          </div>
          <textarea rows={5} value={sequence} onChange={e => setSequence(e.target.value)} placeholder="Paste your target gene region here or upload a FASTA file…  (whitespace &amp; numbers are ignored)" />
          {sequence && (
            <div style={{ marginTop: '0.45rem', fontSize: '0.7rem', color: '#4a4d5a', fontFamily: '"JetBrains Mono",monospace' }}>
              {sequence.toUpperCase().replace(/[^ATGC]/g, '').length} bp after cleaning
            </div>
          )}
        </div>

        {error && (
          <div style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, padding: '0.65rem 0.85rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.78rem', color: '#F87171', fontWeight: 600 }}>Error:</span>
            <span style={{ fontSize: '0.78rem', color: '#F87171' }}>{error}</span>
          </div>
        )}

        {/* ── SUBMIT ── */}
        <button className="btn-primary" onClick={handleFind} disabled={loading}>
          {loading ? <><span style={{ width: 16, height: 16, border: '2px solid rgba(15,17,23,0.25)', borderTop: '2px solid #0f1117', borderRadius: '50%', animation: 'spin 0.55s linear infinite', display: 'inline-block' }}></span> Scanning...</> : <>Find PAM Sites</>}
        </button>
        <style>{`@keyframes spin{ to{transform:rotate(360deg)} }`}</style>

        {/* ── RESULTS ── */}
        {pamSites && (
          <>
            {/* summary stats */}
            <div style={{ marginTop: '1.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.65rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  Results — <span style={{ color: '#34D399' }}>{casConfig.name}</span> · PAM <span style={{ fontFamily: '"JetBrains Mono",monospace', color: '#FBBF24' }}>{casConfig.pam}</span>
                </span>
                <div style={{ position: 'relative' }}>
                  <button
                    className="btn-export"
                    onClick={(e) => { e.stopPropagation(); setShowExportMenu(v => !v); }}
                  >
                    Export Results <span style={{ fontSize: '0.72rem', marginLeft: '0.2rem' }}>{showExportMenu ? '\u25B2' : '\u25BC'}</span>
                  </button>
                  {showExportMenu && (
                    <div className="export-menu" onClick={(e) => e.stopPropagation()}>
                      <div className="export-item" onClick={() => exportTXT(false)}>
                        <strong>TXT - Summary Only</strong>
                        <div style={{ fontSize: '0.72rem', color: '#6b7080', marginTop: '0.15rem' }}>Basic statistics</div>
                      </div>
                      <div className="export-item" onClick={() => exportTXT(true)}>
                        <strong>TXT - Detailed</strong>
                        <div style={{ fontSize: '0.72rem', color: '#6b7080', marginTop: '0.15rem' }}>All PAM sites with sequences</div>
                      </div>
                      <div className="export-item" onClick={() => exportPDF(false)}>
                        <strong>PDF - Summary Only</strong>
                        <div style={{ fontSize: '0.72rem', color: '#6b7080', marginTop: '0.15rem' }}>Basic statistics</div>
                      </div>
                      <div className="export-item" onClick={() => exportPDF(true)}>
                        <strong>PDF - Detailed</strong>
                        <div style={{ fontSize: '0.72rem', color: '#6b7080', marginTop: '0.15rem' }}>All PAM sites with sequences</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="stat-grid">
                <div className="stat-box">
                  <div className="stat-val" style={{ color: '#fff' }}>{pamSites.total}</div>
                  <div className="stat-lbl">Total Sites</div>
                </div>
                <div className="stat-box">
                  <div className="stat-val" style={{ color: '#34D399' }}>{pamSites.forward}</div>
                  <div className="stat-lbl">Forward (+)</div>
                </div>
                <div className="stat-box">
                  <div className="stat-val" style={{ color: '#60A5FA' }}>{pamSites.reverse}</div>
                  <div className="stat-lbl">Reverse (−)</div>
                </div>
                <div className="stat-box">
                  <div className="stat-val" style={{ color: '#6b7280', fontSize: '1.15rem' }}>{pamSites.seqLen}<span style={{ fontSize: '0.6rem', fontWeight: 400 }}> bp</span></div>
                  <div className="stat-lbl">Seq Length</div>
                </div>
              </div>
            </div>

            {/* AI EXPLAIN BUTTON */}
            <div style={{ marginTop: '1.1rem' }}>
              <button className="btn-ai" onClick={handleAI} disabled={loadingAI}>
                {loadingAI ? <><span className="spin"></span> Generating AI Analysis…</> : <>Get AI Explanation</>}
              </button>
            </div>

            {/* AI RESULT */}
            {aiExplanation && (
              <div className="ai-box">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.6rem' }}>
                  <span style={{ fontSize: '0.86rem', fontWeight: 600, color: '#818cf8' }}>AI Analysis</span>
                </div>
                <div style={{ fontSize: '0.88rem', color: '#e2e4e9', lineHeight: 1.8, whiteSpace: 'pre-wrap', maxHeight: 440, overflowY: 'auto', background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '0.75rem', border: '1px solid #24272f' }}>
                  {aiExplanation}
                </div>
              </div>
            )}

            {/* efficiency bars */}
            {pamSites.total > 0 && (
              <div className="card" style={{ marginTop: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.7rem' }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Efficiency Breakdown</span>
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    {['High', 'Medium', 'Low'].map(e => (
                      <span key={e} style={{ fontSize: '0.65rem', color: effColor(e), display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: effColor(e), display: 'inline-block' }}></span>{e}
                      </span>
                    ))}
                  </div>
                </div>
                {['High', 'Medium', 'Low'].map(e => {
                  const count = pamSites.sites.filter(s => s.efficiency === e).length;
                  const pct = pamSites.total ? (count / pamSites.total) * 100 : 0;
                  return (
                    <div key={e} style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', marginBottom: '0.45rem' }}>
                      <span style={{ width: 48, fontSize: '0.72rem', color: effColor(e), fontWeight: 600 }}>{e}</span>
                      <div style={{ flex: 1 }}>
                        <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%`, background: effColor(e) }}></div></div>
                      </div>
                      <span style={{ width: 42, fontSize: '0.68rem', color: '#6b7280', textAlign: 'right' }}>{count} <span style={{ color: '#4a4d5a' }}>({pct.toFixed(0)}%)</span></span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* highlighted sequence */}
            {pamSites.total > 0 && (
              <div className="card" style={{ marginTop: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Annotated Sequence</span>
                  <div style={{ display: 'flex', gap: '1rem', fontSize: '0.67rem' }}>
                    <span style={{ color: '#34D399' }}>■ PAM (+)</span>
                    <span style={{ color: '#60A5FA' }}>■ PAM (−)</span>
                    <span style={{ color: '#34D399', borderBottom: '2px solid #34D399', paddingBottom: 1 }}>guide (+)</span>
                    <span style={{ color: '#60A5FA', borderBottom: '2px solid #60A5FA', paddingBottom: 1 }}>guide (−)</span>
                  </div>
                </div>
                <div className="seq-display">
                  {(() => {
                    const seq = sequence.toUpperCase().replace(/[^ATGC]/g, '');
                    // build a map: index → [pam-fwd, pam-rev, guide-fwd, guide-rev]
                    const map = Array.from({ length: seq.length }, () => ({ pam: null, guide: null }));
                    pamSites.sites.forEach(s => {
                      const pS = s.position - 1, pE = s.positionEnd;
                      const gS = s.guideStart - 1, gE = s.guideEnd;
                      for (let i = pS; i < pE && i < seq.length; i++) map[i].pam = s.strand;
                      for (let i = gS; i < gE && i < seq.length; i++) if (!map[i].guide) map[i].guide = s.strand;
                    });
                    // group consecutive identical states
                    const chunks = [];
                    let cur = null;
                    map.forEach((m, i) => {
                      const key = `${m.pam || '_'}|${m.guide || '_'}`;
                      if (cur && cur.key === key) { cur.end = i + 1; }
                      else { cur = { key, pam: m.pam, guide: m.guide, start: i, end: i + 1 }; chunks.push(cur); }
                    });
                    return chunks.map((c, i) => {
                      let cls = '';
                      if (c.pam === 'forward') cls += ' pam-fwd';
                      else if (c.pam === 'reverse') cls += ' pam-rev';
                      if (!c.pam && c.guide === 'forward') cls += ' guide-fwd';
                      else if (!c.pam && c.guide === 'reverse') cls += ' guide-rev';
                      return <span key={i} className={cls.trim()}>{seq.substring(c.start, c.end)}</span>;
                    });
                  })()}
                </div>
              </div>
            )}

            {/* table */}
            {pamSites.total > 0 && (
              <div className="card" style={{ marginTop: '1.25rem', padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '0.85rem 1rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    PAM Sites · {pamSites.total} found
                  </span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="results-table">
                    <thead>
                      <tr>
                        <th>#</th><th>Position</th><th>Strand</th><th>PAM</th><th>sgRNA Sequence</th><th>GC %</th><th>Efficiency</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pamSites.sites.map((s, i) => (
                        <tr key={i}>
                          <td style={{ color: '#6b7280', fontWeight: 600 }}>{i + 1}</td>
                          <td style={{ color: '#a0a3b1' }}>{s.position}–{s.positionEnd}</td>
                          <td>
                            <span className="strand-badge" style={{ background: s.strand === 'forward' ? 'rgba(52,211,153,0.12)' : 'rgba(96,165,250,0.12)', color: s.strand === 'forward' ? '#34D399' : '#60A5FA' }}>
                              {s.strand === 'forward' ? '(+) Fwd' : '(−) Rev'}
                            </span>
                          </td>
                          <td style={{ color: s.strand === 'forward' ? '#34D399' : '#60A5FA', fontWeight: 600 }}>{s.pamSequence}</td>
                          <td style={{ color: '#c8caD0', fontSize: '0.72rem', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.guideRNA}>{s.guideRNA}</td>
                          <td style={{ color: '#a0a3b1' }}>{s.gcContent}</td>
                          <td>
                            <span className="eff-badge" style={{ background: effBg(s.efficiency), color: effColor(s.efficiency) }}>{s.efficiency}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* empty state */}
            {pamSites.total === 0 && (
              <div className="card" style={{ marginTop: '1.5rem', textAlign: 'center', padding: '2.5rem 1.5rem' }}>
                <div style={{ fontSize: '1.1rem', marginBottom: '0.4rem', fontWeight: 700, color: '#3d4050' }}>No Results</div>
                <p style={{ color: '#a0a3b1', fontWeight: 600, fontSize: '0.88rem' }}>No PAM sites found</p>
                <p style={{ color: '#6b7280', fontSize: '0.75rem', marginTop: '0.3rem' }}>Try a different Cas enzyme or verify your sequence.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
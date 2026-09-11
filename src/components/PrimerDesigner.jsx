import { useState, useEffect } from 'react';
import { evaluatePrimerPair, calcSecondaryStructureScore, calcTmNN, calcGC, calc3PrimeDG, calcHairpinDG, calcSelfDimerDG, calcCrossDimerDG, assessCrossDimerInteraction, revComp } from '../utils/primerEvalEngine';

/* ─── API CONFIG ─────────────────────────────────────────────────────────── */
const API_URL = import.meta.env?.VITE_API_URL || 'https://dna-analyzer-ousa.onrender.com';

/* ─── CURATED SAMPLES ──────────────────────────────────────────────────────── */
const CURATED_SAMPLES = [
  {
    name: "🟢 Gold Standard PCR (PASS)",
    context: "Validated 250bp Template. Correct GC%, no long repeats, and passes all cross-dimer thresholds.",
    application_mode: "standard",
    sequence: "ATGGCTACGTGACCTGATCGTACGTAGCTAGCTGACGTAGCTGATCGTAGCTAGCTGACTGACGTAGCTGATCGTACGTAGCTGACTGATCGTAGCTAGCTGACGTAGCTGATCGTACGTAGCTGACTGATCGTAGCTAGCTGACGTAGCTGATCGTACGTAGCTGACTGATCGTAGCTAGCTGACGTAGCTGATCGTACGTAGCTGACTGATCGTAGCTAGCTGACGTAGCTGA",
    relaxLevel: 0,
    isBorderline: false
  },
  {
    name: "🟢 qPCR Optimized (Short Amplicon)",
    context: "Optimal 84bp sequence mathematically tuned to Real-Time limits.",
    application_mode: "qpcr",
    sequence: "ATGACCTGACGTTGACCTGACCGTACGTTGACCTGACCGTACGATGACCTGACGTTGACCTGACCGTACGTTGACCTGACCGTA",
    relaxLevel: 0,
    isBorderline: false
  },
  {
    name: "🟡 High GC Stress-Test (75%)",
    context: "Challenging target requiring relaxed structural penalties.",
    application_mode: "high_gc",
    sequence: "CGGCGGCGGCGCGGAGCCGGCCGACCCGCGGCGCGCGAGCCCGACGCCGGCGGCCGAGCGCGCGAGCCGGCGCAGCGGCC",
    isHighSensitivity: false,
    relaxLevel: 2,
    isBorderline: false
  },
  {
    name: "🟡 Low GC Template (Repetitive AT)",
    context: "Forced into Touchdown strategy to permit wider Tm tolerances.",
    application_mode: "standard",
    sequence: "TATATATATAAATTTTATATACGATATCGTTAAATAGCTTATTATATATATAAATTTTATATACGATATCGTTAAATAGCTTATTATATATATAAATTTTATATACGATATCGTTAAATAGCTTAT",
    isTouchdown: true,
    relaxLevel: 1,
    isBorderline: false
  },
  {
    name: "🟠 Mutation Detection (Allele Specific)",
    context: "Requires strict 3' sensitivity. Designed to test classification of terminal mismatches.",
    application_mode: "mutation",
    sequence: "ATGGCTACGTGACCTGATCGTAGCTAGCTGACGTAGCTGATCGTACGTAGCTGACTGATCGTACGTAGCTGACTGATCGTACGTAGCTGACTGATCGTACGTAGCTGACTGATCGTACGTAGCTGA",
    relaxLevel: 0,
    isBorderline: false
  },
  {
    name: "🔴 Thermodynamic Failure Demo (Cross-Dimer + Repeats)",
    context: "Safety stress-test template intentionally designed to trigger multiple thermodynamic failure gates (Extreme GC, Hairpin, Cross-Dimer).",
    application_mode: "standard",
    sequence: "ATGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGCGC",
    relaxLevel: 0,
    isBorderline: false
  }
];

/* ═══════════════════════════════════════════════════════════════════════════
   THERMODYNAMIC ENGINE imported from primerEvalEngine.js
   ═══════════════════════════════════════════════════════════════════════════ */

function calcLast5GC(seq) {
  const end = seq.slice(-5).toUpperCase();
  return parseFloat(((end.split('').filter(b => 'GC'.includes(b)).length / 5) * 100).toFixed(1));
}

function hasRuns(seq, n = 4) {
  return ['A', 'T', 'G', 'C'].some(b => seq.toUpperCase().includes(b.repeat(n)));
}

function hasGCClamp(seq) {
  const end2 = seq.slice(-2).toUpperCase();
  const gc = (end2.match(/[GC]/g) || []).length;
  return gc >= 1 && gc <= 2;
}

function noTerminalGGGCCC(seq) {
  const end3 = seq.slice(-3).toUpperCase();
  return !end3.includes('GGG') && !end3.includes('CCC');
}

function hasInternalComplementarity(seq) {
  seq = seq.toUpperCase();
  const n = seq.length;
  for (let len = 5; len <= 8; len++) {
    for (let i = 0; i <= n - 2 * len; i++) {
      const sub = seq.slice(i, i + len);
      for (let j = i + len; j <= n - len; j++) {
        if (seq.slice(j, j + len) === revComp(sub)) return true;
      }
    }
  }
  return false;
}

// Count max 8-mer repeat hits of primer against full sequence (specificity)
function countRepeatHits(primer, fullSeq) {
  primer = primer.toUpperCase(); fullSeq = fullSeq.toUpperCase();
  let max = 0;
  for (let i = 0; i <= primer.length - 8; i++) {
    const kmer = primer.slice(i, i + 8);
    let cnt = 0, pos = 0;
    while ((pos = fullSeq.indexOf(kmer, pos)) !== -1) { cnt++; pos++; }
    if (cnt > max) max = cnt;
  }
  return max;
}

/* ─── SCORING (weighted) ─────────────────────────────────────────────────── */
function scorePrimerFull(p, fullSeq, mode, isHighSensitivity, isTouchdown) {
  const tmTarget = (mode.tmMin + mode.tmMax) / 2;

  let wTm = 40, wSpec = 30, wStruct = 20, wClamp = 10;
  if (mode.name === 'qPCR (Real-Time)') { wTm = 40; wSpec = 35; wStruct = 15; wClamp = 10; }
  else if (mode.name === 'Long-Range PCR') { wTm = 45; wSpec = 25; wStruct = 20; wClamp = 10; }
  else if (mode.name === 'High GC PCR') { wTm = 45; wSpec = 30; wStruct = 15; wClamp = 10; }
  else if (mode.name === 'Mutation Detection') { wTm = 40; wSpec = 40; wStruct = 10; wClamp = 10; }

  if (isHighSensitivity) {
    wSpec += 5;
    wStruct -= 5;
  }

  const tmScoreRaw = Math.max(0, 1 - Math.abs(p.tm - tmTarget) / 5);
  const gcScoreRaw = Math.max(0, 1 - Math.abs(p.gc_content - 50) / 15);
  const combinedThermo = (tmScoreRaw + gcScoreRaw) / 2;

  const hpScoreRaw = p.hairpin_dg > -1 ? 1.0 : p.hairpin_dg > -2 ? 0.8 : p.hairpin_dg > -3 ? 0.55 : 0.0;
  const sdScoreRaw = p.self_dimer_dg > -2 ? 1.0 : p.self_dimer_dg > -3.5 ? 0.75 : p.self_dimer_dg > -5 ? 0.45 : 0.0;
  const combinedStruct = (hpScoreRaw + sdScoreRaw) / 2;

  const clampScoreRaw = hasGCClamp(p.sequence) ? 1.0 : 0.0;

  let rep = countRepeatHits(p.sequence, fullSeq);
  const specScoreRaw = rep <= 2 ? 1.0 : rep <= 5 ? 0.7 : rep <= 10 ? 0.35 : 0.1;

  let total = combinedThermo * (wTm / 100) + specScoreRaw * (wSpec / 100) + combinedStruct * (wStruct / 100) + clampScoreRaw * (wClamp / 100);

  // Specificity penalty in High Sensitivity mode
  if (isHighSensitivity && rep > 5) total -= 0.15;

  return Math.round(total * 100);
}

function classifyScore(score) {
  if (score >= 85) return 'Excellent';
  if (score >= 70) return 'Good';
  if (score >= 60) return 'Fair';
  return 'Poor';
}

function simulateMeltingCurveAnalysis(fwdTm, revTm, fwdGc, revGc, productLength, crossDimerDG = null) {
  const validNum = v => typeof v === 'number' && !isNaN(v) && isFinite(v);
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  const tmA = validNum(fwdTm) ? fwdTm : null;
  const tmB = validNum(revTm) ? revTm : null;
  const gcA = validNum(fwdGc) ? fwdGc : null;
  const gcB = validNum(revGc) ? revGc : null;
  const len = validNum(productLength) && productLength > 0 ? productLength : 250;

  const avgTm = tmA != null && tmB != null ? (tmA + tmB) / 2 : (tmA ?? tmB ?? 60);
  const avgGc = gcA != null && gcB != null ? (gcA + gcB) / 2 : (gcA ?? gcB ?? 50);
  const tmDiff = tmA != null && tmB != null ? Math.abs(tmA - tmB) : 1.5;

  const gcShift = (avgGc - 50) * 0.05;
  const lenShift = Math.log10(Math.max(60, len) / 200) * 1.2;
  const peakMeltingTemperature = parseFloat(clamp(avgTm + gcShift + lenShift, 50, 98).toFixed(1));

  let curveType = 'Sharp';
  if (tmDiff > 3 || avgGc < 35 || avgGc > 68 || len > 1400) curveType = 'Multiple Peaks';
  else if (tmDiff > 1.8 || avgGc < 40 || avgGc > 62 || len > 800 || len < 90) curveType = 'Broad';

  if (validNum(crossDimerDG) && crossDimerDG < -7) curveType = 'Multiple Peaks';
  else if (validNum(crossDimerDG) && crossDimerDG < -5 && curveType === 'Sharp') curveType = 'Broad';

  let interpretation = 'Sharp peak → high specificity';
  if (curveType === 'Broad') interpretation = 'Broad peak → possible non-specific binding';
  if (curveType === 'Multiple Peaks') interpretation = 'Multiple peaks → non-specific products or primer dimers';

  let explanation = `Estimated peak melting temperature is ${peakMeltingTemperature}°C with a ${curveType.toLowerCase()} curve profile.`;
  if (curveType === 'Sharp') {
    explanation += ' This suggests specific target amplification and generally good PCR quality.';
  } else if (curveType === 'Broad') {
    explanation += ' This suggests possible off-target amplification; optimize annealing temperature or primer design.';
  } else {
    explanation += ' This suggests mixed products or dimer artifacts; redesign primers or increase stringency.';
  }

  return {
    peakMeltingTemperature,
    curveType,
    interpretation,
    summary: explanation,
    tmDifferenceUsed: parseFloat(tmDiff.toFixed(1)),
    gcUsed: parseFloat(avgGc.toFixed(1)),
    estimated: !(tmA != null && tmB != null && gcA != null && gcB != null && validNum(productLength))
  };
 }

function buildSpecificityAnalysis(score, maxRepeatHits = 0) {
  const s = typeof score === 'number' && isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
  const issues = [];
  let interpretation = '';

  if (s >= 80) {
    interpretation = 'High specificity. Primer is likely to bind only the intended target sequence.';
  } else if (s >= 60) {
    interpretation = 'Moderate specificity. Minor off-target binding is possible under less stringent PCR conditions.';
    issues.push('Off-target binding');
  } else if (s >= 40) {
    interpretation = 'Low specificity. Off-target binding is possible and primer sequence may not be sufficiently unique.';
    issues.push('Off-target binding');
    issues.push('Low sequence uniqueness');
  } else {
    interpretation = 'Poor specificity. High risk of non-specific amplification and unreliable target selectivity.';
    issues.push('Off-target binding');
    issues.push('Low sequence uniqueness');
  }

  if (maxRepeatHits > 5 || s < 60) {
    issues.push('Repetitive regions');
  }

  const recommendation = s >= 80
    ? 'Maintain current design, and confirm with gradient PCR. If optimization is needed, tune primer length by ±1-2 bp while preserving balanced GC.'
    : 'Improve primer design by adjusting length (typically 18-25 bp), balancing GC content toward ~40-60%, and redesigning toward a more unique target region.';

  return {
    score: parseFloat(s.toFixed(1)),
    interpretation,
    possibleIssues: [...new Set(issues)],
    recommendation
  };
}

/* ─── MAIN PRIMER DESIGN ENGINE ──────────────────────────────────────────── */
/* ─── CANDIDATE SCANNER ──────────────────────────────────────────────────────
   Scans the sequence with given thresholds and returns raw candidate lists.
   thresholds: { gcMax, tmMin, tmMax, hpMin, sdMin, allowNoClamp, allowRuns3 }
   ─────────────────────────────────────────────────────────────────────────── */
function scanCandidates(seq, mode, ampMin, ampMax, th, conditions) {
  const n = seq.length;
  const fwds = [], revs = [];

  const tryPrimer = (p, start, end, isRev) => {
    const gc = calcGC(p);
    if (gc < 40 || gc > th.gcMax) return null;
    if (hasRuns(p, th.allowRuns3 ? 5 : 4)) return null;          // relax: allow 4-run, block only 5+
    if (!th.allowNoClamp && !hasGCClamp(p)) return null;
    if (!noTerminalGGGCCC(p)) return null;
    // Skip expensive internal complementarity check in relaxed passes
    if (!th.relaxed && hasInternalComplementarity(p)) return null;
    const tm = calcTmNN(p, conditions);
    if (tm < th.tmMin || tm > th.tmMax) return null;
    const hp = calcHairpinDG(p, conditions);
    const sd = calcSelfDimerDG(p, conditions);
    if (hp < th.hpMin) return null;
    if (sd < th.sdMin) return null;
    return {
      sequence: p, length: p.length, start, end,
      tm, gc_content: gc,
      hairpin_dg: hp, self_dimer_dg: sd,
      three_prime_dg: calc3PrimeDG(p, conditions),
      last_5bp_gc: calcLast5GC(p),
      gc_clamp: { has_clamp: hasGCClamp(p), clamp_strength: (p.slice(-2).match(/[GC]/g) || []).length }
    };
  };

  for (let start = 0; start < n - 18; start++) {
    for (let len = 18; len <= 22; len++) {
      if (start + len > n) continue;
      const r = tryPrimer(seq.slice(start, start + len), start, start + len, false);
      if (r) fwds.push(r);
    }
  }
  for (let endPos = ampMin; endPos <= n; endPos++) {
    for (let len = 18; len <= 22; len++) {
      const start = endPos - len;
      if (start < 0) continue;
      const rc = revComp(seq.slice(start, endPos));
      const r = tryPrimer(rc, start, endPos, true);
      if (r) revs.push(r);
    }
  }
  return { fwds, revs };
}

/* ─── PAIR PICKER ────────────────────────────────────────────────────────────
   Given scored fwd+rev lists, find best pair using true weightedScore from engine.
   ─────────────────────────────────────────────────────────────────────────── */
function pickBestPair(fwds, revs, ampMin, ampMax, tmDiffMax, crossDimerMin, conditions, seq, appModeKey, isHighSensitivity, isTouchdown) {
  let best = null, bestScore = -Infinity;
  const fList = fwds.slice(0, 50);
  const rList = revs.slice(0, 50);
  for (const fwd of fList) {
    for (const rev of rList) {
      const amp = rev.end - fwd.start;
      if (amp < ampMin || amp > ampMax) continue;
      if (Math.abs(fwd.tm - rev.tm) > tmDiffMax) continue;
      const cd = calcCrossDimerDG(fwd.sequence, rev.sequence, conditions);
      if (cd < crossDimerMin) continue;

      const ev = evaluatePrimerPair(fwd.sequence, rev.sequence, appModeKey || 'standard', seq, conditions, isHighSensitivity, isTouchdown);
      if (ev && !ev.error) {
        const effectiveScore = ev.autoRejected ? (ev.weightedScore - 200) : ev.weightedScore;
        if (effectiveScore > bestScore) {
          bestScore = effectiveScore;
          best = { fwd, rev, amp, cross_dimer_dg: cd };
        }
      }
    }
  }
  return best;
}

/* ─── PICK TOP 3 BORDERLINE PAIRS ────────────────────────────────────────────
   Last resort: return top 3 scored pairs regardless of Tm/dimer strictness.
   ─────────────────────────────────────────────────────────────────────────── */
function pickBorderlinePairs(fwds, revs, ampMin, ampMax, conditions, seq, appModeKey, isHighSensitivity, isTouchdown) {
  const pairs = [];
  const fList = fwds.slice(0, 40);
  const rList = revs.slice(0, 40);
  for (const fwd of fList) {
    for (const rev of rList) {
      const amp = rev.end - fwd.start;
      if (amp < ampMin || amp > ampMax) continue;
      const cd = calcCrossDimerDG(fwd.sequence, rev.sequence, conditions);
      const ev = evaluatePrimerPair(fwd.sequence, rev.sequence, appModeKey || 'standard', seq, conditions, isHighSensitivity, isTouchdown);
      const pairScore = ev && !ev.error ? ev.weightedScore : -100;
      pairs.push({ fwd, rev, amp, cross_dimer_dg: cd, pairScore });
    }
  }
  pairs.sort((a, b) => b.pairScore - a.pairScore);
  return pairs.slice(0, 3);
}

function buildFallbackEvaluation({ fwd, rev, cross_dimer_dg, tmDiff, autoRejected, safetyTriggers, hasThermoError }) {
  const fwdStruct = calcSecondaryStructureScore(fwd.sequence, fwd.hairpin_dg, fwd.self_dimer_dg);
  const revStruct = calcSecondaryStructureScore(rev.sequence, rev.hairpin_dg, rev.self_dimer_dg);
  const structureScore = Math.round((fwdStruct.score + revStruct.score) / 2);
  const threePrimeInterference =
    fwdStruct.threePrimeInvolved || revStruct.threePrimeInvolved || fwdStruct.dimerThreePrime || revStruct.dimerThreePrime;

  const meltQuality = (p) => {
    if (p.hairpin_dg > -2.5 && p.self_dimer_dg > -4) return 'Sharp & Specific';
    if (p.hairpin_dg > -4 && p.self_dimer_dg > -6) return 'Broad / Minor Shoulder';
    return 'Non-specific / Multi-peak Risk';
  };

  const fwdMeltQ = meltQuality(fwd);
  const revMeltQ = meltQuality(rev);
  const asymmetricMelting = fwdMeltQ !== revMeltQ;

  let penalty = 0;
  penalty += Math.max(0, tmDiff - 1.5) * 9;
  penalty += Math.max(0, Math.abs(cross_dimer_dg) - 4) * 5;
  penalty += Math.max(0, Math.abs(Math.min(fwd.hairpin_dg, rev.hairpin_dg)) - 3) * 4;
  penalty += Math.max(0, Math.abs(Math.min(fwd.self_dimer_dg, rev.self_dimer_dg)) - 4) * 3;
  if (threePrimeInterference) penalty += 10;
  if (hasThermoError) penalty += 25;
  if (autoRejected) penalty += 30;

  const successProbability = Math.round(Math.max(0, Math.min(99, 92 - penalty)));

  let riskTier = 'High Risk';
  if (successProbability >= 80) riskTier = 'Low Risk';
  else if (successProbability >= 65) riskTier = 'Moderate Risk';
  else if (successProbability >= 50) riskTier = 'Elevated Risk';

  let confidenceBand = 'High Risk (<50%)';
  if (successProbability >= 85) confidenceBand = 'High Confidence (>=85%)';
  else if (successProbability >= 70) confidenceBand = 'Moderate Confidence (70-84%)';
  else if (successProbability >= 50) confidenceBand = 'Low Confidence (50-69%)';

  const optimizationSuggestions = [];
  if (tmDiff > 3) optimizationSuggestions.push('Run temperature-gradient PCR to optimize annealing and reduce mismatch risk.');
  if (cross_dimer_dg < -5) optimizationSuggestions.push('Reduce primer concentration and use hot-start polymerase to mitigate cross-dimer formation.');
  if (Math.min(fwd.hairpin_dg, rev.hairpin_dg) < -3) optimizationSuggestions.push('Shift one or both primers by 1-3 bases to reduce hairpin stability.');
  if (threePrimeInterference) optimizationSuggestions.push("Avoid strong 3' complementarity by redesigning terminal bases.");

  const meltCurve = simulateMeltingCurveAnalysis(
    fwd.tm,
    rev.tm,
    fwd.gc_content,
    rev.gc_content,
    null,
    cross_dimer_dg
  );

  return {
    successProbability,
    riskTier,
    safetyTriggers,
    safetyPassed: !autoRejected,
    thermoStatus: hasThermoError ? 'FAILED' : 'VALID',
    meltingCurve: {
      fwdMeltQ,
      revMeltQ,
      summary: meltCurve.summary,
      asymmetric: asymmetricMelting,
      peakMeltingTemperature: meltCurve.peakMeltingTemperature,
      curveType: meltCurve.curveType,
      interpretation: meltCurve.interpretation,
      estimated: true
    },
    structureScore,
    structureInterpretation: structureScore >= 6
      ? 'High interference risk from secondary structures.'
      : structureScore >= 3
        ? 'Moderate secondary structure presence.'
        : 'Minimal secondary structure risk.',
    threePrimeInterference,
    fwdStructure: fwdStruct,
    revStructure: revStruct,
    confidenceBand,
    optimizationSuggestions
  };
}

/* ─── BUILD RESULT OBJECT ────────────────────────────────────────────────────
   Shared result builder for both strict and borderline paths.
   ─────────────────────────────────────────────────────────────────────────── */
function buildResult(fwd, rev, amp, cross_dimer_dg, seq, mode, relaxLevel, isBorderline, conditions, appModeKey, isHighSensitivity, isTouchdown) {
  const tmDiff = parseFloat(Math.abs(fwd.tm - rev.tm).toFixed(1));
  const annealT = parseFloat(((fwd.tm + rev.tm) / 2 - 3).toFixed(1));
  const gcMax = Math.max(fwd.gc_content, rev.gc_content);
  // NaN guard: if quality_score is NaN/undefined, default to 0
  const fwdScore = isNaN(fwd.quality_score) || fwd.quality_score == null ? 0 : fwd.quality_score;
  const revScore = isNaN(rev.quality_score) || rev.quality_score == null ? 0 : rev.quality_score;
  const overallScore = Math.round((fwdScore + revScore) / 2);
  const crossDimerAssessment = assessCrossDimerInteraction(fwd.sequence, rev.sequence, conditions);
  const effectiveCrossDimerDG = (typeof cross_dimer_dg === 'number' && isFinite(cross_dimer_dg)) ? cross_dimer_dg : crossDimerAssessment.deltaG;
  const hpRisk = dg => dg > -2 ? 'low' : dg > -3 ? 'medium' : 'high';

  // Warnings — include relaxation info
  const warnings = [];
  if (tmDiff > 3) warnings.push({ urgency: 'high', text: `Tm difference ${tmDiff}°C exceeds 3°C — compatibility downgraded` });
  if (gcMax > 70) warnings.push({ urgency: 'high', text: `GC content ${gcMax}% exceeds 70% — HIGH RISK of secondary structures` });
  if (effectiveCrossDimerDG < -4) warnings.push({ urgency: 'medium', text: `Cross-dimer ΔG ${crossDimerAssessment.deltaGDisplay} approaching threshold (limit −6)` });
  if (fwd.hairpin_dg < -3) warnings.push({ urgency: 'medium', text: `Forward hairpin ΔG ${fwd.hairpin_dg} kcal/mol — relaxed threshold applied` });
  if (rev.hairpin_dg < -3) warnings.push({ urgency: 'medium', text: `Reverse hairpin ΔG ${rev.hairpin_dg} kcal/mol — relaxed threshold applied` });
  const fwdRep = countRepeatHits(fwd.sequence, seq);
  const revRep = countRepeatHits(rev.sequence, seq);
  if (fwdRep > 5) warnings.push({ urgency: 'medium', text: `Forward primer has ${fwdRep} repetitive 8-mer hits — specificity may be reduced` });
  if (revRep > 5) warnings.push({ urgency: 'medium', text: `Reverse primer has ${revRep} repetitive 8-mer hits — specificity may be reduced` });

  // ─── EVALUATION ENGINE INTEGRATION ───────────────────────────────────────
  const evalResult = evaluatePrimerPair(fwd.sequence, rev.sequence, appModeKey || 'standard', seq, conditions, isHighSensitivity, isTouchdown);
  const ev = evalResult.error ? null : evalResult;
  const meltCurve = simulateMeltingCurveAnalysis(
    fwd.tm,
    rev.tm,
    fwd.gc_content,
    rev.gc_content,
    amp,
    effectiveCrossDimerDG
  );

  // ─── SAFETY GATE CHECK & THERMO ERRORS ────────────────────────────────────
  const safetyTriggers = [];
  let hasThermoError = false;
  const checkNull = (v, name) => { if (v === null || v === undefined || isNaN(v)) { safetyTriggers.push(`${name} = invalid (NaN/null)`); hasThermoError = true; } };
  const checkThermo = (v, name) => {
    checkNull(v, name);
    if (v === 0) { safetyTriggers.push(`${name} = 0 (Thermodynamic Calculation Error)`); hasThermoError = true; }
  };

  checkNull(fwd.tm, 'Forward Tm'); checkNull(rev.tm, 'Reverse Tm');
  if (fwd.tm === 0) { safetyTriggers.push('Forward Tm = 0°C (invalid)'); hasThermoError = true; }
  if (rev.tm === 0) { safetyTriggers.push('Reverse Tm = 0°C (invalid)'); hasThermoError = true; }
  checkThermo(fwd.hairpin_dg, 'Forward Hairpin ΔG'); checkThermo(rev.hairpin_dg, 'Reverse Hairpin ΔG');
  checkThermo(fwd.self_dimer_dg, 'Forward Self-dimer ΔG'); checkThermo(rev.self_dimer_dg, 'Reverse Self-dimer ΔG');
  checkThermo(effectiveCrossDimerDG, 'Cross-dimer ΔG');

  if (tmDiff > 5) safetyTriggers.push(`Tm mismatch ${tmDiff}°C exceeds 5°C limit`);
  if (annealT < 50) safetyTriggers.push(`Annealing temperature ${annealT}°C below 50°C`);
  if (Math.min(fwd.self_dimer_dg, rev.self_dimer_dg) < -9) safetyTriggers.push(`Self-dimer ΔG ${Math.min(fwd.self_dimer_dg, rev.self_dimer_dg)} kcal/mol below -9 kcal/mol`);
  if (effectiveCrossDimerDG < -9) safetyTriggers.push(`Cross-dimer ΔG ${crossDimerAssessment.deltaGDisplay} below -9 kcal/mol`);
  const worstHairpin = Math.min(fwd.hairpin_dg, rev.hairpin_dg);
  if (worstHairpin < -6) safetyTriggers.push(`Hairpin ΔG ${worstHairpin} kcal/mol below -6 kcal/mol`);
  if (relaxLevel >= 3) safetyTriggers.push(`Relaxation pass ${relaxLevel} reached`);

  const autoRejected = safetyTriggers.length > 0;
  const fallbackEvaluation = buildFallbackEvaluation({ fwd, rev, cross_dimer_dg: effectiveCrossDimerDG, tmDiff, autoRejected, safetyTriggers, hasThermoError });

  // ─── CLASSIFICATION LOGIC ─────────────────────────────────────────────────
  let classification;
  if (autoRejected) {
    classification = 'REJECTED';
  } else if (ev) {
    classification = ev.classification;
    // engine already computes 'ACCEPTED', 'CONDITIONALLY ACCEPTED', 'REJECTED' intelligently.
  } else {
    // Fallback if engine fails
    if (overallScore >= 80) classification = 'ACCEPTED';
    else if (overallScore >= 50) classification = 'CONDITIONALLY ACCEPTED';
    else classification = 'REJECTED';
  }

  // Adjust for Designer context
  if (isBorderline && classification === 'ACCEPTED') classification = 'CONDITIONALLY ACCEPTED';
  if (relaxLevel > 0 && classification === 'ACCEPTED') classification = 'CONDITIONALLY ACCEPTED';

  // Context-appropriate warnings (post-classification)
  if (autoRejected) {
    warnings.unshift({ urgency: 'high', text: `REJECTED: ${safetyTriggers.length} safety gate${safetyTriggers.length > 1 ? 's' : ''} triggered. This primer pair should NOT be used.` });
  } else {
    if (isBorderline) warnings.unshift({ urgency: 'high', text: 'Borderline pair — experimental validation strongly recommended before use' });
    if (relaxLevel >= 1) warnings.push({ urgency: 'medium', text: `Constraints relaxed (pass ${relaxLevel}) — strict search found no matching pair` });
  }

  const specScore = parseFloat(Math.max(0, 100 - (fwdRep + revRep) * 5).toFixed(1));
  const specificityAnalysis = buildSpecificityAnalysis(specScore, Math.max(fwdRep, revRep));

  const mkPrimer = (p, isRev) => ({
    sequence: p.sequence, length: p.length,
    tm: p.tm, gc_content: p.gc_content,
    position: `${p.start + 1}–${p.end}`,
    quality_grade: p.quality_grade, quality_score: p.quality_score,
    hairpin: { risk_level: hpRisk(p.hairpin_dg), delta_g: p.hairpin_dg },
    self_dimer_dg: p.self_dimer_dg,
    three_prime_stability_dg: p.three_prime_dg,
    last_5bp_gc_percent: p.last_5bp_gc,
    gc_clamp: p.gc_clamp,
    issues: [], warnings: []
  });

  // ─── AUTO-VALIDATOR (Rule 8) ──────────────────────────────────────────────
  if (!autoRejected && ev) {
    let adjust = false;
    if (ev.structureScore >= 8 && classification === 'ACCEPTED') { adjust = true; classification = 'CONDITIONALLY ACCEPTED'; }
    if (hasThermoError && classification !== 'REJECTED') { adjust = true; classification = 'CONDITIONALLY ACCEPTED'; }
    if (ev.successProbability < 80 && classification === 'ACCEPTED') { adjust = true; classification = 'CONDITIONALLY ACCEPTED'; }
    if (adjust) {
      warnings.push({ urgency: 'low', text: "Internal consistency adjustment applied." });
    }
  }

  // Optimize protocol if needed (Rule 6)
  const isHighFi = mode.name === 'Standard PCR' ? false : true; // Only standard is standard taq
  let optimizationNotes = [
    mode.name === 'qPCR (Real-Time)'
      ? 'Keep amplicon 70–150 bp. Verify efficiency 90–110%. Use ROX reference dye.'
      : 'Confirm product size by gel electrophoresis. Sequence before downstream use.',
    `Denaturation: 98°C 30s | Annealing: ${annealT}°C 30s | Extension: 72°C ${Math.max(30, Math.ceil(amp / 1000) * 60)}s`,
    ...(relaxLevel > 0 ? ['Relaxed constraints were used — validate these primers empirically before committing to synthesis.'] : [])
  ];
  if (isHighFi && annealT < 55) {
    optimizationNotes.push('NOTE: High-fidelity polymerases (Q5/Phusion) typically require higher annealing temperatures. Consider a temperature gradient PCR (55–58°C).');
  }

  return {
    forward_primer: mkPrimer(fwd, false),
    reverse_primer: mkPrimer(rev, true),
    cross_dimer_dg: effectiveCrossDimerDG,
    cross_dimer_display: crossDimerAssessment.deltaGDisplay,
    expected_product_size: amp,
    tm_difference: tmDiff,
    annealing_temperature: annealT,
    specificity_score: specScore,
    specificity_analysis: specificityAnalysis,
    overall_score: overallScore,
    classification,
    autoRejected,
    warnings,
    isBorderline,
    relaxLevel,
    dimer_analysis: {
      delta_g: effectiveCrossDimerDG,
      delta_g_display: crossDimerAssessment.deltaGDisplay,
      risk_level: crossDimerAssessment.riskLevel.toLowerCase(),
      estimated: crossDimerAssessment.estimated,
      estimated_range: crossDimerAssessment.estimatedRange,
      complementarity: crossDimerAssessment.complementarity,
      explanation: crossDimerAssessment.explanation
    },
    // ─── EVALUATION ENGINE DATA ───
    evaluation: {
      successProbability: ev ? ev.successProbability : fallbackEvaluation.successProbability,
      riskTier: ev ? ev.riskTier : fallbackEvaluation.riskTier,
      safetyTriggers: ev ? ev.triggers : fallbackEvaluation.safetyTriggers,
      safetyPassed: !autoRejected,
      thermoStatus: ev ? ev.thermoStatus : fallbackEvaluation.thermoStatus,
      meltingCurve: {
        fwdMeltQ: ev ? ev.meltingCurve.fwdMeltQuality : fallbackEvaluation.meltingCurve.fwdMeltQ,
        revMeltQ: ev ? ev.meltingCurve.revMeltQuality : fallbackEvaluation.meltingCurve.revMeltQ,
        summary: meltCurve.summary,
        asymmetric: ev ? ev.meltingCurve.asymmetricMelting : fallbackEvaluation.meltingCurve.asymmetric,
        peakMeltingTemperature: meltCurve.peakMeltingTemperature,
        curveType: meltCurve.curveType,
        interpretation: meltCurve.interpretation,
        estimated: meltCurve.estimated
      },
      structureScore: ev ? ev.structureScore : fallbackEvaluation.structureScore,
      structureInterpretation: ev ? ev.structureInterpretation : fallbackEvaluation.structureInterpretation,
      threePrimeInterference: ev ? ev.threePrimeInterference : fallbackEvaluation.threePrimeInterference,
      fwdStructure: ev ? ev.fwdStructure : fallbackEvaluation.fwdStructure,
      revStructure: ev ? ev.revStructure : fallbackEvaluation.revStructure,
      confidenceBand: ev ? ev.confidenceBand : fallbackEvaluation.confidenceBand,
      optimizationSuggestions: ev ? ev.optimizationSuggestions : fallbackEvaluation.optimizationSuggestions,
    },
    pcr_protocol: {
      annealing_temp: annealT,
      extension_time: Math.max(30, Math.ceil(amp / 1000) * 60),
      cycles: 35,
      polymerase: mode.name === 'qPCR (Real-Time)'
        ? 'SYBR Green Master Mix (high-fidelity)'
        : 'Phusion or Q5 High-Fidelity Polymerase',
      notes: [
        mode.name === 'qPCR (Real-Time)'
          ? 'Keep amplicon 70–150 bp. Verify efficiency 90–110%. Use ROX reference dye.'
          : 'Confirm product size by gel electrophoresis. Sequence before downstream use.',
        `Denaturation: 98°C 30s | Annealing: ${annealT}°C 30s | Extension: 72°C ${Math.max(30, Math.ceil(amp / 1000) * 60)}s`,
        ...(relaxLevel > 0 ? ['Relaxed constraints were used — validate these primers empirically before committing to synthesis.'] : [])
      ]
    },
    _meta: {
      model: 'SantaLucia 1998 Nearest-Neighbor',
      conditions_used: conditions,
      scoring: '25% Tm · 20% GC · 20% structure · 15% dimer · 10% clamp · 10% specificity',
      application_mode: mode.name,
      relax_level: relaxLevel,
      borderline: isBorderline
    }
  };
}

/* ─── MAIN DESIGN ENGINE WITH FALLBACK CASCADE ───────────────────────────────

   Fallback order:
     Pass 0 — strict (GC≤65, Tm 58–65, hp>-3, sd>-5, amplicon exact, ΔTm≤3, cd>-6)
     Pass 1 — relax ΔTm to 5°C
     Pass 2 — relax GC up to 70%, hairpin down to -4 kcal/mol
     Pass 3 — expand amplicon ±50 bp
     Pass 4 — full borderline: relax all, return top 3 pairs
   ─────────────────────────────────────────────────────────────────────────── */
async function designPrimers(seq, mode, conditions, appModeKey, isHighSensitivity, isTouchdown) {
  await new Promise(r => setTimeout(r, 900));
  seq = seq.toUpperCase();
  const n = seq.length;

  if (n < 40) return { success: false, error: 'Sequence must be at least 40 bp. Cannot design primers for this input.' };

  const scoreAll = (candidates, fullSeq) => {
    candidates.forEach(p => {
      p.quality_score = scorePrimerFull(p, fullSeq, mode, isHighSensitivity, isTouchdown);
      p.quality_grade = classifyScore(p.quality_score);
    });
    candidates.sort((a, b) => b.quality_score - a.quality_score);
  };

  // ── PASS 0: Strict ────────────────────────────────────────────────────────
  {
    let tmDiffStrict = 3, crossStrict = -9;
    if (appModeKey === 'qpcr') { tmDiffStrict = 1.5; crossStrict = -7; }
    if (isHighSensitivity) { crossStrict += 2; }
    if (isTouchdown) { tmDiffStrict += 0.5; }

    const th = {
      gcMax: appModeKey === 'high_gc' ? 70 : 60,
      tmMin: mode.tmMin,
      tmMax: mode.tmMax,
      hpMin: appModeKey === 'high_gc' ? -4 : -3,
      sdMin: -5, allowNoClamp: false, allowRuns3: false, relaxed: false
    };
    const { fwds, revs } = scanCandidates(seq, mode, mode.prodMin, mode.prodMax, th, conditions);
    scoreAll(fwds, seq); scoreAll(revs, seq);
    const best = pickBestPair(fwds, revs, mode.prodMin, mode.prodMax, tmDiffStrict, crossStrict, conditions, seq, appModeKey, isHighSensitivity, isTouchdown);
    if (best) {
      const data = buildResult(best.fwd, best.rev, best.amp, best.cross_dimer_dg, seq, mode, 0, false, conditions, appModeKey, isHighSensitivity, isTouchdown);
      data.all_candidates = buildAltCandidates(fwds, revs, best);
      return { success: true, data };
    }
  }

  // ── PASS 1: Relax Tm difference to 5°C ───────────────────────────────────
  {
    const th = { gcMax: 65, tmMin: 58, tmMax: 65, hpMin: -3, sdMin: -5, allowNoClamp: false, allowRuns3: false, relaxed: false };
    const { fwds, revs } = scanCandidates(seq, mode, mode.prodMin, mode.prodMax, th, conditions);
    scoreAll(fwds, seq); scoreAll(revs, seq);
    const best = pickBestPair(fwds, revs, mode.prodMin, mode.prodMax, 5, -6, conditions, seq, appModeKey, isHighSensitivity, isTouchdown);
    if (best) {
      const data = buildResult(best.fwd, best.rev, best.amp, best.cross_dimer_dg, seq, mode, 1, false, conditions, appModeKey, isHighSensitivity, isTouchdown);
      data.all_candidates = buildAltCandidates(fwds, revs, best);
      return { success: true, data };
    }
  }

  // ── PASS 2: Relax GC to 70% and hairpin to -4 kcal/mol ───────────────────
  {
    const th = { gcMax: 70, tmMin: 56, tmMax: 67, hpMin: -4, sdMin: -5, allowNoClamp: false, allowRuns3: false, relaxed: true };
    const { fwds, revs } = scanCandidates(seq, mode, mode.prodMin, mode.prodMax, th, conditions);
    scoreAll(fwds, seq); scoreAll(revs, seq);
    const best = pickBestPair(fwds, revs, mode.prodMin, mode.prodMax, 5, -6, conditions, seq, appModeKey, isHighSensitivity, isTouchdown);
    if (best) {
      const data = buildResult(best.fwd, best.rev, best.amp, best.cross_dimer_dg, seq, mode, 2, false, conditions, appModeKey, isHighSensitivity, isTouchdown);
      data.all_candidates = buildAltCandidates(fwds, revs, best);
      return { success: true, data };
    }
  }

  // ── PASS 3: Expand amplicon range ±50 bp ─────────────────────────────────
  {
    const ampMin = Math.max(40, mode.prodMin - 50);
    const ampMax = mode.prodMax + 50;
    const th = { gcMax: 70, tmMin: 56, tmMax: 67, hpMin: -4, sdMin: -5, allowNoClamp: false, allowRuns3: false, relaxed: true };
    const { fwds, revs } = scanCandidates(seq, mode, ampMin, ampMax, th, conditions);
    scoreAll(fwds, seq); scoreAll(revs, seq);
    const best = pickBestPair(fwds, revs, ampMin, ampMax, 5, -6, conditions, seq, appModeKey, isHighSensitivity, isTouchdown);
    if (best) {
      const data = buildResult(best.fwd, best.rev, best.amp, best.cross_dimer_dg, seq, mode, 3, false, conditions, appModeKey, isHighSensitivity, isTouchdown);
      data.all_candidates = buildAltCandidates(fwds, revs, best);
      return { success: true, data };
    }
  }

  // ── PASS 4: Full borderline — relax everything, return top 3 pairs ────────
  {
    const ampMin = Math.max(40, mode.prodMin - 100);
    const ampMax = mode.prodMax + 100;
    const th = { gcMax: 75, tmMin: 50, tmMax: 70, hpMin: -5, sdMin: -6, allowNoClamp: true, allowRuns3: true, relaxed: true };
    const { fwds, revs } = scanCandidates(seq, mode, ampMin, ampMax, th, conditions);
    scoreAll(fwds, seq); scoreAll(revs, seq);

    if (!fwds.length || !revs.length) {
      return { success: false, error: `Sequence is too short (${n} bp) or lacks sufficient compositional diversity to design primers for ${mode.name} mode. Try a longer sequence or switch to a different application mode.` };
    }

    const borderlinePairs = pickBorderlinePairs(fwds, revs, ampMin, ampMax, conditions, seq, appModeKey, isHighSensitivity, isTouchdown);
    if (!borderlinePairs.length) {
      return { success: false, error: `Sequence is too short (${n} bp) or lacks sufficient compositional diversity to design primers for ${mode.name} mode. Try a longer sequence or switch to a different application mode.` };
    }

    // Use best borderline as primary result, expose all 3
    const primary = borderlinePairs[0];
    const data = buildResult(primary.fwd, primary.rev, primary.amp, primary.cross_dimer_dg, seq, mode, 4, true, conditions, appModeKey, isHighSensitivity, isTouchdown);
    data.borderline_pairs = borderlinePairs.map((bp, i) => ({
      rank: i + 1,
      label: `Borderline Pair ${i + 1} — Experimental Validation Recommended`,
      forward: { sequence: bp.fwd.sequence, tm: bp.fwd.tm, gc: bp.fwd.gc_content, score: bp.fwd.quality_score },
      reverse: { sequence: bp.rev.sequence, tm: bp.rev.tm, gc: bp.rev.gc_content, score: bp.rev.quality_score },
      amplicon_size: bp.amp,
      pair_score: parseFloat(bp.pairScore.toFixed(1)),
      cross_dimer_dg: bp.cross_dimer_dg,
      tm_difference: parseFloat(Math.abs(bp.fwd.tm - bp.rev.tm).toFixed(1))
    }));
    data.all_candidates = buildAltCandidates(fwds, revs, primary);
    return { success: true, data };
  }
}

/* ─── ALT CANDIDATES BUILDER ─────────────────────────────────────────────── */
function buildAltCandidates(fwds, revs, best) {
  const alts = [];
  [...fwds.slice(0, 5), ...revs.slice(0, 5)].forEach((p, i) => {
    if (i < 5 && p.sequence === best.fwd.sequence) return;
    if (i >= 5 && p.sequence === best.rev.sequence) return;
    alts.push({
      type: i < 5 ? 'Alternative Forward' : 'Alternative Reverse',
      sequence: p.sequence, length: p.length, tm: p.tm,
      gc_content: p.gc_content, quality_grade: p.quality_grade, quality_score: p.quality_score
    });
  });
  return alts.slice(0, 6);
}

/* ─── VALIDATION ─────────────────────────────────────────────────────────── */
function validateSequence(seq) {
  const cleaned = seq.toUpperCase().replace(/[^ATGC]/g, '');
  if (cleaned.length === 0) return { valid: false, error: 'No valid DNA bases found.' };
  if (cleaned.length < 40) return { valid: false, error: 'Sequence must be at least 40 bp.' };
  return { valid: true, cleaned };
}

/* ─── APP MODES ──────────────────────────────────────────────────────────── */
const APP_MODES = {
  standard: { name: 'Standard PCR', desc: 'Routine general-purpose PCR', prodMin: 150, prodMax: 800, tmMin: 55, tmMax: 65 },
  qpcr: { name: 'qPCR (Real-Time)', desc: 'Short amplicons (70-150bp), strict dimers', prodMin: 70, prodMax: 150, tmMin: 58, tmMax: 62 },
  high_gc: { name: 'High GC PCR', desc: 'GC tolerance up to 70%', prodMin: 150, prodMax: 800, tmMin: 60, tmMax: 68 },
  long_range: { name: 'Long-Range PCR', desc: 'Large amplicons (≤5kb)', prodMin: 2000, prodMax: 5000, tmMin: 58, tmMax: 68 },
  mutation: { name: 'Mutation Detection', desc: 'SNP detection & mutagenesis', prodMin: 100, prodMax: 400, tmMin: 60, tmMax: 68 }
};

/* ─── COLOURS ────────────────────────────────────────────────────────────── */
const QUAL_COL = { ACCEPTED: '#00FFC6', 'CONDITIONALLY ACCEPTED': '#F59E0B', REJECTED: '#EF4444' };
const RISK_COL = { low: '#00FFC6', medium: '#F59E0B', high: '#EF4444' };
const URG_COL = { high: '#EF4444', medium: '#F59E0B', low: '#00FFC6' };
const CLASS_COL = { ACCEPTED: '#00FFC6', 'CONDITIONALLY ACCEPTED': '#F59E0B', REJECTED: '#EF4444' };
const CLASS_BG = { ACCEPTED: 'rgba(0,255,198,0.1)', 'CONDITIONALLY ACCEPTED': 'rgba(245,158,11,0.1)', REJECTED: 'rgba(239,68,68,0.15)' };

/* ════════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════════════════════════ */
export default function PrimerDesigner() {
  const [sequence, setSequence] = useState('');
  const [appMode, setAppMode] = useState('standard');
  const [primers, setPrimers] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showCand, setShowCand] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showJSON, setShowJSON] = useState(false);
  const [aiExplanation, setAiExplanation] = useState('');
  const [loadingAI, setLoadingAI] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [activeSample, setActiveSample] = useState(null);
  const [showLoadSample, setShowLoadSample] = useState(false);
  const [naConc, setNaConc] = useState(50);
  const [mgConc, setMgConc] = useState(1.5);
  const [primerConc, setPrimerConc] = useState(250);
  const [dntpConc, setDntpConc] = useState(0.2);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isHighSensitivity, setIsHighSensitivity] = useState(false);
  const [isTouchdown, setIsTouchdown] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);

  const mode = APP_MODES[appMode];
  const bpCount = sequence.toUpperCase().replace(/[^ATGC]/g, '').length;

  const handleLoadSampleBtn = () => {
    setShowLoadSample(prev => !prev);
  };

  useEffect(() => {
    const close = () => setShowExportMenu(false);
    if (showExportMenu) {
      document.addEventListener('click', close);
      return () => document.removeEventListener('click', close);
    }
  }, [showExportMenu]);

  /* ── FASTA upload ── */
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      if (typeof evt.target?.result === 'string') {
        const clean = evt.target.result.split('\n').filter(l => !l.startsWith('>')).join('').replace(/\s/g, '');
        setSequence(clean); setError(''); setPrimers(null); setAiExplanation('');
      }
    };
    reader.readAsText(file);
  };

  /* ── Export ── */
  const exportTXT = (detailed = false) => {
    if (!primers) return;
    let c = `PCR Primer Designer Results\n${'='.repeat(50)}\n\n`;
    c += `Application Mode: ${mode.name}\n`;
    c += `Classification: ${primers.classification}\n`;
    if (primers.evaluation?.confidenceBand) c += `Confidence Band: ${primers.evaluation.confidenceBand}\n`;
    if (!primers.autoRejected) c += `Overall Score: ${primers.overall_score}/100\n`;
    c += `Product Size: ${primers.expected_product_size} bp\n`;
    c += `Tm Difference: ${primers.tm_difference} \u00b0C\n`;
    c += `Annealing Temperature: ${primers.annealing_temperature} \u00b0C\n`;
    c += `Specificity Score: ${primers.specificity_score}/100\n`;
    c += `Cross-Dimer \u0394G: ${primers.cross_dimer_display || `${primers.cross_dimer_dg} kcal/mol`}\n`;
    c += `Cross-Dimer Risk Level: ${primers.dimer_analysis?.risk_level || 'low'}\n`;
    if (primers.dimer_analysis?.explanation) c += `Cross-Dimer Explanation: ${primers.dimer_analysis.explanation}\n`;
    c += `\n`;
    c += `EXPERIMENTAL CONDITIONS:\n`;
    c += `  Na+: ${primers._meta?.conditions_used?.na || naConc} mM\n`;
    c += `  Mg2+: ${primers._meta?.conditions_used?.mg || mgConc} mM\n`;
    c += `  Primer Conc: ${primers._meta?.conditions_used?.primerConc || primerConc} nM\n`;
    c += `  dNTP: ${primers._meta?.conditions_used?.dntp || dntpConc} mM\n\n`;
    // Evaluation Engine Data
    if (primers.evaluation) {
      c += `RISK ASSESSMENT\n`;
      c += `  PCR Success Probability: ${primers.evaluation.successProbability}%\n`;
      c += `  Risk Tier: ${primers.evaluation.riskTier}\n`;
      c += `  Safety Gates: ${primers.evaluation.safetyPassed ? 'All Passed' : 'FAILED'}\n\n`;
      if (primers.evaluation.safetyTriggers.length > 0) {
        c += `SAFETY GATE TRIGGERS\n`;
        primers.evaluation.safetyTriggers.forEach(t => { c += `  - ${t}\n`; });
        c += '\n';
      }
      if (primers.evaluation.optimizationSuggestions?.length > 0) {
        c += `SUGGESTED OPTIMIZATIONS\n`;
        primers.evaluation.optimizationSuggestions.forEach(s => { c += `  - ${s}\n`; });
        c += '\n';
      }
        if (primers.specificity_analysis) {
          c += `Specificity Analysis:\n`;
          c += `Score: ${primers.specificity_analysis.score}/100\n\n`;
          c += `Interpretation:\n`;
          c += `${primers.specificity_analysis.interpretation}\n\n`;
          c += `Possible Issues:\n`;
          if (primers.specificity_analysis.possibleIssues.length > 0) {
            primers.specificity_analysis.possibleIssues.forEach(i => { c += `- ${i}\n`; });
          } else {
            c += `- None significant under current constraints\n`;
          }
          c += `\nRecommendation:\n`;
          c += `- ${primers.specificity_analysis.recommendation}\n\n`;
        }
      c += `Melting Curve Summary:\n`;
      c += `- Peak Melting Temperature: ${primers.evaluation.meltingCurve.peakMeltingTemperature}°C\n`;
      c += `- Curve Type: ${primers.evaluation.meltingCurve.curveType}\n`;
      c += `Interpretation:\n`;
      c += `- ${primers.evaluation.meltingCurve.interpretation}\n`;
      c += `- PCR Quality Note: ${primers.evaluation.meltingCurve.summary}\n`;
      c += `STRUCTURE SCORE: ${primers.evaluation.structureScore}/10 - ${primers.evaluation.structureInterpretation}\n\n`;
    }
    if (primers.warnings?.length) {
      c += `WARNINGS:\n`;
      primers.warnings.forEach(w => { c += `  ! ${w.text}\n`; });
      c += '\n';
    }
    if (primers.forward_primer) {
      c += `${primers.autoRejected ? 'REJECTED ' : ''}FORWARD PRIMER:\n`;
      c += `  Sequence: ${primers.forward_primer.sequence}\n`;
      c += `  Length: ${primers.forward_primer.length} bp\n`;
      c += `  Tm: ${primers.forward_primer.tm} \u00b0C\n`;
      c += `  GC: ${primers.forward_primer.gc_content}%\n`;
      c += `  Hairpin \u0394G: ${primers.forward_primer.hairpin.delta_g} kcal/mol\n`;
      c += `  Self-Dimer \u0394G: ${primers.forward_primer.self_dimer_dg} kcal/mol\n`;
      c += `  3\u2032 Stability \u0394G: ${primers.forward_primer.three_prime_stability_dg} kcal/mol\n`;
      c += `  Last 5bp GC: ${primers.forward_primer.last_5bp_gc_percent}%\n`;
      c += `  Quality: ${primers.forward_primer.quality_grade} (${primers.forward_primer.quality_score}/100)\n\n`;
    }
    if (primers.reverse_primer) {
      c += `${primers.autoRejected ? 'REJECTED ' : ''}REVERSE PRIMER:\n`;
      c += `  Sequence: ${primers.reverse_primer.sequence}\n`;
      c += `  Length: ${primers.reverse_primer.length} bp\n`;
      c += `  Tm: ${primers.reverse_primer.tm} \u00b0C\n`;
      c += `  GC: ${primers.reverse_primer.gc_content}%\n`;
      c += `  Hairpin \u0394G: ${primers.reverse_primer.hairpin.delta_g} kcal/mol\n`;
      c += `  Self-Dimer \u0394G: ${primers.reverse_primer.self_dimer_dg} kcal/mol\n`;
      c += `  3\u2032 Stability \u0394G: ${primers.reverse_primer.three_prime_stability_dg} kcal/mol\n`;
      c += `  Last 5bp GC: ${primers.reverse_primer.last_5bp_gc_percent}%\n`;
      c += `  Quality: ${primers.reverse_primer.quality_grade} (${primers.reverse_primer.quality_score}/100)\n\n`;
    }
    if (!primers.autoRejected && detailed && primers.pcr_protocol) {
      c += `PCR PROTOCOL:\n`;
      c += `  Annealing Temp: ${primers.pcr_protocol.annealing_temp} \u00b0C\n`;
      c += `  Extension Time: ${primers.pcr_protocol.extension_time} s\n`;
      c += `  Cycles: ${primers.pcr_protocol.cycles}\n`;
      c += `  Polymerase: ${primers.pcr_protocol.polymerase}\n`;
      primers.pcr_protocol.notes?.forEach(n => { c += `  - ${n}\n`; });
    }
    const blob = new Blob([c], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Primer_Results_${detailed ? 'Detailed_' : ''}${new Date().toISOString().split('T')[0]}.txt`;
    a.click(); setShowExportMenu(false);
  };

  const exportPDF = (detailed = false) => {
    if (!primers) return;
    const ev = primers.evaluation;
    const isRejected = primers.autoRejected;
    let h = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PCR Primer Results</title>
    <style>body{font-family:Arial,sans-serif;margin:40px;color:#333}
    h1{color:#00897B;border-bottom:3px solid #00897B;padding-bottom:10px}
    h2{color:#00897B;margin-top:24px}
    .sum{background:#f0fdf4;padding:20px;border-radius:8px;margin:20px 0}
    .rejected-banner{background:#fef2f2;border:2px solid #dc2626;border-radius:8px;padding:16px;margin:16px 0;color:#dc2626;font-weight:bold;font-size:1.1em}
    .risk-box{background:#f0f9ff;padding:16px;border-radius:8px;margin:12px 0;border-left:4px solid #2563eb}
    .trigger{background:#fef2f2;padding:8px 12px;border-radius:4px;margin:4px 0;color:#dc2626;border-left:3px solid #dc2626}
    .box{margin:20px 0;padding:20px;border-left:4px solid #00897B;background:#f9f9f9;border-radius:4px}
    .box.rejected{border-left-color:#dc2626}
    code{background:#e5e5e5;padding:4px 8px;border-radius:3px;font-family:monospace;font-size:1.05em}
    .warn{color:#d97706;background:#fef3c7;padding:8px 12px;border-radius:4px;margin:4px 0}
    table{width:100%;border-collapse:collapse;margin:10px 0}th,td{border:1px solid #ddd;padding:8px;text-align:left}
    th{background:#00897B;color:white}</style></head><body>
    <h1>PCR Primer Designer Report</h1>
    <div class="sum">
      <p><b>Mode:</b> ${mode.name}</p>
      <p><b>Classification:</b> ${primers.classification}${!isRejected ? ` (${primers.overall_score}/100)` : ''}</p>
      <p><b>Product Size:</b> ${primers.expected_product_size} bp</p>
      <p><b>Tm Difference:</b> ${primers.tm_difference} °C</p>
      <p><b>Cross-Dimer ΔG:</b> ${primers.cross_dimer_display || `${primers.cross_dimer_dg} kcal/mol`}</p>
      <p><b>Cross-Dimer Risk Level:</b> ${primers.dimer_analysis?.risk_level || 'low'}</p>
      <p><b>Cross-Dimer Explanation:</b> ${primers.dimer_analysis?.explanation || 'Primer-primer interaction appears limited under current constraints.'}</p>
      <p><b>Generated:</b> ${new Date().toLocaleString()}</p>
    </div>
    <div class="box" style="margin-top: 0;">
      <h2 style="margin-top:0;">Experimental Conditions</h2>
      <p><b>Na+:</b> ${primers._meta?.conditions_used?.na || naConc} mM | <b>Mg2+:</b> ${primers._meta?.conditions_used?.mg || mgConc} mM | <b>Primer:</b> ${primers._meta?.conditions_used?.primerConc || primerConc} nM | <b>dNTP:</b> ${primers._meta?.conditions_used?.dntp || dntpConc} mM</p>
    </div>`;
    // Rejection banner
    if (isRejected) {
      h += `<div class="rejected-banner">AUTO-REJECTED: This primer pair failed ${ev?.safetyTriggers?.length || 0} safety gate(s). Do NOT use these primers without redesign.</div>`;
    }
    // Risk Assessment
    if (ev) {
      h += `<div class="risk-box"><h2 style="margin-top:0;color:#2563eb">Risk Assessment (Bayesian Model)</h2>
        <table><tr><th>Metric</th><th>Value</th></tr>
        <tr><td>PCR Success Probability</td><td>${ev.successProbability}%</td></tr>
        <tr><td>Risk Tier</td><td>${ev.riskTier}</td></tr>
        <tr><td>Safety Gates</td><td>${ev.safetyPassed ? 'All Passed' : 'FAILED'}</td></tr>
        <tr><td>Peak Melting Temperature</td><td>${ev.meltingCurve.peakMeltingTemperature}°C</td></tr>
        <tr><td>Curve Type</td><td>${ev.meltingCurve.curveType}</td></tr>
        <tr><td>Melting Interpretation</td><td>${ev.meltingCurve.interpretation}</td></tr>
        <tr><td>PCR Quality Note</td><td>${ev.meltingCurve.summary}</td></tr>
        <tr><td>Structure Score</td><td>${ev.structureScore}/10 — ${ev.structureInterpretation}</td></tr>
        </table></div>`;
      if (primers.specificity_analysis) {
        h += `<div class="box"><h2>Specificity Analysis</h2>
          <p><b>Score:</b> ${primers.specificity_analysis.score}/100</p>
          <p><b>Interpretation:</b> ${primers.specificity_analysis.interpretation}</p>
          <p><b>Possible Issues:</b> ${primers.specificity_analysis.possibleIssues.length ? primers.specificity_analysis.possibleIssues.join(', ') : 'None significant under current constraints'}</p>
          <p><b>Recommendation:</b> ${primers.specificity_analysis.recommendation}</p></div>`;
      }
      if (ev.safetyTriggers.length > 0) {
        h += `<h2 style="color:#dc2626">Safety Gate Triggers</h2>`;
        ev.safetyTriggers.forEach(t => { h += `<div class="trigger">${t}</div>`; });
      }
    }
    // Warnings
    if (primers.warnings?.length) {
      h += `<h2>Warnings</h2>`;
      primers.warnings.forEach(w => { h += `<div class="warn">${w.text}</div>`; });
    }
    // Primer cards
    ['forward_primer', 'reverse_primer'].forEach(key => {
      const p = primers[key];
      if (!p) return;
      h += `<div class="box${isRejected ? ' rejected' : ''}"><h2>${isRejected ? 'Rejected ' : ''}${key === 'forward_primer' ? 'Forward' : 'Reverse'} Primer</h2>
        <p><b>Sequence:</b> <code>${p.sequence}</code></p>
        <table><tr><th>Parameter</th><th>Value</th></tr>
        <tr><td>Length</td><td>${p.length} bp</td></tr>
        <tr><td>Tm (NN model)</td><td>${p.tm} °C</td></tr>
        <tr><td>GC Content</td><td>${p.gc_content}%</td></tr>
        <tr><td>Hairpin ΔG</td><td>${p.hairpin.delta_g} kcal/mol</td></tr>
        <tr><td>Self-Dimer ΔG</td><td>${p.self_dimer_dg} kcal/mol</td></tr>
        <tr><td>3′ Stability ΔG</td><td>${p.three_prime_stability_dg} kcal/mol</td></tr>
        <tr><td>Last 5bp GC%</td><td>${p.last_5bp_gc_percent}%</td></tr>
        <tr><td>Quality</td><td>${p.quality_grade} (${p.quality_score}/100)</td></tr>
        </table></div>`;
    });
    // Protocol — only when NOT rejected
    if (!isRejected && detailed && primers.pcr_protocol) {
      h += `<div class="box"><h2>PCR Protocol</h2>
        <p><b>Annealing Temp:</b> ${primers.pcr_protocol.annealing_temp} °C</p>
        <p><b>Extension Time:</b> ${primers.pcr_protocol.extension_time} s</p>
        <p><b>Cycles:</b> ${primers.pcr_protocol.cycles}</p>
        <p><b>Polymerase:</b> ${primers.pcr_protocol.polymerase}</p>
        ${primers.pcr_protocol.notes?.map(n => `<p>- ${n}</p>`).join('')}</div>`;
    }
    h += `</body></html>`;
    const blob = new Blob([h], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `Primer_Results_${detailed ? 'Detailed_' : ''}${new Date().toISOString().split('T')[0]}.html`;
    a.click();
    const w = window.open(url); if (w) w.onload = () => setTimeout(() => w.print(), 250);
    setShowExportMenu(false);
  };

  /* ── submit ── */
  const handleDesignFn = async (overrideSample = null) => {
    const targetSeq = overrideSample ? overrideSample.sequence : sequence;
    const targetModeKey = overrideSample ? overrideSample.application_mode : appMode;
    const targetMode = APP_MODES[targetModeKey];
    const targetHS = overrideSample ? (overrideSample.isHighSensitivity || false) : isHighSensitivity;
    const targetTD = overrideSample ? (overrideSample.isTouchdown || false) : isTouchdown;
    const conditions = { na: parseFloat(naConc) || 50, mg: parseFloat(mgConc) || 1.5, primerConc: parseFloat(primerConc) || 250, dntp: parseFloat(dntpConc) || 0.2 };

    if (!targetSeq.trim()) { setError('Please enter a DNA sequence.'); return; }

    const v = validateSequence(targetSeq);
    if (!v.valid) { setError(v.error); return; }

    // Mode-Aware Length Validation & Smart Suggestions
    const len = v.cleaned.length;
    if (targetModeKey === 'standard' && len < 150) {
      setError('Template length insufficient for Standard PCR. Minimum length is 150 bp. Please switch to qPCR mode.');
      return;
    }
    if (targetModeKey === 'qpcr' && len > 300) {
      setError('Template length exceeds ideal bounds for qPCR. Rapid cycling may fail to extend. Consider switching to Standard PCR.');
      return;
    }
    if (targetModeKey !== 'long_range' && len > 1500) {
      setError('Template length strongly suggests Long-Range PCR. Standard amplification may fail.');
      return;
    }

    setLoading(true); setError(''); setPrimers(null); setAiExplanation('');

    try {
      if (overrideSample) {
        // Direct evaluation for Curated Samples bypassing the sliding-window search
        const fStr = overrideSample.primer_pair.forward;
        const rStr = overrideSample.primer_pair.reverse;
        const fHpDg = calcHairpinDG(fStr, conditions);
        const rHpDg = calcHairpinDG(rStr, conditions);
        const f = { sequence: fStr, length: fStr.length, tm: calcTmNN(fStr, conditions), gc_content: calcGC(fStr), start: 0, end: fStr.length - 1, hairpin: { delta_g: fHpDg, risk_level: fHpDg > -3 ? 'low' : fHpDg > -5 ? 'medium' : 'high' }, self_dimer_dg: calcSelfDimerDG(fStr, conditions), three_prime_stability_dg: calc3PrimeDG(fStr, conditions), last_5bp_gc_percent: calcLast5GC(fStr), gc_clamp: { has_clamp: hasGCClamp(fStr) } };
        const r = { sequence: rStr, length: rStr.length, tm: calcTmNN(rStr, conditions), gc_content: calcGC(rStr), start: targetSeq.length - rStr.length, end: targetSeq.length - 1, hairpin: { delta_g: rHpDg, risk_level: rHpDg > -3 ? 'low' : rHpDg > -5 ? 'medium' : 'high' }, self_dimer_dg: calcSelfDimerDG(rStr, conditions), three_prime_stability_dg: calc3PrimeDG(rStr, conditions), last_5bp_gc_percent: calcLast5GC(rStr), gc_clamp: { has_clamp: hasGCClamp(rStr) } };
        const cd = calcCrossDimerDG(fStr, rStr, conditions);
        let resData = buildResult(f, r, targetSeq.length, cd, v.cleaned, targetMode, overrideSample.relaxLevel, overrideSample.isBorderline, conditions, overrideSample.application_mode, targetHS, targetTD);
        f.quality_score = scorePrimerFull(f, v.cleaned, targetMode, targetHS, targetTD);
        f.quality_grade = classifyScore(f.quality_score);
        r.quality_score = scorePrimerFull(r, v.cleaned, targetMode, targetHS, targetTD);
        r.quality_grade = classifyScore(r.quality_score);
        resData.forward_primer = f;
        resData.reverse_primer = r;
        resData.forward_primer.detailed_analysis = buildAnalysis(resData.forward_primer);
        resData.reverse_primer.detailed_analysis = buildAnalysis(resData.reverse_primer);
        resData.optimization_tips = buildTips(resData, targetMode);

        // Brief timeout for visual loading cue
        await new Promise(res => setTimeout(res, 800));
        setPrimers(resData);
      } else {
        const res = await designPrimers(v.cleaned, targetMode, conditions, appMode, targetHS, targetTD);
        if (res.success) {
          res.data.forward_primer.detailed_analysis = buildAnalysis(res.data.forward_primer);
          res.data.reverse_primer.detailed_analysis = buildAnalysis(res.data.reverse_primer);
          res.data.optimization_tips = buildTips(res.data, targetMode);
          setPrimers(res.data);
        } else {
          setError(res.error);
        }
      }
    } catch (e) {
      setError(`An unexpected evaluation engine error occurred: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDesign = () => handleDesignFn(null);

  /* ── AI explain ── */
  const handleAI = async () => {
    if (!primers) return;
    setLoadingAI(true); setError(''); setAiExplanation('');
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 60000);
      // Include evaluation engine data for better AI context
      const aiData = {
        ...primers,
        evaluation_summary: primers.evaluation ? {
          successProbability: primers.evaluation.successProbability,
          riskTier: primers.evaluation.riskTier,
          safetyPassed: primers.evaluation.safetyPassed,
          safetyTriggers: primers.evaluation.safetyTriggers,
          meltingProfile: primers.evaluation.meltingCurve?.summary,
          structureScore: primers.evaluation.structureScore,
          structureInterpretation: primers.evaluation.structureInterpretation
        } : null
      };
      const res = await fetch(`${API_URL}/api/explain`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'PCR Primer Designer', data: aiData }), signal: ctrl.signal
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

  /* ── analysis helpers ── */
  function buildAnalysis(p) {
    const a = [];
    if (p.hairpin?.risk_level !== 'low') a.push({
      type: p.hairpin.risk_level === 'high' ? 'error' : 'warning',
      title: 'Hairpin Formation Risk',
      issue: `May form a secondary structure (ΔG = ${p.hairpin.delta_g} kcal/mol)`,
      impact: 'Reduces primer availability, which lowers PCR yield and overall efficiency.',
      fixes: ['Shift primer 2–3 bp upstream or downstream', 'Add 3–5% DMSO to destabilise secondary structures', 'Increase annealing temperature by 2–3 °C']
    });
    if (!p.gc_clamp?.has_clamp) a.push({
      type: 'warning',
      title: 'Missing GC Clamp',
      issue: 'No G or C base within the last 2 bases of the 3′ end.',
      impact: 'Weaker 3′ binding reduces extension efficiency.',
      fixes: ['Shift primer so a natural G/C falls at the 3′ end', 'Extend the primer by 1–2 G/C bases if the template allows']
    });
    if (p.self_dimer_dg < -3.5) a.push({
      type: 'warning',
      title: 'Self-Dimer Risk',
      issue: `Self-dimer ΔG = ${p.self_dimer_dg} kcal/mol (threshold: −5)`,
      impact: 'Primer may partially dimerize, reducing effective concentration.',
      fixes: ['Reduce primer concentration to 0.2 µM', 'Use hot-start polymerase', 'Shift primer 1–2 bp to break 3′ complementarity']
    });
    if (p.last_5bp_gc_percent > 80) a.push({
      type: 'warning',
      title: 'GC-Rich 3′ End',
      issue: `Last 5 bp GC content is ${p.last_5bp_gc_percent}% — risk of non-specific binding.`,
      impact: 'High 3′ GC can lead to mispriming on off-target sites.',
      fixes: ['Shift primer to reduce terminal GC density', 'Increase annealing stringency (+2 °C)']
    });
    return a;
  }

  function buildTips(data, m) {
    const tips = [];
    const f = data.forward_primer, r = data.reverse_primer;
    if (!f || !r) return tips;
    if (data.tm_difference > 3) tips.push({
      category: 'Temperature', title: 'Large Tm Difference Detected',
      recommendation: `Run gradient PCR between ${Math.min(f.tm, r.tm) - 5}°C and ${Math.max(f.tm, r.tm) - 3}°C to find optimal annealing temperature.`,
      urgency: 'high'
    });
    if (data.dimer_analysis?.risk_level !== 'low') tips.push({
      category: 'Dimer Prevention', title: 'Primer-Dimer Risk Detected',
      recommendation: 'Reduce primer concentration to 0.2 µM. Use hot-start polymerase to minimise dimer formation during setup.',
      urgency: 'medium'
    });
    if (data.cross_dimer_dg < -3) tips.push({
      category: 'Cross-Dimer', title: 'Forward–Reverse 3′ Complementarity',
      recommendation: `Cross-dimer ΔG = ${data.cross_dimer_dg} kcal/mol. Use separate tubes for diluted primers and combine only in the final mix.`,
      urgency: data.cross_dimer_dg < -5 ? 'high' : 'medium'
    });
    tips.push({
      category: 'Protocol', title: `${m.name} Best Practices`,
      recommendation: m.name === 'qPCR (Real-Time)'
        ? 'Keep amplicon 70–150 bp. Verify amplification efficiency 90–110%. Include no-template control (NTC). Use ROX passive reference dye.'
        : 'Use high-fidelity polymerase (Phusion or Q5). Confirm product size by gel electrophoresis. Sequence the final product before downstream use.',
      urgency: 'low'
    });
    return tips;
  }

  /* ════════════════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════════════════ */
  return (
    <div style={{ minHeight: '100vh', background: '#0c0e14', color: '#e2e4e9', fontFamily: '"Sora",sans-serif' }}>
      <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
    *{ box-sizing:border-box; margin:0; padding:0; }
    ::-webkit-scrollbar{ width:5px; }
    ::-webkit-scrollbar-track{ background:#131518; }
    ::-webkit-scrollbar-thumb{ background:#2a2d3a; border-radius:3px; }

    .pc{ background:#141720; border:1px solid #24272f; border-radius:12px; padding:1.35rem; margin-bottom:1.1rem; }
    .lbl{ display:block; font-size:0.94rem; font-weight:600; color:#6b7080; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:0.42rem; }

    select, textarea{
      width:100%; background:#0f1117; border:1px solid #24272f; border-radius:8px;
      color:#e2e4e9; font-family:'Sora',sans-serif; font-size:1.02rem;
      padding:0.7rem 0.85rem; outline:none; transition:border-color 0.2s;
    }
    select:focus, textarea:focus{ border-color:#00FFC6; }
    textarea{ resize:vertical; font-family:'JetBrains Mono',monospace; font-size:0.9rem; line-height:1.85; }
    textarea::placeholder{ color:#2e3145; }

    .btn-p{
      display:flex; align-items:center; justify-content:center; gap:0.5rem;
      width:100%; padding:0.88rem 1.25rem;
      background:linear-gradient(135deg,#00FFC6,#00b08a);
      border:none; border-radius:10px;
      color:#0c0e14; font-family:'Sora',sans-serif; font-weight:600; font-size:1.08rem;
      cursor:pointer; transition:all 0.22s; letter-spacing:0.02em;
    }
    .btn-p:hover{ filter:brightness(1.12); transform:translateY(-1px); box-shadow:0 6px 24px rgba(0,255,198,0.28); }
    .btn-p:disabled{ filter:brightness(0.5); cursor:not-allowed; transform:none; box-shadow:none; }

    .btn-ai{
      display:flex; align-items:center; justify-content:center; gap:0.5rem;
      width:100%; padding:0.82rem 1.25rem;
      background:linear-gradient(135deg,#6366f1,#4f46e5);
      border:none; border-radius:10px;
      color:#fff; font-family:'Sora',sans-serif; font-weight:600; font-size:1.02rem;
      cursor:pointer; transition:all 0.22s;
    }
    .btn-ai:hover{ filter:brightness(1.12); transform:translateY(-1px); box-shadow:0 6px 20px rgba(99,102,241,0.35); }
    .btn-ai:disabled{ filter:brightness(0.5); cursor:not-allowed; transform:none; box-shadow:none; }

    .btn-g{
      display:inline-flex; align-items:center; gap:0.38rem;
      padding:0.5rem 0.95rem; background:transparent;
      border:1px solid #24272f; border-radius:7px;
      color:#8a8f9e; font-family:'Sora',sans-serif; font-size:0.92rem; font-weight:500;
      cursor:pointer; transition:all 0.2s;
    }
    .btn-g:hover{ border-color:#00FFC6; color:#00FFC6; background:rgba(0,255,198,0.05); }

    .btn-sample{
      display:inline-flex; align-items:center; gap:0.35rem;
      padding:0.44rem 0.88rem; background:rgba(0,255,198,0.08);
      border:1px solid rgba(0,255,198,0.28); border-radius:7px;
      color:#00FFC6; font-family:'JetBrains Mono',monospace; font-size:0.86rem; font-weight:500;
      cursor:pointer; transition:all 0.2s;
    }
    .btn-sample:hover{ background:rgba(0,255,198,0.15); border-color:rgba(0,255,198,0.5); }

    .btn-export{
      display:inline-flex; align-items:center; gap:0.35rem;
      padding:0.44rem 0.88rem; background:rgba(96,165,250,0.1);
      border:1px solid rgba(96,165,250,0.28); border-radius:7px;
      color:#60A5FA; font-family:'Sora',sans-serif; font-size:0.86rem; font-weight:500;
      cursor:pointer; transition:all 0.2s; position:relative;
    }
    .btn-export:hover{ background:rgba(96,165,250,0.18); border-color:rgba(96,165,250,0.5); }

    .export-menu{
      position:absolute; top:calc(100% + 0.35rem); right:0;
      background:#141720; border:1px solid #24272f; border-radius:10px;
      box-shadow:0 12px 32px rgba(0,0,0,0.45); padding:0.55rem;
      z-index:100; min-width:220px;
    }
    .export-item{
      padding:0.65rem 0.75rem; border-radius:7px; cursor:pointer;
      border:1px solid transparent; margin-bottom:0.28rem; transition:all 0.18s;
      font-size:0.9rem; color:#8a8f9e;
    }
    .export-item:hover{ border-color:#60A5FA; background:rgba(96,165,250,0.07); color:#60A5FA; }
    .export-item:last-child{ margin-bottom:0; }

    .mode-card{
      background:#141720; border:1px solid #24272f; border-radius:11px;
      padding:1rem; cursor:pointer; transition:all 0.22s; position:relative;
    }
    .mode-card:hover{ border-color:#00FFC630; transform:translateY(-1px); }
    .mode-card.active{ border-color:#00FFC6; background:rgba(0,255,198,0.06); box-shadow:0 0 18px rgba(0,255,198,0.1); }

    .stat-b{ background:#0f1117; border:1px solid #1e2130; border-radius:10px; padding:0.85rem 0.65rem; text-align:center; }
    .stat-v{ font-size:1.42rem; font-weight:700; line-height:1.2; }
    .stat-l{ font-size:0.8rem; color:#6b7080; text-transform:uppercase; letter-spacing:0.06em; margin-top:0.28rem; }

    .seq-box{
      background:#0a0c12; border:1px solid #1e2130; border-radius:8px;
      padding:0.85rem 0.95rem; font-family:'JetBrains Mono',monospace;
      font-size:0.92rem; color:#00FFC6; letter-spacing:1.5px; word-break:break-all; line-height:1.75;
    }

    .a-card{ border-radius:9px; padding:0.9rem; margin-bottom:0.58rem; }
    .tip-card{ background:#0f1117; border:1px solid #1e2130; border-radius:9px; padding:0.9rem; margin-bottom:0.58rem; }
    .proto-box{ background:#0f1117; border:1px solid #1e2130; border-radius:9px; padding:0.85rem; text-align:center; }
    .cand-row{ background:#0f1117; border:1px solid #1e2130; border-radius:8px; padding:0.85rem; margin-bottom:0.48rem; }

    .info-wrap{ overflow:hidden; transition:max-height 0.4s cubic-bezier(0.4,0,0.2,1), opacity 0.3s; }
    .info-wrap.closed{ max-height:0; opacity:0; }
    .info-wrap.open{ max-height:1000px; opacity:1; }

    .json-wrap{ overflow:hidden; transition:max-height 0.4s cubic-bezier(0.4,0,0.2,1), opacity 0.3s; }
    .json-wrap.closed{ max-height:0; opacity:0; }
    .json-wrap.open{ max-height:2000px; opacity:1; }

    .json-block{
      background:#080a10; border:1px solid #1e2130; border-radius:10px;
      padding:1rem; font-family:'JetBrains Mono',monospace; font-size:0.78rem;
      line-height:1.9; color:#a0a3b1; overflow-x:auto; max-height:500px; overflow-y:auto;
    }
    .json-key{ color:#818cf8; }
    .json-str{ color:#00FFC6; }
    .json-num{ color:#FBBF24; }

    .constraint-grid{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:0.45rem; }
    .constraint-box{
      background:#0a0c10; border:1px solid #1a1d26; border-radius:8px; padding:0.45rem 0.6rem;
      display:flex; flex-direction:column; gap:0.1rem;
    }

    .step-row{ display:flex; gap:0.58rem; align-items:flex-start; margin-bottom:0.65rem; }
    .step-num{ flex-shrink:0; width:26px; height:26px; border-radius:50%; background:#00FFC6; color:#0c0e14; font-size:0.7rem; font-weight:700; display:flex; align-items:center; justify-content:center; margin-top:0.1rem; }

    .mode-grid{ display:grid; grid-template-columns:repeat(4,1fr); gap:0.58rem; }
    .stat-grid{ display:grid; grid-template-columns:repeat(4,1fr); gap:0.58rem; }
    .primer-grid{ display:grid; grid-template-columns:1fr 1fr; gap:0.9rem; }
    .proto-grid{ display:grid; grid-template-columns:repeat(3,1fr); gap:0.55rem; }
    .prop-grid{ display:grid; grid-template-columns:1fr 1fr; gap:0.45rem; }
    .ext-prop-grid{ display:grid; grid-template-columns:1fr 1fr; gap:0.45rem; }

    .ai-box{ background:rgba(99,102,241,0.08); border:1px solid rgba(99,102,241,0.3); border-radius:12px; padding:1.25rem; margin-bottom:1rem; }

    @keyframes fadeIn{ from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:translateY(0)} }
    .fade-in{ animation:fadeIn .35s ease forwards; }

    @media(max-width:640px){
      .mode-grid{ grid-template-columns:repeat(2,1fr); }
      .stat-grid{ grid-template-columns:repeat(2,1fr); }
      .primer-grid{ grid-template-columns:1fr; }
      .proto-grid{ grid-template-columns:1fr; }
      .pc{ padding:1rem; }
      .export-menu{ right:auto; left:0; max-width:calc(100vw - 2.2rem); }
      .lbl{ font-size:0.82rem; }
      select, textarea{ font-size:0.9rem; }
      .btn-p{ font-size:0.96rem; padding:0.8rem 1.1rem; }
    }
    @media(max-width:380px){
      .mode-grid{ grid-template-columns:1fr 1fr; gap:0.42rem; }
      .stat-grid{ grid-template-columns:1fr 1fr; gap:0.42rem; }
    }

    @keyframes spin{ to{ transform:rotate(360deg); } }
    .spin{ display:inline-block; width:16px; height:16px; border:2px solid rgba(255,255,255,0.25); border-top-color:#fff; border-radius:50%; animation:spin 0.5s linear infinite; }
  `}</style>

      {/* ═══ HEADER ═══ */}
      <div style={{ background: 'linear-gradient(180deg,#141820 0%,#0c0e14 100%)', borderBottom: '1px solid #1e2130', padding: '1.5rem 1.2rem 1.2rem' }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.42rem', flexWrap: 'wrap' }}>
            <h1 style={{ fontFamily: 'Sora', fontWeight: 700, fontSize: '1.55rem', color: '#fff' }}>PCR Primer Designer</h1>
            <span style={{ background: 'rgba(0,255,198,0.1)', border: '1px solid rgba(0,255,198,0.25)', color: '#00FFC6', fontSize: '0.7rem', fontWeight: 600, padding: '0.22rem 0.56rem', borderRadius: 20, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Research Grade</span>
            <span style={{ background: 'rgba(129,140,248,0.1)', border: '1px solid rgba(129,140,248,0.25)', color: '#818cf8', fontSize: '0.7rem', fontWeight: 600, padding: '0.22rem 0.56rem', borderRadius: 20, letterSpacing: '0.08em', textTransform: 'uppercase' }}>NN Thermodynamics v2</span>
          </div>
          <p style={{ color: '#6b7080', fontSize: '0.96rem', lineHeight: 1.58, maxWidth: 620 }}>
            Full nearest-neighbor thermodynamic primer design with hairpin, dimer, GC clamp, and specificity analysis across four PCR application modes.
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '1.2rem 1.15rem 3rem' }}>

        {/* ═══ INFO TOGGLE ═══ */}
        <button className="btn-g" onClick={() => setShowInfo(v => !v)} style={{ width: '100%', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.42rem' }}>
            <span style={{ fontSize: '0.94rem' }}>Why This Tool Matters &amp; How to Use It</span>
          </span>
          <span style={{ fontSize: '0.78rem', color: '#6b7080', transition: 'transform 0.25s', transform: showInfo ? 'rotate(180deg)' : 'rotate(0)', display: 'inline-block' }}>▼</span>
        </button>

        <div className={`info-wrap ${showInfo ? 'open' : 'closed'}`}>
          <div className="pc" style={{ padding: '1.35rem' }}>
            <div style={{ marginBottom: '1.15rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.42rem', marginBottom: '0.52rem' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#00FFC6', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Why This Tool Matters</span>
              </div>
              <p style={{ fontSize: '0.96rem', color: '#8a8f9e', lineHeight: 1.78, margin: 0 }}>
                Designing primers by hand is slow and error-prone. A single mismatch at the
                <strong style={{ color: '#c8cad4' }}> 3′ end </strong>
                can silently kill your entire PCR run. This tool uses a
                <strong style={{ color: '#c8cad4' }}> full SantaLucia 1998 nearest-neighbor thermodynamic model </strong>
                to calculate accurate Tm, and then automatically checks every candidate for
                <strong style={{ color: '#c8cad4' }}> hairpin formation, self-dimerization, cross-dimer risk, GC clamp quality, </strong> and
                <strong style={{ color: '#c8cad4' }}> repeat-region specificity</strong>. Primers are scored across 6 weighted dimensions and classified as Excellent, Good, Fair, or Poor.
              </p>
            </div>

            {/* Constraint reference */}
            <div style={{ borderTop: '1px solid #1e2130', paddingTop: '0.9rem', marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#4a4d5e', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.55rem' }}>Applied Constraints</div>
              <div className="constraint-grid">
                {[
                  ['Length', '18–22 bp', '#00FFC6'],
                  ['GC Content', '40–60%', '#00FFC6'],
                  ['Tm Range', '58–65 °C', '#60A5FA'],
                  ['ΔTm', '≤ 3 °C', '#60A5FA'],
                  ['Hairpin ΔG', '> −3 kcal/mol', '#FBBF24'],
                  ['Self-Dimer ΔG', '> −5 kcal/mol', '#FBBF24'],
                  ['Cross-Dimer ΔG', '> −6 kcal/mol', '#F87171'],
                  ['GC Clamp 3′', '1–2 GC bases', '#00FFC6'],
                ].map(([k, v, c]) => (
                  <div key={k} className="constraint-box">
                    <span style={{ fontSize: '0.65rem', color: '#2e3145', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</span>
                    <span style={{ fontSize: '0.78rem', color: c, fontFamily: '"JetBrains Mono",monospace', fontWeight: 600 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ borderTop: '1px solid #1e2130', paddingTop: '0.9rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.42rem', marginBottom: '0.68rem' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#60A5FA', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Workflow &amp; Next Steps</span>
              </div>
              {[
                ['Pick Your Application', 'Choose the PCR type below. Each mode pre-tunes amplicon size and Tm window — Diagnostic is broadest; qPCR is tightest.'],
                ['Paste Your Target Sequence', 'Drop in your gene region (FASTA body or plain text). Headers, line-breaks, and numbers are stripped automatically.'],
                ['Run the Analysis', 'Hit Design Primers. The NN engine scans all valid candidates, scores each on 6 dimensions, and surfaces the best matching pair.'],
                ['Use the Results Downstream', 'Copy oligo sequences directly into a synthesis order. The protocol block gives you annealing temp, extension time, and cycle count.']
              ].map(([title, desc], i) => (
                <div key={i} className="step-row">
                  <div className="step-num">{i + 1}</div>
                  <div>
                    <div style={{ fontSize: '0.94rem', fontWeight: 600, color: '#c8cad4', marginBottom: '0.12rem' }}>{title}</div>
                    <div style={{ fontSize: '0.9rem', color: '#6b7080', lineHeight: 1.65 }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ═══ MODE SELECTOR ═══ */}
        <label className="lbl">Application Mode</label>
        <div className="mode-grid" style={{ marginBottom: '1.15rem' }}>
          {Object.entries(APP_MODES).map(([k, m]) => (
            <div key={k} className={`mode-card ${appMode === k ? 'active' : ''}`} onClick={() => { setAppMode(k); setPrimers(null); setError(''); }}>
              {appMode === k && <span style={{ position: 'absolute', top: '0.52rem', right: '0.52rem', background: '#00FFC6', color: '#0c0e14', fontSize: '0.64rem', fontWeight: 700, width: 19, height: 19, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</span>}
              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: appMode === k ? '#00FFC6' : '#c8cad4', marginBottom: '0.2rem' }}>{m.name}</div>
              <div style={{ fontSize: '0.82rem', color: '#6b7080', lineHeight: 1.45 }}>{m.desc}</div>
            </div>
          ))}
        </div>

        {/* mode strip */}
        <div style={{ background: 'rgba(0,255,198,0.06)', border: '1px solid rgba(0,255,198,0.18)', borderRadius: 9, padding: '0.62rem 0.9rem', marginBottom: '1.15rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.92rem', color: '#00FFC6', fontWeight: 600 }}>{mode.name}</span>
          <span style={{ color: '#3a3d4a', fontSize: '0.84rem' }}>|</span>
          <span style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.7)' }}>Amplicon {mode.prodMin}–{mode.prodMax} bp</span>
          <span style={{ color: '#3a3d4a', fontSize: '0.84rem' }}>|</span>
          <span style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.7)' }}>Tm {mode.tmMin}–{mode.tmMax} °C</span>
          <span style={{ color: '#3a3d4a', fontSize: '0.84rem' }}>|</span>
          <span style={{ fontSize: '0.9rem', color: '#818cf8' }}>SantaLucia 1998 NN Model</span>
        </div>

        {/* ═══ ADVANCED SETTINGS ═══ */}
        <button className="btn-g" onClick={() => setShowAdvanced(v => !v)} style={{ width: '100%', justifyContent: 'space-between', marginBottom: '1rem', background: '#0c0e14' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.42rem' }}>
            <span style={{ fontSize: '0.94rem' }}>Advanced Experimental Controls</span>
          </span>
          <span style={{ fontSize: '0.78rem', color: '#6b7080', transition: 'transform 0.25s', transform: showAdvanced ? 'rotate(180deg)' : 'rotate(0)', display: 'inline-block' }}>▼</span>
        </button>

        <div className={`info-wrap ${showAdvanced ? 'open' : 'closed'}`}>
          <div className="pc" style={{ marginBottom: '1.15rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem', background: '#080a10', borderColor: '#161923' }}>
            <div>
              <label className="lbl">Na+ (mM)</label>
              <input type="number" step="1" value={naConc} onChange={e => setNaConc(e.target.value)} style={{ width: '100%', background: '#0f1117', border: '1px solid #24272f', borderRadius: '8px', color: '#e2e4e9', padding: '0.6rem 0.8rem', outline: 'none' }} />
            </div>
            <div>
              <label className="lbl">Mg2+ (mM)</label>
              <input type="number" step="0.1" value={mgConc} onChange={e => setMgConc(e.target.value)} style={{ width: '100%', background: '#0f1117', border: '1px solid #24272f', borderRadius: '8px', color: '#e2e4e9', padding: '0.6rem 0.8rem', outline: 'none' }} />
            </div>
            <div>
              <label className="lbl">Primer (nM)</label>
              <input type="number" step="10" value={primerConc} onChange={e => setPrimerConc(e.target.value)} style={{ width: '100%', background: '#0f1117', border: '1px solid #24272f', borderRadius: '8px', color: '#e2e4e9', padding: '0.6rem 0.8rem', outline: 'none' }} />
            </div>
            <div>
              <label className="lbl">dNTP (mM)</label>
              <input type="number" step="0.1" value={dntpConc} onChange={e => setDntpConc(e.target.value)} style={{ width: '100%', background: '#0f1117', border: '1px solid #24272f', borderRadius: '8px', color: '#e2e4e9', padding: '0.6rem 0.8rem', outline: 'none' }} />
            </div>
          </div>
          <div style={{ padding: '0 1rem 1rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap', background: '#080a10', border: '1px solid #161923', borderTop: 'none', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px', marginTop: '-1.15rem', marginBottom: '1.15rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', color: isHighSensitivity ? '#00FFC6' : '#e2e4e9' }}>
              <input type="checkbox" checked={isHighSensitivity} onChange={e => setIsHighSensitivity(e.target.checked)} style={{ accentColor: '#00FFC6', width: '16px', height: '16px' }} />
              High Sensitivity Mode
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', color: isTouchdown ? '#00FFC6' : '#e2e4e9' }}>
              <input type="checkbox" checked={isTouchdown} onChange={e => setIsTouchdown(e.target.checked)} style={{ accentColor: '#00FFC6', width: '16px', height: '16px' }} />
              Touchdown Strategy
            </label>
          </div>
        </div>

        {/* ═══ SEQUENCE INPUT ═══ */}
        <div className="pc" id="sequence-input-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '0.65rem', flexWrap: 'wrap', gap: '0.65rem' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#6b7080', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Target DNA Sequence</div>
            <div style={{ display: 'flex', gap: '0.42rem', flexWrap: 'wrap', alignItems: 'center', position: 'relative' }}>
              <label className="btn-sample" style={{ cursor: 'pointer', margin: 0, padding: '0.4rem 0.85rem' }}>
                Upload FASTA
                <input type="file" accept=".fasta,.fa,.txt" onChange={handleFileUpload} style={{ display: 'none' }} />
              </label>
              <div style={{ position: 'relative' }}>
                <button
                  onClick={handleLoadSampleBtn}
                  className="btn-sample sample-shine"
                  style={{
                    cursor: 'pointer', margin: 0, padding: '0.4rem 0.85rem'
                  }}
                >
                  Load Sample
                </button>
                {showLoadSample && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '0.45rem', background: '#141720', border: '1px solid #24272f', borderRadius: 10, padding: '0.55rem', boxShadow: '0 12px 32px rgba(0,0,0,0.5)', zIndex: 50, width: 'max-content', maxWidth: '350px' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#6b7080', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.45rem', padding: '0 0.5rem' }}>Curated Scenarios</div>
                    {CURATED_SAMPLES.map((s, i) => (
                      <div key={i} onClick={() => {
                        setActiveSample(s);
                        setSequence(s.sequence);
                        // Mode-Aware setting change
                        if (s.application_mode) setAppMode(s.application_mode);
                        if (s.isHighSensitivity !== undefined) setIsHighSensitivity(s.isHighSensitivity);
                        if (s.isTouchdown !== undefined) setIsTouchdown(s.isTouchdown);
                        setShowLoadSample(false);
                        if (s.primer_pair) { handleDesignFn(s); } else { setPrimers(null); setError(''); }
                      }}
                        style={{ padding: '0.65rem 0.75rem', borderRadius: 8, cursor: 'pointer', marginBottom: '0.28rem', border: '1px solid transparent', transition: 'all 0.2s', background: activeSample === s ? 'rgba(0,255,198,0.06)' : 'transparent', borderColor: activeSample === s ? 'rgba(0,255,198,0.3)' : 'transparent' }}
                        onMouseEnter={e => { if (activeSample !== s) { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = '#1e2130'; } }}
                        onMouseLeave={e => { if (activeSample !== s) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; } }}
                      >
                        <div style={{ fontSize: '0.9rem', color: activeSample === s ? '#00FFC6' : '#e2e4e9', fontWeight: 600, marginBottom: '0.15rem' }}>{s.name}</div>
                        <div style={{ fontSize: '0.8rem', color: '#8a8f9e', lineHeight: 1.4 }}>{s.context}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', borderLeft: '1px solid #24272f', paddingLeft: '0.65rem' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: isDemoMode ? '#818CF8' : '#6b7080' }}>Demo Mode</span>
                <label className="switch" style={{ margin: 0 }}>
                  <input type="checkbox" checked={isDemoMode} onChange={e => setIsDemoMode(e.target.checked)} />
                  <span className="slider round"></span>
                </label>
              </div>
            </div>
          </div>
          {activeSample && (
            <div style={{ background: activeSample.name.includes('PASS') || activeSample.name.includes('Optimized') || activeSample.name.includes('Gold Standard') ? 'rgba(0,255,198,0.08)' : activeSample.name.includes('FAIL') || activeSample.name.includes('Failure') ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)', borderLeft: `3px solid ${activeSample.name.includes('PASS') || activeSample.name.includes('Optimized') || activeSample.name.includes('Gold Standard') ? '#00FFC6' : activeSample.name.includes('FAIL') || activeSample.name.includes('Failure') ? '#EF4444' : '#F59E0B'}`, padding: '0.65rem 0.85rem', marginBottom: '0.65rem', borderRadius: 4 }}>
              <div style={{ fontSize: '0.86rem', fontWeight: 600, color: activeSample.name.includes('PASS') || activeSample.name.includes('Optimized') || activeSample.name.includes('Gold Standard') ? '#00FFC6' : activeSample.name.includes('FAIL') || activeSample.name.includes('Failure') ? '#F87171' : '#FBBF24', marginBottom: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {activeSample.name.includes('PASS') || activeSample.name.includes('Optimized') || activeSample.name.includes('Gold Standard') ? '✔️ Pre-Validated Research Template' : activeSample.name.includes('FAIL') || activeSample.name.includes('Failure') ? '❌ Safety Stress-Test Template' : '⚠️ Experimental Boundary Template'}
              </div>
              <div style={{ fontSize: '0.84rem', color: '#8a8f9e' }}>Sample Loaded: <span style={{ color: '#c8cad4' }}>{activeSample.name.replace(/^[🟢🟡🟠🔴]\s*/, '')}</span> — {activeSample.context}</div>
            </div>
          )}

          {/* Smart Mode Banner */}
          {!activeSample && bpCount > 0 && (
            <div style={{ background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.2)', padding: '0.55rem 0.85rem', marginBottom: '0.65rem', borderRadius: 7 }}>
              <div style={{ fontSize: '0.84rem', color: '#60A5FA', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ fontSize: '0.9rem' }}>💡</span>
                <span>
                  <strong>Recommended Mode based on length ({bpCount} bp):</strong>{' '}
                  {bpCount < 120 ? 'qPCR (Real-Time)' : bpCount > 1000 ? 'Long-Range PCR' : 'Standard PCR'}
                </span>
              </div>
            </div>
          )}

          <textarea rows={5} value={sequence} onChange={e => setSequence(e.target.value)} placeholder="Paste your target gene region here or upload a FASTA file… (whitespace &amp; numbers are ignored)" />
          {sequence && (
            <div style={{ marginTop: '0.45rem', fontSize: '0.88rem', color: '#6b7080', fontFamily: '"JetBrains Mono",monospace', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span>{bpCount} bp after cleaning</span>
              {bpCount < 150 && bpCount > 0 && <span style={{ color: '#F59E0B' }}>Short sequence — fewer candidates available</span>}
            </div>
          )}
        </div>

        {error && (
          <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '0.65rem 0.88rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.48rem' }}>
            <span style={{ fontSize: '0.92rem', color: '#F87171' }}>{error}</span>
          </div>
        )}

        {/* ═══ SUBMIT ═══ */}
        <button className="btn-p" onClick={handleDesign} disabled={loading}>
          {loading ? <><span className="spin"></span> Running Thermodynamic Analysis…</> : <>Design Primers</>}
        </button>

        {/* ═══════════════════════════════════════════════════════════════════
        RESULTS
        ═══════════════════════════════════════════════════════════════════ */}
        {primers && (
          <div className="fade-in">

            {/* CLASSIFICATION BANNER */}
            <div style={{ marginTop: '1.55rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.65rem', marginBottom: '0.9rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <span style={{
                  background: CLASS_BG[primers.classification], border: `1px solid ${CLASS_COL[primers.classification]}44`, color: CLASS_COL[primers.classification],
                  padding: '0.28rem 0.85rem', borderRadius: 20, fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase'
                }}>
                  {primers.classification}
                </span>
                {primers.autoRejected ? (
                  <span style={{ fontSize: '0.88rem', fontWeight: 600, color: '#DC2626' }}>Safety Gate Triggered</span>
                ) : (
                  <>
                    <span style={{ fontSize: '1.15rem', fontWeight: 700, color: CLASS_COL[primers.classification] }}>{primers.overall_score}</span>
                    <span style={{ fontSize: '0.78rem', color: '#6b7080' }}>/100 overall</span>
                  </>
                )}
                <span style={{ fontSize: '0.78rem', color: '#818cf8' }}>Specificity: {primers.specificity_score}/100</span>
              </div>
              <div style={{ position: 'relative' }}>
                <button className="btn-export" onClick={(e) => { e.stopPropagation(); setShowExportMenu(v => !v); }}>
                  Export Results <span style={{ fontSize: '0.76rem', marginLeft: '0.22rem' }}>▼</span>
                </button>
                {showExportMenu && (
                  <div className="export-menu" onClick={e => e.stopPropagation()}>
                    <div className="export-item" onClick={() => exportTXT(false)}><strong>TXT - Summary</strong><div style={{ fontSize: '0.78rem', color: '#6b7080', marginTop: '0.16rem' }}>Primer sequences & key metrics</div></div>
                    <div className="export-item" onClick={() => exportTXT(true)}><strong>TXT - Detailed</strong><div style={{ fontSize: '0.78rem', color: '#6b7080', marginTop: '0.16rem' }}>All thermodynamic data + protocol</div></div>
                    <div className="export-item" onClick={() => exportPDF(false)}><strong>PDF - Summary</strong><div style={{ fontSize: '0.78rem', color: '#6b7080', marginTop: '0.16rem' }}>Clean report for sharing</div></div>
                    <div className="export-item" onClick={() => exportPDF(true)}><strong>PDF - Detailed</strong><div style={{ fontSize: '0.78rem', color: '#6b7080', marginTop: '0.16rem' }}>Full report incl. protocol</div></div>
                  </div>
                )}
              </div>
            </div>

            {/* WARNINGS */}
            {primers.warnings?.length > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                {primers.warnings.map((w, i) => (
                  <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', background: `${URG_COL[w.urgency]}0a`, border: `1px solid ${URG_COL[w.urgency]}30`, borderRadius: 8, padding: '0.55rem 0.78rem', marginBottom: '0.38rem', fontSize: '0.86rem', color: URG_COL[w.urgency] }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700 }}>!</span><span>{w.text}</span>
                  </div>
                ))}
              </div>
            )}

            {/* EXPERIMENTAL CONDITIONS USED */}
            <div className="pc" style={{ marginBottom: '1.1rem', padding: '1rem', background: '#0a0c10', borderColor: '#1a1d26' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#6b7080', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.7rem' }}>Experimental Conditions</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
                <div style={{ background: '#141720', borderRadius: 6, padding: '0.5rem', textAlign: 'center', border: '1px solid #24272f' }}>
                  <div style={{ fontSize: '1.05rem', color: '#fff', fontWeight: 600 }}>{primers._meta?.conditions_used?.na || naConc} <span style={{ fontSize: '0.7em', color: '#8a8f9e' }}>mM</span></div>
                  <div style={{ fontSize: '0.72rem', color: '#6b7080', marginTop: '0.2rem' }}>Na+</div>
                </div>
                <div style={{ background: '#141720', borderRadius: 6, padding: '0.5rem', textAlign: 'center', border: '1px solid #24272f' }}>
                  <div style={{ fontSize: '1.05rem', color: '#fff', fontWeight: 600 }}>{primers._meta?.conditions_used?.mg || mgConc} <span style={{ fontSize: '0.7em', color: '#8a8f9e' }}>mM</span></div>
                  <div style={{ fontSize: '0.72rem', color: '#6b7080', marginTop: '0.2rem' }}>Mg2+</div>
                </div>
                <div style={{ background: '#141720', borderRadius: 6, padding: '0.5rem', textAlign: 'center', border: '1px solid #24272f' }}>
                  <div style={{ fontSize: '1.05rem', color: '#fff', fontWeight: 600 }}>{primers._meta?.conditions_used?.primerConc || primerConc} <span style={{ fontSize: '0.7em', color: '#8a8f9e' }}>nM</span></div>
                  <div style={{ fontSize: '0.72rem', color: '#6b7080', marginTop: '0.2rem' }}>Primer</div>
                </div>
                <div style={{ background: '#141720', borderRadius: 6, padding: '0.5rem', textAlign: 'center', border: '1px solid #24272f' }}>
                  <div style={{ fontSize: '1.05rem', color: '#fff', fontWeight: 600 }}>{primers._meta?.conditions_used?.dntp || dntpConc} <span style={{ fontSize: '0.7em', color: '#8a8f9e' }}>mM</span></div>
                  <div style={{ fontSize: '0.72rem', color: '#6b7080', marginTop: '0.2rem' }}>dNTP</div>
                </div>
              </div>
            </div>

            {/* STATS */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.52rem', flexWrap: 'wrap', gap: '0.52rem' }}>
              <span style={{ fontSize: '0.88rem', fontWeight: 600, color: '#6b7080', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                Results — <span style={{ color: '#00FFC6' }}>{mode.name}</span>
              </span>
            </div>
            <div className="stat-grid" style={{ marginBottom: '1.1rem' }}>
              {[
                { l: 'Product Size', v: `${primers.expected_product_size} bp`, c: '#fff' },
                { l: 'Tm Difference', v: `${primers.tm_difference} °C`, c: primers.tm_difference <= 2 ? '#00FFC6' : primers.tm_difference <= 3 ? '#F59E0B' : '#EF4444' },
                {
                  l: 'Compatibility', v: primers.tm_difference <= 2 ? 'Excellent' : primers.tm_difference <= 3 ? 'Acceptable' : 'Poor',
                  c: primers.tm_difference <= 2 ? '#00FFC6' : primers.tm_difference <= 3 ? '#F59E0B' : '#EF4444'
                },
                {
                  l: 'Cross-Dimer ΔG',
                  v: primers.cross_dimer_display || `${primers.cross_dimer_dg} kcal/mol`,
                  c: primers.dimer_analysis?.risk_level === 'high' ? '#EF4444' : primers.dimer_analysis?.risk_level === 'moderate' ? '#F59E0B' : '#00FFC6'
                }
              ].map((s, i) => (
                <div key={i} className="stat-b">
                  <div className="stat-v" style={{ color: s.c, fontSize: s.v.length > 8 ? '1.05rem' : '1.42rem' }}>{s.v}</div>
                  <div className="stat-l">{s.l}</div>
                </div>
              ))}
            </div>

            {primers.evaluation?.meltingCurve && (
              <div className="pc" style={{ marginBottom: '1.1rem', background: '#0a0c10', borderColor: '#1a1d26' }}>
                <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#6b7080', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.65rem' }}>
                  Melting Curve Summary
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.55rem', marginBottom: '0.55rem' }}>
                  <div className="stat-b">
                    <div className="stat-v" style={{ color: '#60A5FA' }}>{primers.evaluation.meltingCurve.peakMeltingTemperature}°C</div>
                    <div className="stat-l">Peak Melting Temperature</div>
                  </div>
                  <div className="stat-b">
                    <div className="stat-v" style={{ fontSize: '1.05rem', color: primers.evaluation.meltingCurve.curveType === 'Sharp' ? '#00FFC6' : primers.evaluation.meltingCurve.curveType === 'Broad' ? '#F59E0B' : '#EF4444' }}>
                      {primers.evaluation.meltingCurve.curveType}
                    </div>
                    <div className="stat-l">Curve Type</div>
                  </div>
                </div>
                <div style={{ fontSize: '0.88rem', color: '#c8cad4', lineHeight: 1.5, marginBottom: '0.35rem' }}>
                  {primers.evaluation.meltingCurve.interpretation}
                </div>
                <div style={{ fontSize: '0.84rem', color: '#8a8f9e', lineHeight: 1.55 }}>
                  {primers.evaluation.meltingCurve.summary}
                  {primers.evaluation.meltingCurve.estimated ? ' (Estimated from available Tm and GC data.)' : ''}
                </div>
              </div>
            )}

            {primers.specificity_analysis && (
              <div className="pc" style={{ marginBottom: '1.1rem', background: '#0a0c10', borderColor: '#1a1d26' }}>
                <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#6b7080', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.65rem' }}>
                  Specificity Analysis
                </div>
                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: primers.specificity_analysis.score >= 80 ? '#00FFC6' : primers.specificity_analysis.score >= 60 ? '#F59E0B' : '#EF4444', marginBottom: '0.45rem' }}>
                  Score: {primers.specificity_analysis.score}/100
                </div>
                <div style={{ fontSize: '0.9rem', color: '#c8cad4', lineHeight: 1.5, marginBottom: '0.45rem' }}>
                  {primers.specificity_analysis.interpretation}
                </div>
                <div style={{ fontSize: '0.84rem', color: '#8a8f9e', marginBottom: '0.35rem' }}>
                  Possible Issues:
                </div>
                <div style={{ fontSize: '0.84rem', color: '#8a8f9e', lineHeight: 1.45, marginBottom: '0.45rem' }}>
                  {primers.specificity_analysis.possibleIssues.length > 0 ? primers.specificity_analysis.possibleIssues.map((x, idx) => <div key={idx}>- {x}</div>) : <div>- None significant under current constraints</div>}
                </div>
                <div style={{ fontSize: '0.84rem', color: '#8a8f9e', lineHeight: 1.5 }}>
                  <strong style={{ color: '#c8cad4' }}>Recommendation:</strong> {primers.specificity_analysis.recommendation}
                </div>
              </div>
            )}

            {/* ═══ EVALUATION ENGINE RESULTS ═══ */}
            {primers.evaluation && primers.evaluation.thermoStatus === 'FAILED' && (
              <div className="pc" style={{ borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.05)', marginBottom: '1.1rem' }}>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: '#EF4444', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span>❌</span> Auto-Rejected (Thermodynamic Engine Failure)
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.78rem', color: '#6b7080', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' }}>Safety Gate Status</div>
                  <div style={{ color: '#FCA5A5', fontWeight: 600 }}>FAILED — Structural parameters could not be computed.</div>
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.78rem', color: '#6b7080', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' }}>PCR Success Probability</div>
                  <div style={{ color: '#8a8f9e' }}>Not Computed (Model integrity failure)</div>
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.78rem', color: '#6b7080', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' }}>Secondary Structure</div>
                  <div style={{ color: '#8a8f9e' }}>{primers.evaluation?.structureInterpretation || 'Estimated from primer thermodynamics.'}</div>
                </div>

                <div>
                  <div style={{ fontSize: '0.78rem', color: '#6b7080', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' }}>Explanation</div>
                  <div style={{ color: '#e2e4e9', lineHeight: 1.6, fontSize: '0.9rem' }}>
                    Thermodynamic nearest-neighbor calculations returned invalid values.<br />
                    Re-evaluate ΔG computation engine before primer assessment.
                  </div>
                </div>
              </div>
            )}

            {primers.evaluation && primers.evaluation.thermoStatus !== 'FAILED' && (
              <div style={{ marginBottom: '1.1rem' }}>

                {/* Risk Assessment */}
                <div className="pc" style={{ borderColor: primers.evaluation.riskTier === 'Low' ? 'rgba(0,255,198,0.25)' : primers.evaluation.riskTier === 'Moderate' ? 'rgba(245,158,11,0.25)' : 'rgba(239,68,68,0.25)', background: primers.evaluation.riskTier === 'Low' ? 'rgba(0,255,198,0.04)' : primers.evaluation.riskTier === 'Moderate' ? 'rgba(245,158,11,0.04)' : 'rgba(239,68,68,0.04)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', marginBottom: '0.65rem' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#60A5FA', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Risk Assessment (Bayesian Model)</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.55rem' }}>
                    <div className="stat-b">
                      <div className="stat-v" style={{ color: primers.evaluation.riskTier === 'Low' ? '#00FFC6' : primers.evaluation.riskTier === 'Moderate' ? '#F59E0B' : '#EF4444' }}>{primers.evaluation.successProbability}%</div>
                      <div className="stat-l">PCR Success Probability</div>
                    </div>
                    <div className="stat-b">
                      <div className="stat-v" style={{ fontSize: '1.1rem', color: primers.evaluation.riskTier === 'Low' ? '#00FFC6' : primers.evaluation.riskTier === 'Moderate' ? '#F59E0B' : '#EF4444' }}>{primers.evaluation.riskTier}</div>
                      <div className="stat-l">Risk Tier</div>
                    </div>
                  </div>
                </div>

                {/* VISUAL SAFETY DASHBOARD */}
                <div className="pc" style={{ background: '#0a0c10', borderColor: '#1a1d26', marginBottom: '1.1rem' }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#e2e4e9', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span>📊</span> Visual Safety Dashboard
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                    {/* Thermodynamic Health */}
                    <div style={{ background: '#141720', padding: '0.85rem', borderRadius: 8, border: '1px solid #24272f' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                        <span style={{ fontSize: '0.8rem', color: '#8a8f9e', fontWeight: 600 }}>Thermodynamic Health</span>
                        <span style={{ fontSize: '0.8rem', color: primers.evaluation.safetyPassed ? '#00FFC6' : '#EF4444', fontWeight: 700 }}>{primers.evaluation.safetyPassed ? 'PASS' : 'FAIL'}</span>
                      </div>
                      <div style={{ height: 6, background: '#1e2130', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: primers.evaluation.safetyPassed ? '100%' : '35%', background: primers.evaluation.safetyPassed ? '#00FFC6' : '#EF4444', transition: 'width 1s ease' }}></div>
                      </div>
                    </div>

                    {/* Dimer Strength Gauge */}
                    <div style={{ background: '#141720', padding: '0.85rem', borderRadius: 8, border: '1px solid #24272f' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                        <span style={{ fontSize: '0.8rem', color: '#8a8f9e', fontWeight: 600 }}>Cross-Dimer Risk</span>
                        <span style={{ fontSize: '0.8rem', color: primers.dimer_analysis?.risk_level === 'high' ? '#EF4444' : primers.dimer_analysis?.risk_level === 'moderate' ? '#F59E0B' : '#00FFC6', fontWeight: 700 }}>
                          {primers.cross_dimer_display || `${primers.cross_dimer_dg} kcal/mol`}
                        </span>
                      </div>
                      <div style={{ height: 6, background: '#1e2130', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${Math.max(5, 100 - (Math.abs(primers.dimer_analysis?.delta_g ?? primers.cross_dimer_dg) * 10))}%`,
                          background: primers.dimer_analysis?.risk_level === 'high' ? '#EF4444' : primers.dimer_analysis?.risk_level === 'moderate' ? '#F59E0B' : '#00FFC6',
                          transition: 'width 1s ease'
                        }}></div>
                      </div>
                    </div>

                    {/* Tm Match Indicator */}
                    <div style={{ background: '#141720', padding: '0.85rem', borderRadius: 8, border: '1px solid #24272f' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                        <span style={{ fontSize: '0.8rem', color: '#8a8f9e', fontWeight: 600 }}>Tm Match (ΔTm)</span>
                        <span style={{ fontSize: '0.8rem', color: primers.tm_difference <= 2 ? '#00FFC6' : primers.tm_difference <= 3 ? '#F59E0B' : '#EF4444', fontWeight: 700 }}>{primers.tm_difference}°C</span>
                      </div>
                      <div style={{ height: 6, background: '#1e2130', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.max(5, 100 - (primers.tm_difference * 20))}%`, background: primers.tm_difference <= 2 ? '#00FFC6' : primers.tm_difference <= 3 ? '#F59E0B' : '#EF4444', transition: 'width 1s ease' }}></div>
                      </div>
                    </div>

                    {/* Specificity Score */}
                    <div style={{ background: '#141720', padding: '0.85rem', borderRadius: 8, border: '1px solid #24272f' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                        <span style={{ fontSize: '0.8rem', color: '#8a8f9e', fontWeight: 600 }}>Specificity</span>
                        <span style={{ fontSize: '0.8rem', color: primers.specificity_score >= 80 ? '#818CF8' : primers.specificity_score >= 60 ? '#F59E0B' : '#EF4444', fontWeight: 700 }}>{primers.specificity_score}/100</span>
                      </div>
                      <div style={{ height: 6, background: '#1e2130', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${primers.specificity_score}%`, background: primers.specificity_score >= 80 ? '#818CF8' : primers.specificity_score >= 60 ? '#F59E0B' : '#EF4444', transition: 'width 1s ease' }}></div>
                      </div>
                    </div>

                  </div>
                </div>

                {/* Safety Gate Triggers */}
                {primers.evaluation.safetyTriggers.length > 0 && (
                  <div className="pc" style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.04)' }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#EF4444', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.55rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span>Safety Gate Triggers</span>
                      {isDemoMode && <span style={{ fontSize: '0.75rem', color: '#818CF8', padding: '0.2rem 0.5rem', background: 'rgba(129,140,248,0.1)', borderRadius: 4 }}>DEMO LOGIC: Fails structural filter</span>}
                    </div>
                    {primers.evaluation.safetyTriggers.map((t, i) => (
                      <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', background: 'rgba(239,68,68,0.08)', borderRadius: 7, padding: '0.5rem 0.75rem', marginBottom: '0.35rem', fontSize: '0.86rem', color: '#FCA5A5', borderLeft: '3px solid #EF4444' }}>
                        <span>{t}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Melting Behavior */}
                {typeof meltingCurveData !== 'undefined' && meltingCurveData !== undefined && (
                  <div className="pc">
                    <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#00FFC6', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.55rem' }}>Melting Curve Simulation</div>
                    <p style={{ fontSize: '0.92rem', color: '#8a8f9e', lineHeight: 1.75, margin: '0 0 0.65rem' }}>{primers.evaluation.meltingCurve.summary}</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.45rem' }}>
                      <div style={{ background: '#0f1117', borderRadius: 7, padding: '0.5rem 0.65rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.8rem', color: '#6b7080' }}>Forward</span>
                        <span style={{ fontSize: '0.82rem', color: primers.evaluation.meltingCurve.fwdMeltQ === 'Sharp & Specific' ? '#00FFC6' : '#F59E0B', fontWeight: 600 }}>{primers.evaluation.meltingCurve.fwdMeltQ}</span>
                      </div>
                      <div style={{ background: '#0f1117', borderRadius: 7, padding: '0.5rem 0.65rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.8rem', color: '#6b7080' }}>Reverse</span>
                        <span style={{ fontSize: '0.82rem', color: primers.evaluation.meltingCurve.revMeltQ === 'Sharp & Specific' ? '#00FFC6' : '#F59E0B', fontWeight: 600 }}>{primers.evaluation.meltingCurve.revMeltQ}</span>
                      </div>
                      {primers.evaluation.meltingCurve.asymmetric && (
                        <div style={{ background: 'rgba(245,158,11,0.08)', borderRadius: 7, padding: '0.5rem 0.65rem', borderLeft: '3px solid #F59E0B' }}>
                          <span style={{ fontSize: '0.82rem', color: '#F59E0B', fontWeight: 600 }}>Asymmetric melting detected</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Structural Integrity */}
                <div className="pc">
                  <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#00FFC6', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.55rem' }}>Secondary Structure Analysis</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginBottom: '0.55rem' }}>
                    <div style={{ width: 52, height: 52, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1.05rem', fontFamily: '"Sora",sans-serif', color: primers.evaluation.structureScore >= 6 ? '#EF4444' : primers.evaluation.structureScore >= 3 ? '#F59E0B' : '#00FFC6', background: primers.evaluation.structureScore >= 6 ? 'rgba(239,68,68,0.1)' : primers.evaluation.structureScore >= 3 ? 'rgba(245,158,11,0.1)' : 'rgba(0,255,198,0.1)', border: `2px solid ${primers.evaluation.structureScore >= 6 ? '#EF4444' : primers.evaluation.structureScore >= 3 ? '#F59E0B' : '#00FFC6'}` }}>
                      {primers.evaluation.structureScore}/10
                    </div>
                    <div>
                      <div style={{ color: '#c8cad4', fontWeight: 600, fontSize: '0.94rem' }}>{primers.evaluation.structureInterpretation}</div>
                      <div style={{ color: '#6b7080', fontSize: '0.84rem', marginTop: '0.18rem' }}>
                        {primers.evaluation.threePrimeInterference ? "3' end structural interference DETECTED — severe impact on extension." : "No 3' end structural interference detected."}
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* AI EXPLAIN */}
            {!primers.autoRejected && (
              <div style={{ marginBottom: '1.1rem' }}>
                <button className="btn-ai" onClick={handleAI} disabled={loadingAI}>
                  {loadingAI ? <><span className="spin"></span> Generating Detailed AI Analysis…</> : <>Get Detailed AI Analysis</>}
                </button>
              </div>
            )}
            {aiExplanation && (
              <div className="ai-box">
                <div style={{ fontSize: '0.94rem', fontWeight: 600, color: '#818cf8', marginBottom: '0.65rem' }}>AI Analysis</div>
                <div style={{ fontSize: '0.96rem', color: '#e2e4e9', lineHeight: 1.82, whiteSpace: 'pre-wrap', maxHeight: 450, overflowY: 'auto', background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '0.8rem', border: '1px solid #24272f' }}>
                  {aiExplanation}
                </div>
              </div>
            )}

            {/* BORDERLINE PAIRS PANEL */}
            {!primers.autoRejected && primers.isBorderline && primers.borderline_pairs?.length > 0 && (
              <div className="pc" style={{ marginBottom: '0.55rem', borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.04)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', marginBottom: '0.75rem' }}>
                  <span style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444', fontSize: '0.62rem', fontWeight: 800, padding: '0.2rem 0.48rem', borderRadius: 6, letterSpacing: '0.04em' }}>WARN</span>
                  <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#EF4444', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Borderline Results -- Experimental Validation Required</span>
                </div>
                <p style={{ fontSize: '0.88rem', color: '#8a8f9e', lineHeight: 1.7, marginBottom: '0.9rem' }}>
                  No primer pair satisfied strict thermodynamic criteria for this sequence. The engine relaxed all constraints and found <strong style={{ color: '#c8cad4' }}>{primers.borderline_pairs.length} borderline pair{primers.borderline_pairs.length > 1 ? 's' : ''}</strong> ranked below. The <strong style={{ color: '#c8cad4' }}>best-scoring pair</strong> is shown in the primer cards above. All borderline pairs <strong style={{ color: '#F87171' }}>must be validated experimentally</strong> before committing to synthesis.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                  {primers.borderline_pairs.map((bp, i) => (
                    <div key={i} style={{ background: '#0a0c10', border: `1px solid ${i === 0 ? 'rgba(239,68,68,0.4)' : '#1a1d26'}`, borderRadius: 10, padding: '0.85rem 1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.55rem', flexWrap: 'wrap', gap: '0.38rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444', fontSize: '0.65rem', fontWeight: 700, padding: '0.18rem 0.5rem', borderRadius: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Rank #{bp.rank}
                          </span>
                          {i === 0 && <span style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', color: '#F59E0B', fontSize: '0.65rem', fontWeight: 700, padding: '0.18rem 0.5rem', borderRadius: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Best Available</span>}
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.78rem', color: '#6b7080' }}>
                          <span>Amplicon: <b style={{ color: '#a0a3b1' }}>{bp.amplicon_size} bp</b></span>
                          <span>ΔTm: <b style={{ color: bp.tm_difference > 3 ? '#F59E0B' : '#a0a3b1' }}>{bp.tm_difference}°C</b></span>
                          <span>Score: <b style={{ color: '#a0a3b1' }}>{bp.pair_score}</b></span>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.45rem' }}>
                        {[['→ Forward', bp.forward], ['← Reverse', bp.reverse]].map(([lbl, p]) => (
                          <div key={lbl} style={{ background: '#12141c', borderRadius: 8, padding: '0.55rem 0.7rem' }}>
                            <div style={{ fontSize: '0.68rem', color: '#3d4155', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>{lbl}</div>
                            <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: '0.76rem', color: '#00c9a0', wordBreak: 'break-all', marginBottom: '0.28rem' }}>{p.sequence}</div>
                            <div style={{ fontSize: '0.72rem', color: '#6b7080' }}>Tm {p.tm}°C · GC {p.gc}% · Score {p.score}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: '0.45rem', fontSize: '0.72rem', color: bp.cross_dimer_dg < -5 ? '#F87171' : '#6b7080' }}>
                        Cross-dimer ΔG: {bp.cross_dimer_dg} kcal/mol {bp.cross_dimer_dg < -5 ? '-- High risk' : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* RELAXED CONSTRAINT NOTICE */}
            {!primers.autoRejected && !primers.isBorderline && primers.relaxLevel > 0 && (
              <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.22)', borderRadius: 9, padding: '0.65rem 0.9rem', marginBottom: '0.9rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '0.78rem', color: '#F59E0B', fontWeight: 700 }}>NOTE:</span>
                <div>
                  <span style={{ fontSize: '0.84rem', fontWeight: 600, color: '#F59E0B' }}>Relaxed Constraints Applied (Pass {primers.relaxLevel})</span>
                  <div style={{ fontSize: '0.8rem', color: '#8a8f9e', marginTop: '0.18rem', lineHeight: 1.6 }}>
                    Strict parameters found no valid pair. Constraints were progressively relaxed — validate these primers empirically before synthesis.
                  </div>
                </div>
              </div>
            )}

            {/* OPTIMIZATION TIPS */}
            {!primers.autoRejected && primers.optimization_tips?.length > 0 && (
              <div className="pc" style={{ borderColor: 'rgba(245,158,11,0.22)', background: 'rgba(245,158,11,0.04)' }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#F59E0B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.68rem' }}>PCR Optimization</div>
                {primers.optimization_tips.map((t, i) => (
                  <div key={i} className="tip-card">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem', flexWrap: 'wrap', gap: '0.38rem' }}>
                      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#FCD34D' }}>{t.title}</span>
                      <span style={{ background: `${URG_COL[t.urgency]}15`, color: URG_COL[t.urgency], fontSize: '0.74rem', fontWeight: 600, padding: '0.2rem 0.52rem', borderRadius: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t.urgency}</span>
                    </div>
                    <p style={{ fontSize: '0.92rem', color: '#8a8f9e', lineHeight: 1.68, margin: 0 }}>{t.recommendation}</p>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginBottom: '0.52rem' }}>
              <span style={{ fontSize: '0.88rem', fontWeight: 600, color: primers.autoRejected ? '#EF4444' : '#6b7080', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                {primers.thermoStatus === 'VALIDATION_FAILED' ? 'Sequence Complexity Validation Failed' : primers.autoRejected ? 'Rejected Primers (Reference Only)' : 'Designed Primers'}
              </span>
            </div>
            <div className="primer-grid">
              {[
                primers.forward_primer && { ...primers.forward_primer, label: 'Forward' },
                primers.reverse_primer && { ...primers.reverse_primer, label: 'Reverse' }
              ].map((p, i) => p ? (
                <div key={i} className="pc" style={{ padding: '1.2rem' }}>
                  {/* header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.65rem', flexWrap: 'wrap', gap: '0.38rem' }}>
                    <span style={{ fontSize: '0.98rem', fontWeight: 600, color: '#00FFC6', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {p.label} Primer
                      {isDemoMode && <span style={{ fontSize: '0.7rem', color: '#818CF8', background: 'rgba(129,140,248,0.15)', padding: '0.15rem 0.4rem', borderRadius: 4, fontWeight: 700, letterSpacing: '0.05em' }}>SELECTED PAIR</span>}
                    </span>
                    <span style={{ background: `${QUAL_COL[p.quality_grade]}18`, color: QUAL_COL[p.quality_grade], border: `1px solid ${QUAL_COL[p.quality_grade]}40`, fontSize: '0.76rem', fontWeight: 600, padding: '0.22rem 0.58rem', borderRadius: 12 }}>
                      {p.quality_grade} · {p.quality_score}/100
                    </span>
                  </div>
                  {/* sequence */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.3rem' }}>
                    <button className="btn-g" style={{ fontSize: '0.8rem', padding: '0.35rem 0.72rem' }} onClick={() => navigator.clipboard?.writeText(p.sequence)}>Copy</button>
                  </div>
                  <div className="seq-box">{p.sequence}</div>

                  {/* core props */}
                  <div className="prop-grid" style={{ marginTop: '0.68rem' }}>
                    {[['Length', `${p.length} bp`], ['Tm (NN)', `${p.tm} °C`], ['GC Content', `${p.gc_content}%`], ['Position', p.position]].map(([l, v], j) => (
                      <div key={j} style={{ background: '#0f1117', borderRadius: 7, padding: '0.54rem 0.62rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.8rem', color: '#6b7080' }}>{l}</span>
                        <span style={{ fontSize: '0.86rem', color: '#c8cad4', fontWeight: 600, fontFamily: '"JetBrains Mono",monospace' }}>{v}</span>
                      </div>
                    ))}
                  </div>

                  {/* extended thermodynamic props */}
                  <div className="ext-prop-grid" style={{ marginTop: '0.45rem' }}>
                    {[
                      ['Hairpin ΔG', `${p.hairpin?.delta_g} kcal/mol`, p.hairpin?.delta_g > -2 ? '#00FFC6' : p.hairpin?.delta_g > -3 ? '#F59E0B' : '#EF4444'],
                      ['Self-Dimer ΔG', `${p.self_dimer_dg} kcal/mol`, p.self_dimer_dg > -3 ? '#00FFC6' : p.self_dimer_dg > -5 ? '#F59E0B' : '#EF4444'],
                      ['3′ Stability ΔG', `${p.three_prime_stability_dg} kcal/mol`, '#a0a3b1'],
                      ['Last 5bp GC', `${p.last_5bp_gc_percent}%`, p.last_5bp_gc_percent <= 80 ? '#a0a3b1' : '#F59E0B'],
                    ].map(([l, v, c], j) => (
                      <div key={j} style={{ background: '#0a0c10', borderRadius: 7, padding: '0.48rem 0.62rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.76rem', color: '#3d4155' }}>{l}</span>
                        <span style={{ fontSize: '0.8rem', color: c, fontWeight: 600, fontFamily: '"JetBrains Mono",monospace' }}>{v}</span>
                      </div>
                    ))}
                  </div>

                  {/* hairpin + clamp quick metrics */}
                  {p.hairpin && p.gc_clamp && (
                    <div className="prop-grid" style={{ marginTop: '0.45rem' }}>
                      {[
                        { l: 'Hairpin Risk', v: p.hairpin.risk_level, c: RISK_COL[p.hairpin.risk_level] },
                        { l: 'GC Clamp', v: p.gc_clamp.has_clamp ? 'Present' : 'Missing', c: p.gc_clamp.has_clamp ? '#00FFC6' : '#F59E0B' }
                      ].map((m, j) => (
                        <div key={j} style={{ background: '#0f1117', borderRadius: 7, padding: '0.46rem 0.62rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.8rem', color: '#6b7080' }}>{m.l}</span>
                          <span style={{ fontSize: '0.86rem', color: m.c, fontWeight: 600 }}>{m.v}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* quality flags */}
                  {p.detailed_analysis?.length > 0 && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#6b7080', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Quality Flags</span>
                        {isDemoMode && <span style={{ fontSize: '0.7rem', color: '#818CF8' }}>DEMO: Showing logic triggers</span>}
                      </div>

                      {p.detailed_analysis.map((a, j) => {
                        const col = { error: '#EF4444', warning: '#F59E0B', info: '#60A5FA' }[a.type] || '#6b7080';
                        return (
                          <div key={j} className="a-card" style={{ marginTop: '0.42rem', background: `${col}0e`, border: `1px solid ${col}35` }}>
                            <div style={{ fontSize: '0.86rem', fontWeight: 600, color: col, marginBottom: '0.32rem' }}>{a.title}</div>
                            <p style={{ fontSize: '0.84rem', color: '#8a8f9e', lineHeight: 1.65, margin: '0 0 0.28rem' }}>{a.issue}</p>
                            <p style={{ fontSize: '0.82rem', color: '#606878', lineHeight: 1.6, margin: '0 0 0.35rem', fontStyle: 'italic' }}>{a.impact}</p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.18rem' }}>
                              {a.fixes.map((f, fi) => (
                                <span key={fi} style={{ fontSize: '0.82rem', color: '#00c9a0', paddingLeft: '0.68rem', position: 'relative' }}>
                                  <span style={{ position: 'absolute', left: 0, color: '#00FFC660' }}>›</span>{f}
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div key={i} className="pc" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 190, color: '#EF4444', fontSize: '0.98rem' }}>No suitable primer found</div>
              ))}
            </div>

            {/* PCR PROTOCOL — only shown when NOT auto-rejected */}
            {!primers.autoRejected && primers.pcr_protocol && (
              <div className="pc" style={{ marginTop: '0.55rem' }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#00FFC6', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.65rem' }}>Recommended Protocol</div>
                <div className="proto-grid" style={{ marginBottom: '0.75rem' }}>
                  {[['Annealing Temp', `${primers.pcr_protocol.annealing_temp} °C`], ['Extension Time', `${primers.pcr_protocol.extension_time} s`], ['Cycles', primers.pcr_protocol.cycles]].map(([l, v], i) => (
                    <div key={i} className="proto-box">
                      <div style={{ fontSize: '0.79rem', color: '#6b7080', marginBottom: '0.24rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{l}</div>
                      <div style={{ fontSize: '1.2rem', color: '#00FFC6', fontWeight: 600 }}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: '0.92rem', color: '#8a8f9e', marginBottom: '0.35rem' }}>
                  <span style={{ color: '#6b7080' }}>Polymerase: </span>{primers.pcr_protocol.polymerase}
                </div>
                {primers.pcr_protocol.notes?.map((n, i) => (
                  <div key={i} style={{ fontSize: '0.9rem', color: '#F59E0B', marginBottom: '0.22rem' }}>• {n}</div>
                ))}
              </div>
            )}

            {/* JSON OUTPUT */}
            <div className="pc" style={{ marginTop: '0.55rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: showJSON ? '0.65rem' : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <button className="btn-g" onClick={() => setShowJSON(v => !v)} style={{ fontSize: '0.84rem' }}>
                    {showJSON ? '▲ Hide' : '▼ Show'} Structured JSON Output
                  </button>
                </div>
                {showJSON && (
                  <button className="btn-g" style={{ fontSize: '0.8rem', padding: '0.35rem 0.72rem' }}
                    onClick={() => navigator.clipboard?.writeText(JSON.stringify(primers, null, 2))}>
                    Copy JSON
                  </button>
                )}
              </div>
              <div className={`json-wrap ${showJSON ? 'open' : 'closed'}`}>
                <div className="json-block">
                  <PrimerJsonRenderer data={primers} />
                </div>
              </div>
            </div>

            {/* ALTERNATIVE CANDIDATES */}
            {primers.all_candidates?.length > 0 && (
              <div className="pc" style={{ marginTop: '0.55rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.48rem' }}>
                  <span style={{ fontSize: '0.88rem', fontWeight: 600, color: '#6b7080', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Alternative Candidates</span>
                  <button className="btn-g" onClick={() => setShowCand(v => !v)}>{showCand ? 'Hide' : 'Show'} ({primers.all_candidates.length})</button>
                </div>
                {showCand && primers.all_candidates.map((c, i) => (
                  <div key={i} className="cand-row">
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                      <span style={{ fontSize: '0.92rem', color: '#00FFC6', fontWeight: 600 }}>{c.type}</span>
                      <span style={{ fontSize: '0.88rem', color: QUAL_COL[c.quality_grade] }}>{c.quality_grade} · {c.quality_score}/100</span>
                    </div>
                    <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: '0.88rem', color: '#c8cad4', marginBottom: '0.3rem' }}>{c.sequence}</div>
                    <div style={{ fontSize: '0.84rem', color: '#6b7080' }}>Tm {c.tm} °C · GC {c.gc_content}% · {c.length} bp</div>
                  </div>
                ))}
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}

/* ─── JSON SYNTAX HIGHLIGHTER ──────────────────────────────────────────────── */
function PrimerJsonRenderer({ data, indent = 0 }) {
  const pad = '  '.repeat(indent);
  const pad1 = '  '.repeat(indent + 1);

  if (Array.isArray(data)) {
    if (!data.length) return <span style={{ color: '#3d4155' }}>[]</span>;
    return <>
      <span style={{ color: '#3d4155' }}>{'['}</span>{'\n'}
      {data.map((v, i) => <span key={i}>{pad1}<PrimerJsonRenderer data={v} indent={indent + 1} />{i < data.length - 1 ? ',' : ''}{'\n'}</span>)}
      {pad}<span style={{ color: '#3d4155' }}>{']'}</span>
    </>;
  }
  if (data !== null && typeof data === 'object') {
    const keys = Object.keys(data);
    if (!keys.length) return <span style={{ color: '#3d4155' }}>{'{}'}</span>;
    return <>
      <span style={{ color: '#3d4155' }}>{'{'}</span>{'\n'}
      {keys.map((k, i) => <span key={k}>{pad1}<span className="json-key">"{k}"</span><span style={{ color: '#3d4155' }}>: </span><PrimerJsonRenderer data={data[k]} indent={indent + 1} />{i < keys.length - 1 ? ',' : ''}{'\n'}</span>)}
      {pad}<span style={{ color: '#3d4155' }}>{'}'}</span>
    </>;
  }
  if (typeof data === 'string') return <span className="json-str">"{data}"</span>;
  if (typeof data === 'number') return <span className="json-num">{data}</span>;
  if (typeof data === 'boolean') return <span style={{ color: '#F87171' }}>{String(data)}</span>;
  if (data === null) return <span style={{ color: '#F87171' }}>null</span>;
  return <span>{String(data)}</span>;
}
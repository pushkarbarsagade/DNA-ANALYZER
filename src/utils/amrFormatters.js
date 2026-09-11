/**
 * src/utils/amrFormatters.js
 *
 * Formatter utilities for AMR Research Module:
 * 1. Cleans raw BigQuery AMR genotype representations (e.g. "aac(6')-Ib, COMPLETE, False")
 *    into structured display entries (e.g. "aac(6')-Ib — Complete").
 * 2. Formats explicit concordance summaries: e.g. "100% (2/2 comparable pairs)".
 * 3. Provides explicit denominator formula and explanatory notes.
 */

export function formatGenotypeEntries(genotypeStr) {
  if (!genotypeStr) return [];
  const raw = String(genotypeStr).trim();
  if (!raw) return [];

  // Split by comma and strip quotes
  const rawParts = raw
    .replace(/["']/g, '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  const entries = [];
  let i = 0;

  while (i < rawParts.length) {
    const part = rawParts[i];

    // Check for BigQuery triplet pattern: [gene, COMPLETE/PARTIAL/etc, False/True]
    if (
      i + 2 < rawParts.length &&
      /^(COMPLETE|PARTIAL|HMM|INTERNAL_STOP|EXACT|ALLELE)$/i.test(rawParts[i + 1]) &&
      /^(true|false)$/i.test(rawParts[i + 2])
    ) {
      const gene = part;
      const condition = rawParts[i + 1].charAt(0).toUpperCase() + rawParts[i + 1].slice(1).toLowerCase();
      entries.push(`${gene} — ${condition}`);
      i += 3;
    } else if (
      i + 1 < rawParts.length &&
      /^(COMPLETE|PARTIAL|HMM|INTERNAL_STOP|EXACT|ALLELE)$/i.test(rawParts[i + 1])
    ) {
      const gene = part;
      const condition = rawParts[i + 1].charAt(0).toUpperCase() + rawParts[i + 1].slice(1).toLowerCase();
      entries.push(`${gene} — ${condition}`);
      i += 2;
    } else if (/^(true|false)$/i.test(part)) {
      i += 1;
    } else if (/^(COMPLETE|PARTIAL|HMM|INTERNAL_STOP|EXACT|ALLELE)$/i.test(part)) {
      i += 1;
    } else {
      entries.push(part);
      i += 1;
    }
  }

  return entries;
}

export function formatConcordanceMetrics(concordant = 0, comparable = 0, percentage = null) {
  const conc = Number(concordant) || 0;
  const comp = Number(comparable) || 0;

  let pctStr = 'N/A';
  if (comp > 0) {
    if (percentage !== undefined && percentage !== null) {
      pctStr = `${percentage}%`;
    } else {
      pctStr = `${((conc / comp) * 100).toFixed(1)}%`;
    }
  }

  const displayStr = comp > 0
    ? `${pctStr} (${conc}/${comp} comparable pairs)`
    : `N/A (0/0 comparable pairs)`;

  const formula = 'Concordance = concordant comparable pairs / total comparable pairs';
  const note = 'Only genotype–phenotype relationships with a validated project mapping are included in the concordance denominator. Other AST records are reported as Not Comparable or Not Evaluable.';

  return {
    displayStr,
    percentageStr: pctStr,
    concordant: conc,
    comparable: comp,
    formula,
    note,
  };
}

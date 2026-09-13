import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatGenotypeEntries, formatConcordanceMetrics } from './amrFormatters';

const VALIDATION_ISOLATES = [
  'SAMN03177674',
  'SAMN03177676',
  'SAMN03177659',
  'SAMN03177675',
  'SAMN03177664'
];

/**
 * Generates and downloads a dynamic PDF report for the given AMR isolate data.
 * @param {Object} isolateData - Full isolate analysis payload from API
 */
export function exportAmrReportPdf(isolateData) {
  if (!isolateData) {
    throw new Error('No isolate data available to export.');
  }

  const {
    biosample_accession = 'UNKNOWN',
    assembly_accession = '—',
    organism = 'Unknown',
    amr_genotypes = '',
    comparisons = [],
    summary_metrics = {},
    _data_source = '',
    data_source_label = '',
    pdg_release = '',
    amrfinder_version = ''
  } = isolateData;

  const totalAst = summary_metrics.total_ast_records ?? comparisons.length;
  const concordant = summary_metrics.concordant ?? 0;
  const discordant = summary_metrics.discordant ?? 0;
  const notComparable = summary_metrics.not_comparable ?? 0;
  const _notEvaluable = summary_metrics.not_evaluable ?? 0;
  const comparable = summary_metrics.comparable_pairs ?? (concordant + discordant);

  const {
    displayStr: concordanceRateStr,
    percentageStr: concordancePctStr,
    formula: concordanceFormula,
    note: concordanceNote,
  } = formatConcordanceMetrics(concordant, comparable, summary_metrics.concordance_percentage);

  const genotypeList = formatGenotypeEntries(amr_genotypes);

  const isValidationIsolate = VALIDATION_ISOLATES.includes(
    (biosample_accession || '').trim().toUpperCase()
  );

  const provenanceStr = data_source_label || (
    isValidationIsolate ? 'DNA Analyzer Validation Dataset' : 'NCBI Pathogen Detection'
  );

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  let currentY = 14;

  // --- 1. HEADER SECTION ---
  doc.setFillColor(15, 23, 42); // #0f172a
  doc.rect(margin, currentY, pageWidth - margin * 2, 22, 'F');

  doc.setTextColor(56, 189, 248); // #38bdf8
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('DNA ANALYZER  |  AMR RESEARCH MODULE', margin + 6, currentY + 7);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('BioSample Genotype–Phenotype Concordance Report', margin + 6, currentY + 15);

  const timestamp = new Date().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184); // #94a3b8
  doc.text(`Generated: ${timestamp}`, pageWidth - margin - 6, currentY + 7, { align: 'right' });
  doc.text(`Target: ${biosample_accession}`, pageWidth - margin - 6, currentY + 15, { align: 'right' });

  currentY += 26;

  // --- 2. BIOSAMPLE METADATA & GENOTYPES ---
  doc.setFillColor(248, 250, 252); // #f8fafc
  doc.setDrawColor(226, 232, 240); // #e2e8f0
  doc.rect(margin, currentY, pageWidth - margin * 2, 32, 'FD');

  doc.setTextColor(71, 85, 105);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('SAMPLE METADATA & PROVENANCE', margin + 4, currentY + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(30, 41, 59);

  // Col 1: BioSample
  doc.setFont('helvetica', 'bold');
  doc.text('BioSample:', margin + 4, currentY + 12);
  doc.setFont('helvetica', 'normal');
  doc.text(`${biosample_accession}`, margin + 25, currentY + 12);

  // Col 2: Organism
  doc.setFont('helvetica', 'bold');
  doc.text('Organism:', margin + 62, currentY + 12);
  doc.setFont('helvetica', 'normal');
  doc.text(`${organism || 'Escherichia coli'}`, margin + 80, currentY + 12);

  // Col 3: Assembly
  doc.setFont('helvetica', 'bold');
  doc.text('Assembly:', margin + 130, currentY + 12);
  doc.setFont('helvetica', 'normal');
  doc.text(`${assembly_accession || 'N/A'}`, margin + 148, currentY + 12);

  // Row 2: Data Source & AMRFinderPlus version
  doc.setFont('helvetica', 'bold');
  doc.text('Source:', margin + 4, currentY + 18);
  doc.setFont('helvetica', 'normal');
  const sourceText = pdg_release ? `${provenanceStr}` : provenanceStr;
  doc.text(sourceText, margin + 25, currentY + 18);

  if (amrfinder_version) {
    doc.setFont('helvetica', 'bold');
    doc.text('AMRFinder+:', margin + 130, currentY + 18);
    doc.setFont('helvetica', 'normal');
    doc.text(`v${amrfinder_version}`, margin + 154, currentY + 18);
  }

  // Row 3: Genomic AMR Determinants
  doc.setFont('helvetica', 'bold');
  doc.text('Genotypes:', margin + 4, currentY + 25);
  doc.setFont('helvetica', 'normal');
  const genesText = genotypeList.length > 0 ? genotypeList.join(', ') : 'None detected';
  const splitGenes = doc.splitTextToSize(genesText, pageWidth - margin * 2 - 28);
  doc.text(splitGenes, margin + 25, currentY + 25);

  currentY += 36;

  // --- 3. AST SUMMARY METRICS ---
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Summary Metrics for this BioSample', margin, currentY + 1);

  currentY += 4;

  const metricBoxes = [
    { label: 'Total AST', val: String(totalAst), color: [241, 245, 249], border: [203, 213, 225], textCol: [30, 41, 59] },
    { label: 'Comparable', val: String(comparable), color: [238, 242, 255], border: [199, 210, 254], textCol: [67, 56, 202] },
    { label: 'Concordant', val: String(concordant), color: [236, 253, 245], border: [167, 243, 208], textCol: [4, 120, 87] },
    { label: 'Discordant', val: String(discordant), color: [254, 242, 242], border: [254, 202, 202], textCol: [185, 28, 28] },
    { label: 'Not Comparable', val: String(notComparable), color: [248, 250, 252], border: [226, 232, 240], textCol: [71, 85, 105] },
    { label: 'Concordance', val: comparable > 0 ? `${concordancePctStr}` : 'N/A', color: [240, 253, 250], border: [153, 246, 228], textCol: [13, 148, 136] }
  ];

  const totalWidth = pageWidth - margin * 2;
  const gap = 2.5;
  const boxWidth = (totalWidth - (metricBoxes.length - 1) * gap) / metricBoxes.length;
  const boxHeight = 15;

  metricBoxes.forEach((m, idx) => {
    const x = margin + idx * (boxWidth + gap);
    doc.setFillColor(...m.color);
    doc.setDrawColor(...m.border);
    doc.rect(x, currentY, boxWidth, boxHeight, 'FD');

    doc.setTextColor(...m.textCol);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(m.val, x + boxWidth / 2, currentY + 6.5, { align: 'center' });

    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(m.label, x + boxWidth / 2, currentY + 11.5, { align: 'center' });
  });

  currentY += boxHeight + 4;

  // Explicit Concordance Formula & Explanatory Note Banner
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.rect(margin, currentY, pageWidth - margin * 2, 12, 'FD');

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text(`Concordance: ${concordanceRateStr}   |   ${concordanceFormula}`, margin + 4, currentY + 4.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(100, 116, 139);
  const splitNote = doc.splitTextToSize(`Explanatory Note: ${concordanceNote}`, pageWidth - margin * 2 - 8);
  doc.text(splitNote, margin + 4, currentY + 8.5);

  currentY += 15;

  // --- 4. DISCORDANCE HIGHLIGHT SECTION ---
  const discordantRows = comparisons.filter(
    c => (c.classification || '').toLowerCase() === 'discordant'
  );

  if (discordantRows.length > 0) {
    doc.setFillColor(254, 242, 242);
    doc.setDrawColor(252, 165, 165);
    const discordBoxHeight = 12 + discordantRows.length * 6;
    doc.rect(margin, currentY, pageWidth - margin * 2, discordBoxHeight, 'FD');

    doc.setTextColor(185, 28, 28);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(`⚠️ Discordance Alert: ${discordantRows.length} Discordant Pair(s) Detected`, margin + 4, currentY + 6);

    discordantRows.forEach((d, dIdx) => {
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(153, 27, 27);
      const text = `• ${d.antibiotic}: AST is ${d.phenotype}${d.mic ? ` (MIC: ${d.mic})` : ''}, Genotype: ${d.genotype_evidence || 'None'} — Reason: ${d.reason || d.mapping_basis || 'Discordant'}`;
      const splitText = doc.splitTextToSize(text, pageWidth - margin * 2 - 8);
      doc.text(splitText, margin + 4, currentY + 11 + dIdx * 6);
    });

    currentY += discordBoxHeight + 5;
  } else {
    doc.setFillColor(240, 253, 244);
    doc.setDrawColor(187, 247, 208);
    doc.rect(margin, currentY, pageWidth - margin * 2, 8, 'FD');

    doc.setTextColor(22, 101, 52);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.text('✓ No discordant genotype–phenotype pairs identified for this BioSample.', margin + 4, currentY + 5.5);

    currentY += 12;
  }

  // --- 5. AST RECORDS TABLE ---
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(`AST Records Retrieved (${comparisons.length} records)`, margin, currentY);

  if (comparable === 0 && comparisons.length > 0) {
    currentY += 4;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text('AST records retrieved, but no eligible S/I/R phenotype records were available. Concordance was not calculated.', margin, currentY);
    currentY += 2;
  } else {
    currentY += 2;
  }

  const tableBody = comparisons.map(row => {
    const abx = row.antibiotic || '—';
    const geno = (row.genotype_evidence && row.genotype_evidence !== '(none)')
      ? row.genotype_evidence
      : '—';
    const pheno = row.mic
      ? `${row.phenotype || 'Not defined'}\n(MIC: ${row.mic})`
      : (row.phenotype || 'Not defined');
    const classification = row.classification || 'Not comparable';
    const reason = row.reason || row.mapping_basis || '—';

    return [abx, geno, pheno, classification, reason];
  });

  autoTable(doc, {
    startY: currentY,
    margin: { left: margin, right: margin, bottom: 20 },
    head: [['Antibiotic', 'Genomic Evidence', 'AST Phenotype', 'Classification', 'Evaluation Details']],
    body: tableBody,
    theme: 'grid',
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontSize: 8,
      fontStyle: 'bold',
      halign: 'left'
    },
    styles: {
      fontSize: 7.5,
      cellPadding: 2,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      overflow: 'linebreak'
    },
    columnStyles: {
      0: { cellWidth: 32, fontStyle: 'bold' },
      1: { cellWidth: 30 },
      2: { cellWidth: 26 },
      3: { cellWidth: 28 },
      4: { cellWidth: 'auto' }
    },
    didParseCell: (data) => {
      if (data.section === 'body') {
        const rawClass = comparisons[data.row.index]?.classification || '';
        const classLower = rawClass.toLowerCase();

        if (classLower === 'discordant') {
          // Highlight discordant row lightly
          data.cell.styles.fillColor = [254, 242, 242];
          if (data.column.index === 3) {
            data.cell.styles.textColor = [185, 28, 28];
            data.cell.styles.fontStyle = 'bold';
          }
        } else if (classLower === 'concordant' && data.column.index === 3) {
          data.cell.styles.textColor = [4, 120, 87];
          data.cell.styles.fontStyle = 'bold';
        } else if (classLower === 'not comparable' && data.column.index === 3) {
          data.cell.styles.textColor = [100, 116, 139];
        }
      }
    }
  });

  // --- 6. FOOTER & CONTEXT NOTES ---
  const finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 6 : currentY + 40;

  // If table went to new page and finalY is close to bottom, add new page for footer notes
  let notesY = finalY;
  if (notesY > pageHeight - 32) {
    doc.addPage();
    notesY = 16;
  }

  // Validation benchmark context note
  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(248, 250, 252);
  doc.rect(margin, notesY, pageWidth - margin * 2, 18, 'FD');

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(71, 85, 105);

  if (isValidationIsolate) {
    doc.text('VALIDATION BENCHMARK CONTEXT', margin + 4, notesY + 5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(
      'This isolate is part of the preliminary 5-isolate validation dataset used for pipeline benchmarking (26/28 concordant, 92.9%).',
      margin + 4,
      notesY + 9
    );
  } else {
    doc.text('DATA PROVENANCE & BENCHMARK CONTEXT', margin + 4, notesY + 5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(
      'Independent NCBI isolate analysis evaluated via the DNA Analyzer AMR Comparison Engine.',
      margin + 4,
      notesY + 9
    );
  }

  doc.setFont('helvetica', 'italic');
  doc.text(
    'RESEARCH USE ONLY: Generated for computational research and pipeline benchmarking. Not intended for primary clinical diagnostic use.',
    margin + 4,
    notesY + 14
  );

  // Add page numbers on all pages
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text(
      `DNA Analyzer AMR Module  •  BioSample: ${biosample_accession}  •  Page ${i} of ${totalPages}`,
      pageWidth / 2,
      pageHeight - 6,
      { align: 'center' }
    );
  }

  // --- 7. SAVE FILE ---
  const cleanFilenameAcc = (biosample_accession || 'Unknown').replace(/[^a-zA-Z0-9_-]/g, '');
  const filename = `AMR_Report_${cleanFilenameAcc}.pdf`;
  doc.save(filename);
}
/**
 * Generates and downloads a complete, multi-page Evidence Reconciliation PDF report.
 * Includes all 10 standard scientific sections:
 * 1. Sample Information
 * 2. Genomic AMR Evidence
 * 3. NCBI Reference AST
 * 4. Deterministic Genotype–Phenotype Comparison
 * 5. User Laboratory Evidence (or explicit note if none)
 * 6. Evidence Reconciliation Summary & Metrics
 * 7. ML Research Predictions & Dynamic Coverage
 * 8. ML Interpretation & Evidence Hierarchy
 * 9. AI Research Summary (or explicit note if none)
 * 10. Limitations & Research Disclaimers
 *
 * @param {Object} params
 * @param {Object} params.isolateDetails - BioSample isolate metadata and records
 * @param {Object} params.reconciliationResult - Structured reconciliation output from API
 * @param {Array} params.userLabRecords - Array of user-provided laboratory AST observations
 * @param {Object} params.mlPrediction - Dynamic ML multi-drug prediction response
 * @param {Object} params.aiExplanation - AI-assisted research explanation object
 * @param {string} params.currentBioSample - Target BioSample accession string
 */
export function exportReconciliationReportPdf({
  isolateDetails = null,
  reconciliationResult = null,
  userLabRecords = [],
  mlPrediction = null,
  aiExplanation = null,
  currentBioSample = ''
} = {}) {
  const biosampleAccession = (
    currentBioSample ||
    isolateDetails?.biosample_accession ||
    reconciliationResult?.biosample ||
    'UNKNOWN'
  ).trim().toUpperCase();

  const organism = (
    isolateDetails?.organism ||
    reconciliationResult?.organism ||
    mlPrediction?.organism ||
    'Escherichia coli'
  );

  const assemblyAccession = isolateDetails?.assembly_accession || 'Not available';

  const isValidationIsolate = VALIDATION_ISOLATES.includes(biosampleAccession);
  const dataProvider = isolateDetails?.data_source_label || (
    isValidationIsolate
      ? 'DNA Analyzer Validation Dataset (Frozen 5-Isolate Benchmark)'
      : 'NCBI Pathogen Detection (Live BigQuery / Entrez Provider)'
  );

  const amrfinderInfo = isolateDetails?.amrfinder_version
    ? `NCBI AMRFinderPlus v${isolateDetails.amrfinder_version}`
    : 'NCBI AMRFinderPlus (Release PDG000000004.6300)';

  const frameworkVersion = 'DNA Analyzer Phase 12 Framework (Broad-Spectrum Validated)';

  const timestamp = new Date().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const printableWidth = pageWidth - margin * 2;
  let currentY = 14;

  // Helper: check page break before rendering content
  const checkPageBreak = (neededHeight) => {
    if (currentY + neededHeight > pageHeight - margin - 12) {
      doc.addPage();
      currentY = margin;
      return true;
    }
    return false;
  };

  // Helper: Section title bar
  const renderSectionHeader = (titleText, badgeText = null) => {
    checkPageBreak(13);
    doc.setFillColor(30, 41, 59); // #1e293b
    doc.rect(margin, currentY, printableWidth, 7.5, 'F');

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(56, 189, 248); // #38bdf8
    doc.text(titleText.toUpperCase(), margin + 3.5, currentY + 5.2);

    if (badgeText) {
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184);
      doc.text(badgeText, pageWidth - margin - 3.5, currentY + 5.2, { align: 'right' });
    }

    currentY += 10.5;
  };

  // =========================================================================
  // DOCUMENT HEADER & BANNER
  // =========================================================================
  doc.setFillColor(15, 23, 42); // #0f172a
  doc.rect(margin, currentY, printableWidth, 24, 'F');

  doc.setTextColor(56, 189, 248); // #38bdf8
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('DNA ANALYZER  |  AMR RESEARCH MODULE', margin + 5, currentY + 6.5);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('AMR Evidence Reconciliation Report', margin + 5, currentY + 14.5);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(203, 213, 225);
  doc.text('Genomic–Phenotypic Antimicrobial Resistance Research Analysis', margin + 5, currentY + 20);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text(`Generated: ${timestamp}`, pageWidth - margin - 5, currentY + 6.5, { align: 'right' });
  doc.text(`Target BioSample: ${biosampleAccession}`, pageWidth - margin - 5, currentY + 14.5, { align: 'right' });

  currentY += 27;

  // RESEARCH DISCLAIMER STRIP
  doc.setFillColor(238, 242, 255); // #eef2ff
  doc.setDrawColor(199, 210, 254); // #c7d2fe
  doc.rect(margin, currentY, printableWidth, 7, 'FD');

  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(67, 56, 202); // #4338ca
  doc.text('RESEARCH / EDUCATIONAL USE ONLY', margin + 3.5, currentY + 4.6);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text('— Supplementary computational analysis. Not intended for clinical diagnosis, patient management, or treatment decisions.', margin + 57, currentY + 4.6);

  currentY += 10.5;

  // =========================================================================
  // SECTION 1: SAMPLE INFORMATION
  // =========================================================================
  renderSectionHeader('Section 1 — Sample Information & Provenance');

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.rect(margin, currentY, printableWidth, 22, 'FD');

  doc.setFontSize(8);
  doc.setTextColor(30, 41, 59);

  // Row 1
  doc.setFont('helvetica', 'bold');
  doc.text('BioSample Accession:', margin + 4, currentY + 5.5);
  doc.setFont('helvetica', 'normal');
  doc.text(biosampleAccession, margin + 36, currentY + 5.5);

  doc.setFont('helvetica', 'bold');
  doc.text('Organism:', margin + 70, currentY + 5.5);
  doc.setFont('helvetica', 'normal');
  doc.text(organism, margin + 86, currentY + 5.5);

  doc.setFont('helvetica', 'bold');
  doc.text('Assembly:', margin + 132, currentY + 5.5);
  doc.setFont('helvetica', 'normal');
  doc.text(assemblyAccession, margin + 148, currentY + 5.5);

  // Row 2
  doc.setFont('helvetica', 'bold');
  doc.text('Data Provider:', margin + 4, currentY + 11.5);
  doc.setFont('helvetica', 'normal');
  doc.text(dataProvider, margin + 27, currentY + 11.5);

  doc.setFont('helvetica', 'bold');
  doc.text('AMRFinderPlus:', margin + 124, currentY + 11.5);
  doc.setFont('helvetica', 'normal');
  doc.text(amrfinderInfo, margin + 148, currentY + 11.5);

  // Row 3
  doc.setFont('helvetica', 'bold');
  doc.text('Framework:', margin + 4, currentY + 17.5);
  doc.setFont('helvetica', 'normal');
  doc.text(frameworkVersion, margin + 23, currentY + 17.5);

  doc.setFont('helvetica', 'bold');
  doc.text('Report Date:', margin + 128, currentY + 17.5);
  doc.setFont('helvetica', 'normal');
  doc.text(timestamp, margin + 148, currentY + 17.5);

  currentY += 26;

  // =========================================================================
  // SECTION 2: GENOMIC AMR EVIDENCE
  // =========================================================================
  const rawGenotypes = isolateDetails?.amr_genotypes || '';
  const parsedGenotypes = formatGenotypeEntries(rawGenotypes);

  renderSectionHeader('Section 2 — Genomic AMR Evidence', `${parsedGenotypes.length} Determinants`);

  const genotypeTableRows = parsedGenotypes.length > 0
    ? parsedGenotypes.map((g) => {
        const parts = g.split(' — ');
        const gene = parts[0] || g;
        const condition = parts[1] || 'Complete';
        return [gene, condition, 'Identified Determinant', 'NCBI AMRFinderPlus'];
      })
    : [['None', '—', 'No acquired AMR determinants detected', 'NCBI AMRFinderPlus']];

  autoTable(doc, {
    startY: currentY,
    margin: { left: margin, right: margin, bottom: 16 },
    head: [['Genomic Determinant / Gene', 'Allele / Variant Details', 'Evidence Status', 'Source']],
    body: genotypeTableRows,
    theme: 'grid',
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontSize: 7.8,
      fontStyle: 'bold'
    },
    styles: {
      fontSize: 7.5,
      cellPadding: 2,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.15
    },
    columnStyles: {
      0: { cellWidth: 42, fontStyle: 'bold' },
      1: { cellWidth: 38 },
      2: { cellWidth: 50 },
      3: { cellWidth: 'auto' }
    }
  });

  currentY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 7 : currentY + 20;

  // =========================================================================
  // SECTION 3: NCBI REFERENCE AST
  // =========================================================================
  const astRecords = isolateDetails?.ast_records || [];
  renderSectionHeader('Section 3 — NCBI Reference AST Observations', `${astRecords.length} Records`);

  const astTableRows = astRecords.length > 0
    ? astRecords.map((r) => {
        const abx = r.antibiotic || r.drug || '—';
        const pheno = r.phenotype || 'Not defined';
        const mic = r.mic ? `${r.mic}` : '—';
        const method = r.method || r.guideline ? `${r.method || 'MIC'} (${r.guideline || 'CLSI'})` : 'MIC';
        return [abx, pheno, mic, method, 'NCBI Pathogen Detection'];
      })
    : [['No AST records retrieved for this BioSample', '—', '—', '—', 'NCBI']];

  autoTable(doc, {
    startY: currentY,
    margin: { left: margin, right: margin, bottom: 16 },
    head: [['Antibiotic', 'AST Phenotype', 'MIC', 'Method / Guideline', 'Source']],
    body: astTableRows,
    theme: 'grid',
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontSize: 7.8,
      fontStyle: 'bold'
    },
    styles: {
      fontSize: 7.5,
      cellPadding: 2,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.15
    },
    columnStyles: {
      0: { cellWidth: 42, fontStyle: 'bold' },
      1: { cellWidth: 32 },
      2: { cellWidth: 26 },
      3: { cellWidth: 42 },
      4: { cellWidth: 'auto' }
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 1) {
        const val = String(data.cell.raw).toLowerCase();
        if (val.includes('resistant') || val === 'r') {
          data.cell.styles.textColor = [185, 28, 28];
          data.cell.styles.fontStyle = 'bold';
        } else if (val.includes('susceptible') || val === 's') {
          data.cell.styles.textColor = [4, 120, 87];
          data.cell.styles.fontStyle = 'bold';
        } else if (val.includes('intermediate') || val === 'i') {
          data.cell.styles.textColor = [180, 83, 9];
        }
      }
    }
  });

  currentY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 7 : currentY + 20;

  // =========================================================================
  // SECTION 4: DETERMINISTIC GENOTYPE–PHENOTYPE COMPARISON
  // =========================================================================
  const findings = reconciliationResult?.findings || [];
  renderSectionHeader('Section 4 — Deterministic Genotype–Phenotype Comparison', `${findings.length} Evaluated`);

  const findingTableRows = findings.length > 0
    ? findings.map((f) => {
        const abx = f.antibiotic || '—';
        const geno = f.genomic_evidence?.evidence_str || (f.genomic_evidence?.has_determinant ? 'Present' : 'None');
        const ast = f.ncbi_ast?.phenotype || 'Not available';
        const astWithMic = f.ncbi_ast?.mic ? `${ast} (${f.ncbi_ast.mic})` : ast;
        const status = f.reconciliation_status || 'Evaluated';
        const basis = f.conflict_summary || f.genomic_evidence?.mapping_basis || f.reconciliation_category || '—';
        return [abx, geno, astWithMic, status, basis];
      })
    : [['Deterministic reconciliation not yet executed for this session', '—', '—', '—', '—']];

  autoTable(doc, {
    startY: currentY,
    margin: { left: margin, right: margin, bottom: 16 },
    head: [['Antibiotic', 'Genomic Evidence', 'NCBI AST', 'Classification', 'Evaluation Details']],
    body: findingTableRows,
    theme: 'grid',
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontSize: 7.8,
      fontStyle: 'bold'
    },
    styles: {
      fontSize: 7.5,
      cellPadding: 2,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.15,
      overflow: 'linebreak'
    },
    columnStyles: {
      0: { cellWidth: 34, fontStyle: 'bold' },
      1: { cellWidth: 32 },
      2: { cellWidth: 30 },
      3: { cellWidth: 32 },
      4: { cellWidth: 'auto' }
    },
    didParseCell: (data) => {
      if (data.section === 'body') {
        const rowData = findings[data.row.index];
        if (rowData) {
          const isConflict = rowData.has_conflict;
          const isConcordant = rowData.reconciliation_category?.startsWith('concordant');
          if (isConflict) {
            data.cell.styles.fillColor = [254, 242, 242];
            if (data.column.index === 3) {
              data.cell.styles.textColor = [185, 28, 28];
              data.cell.styles.fontStyle = 'bold';
            }
          } else if (isConcordant && data.column.index === 3) {
            data.cell.styles.textColor = [4, 120, 87];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      }
    }
  });

  currentY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 7 : currentY + 20;

  // =========================================================================
  // SECTION 5: USER LABORATORY EVIDENCE
  // =========================================================================
  renderSectionHeader('Section 5 — User Laboratory Evidence', `${userLabRecords.length} Records`);

  if (userLabRecords.length > 0) {
    // Note banner
    doc.setFillColor(254, 243, 199); // #fef3c7
    doc.setDrawColor(252, 211, 77); // #fcd34d
    doc.rect(margin, currentY, printableWidth, 6.5, 'FD');

    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(180, 83, 9); // #b45309
    doc.text('User-Provided Laboratory Evidence:', margin + 3.5, currentY + 4.3);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 53, 15);
    doc.text('Analyzed as supplied. Not independently verified by NCBI or DNA Analyzer.', margin + 46, currentY + 4.3);

    currentY += 9;

    const userLabRows = userLabRecords.map((u) => {
      const abx = u.antibiotic ? u.antibiotic.charAt(0).toUpperCase() + u.antibiotic.slice(1) : '—';
      const pheno = u.phenotype || '—';
      const mic = u.mic || '—';
      const method = u.method || 'Broth Microdilution';

      // Find matching finding in reconciliationResult
      const matchedFinding = findings.find(
        (f) => f.antibiotic?.toLowerCase() === u.antibiotic?.toLowerCase()
      );
      const ncbiAst = matchedFinding?.ncbi_ast?.phenotype || 'Not in NCBI';
      const conflictStatus = matchedFinding?.has_conflict
        ? 'Conflict Detected'
        : (matchedFinding ? 'In Agreement' : 'Evaluated as Supplied');

      return [abx, pheno, mic, method, ncbiAst, conflictStatus];
    });

    autoTable(doc, {
      startY: currentY,
      margin: { left: margin, right: margin, bottom: 16 },
      head: [['Antibiotic', 'User AST Result', 'MIC / Unit', 'Method', 'NCBI AST Comparison', 'Conflict Status']],
      body: userLabRows,
      theme: 'grid',
      headStyles: {
        fillColor: [30, 41, 59],
        textColor: [255, 255, 255],
        fontSize: 7.8,
        fontStyle: 'bold'
      },
      styles: {
        fontSize: 7.5,
        cellPadding: 2,
        textColor: [30, 41, 59],
        lineColor: [226, 232, 240],
        lineWidth: 0.15
      },
      columnStyles: {
        0: { cellWidth: 34, fontStyle: 'bold' },
        1: { cellWidth: 28 },
        2: { cellWidth: 26 },
        3: { cellWidth: 34 },
        4: { cellWidth: 32 },
        5: { cellWidth: 'auto', fontStyle: 'bold' }
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 5) {
          const val = String(data.cell.raw);
          if (val.includes('Conflict')) {
            data.cell.styles.textColor = [185, 28, 28];
          } else if (val.includes('Agreement')) {
            data.cell.styles.textColor = [4, 120, 87];
          }
        }
      }
    });

    currentY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 7 : currentY + 20;
  } else {
    // No user lab data
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.rect(margin, currentY, printableWidth, 9, 'FD');

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text('No user laboratory evidence provided. Multi-source reconciliation evaluated genomic and NCBI AST sources.', margin + 4, currentY + 5.8);

    currentY += 14;
  }

  // =========================================================================
  // SECTION 6: EVIDENCE RECONCILIATION SUMMARY
  // =========================================================================
  renderSectionHeader('Section 6 — Evidence Reconciliation Summary');

  // Derive metrics from Section 4 findings (deterministic evaluation)
  const evaluatedFindings = reconciliationResult?.findings || [];
  
  let concPairs = 0;
  let discPairs = 0;
  let notCompPairs = 0;
  let notEvalPairs = 0;

  evaluatedFindings.forEach(f => {
    const cat = (f.reconciliation_category || '').toLowerCase();
    if (cat.startsWith('concordant')) {
      concPairs++;
    } else if (f.has_conflict) {
      discPairs++;
    } else if (cat === 'not_comparable') {
      notCompPairs++;
    } else if (cat === 'not_evaluable') {
      notEvalPairs++;
    }
  });

  const compPairs = concPairs + discPairs;
  const totalAstCount = astRecords.length;
  
  const rawPercentage = compPairs > 0 ? (concPairs / compPairs) * 100 : null;

  const {
    displayStr: concDisplayStr,
    percentageStr: concPctStr,
    formula: concFormula,
    note: concNote
  } = formatConcordanceMetrics(concPairs, compPairs, rawPercentage);

  const summaryBoxes = [
    { label: 'Total AST', val: String(totalAstCount), color: [241, 245, 249], border: [203, 213, 225], textCol: [30, 41, 59] },
    { label: 'Comparable', val: String(compPairs), color: [238, 242, 255], border: [199, 210, 254], textCol: [67, 56, 202] },
    { label: 'Concordant', val: String(concPairs), color: [236, 253, 245], border: [167, 243, 208], textCol: [4, 120, 87] },
    { label: 'Discordant', val: String(discPairs), color: [254, 242, 242], border: [254, 202, 202], textCol: [185, 28, 28] },
    { label: 'Not Comparable', val: String(notCompPairs), color: [248, 250, 252], border: [226, 232, 240], textCol: [71, 85, 105] },
    { label: 'Concordance', val: compPairs > 0 ? `${concPctStr}` : 'N/A', color: [240, 253, 250], border: [153, 246, 228], textCol: [13, 148, 136] }
  ];

  const gap = 2.5;
  const boxWidth = (printableWidth - (summaryBoxes.length - 1) * gap) / summaryBoxes.length;
  const boxHeight = 14;

  summaryBoxes.forEach((m, idx) => {
    const x = margin + idx * (boxWidth + gap);
    doc.setFillColor(...m.color);
    doc.setDrawColor(...m.border);
    doc.rect(x, currentY, boxWidth, boxHeight, 'FD');

    doc.setTextColor(...m.textCol);
    doc.setFontSize(10.5);
    doc.setFont('helvetica', 'bold');
    doc.text(m.val, x + boxWidth / 2, currentY + 6, { align: 'center' });

    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(m.label, x + boxWidth / 2, currentY + 10.8, { align: 'center' });
  });

  currentY += boxHeight + 4;

  // Formula & Explanatory Banner
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.rect(margin, currentY, printableWidth, 11, 'FD');

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text(`Concordance: ${concDisplayStr}   |   ${concFormula}`, margin + 3.5, currentY + 4.2);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(100, 116, 139);
  const splitNote = doc.splitTextToSize(`Explanatory Note: ${concNote}`, printableWidth - 7);
  doc.text(splitNote, margin + 3.5, currentY + 8.2);

  currentY += 15;

  // =========================================================================
  // SECTION 7: ML RESEARCH PREDICTIONS
  // =========================================================================
  const predictionsList = mlPrediction?.predictions && Array.isArray(mlPrediction.predictions)
    ? mlPrediction.predictions
    : (mlPrediction ? [mlPrediction] : []);

  const availableMlCount = mlPrediction?.available_count !== undefined
    ? mlPrediction.available_count
    : predictionsList.filter((p) => p.available || p.has_broad).length;

  const totalMlEvaluated = mlPrediction?.total_drugs || predictionsList.length;

  renderSectionHeader(
    'Section 7 — Machine Learning Research Predictions',
    `Coverage: ${availableMlCount} of ${totalMlEvaluated || 1} evaluated drugs`
  );

  // Informational banner about Dual Model Architecture (Specialist vs Broad ML1)
  doc.setFillColor(241, 245, 249); // #f1f5f9
  doc.setDrawColor(203, 213, 225); // #cbd5e1
  doc.rect(margin, currentY, printableWidth, 6.5, 'FD');

  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text('Dual Model System:', margin + 3.5, currentY + 4.3);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text('Specialist models provide dedicated organism x drug context; Broad ML1 provides multi-organism dataset-conditioned research coverage.', margin + 31, currentY + 4.3);

  currentY += 9.5;

  const mlTableRows = [];
  const formatProb = (prob) => (prob !== undefined && prob !== null) ? `${(prob * 100).toFixed(1)}%` : '—';

  if (predictionsList.length > 0) {
    predictionsList.forEach((p) => {
      const abx = p.antibiotic ? p.antibiotic.charAt(0).toUpperCase() + p.antibiotic.slice(1) : '—';
      const hasBoth = p.selection_case === 'both' || (p.has_broad && p.has_specialist);
      const hasBroadOnly = p.selection_case === 'broad_only' || (p.has_broad && !p.has_specialist);
      const hasSpecOnly = p.selection_case === 'specialist_only' || (!p.has_broad && p.has_specialist);

      if (hasBoth) {
        // Row 1: Specialist Model
        const spec = p.specialist_prediction || p;
        const specProb = formatProb(spec.predicted_probability ?? spec.probability_resistant);
        const specPred = spec.prediction || (spec.predicted_probability >= 0.5 ? 'Resistant' : 'Susceptible');
        const specId = spec.model_version || spec.model_id || 'AMR-ML-ECOLI-AMP-v0.1';
        const specFeat = `${spec.recognized_features || 0}/${spec.total_determinants || 0}`;
        mlTableRows.push([abx, 'Specialist', specProb, specPred, specId, specFeat, 'Active Specialist (Primary)']);

        // Row 2: Broad ML1 Reference
        const broad = p.broad_prediction;
        if (broad && (broad.available || broad.predicted_probability !== undefined)) {
          const broadProb = formatProb(broad.predicted_probability ?? broad.probability_resistant);
          const broadPred = broad.prediction || (broad.predicted_probability >= 0.5 ? 'Resistant' : 'Susceptible');
          const broadId = broad.model_version || broad.model_id || 'AMR-ML1-BROAD-v0.1';
          const broadFeat = `${broad.recognized_features || 0}/${broad.total_determinants || 0}`;
          mlTableRows.push([`  ↳ (Broad Ref)`, 'Broad ML1', broadProb, broadPred, broadId, broadFeat, 'Pan-Pathogen Reference']);
        }
      } else if (hasBroadOnly) {
        const broad = p.broad_prediction || p;
        const broadProb = formatProb(broad.predicted_probability ?? broad.probability_resistant);
        const broadPred = broad.prediction || (broad.predicted_probability >= 0.5 ? 'Resistant' : 'Susceptible');
        const broadId = broad.model_version || broad.model_id || 'AMR-ML1-BROAD-v0.1';
        const broadFeat = `${broad.recognized_features || 0}/${broad.total_determinants || 0}`;
        mlTableRows.push([abx, 'Broad ML1', broadProb, broadPred, broadId, broadFeat, 'Broad Model (Multi-Organism)']);
      } else if (hasSpecOnly) {
        const spec = p.specialist_prediction || p;
        const specProb = formatProb(spec.predicted_probability ?? spec.probability_resistant);
        const specPred = spec.prediction || (spec.predicted_probability >= 0.5 ? 'Resistant' : 'Susceptible');
        const specId = spec.model_version || spec.model_id || 'Specialist';
        const specFeat = `${spec.recognized_features || 0}/${spec.total_determinants || 0}`;
        mlTableRows.push([abx, 'Specialist', specProb, specPred, specId, specFeat, 'Active Specialist (Primary)']);
      } else if (p.available) {
        const prob = formatProb(p.predicted_probability ?? p.probability_resistant);
        const predClass = p.prediction || (p.predicted_probability >= 0.5 ? 'Resistant' : 'Susceptible');
        const modelVer = p.model_version || p.model || 'AMR-ML';
        const recognized = `${p.recognized_features || 0}/${p.total_determinants || 0}`;
        const fam = p.model_family === 'broad' ? 'Broad ML1' : 'Specialist';
        mlTableRows.push([abx, fam, prob, predClass, modelVer, recognized, 'Validated Model']);
      } else {
        mlTableRows.push([abx, '—', '—', 'No Validated Model', 'None', '—', p.display_note || 'No Validated Model']);
      }
    });
  } else {
    mlTableRows.push(['No ML predictions available for this BioSample', '—', '—', '—', '—', '—', '—']);
  }

  autoTable(doc, {
    startY: currentY,
    margin: { left: margin, right: margin, bottom: 16 },
    head: [['Antibiotic', 'Model Family', 'Predicted Resist. Prob.', 'Prediction', 'Model Version', 'Determinants', 'Coverage Status']],
    body: mlTableRows,
    theme: 'grid',
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontSize: 7.5,
      fontStyle: 'bold'
    },
    styles: {
      fontSize: 7.2,
      cellPadding: 2,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.15
    },
    columnStyles: {
      0: { cellWidth: 32, fontStyle: 'bold' },
      1: { cellWidth: 24 },
      2: { cellWidth: 26 },
      3: { cellWidth: 22, fontStyle: 'bold' },
      4: { cellWidth: 35 },
      5: { cellWidth: 20 },
      6: { cellWidth: 'auto' }
    },
    didParseCell: (data) => {
      if (data.section === 'body') {
        if (data.column.index === 3) {
          const predVal = String(data.cell.raw).toLowerCase();
          if (predVal === 'resistant') {
            data.cell.styles.textColor = [185, 28, 28];
          } else if (predVal === 'susceptible') {
            data.cell.styles.textColor = [4, 120, 87];
          } else if (predVal.includes('no validated')) {
            data.cell.styles.textColor = [100, 116, 139];
            data.cell.styles.fontStyle = 'normal';
          }
        } else if (data.column.index === 1) {
          const famVal = String(data.cell.raw);
          if (famVal === 'Specialist') {
            data.cell.styles.textColor = [37, 99, 235];
            data.cell.styles.fontStyle = 'bold';
          } else if (famVal === 'Broad ML1') {
            data.cell.styles.textColor = [5, 150, 105];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      }
    }
  });

  currentY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 7 : currentY + 20;

  // =========================================================================
  // SECTION 8: ML INTERPRETATION & EVIDENCE HIERARCHY
  // =========================================================================
  renderSectionHeader('Section 8 — ML Interpretation & Evidence Hierarchy');

  checkPageBreak(18);
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.rect(margin, currentY, printableWidth, 16, 'FD');

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85);
  doc.text('ML predictions are supplementary research estimates and do not override observed AST or deterministic classification.', margin + 3.5, currentY + 5);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text('Evidence Authority Hierarchy:', margin + 3.5, currentY + 10.5);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(67, 56, 202);
  doc.text('Observed AST (Gold Standard)   >   Deterministic Genomic Classification   >   ML Research Prediction   >   AI Research Explanation', margin + 46, currentY + 10.5);

  currentY += 20;

  // =========================================================================
  // SECTION 9: AI RESEARCH SUMMARY
  // =========================================================================
  const aiExplanationText = aiExplanation?.explanation || null;
  const aiProvider = aiExplanation?.ai_provider || 'Groq Llama-3.3-70b (Deterministic Fallback Available)';

  renderSectionHeader('Section 9 — AI-Assisted Research Summary', aiExplanationText ? `Provider: ${aiProvider}` : null);

  if (aiExplanationText) {
    checkPageBreak(20);

    // AI text container with multi-page automatic wrapping
    const textLines = doc.splitTextToSize(aiExplanationText, printableWidth - 8);
    const lineHeight = 4.2;
    const blockHeight = textLines.length * lineHeight + 8;

    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);

    // If block fits on current page, draw box
    if (currentY + blockHeight <= pageHeight - margin - 15) {
      doc.rect(margin, currentY, printableWidth, blockHeight, 'FD');
      doc.setFontSize(7.8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(30, 41, 59);
      doc.text(textLines, margin + 4, currentY + 6);
      currentY += blockHeight + 5;
    } else {
      // Stream lines across page breaks smoothly
      doc.setFontSize(7.8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(30, 41, 59);

      for (let i = 0; i < textLines.length; i++) {
        checkPageBreak(6);
        doc.text(textLines[i], margin + 2, currentY + 4);
        currentY += lineHeight;
      }
      currentY += 5;
    }

    // AI disclaimer
    checkPageBreak(8);
    doc.setFontSize(6.8);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(100, 116, 139);
    doc.text(
      'AI Research Disclaimer: AI-generated research summary synthesizes structured evidence for research exploration. Not a clinical diagnosis, prescription, or therapeutic recommendation.',
      margin + 2,
      currentY + 4
    );
    currentY += 9;
  } else {
    checkPageBreak(12);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.rect(margin, currentY, printableWidth, 9, 'FD');

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text('AI research summary was not requested or was unavailable for this analysis session.', margin + 4, currentY + 5.8);

    currentY += 14;
  }

  // =========================================================================
  // SECTION 10: LIMITATIONS & RESEARCH DISCLAIMERS
  // =========================================================================
  renderSectionHeader('Section 10 — Limitations & Research Disclaimers');

  checkPageBreak(32);
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.rect(margin, currentY, printableWidth, 30, 'FD');

  const limitations = [
    '• Research & educational use only: DNA Analyzer is a computational research tool, not a diagnostic medical device.',
    '• Authoritative phenotype evidence: Observed phenotypic AST remains the gold standard for bacterial susceptibility.',
    '• Model scope specificity: Machine learning predictions are model-specific to trained organism–antibiotic pairs.',
    '• Absence of evidence: The absence of a detected acquired AMR gene does not prove phenotypic susceptibility.',
    '• User laboratory evidence: User-provided laboratory observations are analyzed as supplied and are not independently verified.',
    '• AI research interpretations: AI output represents an automated synthesis of structured evidence and may be incomplete.',
    '• No validated model: A "No Validated Model" status signifies that no model in the registry satisfies all project quality gates.',
    '• Clinical microbiology: This platform does not replace standardized laboratory AST (CLSI / EUCAST guidelines).'
  ];

  doc.setFontSize(6.8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);

  limitations.forEach((item, idx) => {
    doc.text(item, margin + 4, currentY + 4.5 + idx * 3.3);
  });

  currentY += 34;

  // =========================================================================
  // RUNNING FOOTERS & PAGE NUMBERS (ALL PAGES)
  // =========================================================================
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(7.2);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184); // #94a3b8
    doc.text(
      `DNA Analyzer AMR Module  •  BioSample: ${biosampleAccession}  •  Page ${p} of ${totalPages}`,
      pageWidth / 2,
      pageHeight - 6,
      { align: 'center' }
    );
  }

  // =========================================================================
  // SAVE AND DOWNLOAD
  // =========================================================================
  const cleanAcc = biosampleAccession.replace(/[^a-zA-Z0-9_-]/g, '');
  const filename = `AMR_Reconciliation_Report_${cleanAcc}.pdf`;
  doc.save(filename);
}

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

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
    organism = 'Escherichia coli',
    amr_genotypes = '',
    comparisons = [],
    summary_metrics = {},
    data_source = '',
    data_source_label = '',
    pdg_release = '',
    amrfinder_version = ''
  } = isolateData;

  const totalAst = summary_metrics.total_ast_records ?? comparisons.length;
  const concordant = summary_metrics.concordant ?? 0;
  const discordant = summary_metrics.discordant ?? 0;
  const notComparable = summary_metrics.not_comparable ?? 0;
  const notEvaluable = summary_metrics.not_evaluable ?? 0;
  const comparable = summary_metrics.comparable_pairs ?? (concordant + discordant);

  let concordanceRateStr = 'N/A';
  if (comparable > 0) {
    if (summary_metrics.concordance_percentage !== undefined && summary_metrics.concordance_percentage !== null) {
      concordanceRateStr = `${summary_metrics.concordance_percentage}%`;
    } else {
      concordanceRateStr = `${((concordant / comparable) * 100).toFixed(1)}%`;
    }
  }

  const genotypeList = amr_genotypes
    ? amr_genotypes.split(',').map(g => g.trim()).filter(Boolean)
    : [];

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
    { label: 'Concordance', val: concordanceRateStr, color: [240, 253, 250], border: [153, 246, 228], textCol: [13, 148, 136] }
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

  currentY += boxHeight + 6;

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

  // --- 5. COMPLETE COMPARISON TABLE ---
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(`Complete AST Genotype–Phenotype Comparison (${comparisons.length} records)`, margin, currentY);

  currentY += 2;

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

import React, { useState, useEffect, useRef, useCallback } from 'react';

const API_URL = import.meta.env?.VITE_API_URL || 'https://dna-analyzer-ousa.onrender.com';

const EMBEDDED_PDB = {
  TP53: "REMARK  TP53 DNA Binding Domain - Domain-accurate CA trace\nREMARK  Based on PDB 2OCJ structural topology\nATOM      1  CA  GLY A 113       3.459  -1.900  -0.675  1.00 30.00           C\nATOM      2  CA  SER A 114       6.294  -0.954  -0.145  1.00 30.00           C\nEND",
};

const GENE_PANEL = {
  TP53: {
    id: 'NM_000546.6', symbol: 'TP53', name: 'Tumor Protein p53',
    fullName: 'Human TP53 tumor protein p53 transcript variant 1',
    type: 'Tumor Suppressor', chromosome: '17p13.1', proteinLength: 393,
    color: '#06B6D4', icon: 'DNA',
    cancerAssociations: ['Lung cancer', 'Colorectal cancer', 'Breast cancer', 'Li-Fraumeni syndrome', 'Ovarian cancer', 'Leukemia'],
    clinicalContext: 'Most frequently mutated gene in human cancers (~50% of all tumors). Loss of p53 function abrogates cell cycle arrest and apoptosis in response to DNA damage.',
    domains: [
      { name: 'Transactivation Domain', start: 1, end: 93, functionalRegion: 'Critical', description: 'Required for p53-mediated transcriptional activation', detail: 'Contains the MDM2-binding site (aa 18–26) and two sub-domains (AD1: 1–40, AD2: 40–67). Key residues: L22, W23, L25, L26 contact TFIID and CBP/p300.' },
      { name: 'Proline-Rich Domain', start: 64, end: 92, functionalRegion: 'Structural', description: 'Important for p53 apoptotic function', detail: 'Contains five PXXP motifs that interact with SH3 domain proteins. Required for apoptosis but not cell cycle arrest. Residues P72 and P47 are common polymorphism sites.' },
      { name: 'DNA Binding Domain', start: 102, end: 292, functionalRegion: 'Critical', description: 'Essential for sequence-specific DNA binding and tumor suppression', detail: 'β-sandwich scaffold (S1–S10) with four loops (L1–L4) and helix H2 that contact DNA. Hotspot residues: R175, G245, R248, R249, R273, R282. Zinc ion coordinated by C176, H179, C238, C242.' },
      { name: 'Nuclear Localization Signal', start: 316, end: 325, functionalRegion: 'Critical', description: 'Directs p53 to nucleus', detail: 'Three overlapping NLS sequences (NLS1: 305–306, NLS2: 370–380, NLS3: 379–384) bind importin-α for nuclear import. Mutations here cause cytoplasmic sequestration.' },
      { name: 'Oligomerization Domain', start: 323, end: 356, functionalRegion: 'Structural', description: 'Required for p53 tetramerization', detail: 'Forms dimers via β-strand (aa 326–333) and α-helix (aa 335–354). Two dimers assemble into the active tetramer. L330, R333, E343, L344, R342 are key interface residues.' },
      { name: 'Regulatory Domain', start: 356, end: 393, functionalRegion: 'Regulatory', description: 'Negatively regulates p53 DNA binding', detail: 'Contains multiple post-translational modification sites: K370, K372, K373, K381, K382, K386 (acetylation by CBP/p300). S371, S375, S378 (phosphorylation by CHK2). Interacts with S100 proteins.' }
    ],
    getGeneNote: (mutClass, domainName) => {
      if (mutClass === 'Missense') return `TP53 missense mutations in the ${domainName} are among the most oncogenic alterations in human cancer.`;
      if (mutClass === 'Nonsense' || mutClass === 'Frameshift') return 'Truncating TP53 mutations result in complete loss of tumor suppressor activity.';
      return 'TP53 variants should be evaluated in the context of the full mutational landscape.';
    },
    pdb: { id: '2OCJ', name: 'p53 DNA-binding domain bound to DNA', url: 'https://www.rcsb.org/3d-view/2OCJ', description: 'Crystal structure of TP53 DBD tetramer bound to full-site DNA (2.05Å resolution)' }
  },
  BRCA1: {
    id: 'NM_007294.4', symbol: 'BRCA1', name: 'Breast Cancer Gene 1',
    fullName: 'Human BRCA1 DNA repair associated transcript variant 1',
    type: 'Tumor Suppressor', chromosome: '17q21.31', proteinLength: 1863,
    color: '#EC4899', icon: 'BRCA',
    cancerAssociations: ['Hereditary breast cancer', 'Ovarian cancer', 'Fallopian tube cancer', 'Peritoneal cancer', 'Pancreatic cancer'],
    clinicalContext: 'Germline BRCA1 mutations confer 57–65% lifetime risk of breast cancer and 39–46% risk of ovarian cancer.',
    domains: [
      { name: 'RING Domain', start: 1, end: 109, functionalRegion: 'Critical', description: 'E3 ubiquitin ligase activity; interacts with BARD1', detail: 'RING finger (aa 8–98) coordinates two zinc ions via eight cysteine/histidine residues (C24, C27, H41, C44, C61, C64, H74, C77). Forms obligate heterodimer with BARD1 via C-terminal helix.' },
      { name: 'RING-NBD Linker', start: 110, end: 202, functionalRegion: 'Structural', description: 'Connects RING domain to nuclear export signals', detail: 'Contains NES1 (aa 22–30) and NES2 (aa 81–99) for CRM1-dependent nuclear export. Phosphorylation by CDK2 at S127 promotes nuclear retention during S phase.' },
      { name: 'Coiled-Coil Domain', start: 1364, end: 1437, functionalRegion: 'Structural', description: 'Mediates interaction with PALB2 for HR repair', detail: 'Leucine zipper-like coiled-coil interacts with PALB2 WD40 domain. This interaction is essential for BRCA2 recruitment to DSB sites. Key residues: L1396, I1399, L1403, M1410.' },
      { name: 'BRCT Domain 1', start: 1642, end: 1736, functionalRegion: 'Critical', description: 'Phosphoprotein binding; essential for DNA damage response', detail: 'BRCT1 phosphopeptide binding groove (K1702, T1700, S1655) recognizes pSXXF motifs on BACH1/FANCJ, CtIP, and Abraxas. Missense mutations (M1775R, Y1853C) disrupt this binding.' },
      { name: 'BRCT Domain 2', start: 1756, end: 1855, functionalRegion: 'Critical', description: 'Tandem BRCT repeat; recruits repair factors to DSBs', detail: 'BRCT2 packs against BRCT1 via an inter-domain linker helix. Together they form the tandem BRCT phosphopeptide receptor. BRCT2 provides additional hydrophobic contacts: W1837, A1789.' }
    ],
    getGeneNote: (mutClass, domainName) => {
      if (mutClass === 'Missense') return `BRCA1 missense mutations in the ${domainName} may disrupt homologous recombination repair.`;
      if (mutClass === 'Nonsense' || mutClass === 'Frameshift') return 'Truncating BRCA1 mutations are strongly associated with HBOC syndrome.';
      return 'BRCA1 variants require clinical classification using multifactorial likelihood models.';
    },
    pdb: { id: '1JNX', name: 'BRCA1 BRCT tandem domain', url: 'https://www.rcsb.org/3d-view/1JNX', description: 'Crystal structure of BRCA1 tandem BRCT domains (1.85Å)' }
  },
  KRAS: {
    id: 'NM_004985.5', symbol: 'KRAS', name: 'Kirsten RAS Proto-Oncogene',
    fullName: 'Human KRAS proto-oncogene GTPase transcript variant b',
    type: 'Oncogene', chromosome: '12p12.1', proteinLength: 189,
    color: '#F59E0B', icon: 'KRAS',
    cancerAssociations: ['Pancreatic ductal adenocarcinoma (>90%)', 'Colorectal cancer', 'Non-small cell lung cancer', 'Thyroid cancer', 'Biliary tract cancer'],
    clinicalContext: 'KRAS is the most commonly mutated oncogene in human cancer. Activating mutations lock KRAS in the GTP-bound active state.',
    domains: [
      { name: 'P-loop (G1)', start: 10, end: 17, functionalRegion: 'Critical', description: 'GTP/GDP phosphate binding; hotspot for G12 and G13 mutations', detail: 'Also called Walker A motif (GXXXXGKS/T). G12 and G13 mutations abolish GAP-stimulated GTPase activity by steric clash with R789 of GAP. G12C mutation creates a covalent pocket exploited by sotorasib (AMG-510).' },
      { name: 'Switch I (G2)', start: 30, end: 40, functionalRegion: 'Critical', description: 'Effector binding region; changes conformation upon GTP hydrolysis', detail: 'Residues 30–40 undergo dramatic conformational change between GDP and GTP states. In GTP-bound form, contacts effectors RAF, PI3K, RALGDS via D33, I36, T35, Y40. T35 coordinates Mg²⁺ and γ-phosphate.' },
      { name: 'Switch II (G3)', start: 57, end: 76, functionalRegion: 'Critical', description: 'GAP interaction site; Q61 is a major mutation hotspot', detail: 'Q61 is the catalytic glutamine that activates the water molecule for GTP hydrolysis. Q61 mutations (Q61H, Q61L, Q61R, Q61K) reduce intrinsic and GAP-stimulated GTPase activity >1000-fold. A59 forms van der Waals contacts with γ-phosphate.' },
      { name: 'G4 Motif', start: 116, end: 119, functionalRegion: 'Structural', description: 'Guanine base recognition', detail: 'NKXD motif (N116, K117, D119) provides specificity for guanine over adenine. D119 makes two hydrogen bonds to N1 and N2 of guanine. Mutations here would lose guanine specificity.' },
      { name: 'G5 Motif', start: 145, end: 147, functionalRegion: 'Structural', description: 'Guanine base specificity', detail: 'SAK/SAL motif. A146 and K147 contact the guanine O6 and N7 positions. A146T/V mutations have been found in colorectal cancer.' },
      { name: 'Hypervariable Region', start: 167, end: 189, functionalRegion: 'Regulatory', description: 'Membrane anchoring; CAAX motif for farnesylation', detail: 'CAAX box (C185-A186-V187-M188 or C185-A186-I187-M188) is farnesylated at C185 by farnesyltransferase, then proteolyzed and carboxymethylated. This is the basis for the failed farnesyltransferase inhibitor drug class.' }
    ],
    getGeneNote: (mutClass, domainName) => {
      if (domainName.includes('P-loop')) return 'Mutations at KRAS G12 and G13 (P-loop) are the most clinically significant. G12C is targetable by sotorasib.';
      if (mutClass === 'Missense') return `KRAS missense mutations in the ${domainName} may constitutively activate RAS-MAPK signaling.`;
      return 'KRAS mutations predict resistance to EGFR-targeted therapies.';
    },
    pdb: { id: '4OBE', name: 'KRAS G12C mutant with GDP', url: 'https://www.rcsb.org/3d-view/4OBE', description: 'Crystal structure of KRAS G12C bound to GDP (1.90Å)' }
  },
  EGFR: {
    id: 'NM_005228.5', symbol: 'EGFR', name: 'Epidermal Growth Factor Receptor',
    fullName: 'Human EGFR epidermal growth factor receptor transcript variant 1',
    type: 'Oncogene', chromosome: '7p11.2', proteinLength: 1210,
    color: '#8B5CF6', icon: 'RAS',
    cancerAssociations: ['Non-small cell lung cancer (NSCLC)', 'Glioblastoma', 'Colorectal cancer', 'Head and neck squamous cell carcinoma'],
    clinicalContext: 'Activating EGFR mutations are found in ~15% of NSCLC. These mutations predict sensitivity to EGFR tyrosine kinase inhibitors.',
    domains: [
      { name: 'Signal Peptide', start: 1, end: 24, functionalRegion: 'Structural', description: 'Directs EGFR to cell membrane', detail: 'Cleaved co-translationally after Ala24. Hydrophobic core (L10–A21) inserts into ER membrane during translation. Loss of signal peptide causes cytoplasmic retention.' },
      { name: 'Extracellular Domain I', start: 25, end: 310, functionalRegion: 'Regulatory', description: 'Ligand binding domain; EGF interaction site', detail: 'L-domain fold (β-helix). EGF contacts residues L38, K465, I467, S468 in Domain I and Domain III. Domain I adopts a tethered conformation in the absence of ligand via a Domain II–IV autoinhibitory interaction.' },
      { name: 'Extracellular Domain II', start: 311, end: 481, functionalRegion: 'Structural', description: 'Dimerization arm; receptor activation interface', detail: 'Furin-like cysteine-rich domain. The β-hairpin dimerization arm (aa 242–259) mediates receptor–receptor contacts in the active dimer. Dimerization buries ~1600 Å² surface area.' },
      { name: 'Transmembrane Domain', start: 646, end: 667, functionalRegion: 'Structural', description: 'Membrane spanning helix', detail: 'Single-pass α-helix that transmits conformational changes across the membrane. Helix rotation model: V663, T654 mediate transmembrane domain dimerization in the active state.' },
      { name: 'Kinase Domain', start: 712, end: 979, functionalRegion: 'Critical', description: 'ATP binding and catalytic activity; major mutation hotspot (exons 18-21)', detail: 'Bilobal kinase fold. N-lobe (β-strands) and C-lobe (α-helices). ATP binds in the hinge region (M769, A767). Key mutations: exon 19 del (ELREA745–749del), L858R activating; T790M (gatekeeper) resistance to 1st/2nd gen TKIs; C797S resistance to osimertinib.' },
      { name: 'C-terminal Domain', start: 980, end: 1210, functionalRegion: 'Regulatory', description: 'Autophosphorylation sites; signal transduction scaffolding', detail: 'Contains 5 autophosphorylation sites: Y992, Y1045, Y1068, Y1086, Y1173. pY1068 recruits GRB2→SOS→RAS. pY1173 recruits SHC. pY992 recruits PLCγ. This domain is intrinsically disordered and acts as a signaling hub.' }
    ],
    getGeneNote: (mutClass, domainName) => {
      if (domainName.includes('Kinase')) return 'EGFR kinase domain mutations are the primary predictive biomarker for TKI therapy in NSCLC.';
      if (mutClass === 'Missense') return `EGFR missense mutations in the ${domainName} may alter receptor kinase activity.`;
      return 'EGFR mutation status is a mandatory biomarker test in newly diagnosed advanced NSCLC.';
    },
    pdb: { id: '2ITX', name: 'EGFR kinase domain with erlotinib', url: 'https://www.rcsb.org/3d-view/2ITX', description: 'EGFR kinase domain (L858R mutant) bound to erlotinib (2.60Å)' }
  }
};

const CANCER_SAMPLES = {
  tp53_r175h: { name: 'TP53 R175H', tag: 'P53', color: '#F59E0B', gene: 'TP53', input: 'R175H', inputType: 'hgvs', description: 'Common dominant-negative missense mutation disrupting the zinc finger.' },
  kras_g12c: { name: 'KRAS G12C', tag: 'RAS', color: '#DC2626', gene: 'KRAS', input: 'G12C', inputType: 'hgvs', description: 'Actionable mutation locked in active GTP state (target of Sotorasib).' },
  brca1_m1775r: { name: 'BRCA1 M1775R', tag: 'BRC', color: '#EF4444', gene: 'BRCA1', input: 'M1775R', inputType: 'hgvs', description: 'Pathogenic variant destroying the phosphopeptide binding pocket.' },
  egfr_l858r: { name: 'EGFR L858R', tag: 'EGF', color: '#10B981', gene: 'EGFR', input: 'L858R', inputType: 'hgvs', description: 'Sensitizing kinase domain mutation responding to TKIs.' }
};

const RESEARCH_SAMPLES = {
  research_normal: { name: 'Normal (Wild-Type)', tag: 'WT', color: '#10B981', reference: 'ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG', alternate: 'ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG', readingFrame: '1', strand: 'forward', description: 'Identical Sequences - No Mutations' },
  research_snp: { name: 'SNP (Missense)', tag: 'SNP', color: '#F59E0B', reference: 'ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG', alternate: 'ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG'.replace('CGC', 'CGT'), readingFrame: '1', strand: 'forward', description: 'Single Nucleotide Polymorphism (SNP)' },
  research_ins: { name: 'Insertion', tag: 'INS', color: '#3B82F6', reference: 'ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG', alternate: 'ATGGCCATTGTAATGGGCCGCTGAAACAAGGGTGCCCGATAG', readingFrame: '1', strand: 'forward', description: 'Insertion Mutation (3 nucleotides)' },
  research_fs: { name: 'Frameshift', tag: 'FS', color: '#DC2626', reference: 'ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG', alternate: 'ATGGCCATTGTAATGGGCCGCTGAACAAGGGTGCCCGATAG', readingFrame: '1', strand: 'forward', description: 'Frameshift Mutation (2 bp Insertion)' }
};

const AA_PROPERTIES = {
  'A': { name: 'Alanine', size: 'small', polarity: 'nonpolar', charge: 'neutral' },
  'R': { name: 'Arginine', size: 'large', polarity: 'polar', charge: 'positive' },
  'N': { name: 'Asparagine', size: 'medium', polarity: 'polar', charge: 'neutral' },
  'D': { name: 'Aspartate', size: 'medium', polarity: 'polar', charge: 'negative' },
  'C': { name: 'Cysteine', size: 'small', polarity: 'polar', charge: 'neutral' },
  'E': { name: 'Glutamate', size: 'medium', polarity: 'polar', charge: 'negative' },
  'Q': { name: 'Glutamine', size: 'medium', polarity: 'polar', charge: 'neutral' },
  'G': { name: 'Glycine', size: 'small', polarity: 'nonpolar', charge: 'neutral' },
  'H': { name: 'Histidine', size: 'large', polarity: 'polar', charge: 'positive' },
  'I': { name: 'Isoleucine', size: 'medium', polarity: 'nonpolar', charge: 'neutral' },
  'L': { name: 'Leucine', size: 'medium', polarity: 'nonpolar', charge: 'neutral' },
  'K': { name: 'Lysine', size: 'large', polarity: 'polar', charge: 'positive' },
  'M': { name: 'Methionine', size: 'medium', polarity: 'nonpolar', charge: 'neutral' },
  'F': { name: 'Phenylalanine', size: 'large', polarity: 'nonpolar', charge: 'neutral' },
  'P': { name: 'Proline', size: 'small', polarity: 'nonpolar', charge: 'neutral' },
  'S': { name: 'Serine', size: 'small', polarity: 'polar', charge: 'neutral' },
  'T': { name: 'Threonine', size: 'small', polarity: 'polar', charge: 'neutral' },
  'W': { name: 'Tryptophan', size: 'large', polarity: 'nonpolar', charge: 'neutral' },
  'Y': { name: 'Tyrosine', size: 'large', polarity: 'polar', charge: 'neutral' },
  'V': { name: 'Valine', size: 'small', polarity: 'nonpolar', charge: 'neutral' },
  '*': { name: 'Stop', size: 'n/a', polarity: 'n/a', charge: 'n/a' }
};

const CODON_TABLE = {
  'TTT': 'F', 'TTC': 'F', 'TTA': 'L', 'TTG': 'L', 'TCT': 'S', 'TCC': 'S', 'TCA': 'S', 'TCG': 'S',
  'TAT': 'Y', 'TAC': 'Y', 'TAA': '*', 'TAG': '*', 'TGT': 'C', 'TGC': 'C', 'TGA': '*', 'TGG': 'W',
  'CTT': 'L', 'CTC': 'L', 'CTA': 'L', 'CTG': 'L', 'CCT': 'P', 'CCC': 'P', 'CCA': 'P', 'CCG': 'P',
  'CAT': 'H', 'CAC': 'H', 'CAA': 'Q', 'CAG': 'Q', 'CGT': 'R', 'CGC': 'R', 'CGA': 'R', 'CGG': 'R',
  'ATT': 'I', 'ATC': 'I', 'ATA': 'I', 'ATG': 'M', 'ACT': 'T', 'ACC': 'T', 'ACA': 'T', 'ACG': 'T',
  'AAT': 'N', 'AAC': 'N', 'AAA': 'K', 'AAG': 'K', 'AGT': 'S', 'AGC': 'S', 'AGA': 'R', 'AGG': 'R',
  'GTT': 'V', 'GTC': 'V', 'GTA': 'V', 'GTG': 'V', 'GCT': 'A', 'GCC': 'A', 'GCA': 'A', 'GCG': 'A',
  'GAT': 'D', 'GAC': 'D', 'GAA': 'E', 'GAG': 'E', 'GGT': 'G', 'GGC': 'G', 'GGA': 'G', 'GGG': 'G'
};

const revComp = seq => { const comp = { A: 'T', T: 'A', G: 'C', C: 'G' }; return seq.split('').reverse().map(c => comp[c] || c).join(''); };
const translateCodon = codon => CODON_TABLE[codon] || '?';

const parseVCF = (vcfText) => {
  const lines = vcfText.split('\n'); const variants = []; const metaLines = []; const errors = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim(); if (!line) continue;
    if (line.startsWith('##')) { metaLines.push(line); continue; }
    if (line.startsWith('#CHROM') || line.startsWith('#chrom')) continue;
    const cols = line.split('\t');
    if (cols.length < 5) { errors.push(`Line ${i + 1}: Expected at least 5 columns, got ${cols.length}`); continue; }
    const [chrom, pos, id, ref, altRaw] = cols; const alts = altRaw.split(',');
    const cleanRef = ref.toUpperCase().replace(/[^ATGCN]/g, '');
    if (!cleanRef) { errors.push(`Line ${i + 1}: Invalid REF allele "${ref}"`); continue; }
    alts.forEach((alt, altIdx) => {
      const cleanAlt = alt.toUpperCase().replace(/[^ATGCN]/g, '');
      if (!cleanAlt) { errors.push(`Line ${i + 1}, ALT ${altIdx + 1}: Invalid ALT allele "${alt}"`); return; }
      variants.push({ chrom, pos: parseInt(pos), id: id === '.' ? `${chrom}:${pos}` : id, ref: cleanRef, alt: cleanAlt, rawLine: line, lineNumber: i + 1, isMultiAllelic: alts.length > 1, altIndex: altIdx });
    });
  }
  return { variants, metaLines, errors };
};

const calculatePositions = (nucleotidePos, frame) => {
  const offset = parseInt(frame) - 1; const adjustedPos = nucleotidePos - offset; const codonNumber = Math.floor(adjustedPos / 3) + 1;
  return { nucleotidePosition: nucleotidePos + 1, codonNumber, aaPosition: codonNumber, literaturePosition: codonNumber };
};

const generateHGVS = (mutation, positions, refSeq, frame, geneKeyOrObj = 'TP53') => {
  const gene = typeof geneKeyOrObj === 'string' ? (GENE_PANEL[geneKeyOrObj] || GENE_PANEL.TP53) : geneKeyOrObj; const prefix = `${gene.id}:p.`;
  if (mutation.mutation_class === 'Silent') return `${prefix}${mutation.reference_amino_acid}${positions.literaturePosition}=`;
  if (mutation.mutation_class === 'Missense') return `${prefix}${mutation.reference_amino_acid}${positions.literaturePosition}${mutation.alternate_amino_acid}`;
  if (mutation.mutation_class === 'Nonsense') return `${prefix}${mutation.reference_amino_acid}${positions.literaturePosition}*`;
  if (mutation.is_frameshift) { const aa = mutation.reference_amino_acid || '?'; return `${prefix}${aa}${positions.literaturePosition}fs`; }
  if (mutation.type === 'Insertion') { const aa = mutation.reference_amino_acid; return aa ? `${prefix}${aa}${positions.literaturePosition}_${positions.literaturePosition + 1}ins` : `${prefix}${positions.literaturePosition}_${positions.literaturePosition + 1}ins`; }
  if (mutation.type === 'Deletion') { const aa = mutation.reference_amino_acid; return aa ? `${prefix}${aa}${positions.literaturePosition}del` : `${prefix}${positions.literaturePosition}del`; }
  return `${prefix}?`;
};

const getDomainMapping = (aaPosition, geneKeyOrObj = 'TP53') => {
  const gene = typeof geneKeyOrObj === 'string' ? (GENE_PANEL[geneKeyOrObj] || GENE_PANEL.TP53) : geneKeyOrObj;
  for (const domain of gene.domains) {
    if (aaPosition >= domain.start && aaPosition <= domain.end) {
      return { proteinDomain: domain.name, functionalRegion: domain.functionalRegion, interpretation: `Mutation occurs inside functional domain: ${domain.description}`, start: domain.start, end: domain.end, isInterDomain: false };
    }
  }
  return { proteinDomain: 'Inter-domain region', functionalRegion: 'N/A', interpretation: `Mutation in inter-domain linker region of ${gene.symbol}`, isInterDomain: true };
};

const getBiologicalInterpretation = (mutation, domainMapping, geneKeyOrObj = 'TP53') => {
  const gene = typeof geneKeyOrObj === 'string' ? (GENE_PANEL[geneKeyOrObj] || GENE_PANEL.TP53) : geneKeyOrObj;
  let interpretation = { mutationType: mutation.type, functionalEffect: mutation.mutation_class, confidence: 'High', confidenceReason: '', scientificNote: '', biochemicalAnalysis: null };
  if (mutation.mutation_class === 'Missense' && mutation.reference_amino_acid && mutation.alternate_amino_acid) {
    const refProps = AA_PROPERTIES[mutation.reference_amino_acid]; const altProps = AA_PROPERTIES[mutation.alternate_amino_acid];
    if (refProps && altProps) {
      interpretation.biochemicalAnalysis = { referenceAA: { aa: mutation.reference_amino_acid, ...refProps }, alternateAA: { aa: mutation.alternate_amino_acid, ...altProps }, sizeChange: refProps.size !== altProps.size, polarityChange: refProps.polarity !== altProps.polarity, chargeChange: refProps.charge !== altProps.charge };
      let changes = [];
      if (refProps.charge !== altProps.charge) changes.push(`charge (${refProps.charge} → ${altProps.charge})`);
      if (refProps.polarity !== altProps.polarity) changes.push(`polarity (${refProps.polarity} → ${altProps.polarity})`);
      if (refProps.size !== altProps.size) changes.push(`size (${refProps.size} → ${altProps.size})`);
      const biochemNote = changes.length > 0 ? `Substitution alters biochemical properties: ${changes.join(', ')}.` : 'Conservative substitution with similar biochemical properties.';
      interpretation.scientificNote = `${biochemNote} ${gene.getGeneNote('Missense', domainMapping.proteinDomain)}`;
    }
    interpretation.confidenceReason = 'Clear codon-level substitution with defined amino acid change';
  }
  if (mutation.is_frameshift) { interpretation.scientificNote = `Frameshift disrupts downstream reading frame and likely truncates ${gene.symbol} protein. ${gene.getGeneNote('Frameshift', domainMapping.proteinDomain)}`; interpretation.confidenceReason = 'Frameshift detected via sequence length difference'; }
  if (mutation.mutation_class === 'Nonsense') { interpretation.scientificNote = `Premature stop codon produces truncated ${gene.symbol} protein. ${gene.getGeneNote('Nonsense', domainMapping.proteinDomain)}`; interpretation.confidenceReason = 'Stop codon introduced at defined position'; }
  if (mutation.mutation_class === 'Silent') { interpretation.scientificNote = `Synonymous substitution with no amino acid change in ${gene.symbol}. Unlikely to affect protein function.`; interpretation.confidenceReason = 'Synonymous codon change verified'; }
  return interpretation;
};

/* ═══════════════════════════════════════════════════════════════════
   BLOSUM62 MATRIX — substitution log-odds scores
   Used for SIFT-like toleration estimate
   ═══════════════════════════════════════════════════════════════════ */
const BLOSUM62 = {
  A: { A: 4, R: -1, N: -2, D: -2, C: 0, Q: -1, E: -1, G: 0, H: -2, I: -1, L: -1, K: -1, M: -1, F: -2, P: -1, S: 1, T: 0, W: -3, Y: -2, V: 0 },
  R: { A: -1, R: 5, N: 0, D: -2, C: -3, Q: 1, E: 0, G: -2, H: 0, I: -3, L: -2, K: 2, M: -1, F: -3, P: -2, S: -1, T: -1, W: -3, Y: -2, V: -3 },
  N: { A: -2, R: 0, N: 6, D: 1, C: -3, Q: 0, E: 0, G: 0, H: 1, I: -3, L: -3, K: 0, M: -2, F: -3, P: -2, S: 1, T: 0, W: -4, Y: -2, V: -3 },
  D: { A: -2, R: -2, N: 1, D: 6, C: -3, Q: 0, E: 2, G: -1, H: -1, I: -3, L: -4, K: -1, M: -3, F: -3, P: -1, S: 0, T: -1, W: -4, Y: -3, V: -3 },
  C: { A: 0, R: -3, N: -3, D: -3, C: 9, Q: -3, E: -4, G: -3, H: -3, I: -1, L: -1, K: -3, M: -1, F: -2, P: -3, S: -1, T: -1, W: -2, Y: -2, V: -1 },
  Q: { A: -1, R: 1, N: 0, D: 0, C: -3, Q: 5, E: 2, G: -2, H: 0, I: -3, L: -2, K: 1, M: 0, F: -3, P: -1, S: 0, T: -1, W: -2, Y: -1, V: -2 },
  E: { A: -1, R: 0, N: 0, D: 2, C: -4, Q: 2, E: 5, G: -2, H: 0, I: -3, L: -3, K: 1, M: -2, F: -3, P: -1, S: 0, T: -1, W: -3, Y: -2, V: -2 },
  G: { A: 0, R: -2, N: 0, D: -1, C: -3, Q: -2, E: -2, G: 6, H: -2, I: -4, L: -4, K: -2, M: -3, F: -3, P: -2, S: 0, T: -2, W: -2, Y: -3, V: -3 },
  H: { A: -2, R: 0, N: 1, D: -1, C: -3, Q: 0, E: 0, G: -2, H: 8, I: -3, L: -3, K: -1, M: -2, F: -1, P: -2, S: -1, T: -2, W: -2, Y: 2, V: -3 },
  I: { A: -1, R: -3, N: -3, D: -3, C: -1, Q: -3, E: -3, G: -4, H: -3, I: 4, L: 2, K: -3, M: 1, F: 0, P: -3, S: -2, T: -1, W: -3, Y: -1, V: 3 },
  L: { A: -1, R: -2, N: -3, D: -4, C: -1, Q: -2, E: -3, G: -4, H: -3, I: 2, L: 4, K: -2, M: 2, F: 0, P: -3, S: -2, T: -1, W: -2, Y: -1, V: 1 },
  K: { A: -1, R: 2, N: 0, D: -1, C: -3, Q: 1, E: 1, G: -2, H: -1, I: -3, L: -2, K: 5, M: -1, F: -3, P: -1, S: 0, T: -1, W: -3, Y: -2, V: -2 },
  M: { A: -1, R: -1, N: -2, D: -3, C: -1, Q: 0, E: -2, G: -3, H: -2, I: 1, L: 2, K: -1, M: 5, F: 0, P: -2, S: -1, T: -1, W: -1, Y: -1, V: 1 },
  F: { A: -2, R: -3, N: -3, D: -3, C: -2, Q: -3, E: -3, G: -3, H: -1, I: 0, L: 0, K: -3, M: 0, F: 6, P: -4, S: -2, T: -2, W: 1, Y: 3, V: -1 },
  P: { A: -1, R: -2, N: -2, D: -1, C: -3, Q: -1, E: -1, G: -2, H: -2, I: -3, L: -3, K: -1, M: -2, F: -4, P: 7, S: -1, T: -1, W: -4, Y: -3, V: -2 },
  S: { A: 1, R: -1, N: 1, D: 0, C: -1, Q: 0, E: 0, G: 0, H: -1, I: -2, L: -2, K: 0, M: -1, F: -2, P: -1, S: 4, T: 1, W: -3, Y: -2, V: -2 },
  T: { A: 0, R: -1, N: 0, D: -1, C: -1, Q: -1, E: -1, G: -2, H: -2, I: -1, L: -1, K: -1, M: -1, F: -2, P: -1, S: 1, T: 5, W: -2, Y: -2, V: 0 },
  W: { A: -3, R: -3, N: -4, D: -4, C: -2, Q: -2, E: -3, G: -2, H: -2, I: -3, L: -2, K: -3, M: -1, F: 1, P: -4, S: -3, T: -2, W: 11, Y: 2, V: -3 },
  Y: { A: -2, R: -2, N: -2, D: -3, C: -2, Q: -1, E: -2, G: -3, H: 2, I: -1, L: -1, K: -2, M: -1, F: 3, P: -3, S: -2, T: -2, W: 2, Y: 7, V: -1 },
  V: { A: 0, R: -3, N: -3, D: -3, C: -1, Q: -2, E: -2, G: -3, H: -3, I: 3, L: 1, K: -2, M: 1, F: -1, P: -2, S: -2, T: 0, W: -3, Y: -1, V: 4 },
};

/* ─── COSMIC hotspot catalogue (representative subset) ─── */
const COSMIC_HOTSPOTS = {
  TP53: {
    R175H: { freq: 0.068, samples: 2847, tissues: ['Colorectal', 'Breast', 'Lung', 'Ovarian'], cosmic_id: 'COSM10660' },
    R248W: { freq: 0.051, samples: 2138, tissues: ['Colorectal', 'Lung', 'Breast', 'Pancreatic'], cosmic_id: 'COSM10662' },
    R248Q: { freq: 0.038, samples: 1592, tissues: ['Colorectal', 'Breast', 'Brain'], cosmic_id: 'COSM43617' },
    R273H: { freq: 0.041, samples: 1724, tissues: ['Colorectal', 'Lung', 'Breast'], cosmic_id: 'COSM10656' },
    R273C: { freq: 0.029, samples: 1213, tissues: ['Colorectal', 'Lung'], cosmic_id: 'COSM10657' },
    G245S: { freq: 0.022, samples: 921, tissues: ['Colorectal', 'Breast', 'Lung'], cosmic_id: 'COSM10658' },
    R249S: { freq: 0.015, samples: 631, tissues: ['Liver', 'Lung'], cosmic_id: 'COSM10659' },
    R282W: { freq: 0.018, samples: 753, tissues: ['Colorectal', 'Breast'], cosmic_id: 'COSM10663' },
  },
  KRAS: {
    G12D: { freq: 0.158, samples: 9241, tissues: ['Pancreatic', 'Colorectal', 'Lung'], cosmic_id: 'COSM521' },
    G12V: { freq: 0.128, samples: 7483, tissues: ['Pancreatic', 'Colorectal', 'Lung'], cosmic_id: 'COSM522' },
    G12C: { freq: 0.089, samples: 5204, tissues: ['Lung', 'Colorectal', 'Pancreatic'], cosmic_id: 'COSM516' },
    G12A: { freq: 0.041, samples: 2397, tissues: ['Pancreatic', 'Colorectal'], cosmic_id: 'COSM517' },
    G13D: { freq: 0.076, samples: 4441, tissues: ['Colorectal', 'Lung'], cosmic_id: 'COSM532' },
    Q61H: { freq: 0.021, samples: 1227, tissues: ['Pancreatic', 'Lung'], cosmic_id: 'COSM554' },
    Q61L: { freq: 0.018, samples: 1051, tissues: ['Pancreatic'], cosmic_id: 'COSM553' },
    A146T: { freq: 0.012, samples: 701, tissues: ['Colorectal'], cosmic_id: 'COSM572' },
  },
  BRCA1: {
    M1775R: { freq: 0.008, samples: 312, tissues: ['Breast', 'Ovarian'], cosmic_id: 'COSM119071' },
    C61G: { freq: 0.011, samples: 428, tissues: ['Breast', 'Ovarian'], cosmic_id: 'COSM118943' },
    C64G: { freq: 0.006, samples: 234, tissues: ['Breast'], cosmic_id: 'COSM118944' },
    R1699W: { freq: 0.005, samples: 196, tissues: ['Breast', 'Ovarian'], cosmic_id: 'COSM119074' },
  },
  EGFR: {
    L858R: { freq: 0.212, samples: 8931, tissues: ['Lung', 'Colorectal'], cosmic_id: 'COSM6224' },
    T790M: { freq: 0.141, samples: 5942, tissues: ['Lung'], cosmic_id: 'COSM6240' },
    L861Q: { freq: 0.028, samples: 1180, tissues: ['Lung'], cosmic_id: 'COSM6253' },
    G719S: { freq: 0.022, samples: 927, tissues: ['Lung'], cosmic_id: 'COSM6258' },
    G719A: { freq: 0.019, samples: 801, tissues: ['Lung'], cosmic_id: 'COSM6259' },
    S768I: { freq: 0.014, samples: 590, tissues: ['Lung'], cosmic_id: 'COSM6241' },
  }
};

/* ─── ClinVar evidence database (representative entries) ─── */
const CLINVAR_DB = {
  TP53: {
    R175H: { sig: 'Pathogenic', review: 'criteria provided, multiple submitters, no conflicts', condition: 'Li-Fraumeni syndrome; Adrenocortical carcinoma; Colorectal cancer', accession: 'RCV000013183', stars: 2 },
    R248W: { sig: 'Pathogenic', review: 'criteria provided, multiple submitters, no conflicts', condition: 'Li-Fraumeni syndrome; Colorectal cancer', accession: 'RCV000013186', stars: 2 },
    R248Q: { sig: 'Pathogenic', review: 'criteria provided, multiple submitters, no conflicts', condition: 'Li-Fraumeni syndrome', accession: 'RCV000076586', stars: 2 },
    R273H: { sig: 'Pathogenic', review: 'criteria provided, multiple submitters, no conflicts', condition: 'Li-Fraumeni syndrome; Non-small cell lung cancer', accession: 'RCV000013180', stars: 2 },
    G245S: { sig: 'Pathogenic', review: 'criteria provided, single submitter', condition: 'Li-Fraumeni syndrome', accession: 'RCV000013181', stars: 1 },
    R249S: { sig: 'Pathogenic', review: 'criteria provided, multiple submitters, no conflicts', condition: 'Hepatocellular carcinoma', accession: 'RCV000013184', stars: 2 },
    R282W: { sig: 'Pathogenic', review: 'criteria provided, multiple submitters, no conflicts', condition: 'Li-Fraumeni syndrome', accession: 'RCV000013187', stars: 2 },
  },
  KRAS: {
    G12D: { sig: 'Pathogenic', review: 'criteria provided, multiple submitters, no conflicts', condition: 'Pancreatic cancer; RAS-associated autoimmune leukoproliferative disease', accession: 'RCV000042399', stars: 2 },
    G12V: { sig: 'Pathogenic', review: 'criteria provided, multiple submitters, no conflicts', condition: 'Pancreatic cancer; Colorectal cancer', accession: 'RCV000042400', stars: 2 },
    G12C: { sig: 'Pathogenic', review: 'criteria provided, multiple submitters, no conflicts', condition: 'Non-small cell lung cancer; Pancreatic cancer', accession: 'RCV000042401', stars: 2 },
    G13D: { sig: 'Pathogenic', review: 'criteria provided, multiple submitters, no conflicts', condition: 'Colorectal cancer; Pancreatic cancer', accession: 'RCV000042402', stars: 2 },
    Q61H: { sig: 'Pathogenic/Likely pathogenic', review: 'criteria provided, single submitter', condition: 'Pancreatic cancer', accession: 'RCV000145122', stars: 1 },
  },
  BRCA1: {
    M1775R: { sig: 'Pathogenic', review: 'reviewed by expert panel', condition: 'Hereditary breast and ovarian cancer', accession: 'RCV000112697', stars: 3 },
    C61G: { sig: 'Pathogenic', review: 'reviewed by expert panel', condition: 'Hereditary breast and ovarian cancer', accession: 'RCV000031178', stars: 3 },
    C64G: { sig: 'Pathogenic', review: 'reviewed by expert panel', condition: 'Hereditary breast and ovarian cancer', accession: 'RCV000031179', stars: 3 },
  },
  EGFR: {
    L858R: { sig: 'Pathogenic', review: 'criteria provided, multiple submitters, no conflicts', condition: 'Non-small cell lung carcinoma', accession: 'RCV000114473', stars: 2 },
    T790M: { sig: 'Pathogenic', review: 'criteria provided, multiple submitters, no conflicts', condition: 'Non-small cell lung carcinoma; Lung adenocarcinoma', accession: 'RCV000114474', stars: 2 },
    G719S: { sig: 'Likely pathogenic', review: 'criteria provided, single submitter', condition: 'Non-small cell lung carcinoma', accession: 'RCV000114476', stars: 1 },
    L861Q: { sig: 'Likely pathogenic', review: 'criteria provided, multiple submitters, no conflicts', condition: 'Non-small cell lung carcinoma', accession: 'RCV000114477', stars: 2 },
  }
};

/* ─── Conservation hotspot residues ─── */
const HOTSPOT_RESIDUES = {
  TP53: [175, 245, 248, 249, 273, 282, 220, 179, 238, 242, 176],
  KRAS: [12, 13, 61, 146, 59, 116, 117, 119],
  BRCA1: [1775, 61, 64, 1699, 24, 27, 41, 44, 1702, 1700, 1655],
  EGFR: [858, 790, 719, 861, 768, 797, 745, 746, 747, 748, 749, 750, 769],
};

/* ═══════════════════════════════════════════════════════════════════
   CANONICAL REFERENCE SEQUENCES — Cancer Intelligence Mode
   Platform-provided reference CDS (representative region) for each gene.
   In production, replace with full NCBI RefSeq CDS sequences.
   ═══════════════════════════════════════════════════════════════════ */
const CANONICAL_REFERENCES = {
  TP53: 'ATGGAGGAGCCGCAGTCAGATCCTAGCGTGAGTTTGCACCTGAGTCTTGCAGAAACGTGGGAAAACCACACTGGCATGTTCAATACCAGGGTTCGAGGCCCACTGAAAGTGAATTTATAGGAGTCCGAATCTTCATTCTAACAAGGTCAGCATGTGAACTTCAAGGATGCCCAGGCCCCTTTTCTTTATGCCAGCAAATAAAGCTACTTCCAGGCAAGATGTTTCATATAAGCTATGATACAGAAATTGATGACTTCATTTTTAACGTGTCTGTGTTTGCAGATAGCGATGGTCTGGCTCCTGAAGGCAAAAAGGGGCAGAGGAAGGGGCTTAGCTTCGCTAAATCCTGACCTGCCCAATGGAGTCACAGCGGGCTTTTCTGATACCACATTTTTCCTCCCAGAGAATGATTTCATCTGCAGCCAGATTTTCATCTTCTGTCCCTTCCCAGAAAACCTACCAGGGCAGCTACGGTTTCCGTCTGGGCTTCTTGCATTCTGGGACAGCCAAGTCTGTGACTTGCACGTACTCCCCTGCCCTCAACAAGATGTTTTGCCAACTGG',
  KRAS: 'ATGACTGAATATAAACTTGTGGTAGTTGGAGCTGGTGGCGTAGGCAAGAGTGCCTTGACGATACAGCTAATTCAGAATCATTTTGTGGACGAATATGATCCAACAATAGAGGATTCCTACAGGAAGCAAGTAGTAATTGATGGAGAAACCTGTCTCTTGGATATTCTCGACACAGCAGGTCAAGAGGAGTACAGTGCAATGAGGGACCAGTACATGAGGACTGGGGAGGGCTTTCTTTGTGTATTTGCCATAAATAATACTAAATCATTTGAAGATATTCACCATTATAGAGAACAAATTAAAAGAGTTAAGGACTCTGAAGATGTACCTATGGTCCTAGTAGGAAATAAATGTGATTTGCCTTCTAGAACAGTAGACACAAAACAGGCTCAGGACTTAGCAAGAAGTTATGGAATTCCTTTTATTGAAACATCAGCAAAGACAAGACAG',
  BRCA1: 'ATGGATTTATCTGCTCTTCGCGTTGAAGAAGTACAAAATGTCATTAATGCTATGCAGAAAATCTTAGAGTGTCCCATCTGTCTGGAGTTGATCAAGGAACCTGTCTCCACAAAGTGTGACCACATATTTTGCAAATTTTGCATGCTGAAACTTCTCAACCAGAAGAAAGGGCCTTCACAGTGTCCTTTATGTAAGAATGATATAACCAAAAGGAGCCTACAAGAAAGTACGAGATTTAGTCAACTTGTTGAAGAGCTATTGAAAATCATTTGTGCTTTTCAGCTTGACACAGGTTTG',
  EGFR: 'ATGCGACCCTCCGGGACGGCCGGGGCAGCGCTCCTGGCGCTGCTGGCTGCGCTCTGCCCGGCGAGTCGGGCTCTGGAGGAAAAGAAAGTTTGCCAAGGCACGAGTAACAAGCTCACGCAGTTGGGCACTTTTGAAGATCATTTTCTCAGCCTCCAGAGGATGTTCAATAACTGTGAGGTGGTCCTTGGGAATTTGGAAATTACCTATGTGCAGAGGAATTATGATCTTTCCTTCTTAAAGATCGTCAGAGCTCTTGGCCGTGGAGACCTGACAGATGCCAAACTCATCAAAGAAGCAACG',
};

/* ─── HGVS variant parser (Cancer Intelligence Mode) ─── */
const AA_3TO1 = { Ala: 'A', Arg: 'R', Asn: 'N', Asp: 'D', Cys: 'C', Glu: 'E', Gln: 'Q', Gly: 'G', His: 'H', Ile: 'I', Leu: 'L', Lys: 'K', Met: 'M', Phe: 'F', Pro: 'P', Ser: 'S', Thr: 'T', Trp: 'W', Tyr: 'Y', Val: 'V', Ter: '*' };
const parseHGVS = (input) => {
  if (!input || typeof input !== 'string') return null;
  const clean = input.trim().replace(/^p\.?/i, '');
  const m1 = clean.match(/^([A-Z])(\d+)([A-Z*])$/i);
  if (m1) {
    const refAA = m1[1].toUpperCase(), position = parseInt(m1[2]), altAA = m1[3].toUpperCase();
    if (AA_PROPERTIES[refAA] && (AA_PROPERTIES[altAA] || altAA === '*') && position > 0) {
      let mutClass = 'Missense'; if (refAA === altAA) mutClass = 'Silent'; else if (altAA === '*') mutClass = 'Nonsense';
      return { valid: true, position, refAA, altAA, mutClass, hgvsInput: input };
    }
  }
  const m3 = clean.match(/^([A-Za-z]{3})(\d+)([A-Za-z]{3}|\*)$/);
  if (m3) {
    const refAA = AA_3TO1[m3[1].charAt(0).toUpperCase() + m3[1].slice(1).toLowerCase()];
    const altAA = m3[3] === '*' ? '*' : AA_3TO1[m3[3].charAt(0).toUpperCase() + m3[3].slice(1).toLowerCase()];
    if (refAA && altAA) return { valid: true, position: parseInt(m3[2]), refAA, altAA, mutClass: refAA === altAA ? 'Silent' : altAA === '*' ? 'Nonsense' : 'Missense', hgvsInput: input };
  }
  return null;
};

/* ─── Auto-detect input type ─── */
const detectInputType = (input) => {
  if (!input || !input.trim()) return 'empty';
  const clean = input.trim();
  if (/^(p\.?)?[A-Z][a-z]{0,2}\d+[A-Z*][a-z]{0,2}$/i.test(clean)) return 'hgvs';
  if (/^[ATGCNatgcn\s>]+$/.test(clean) && clean.replace(/\s/g, '').length >= 6) return 'sequence';
  return 'unknown';
};

/* ─── Build generic gene for Research Mode 3D viewer ─── */
const buildResearchGene = (proteinLength) => ({
  id: 'USER_SEQ', symbol: 'GENE', name: 'User Sequence',
  fullName: 'User-provided protein sequence',
  type: 'Unknown', chromosome: 'N/A', proteinLength: Math.max(proteinLength, 50),
  color: '#06B6D4', icon: 'DNA',
  cancerAssociations: [],
  clinicalContext: 'User-provided sequence for general mutation research and analysis.',
  domains: [
    { name: 'N-terminal', start: 1, end: Math.max(Math.floor(proteinLength * 0.3), 10), functionalRegion: 'Structural', description: 'N-terminal region', detail: '' },
    { name: 'Central Region', start: Math.floor(proteinLength * 0.3) + 1, end: Math.max(Math.floor(proteinLength * 0.7), 20), functionalRegion: 'Critical', description: 'Central functional region', detail: '' },
    { name: 'C-terminal', start: Math.floor(proteinLength * 0.7) + 1, end: Math.max(proteinLength, 30), functionalRegion: 'Regulatory', description: 'C-terminal region', detail: '' },
  ],
  getGeneNote: () => 'Variant identified in user-provided sequence.',
  pdb: { id: 'N/A', name: 'User Protein', url: '#', description: 'Structure visualization from user sequence' },
});

/* ─── SIFT-like toleration score from BLOSUM62 ─── */
const estimateSIFT = (refAA, altAA) => {
  if (!refAA || !altAA || refAA === altAA) return { score: 1.0, tolerated: true, label: 'Tolerated' };
  const b62 = BLOSUM62[refAA]?.[altAA] ?? -4;
  // Map BLOSUM62 score (-4 to +11) → SIFT-like (0–1), low = damaging
  const sift = Math.max(0, Math.min(1, (b62 + 4) / 15));
  return {
    score: parseFloat(sift.toFixed(3)),
    blosum62: b62,
    tolerated: sift >= 0.05,
    label: sift < 0.05 ? 'Damaging' : sift < 0.20 ? 'Low tolerance' : 'Tolerated',
    labelColor: sift < 0.05 ? '#EF4444' : sift < 0.20 ? '#F59E0B' : '#10B981',
  };
};

/* ─── PolyPhen-like structural disruption score ─── */
const estimatePolyPhen = (mutation, domainMapping, geneKey) => {
  const refAA = mutation.reference_amino_acid;
  const altAA = mutation.alternate_amino_acid;
  if (!refAA || !altAA) return { score: 0, label: 'Unknown', labelColor: '#6b7280' };
  let score = 0;
  const refP = AA_PROPERTIES[refAA]; const altP = AA_PROPERTIES[altAA];
  // Domain location weight (0.25 of total)
  if (domainMapping.functionalRegion === 'Critical') score += 0.35;
  else if (domainMapping.functionalRegion === 'Structural') score += 0.20;
  else score += 0.05;
  // Amino acid property disruption (0.35 of total)
  if (refP && altP) {
    if (refP.charge !== altP.charge) score += 0.25;
    if (refP.polarity !== altP.polarity) score += 0.10;
    if (refP.size !== altP.size) score += 0.05;
    if (altAA === 'P') score += 0.10; // proline = helix breaker
    if (altAA === 'G' && domainMapping.functionalRegion !== 'N/A') score += 0.05; // glycine disrupts secondary structure
  }
  // Conservation proxy: hotspot residues (0.15 of total)
  const hotspots = HOTSPOT_RESIDUES[geneKey] || [];
  const aaPos = mutation.aaPosition || 0;
  if (hotspots.includes(aaPos)) score += 0.15;
  else if (domainMapping.functionalRegion === 'Critical') score += 0.07;
  score = Math.max(0, Math.min(1, score));
  const label = score > 0.75 ? 'Probably Damaging' : score > 0.45 ? 'Possibly Damaging' : 'Benign';
  const labelColor = score > 0.75 ? '#EF4444' : score > 0.45 ? '#F59E0B' : '#10B981';
  return { score: parseFloat(score.toFixed(3)), label, labelColor };
};

/* ─── Conservation score ─── */
const estimateConservation = (mutation, geneKey) => {
  const hotspots = HOTSPOT_RESIDUES[geneKey] || [];
  const aaPos = mutation.aaPosition || 0;
  if (hotspots.includes(aaPos)) return { score: 0.95, label: 'Highly conserved hotspot', color: '#EF4444' };
  const gene = GENE_PANEL[geneKey]; if (!gene) return { score: 0.5, label: 'Unknown', color: '#6b7280' };
  for (const dom of gene.domains) {
    if (aaPos >= dom.start && aaPos <= dom.end) {
      if (dom.functionalRegion === 'Critical') return { score: 0.82, label: 'Highly conserved (critical domain)', color: '#F59E0B' };
      if (dom.functionalRegion === 'Structural') return { score: 0.65, label: 'Moderately conserved', color: '#818CF8' };
      return { score: 0.40, label: 'Partially conserved', color: '#10B981' };
    }
  }
  return { score: 0.25, label: 'Low conservation (inter-domain)', color: '#10B981' };
};

/* ─── COSMIC lookup ─── */
const lookupCOSMIC = (mutation, geneKey) => {
  const db = COSMIC_HOTSPOTS[geneKey]; if (!db) return null;
  const ref = mutation.reference_amino_acid; const alt = mutation.alternate_amino_acid;
  if (!ref || !alt) return null;
  const key = `${ref}${mutation.aaPosition}${alt}`;
  return db[key] || null;
};

/* ─── ClinVar lookup ─── */
const lookupClinVar = (mutation, geneKey) => {
  const db = CLINVAR_DB[geneKey]; if (!db) return null;
  const ref = mutation.reference_amino_acid; const alt = mutation.alternate_amino_acid;
  if (!ref || !alt) return null;
  const key = `${ref}${mutation.aaPosition}${alt}`;
  return db[key] || null;
};

/* ─── Live ClinVar NCBI API query ─── */
const fetchClinVarLive = async (hgvs, geneSymbol) => {
  try {
    const query = encodeURIComponent(`${geneSymbol}[gene] AND ${hgvs}[variant name]`);
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=clinvar&term=${query}&retmode=json&retmax=1`;
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const ids = searchData?.esearchresult?.idlist;
    if (!ids || ids.length === 0) return null;
    const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=clinvar&id=${ids[0]}&retmode=json`;
    const sumRes = await fetch(summaryUrl);
    if (!sumRes.ok) return null;
    const sumData = await sumRes.json();
    const doc = sumData?.result?.[ids[0]];
    if (!doc) return null;
    return {
      sig: doc.clinical_significance?.description || 'Unknown',
      review: doc.review_status || 'No review',
      condition: doc.trait_set?.map(t => t.trait_name).join('; ') || 'Not specified',
      accession: doc.accession || ids[0],
      stars: doc.review_status?.includes('expert') ? 3 : doc.review_status?.includes('multiple') ? 2 : 1,
      live: true,
    };
  } catch { return null; }
};

/* ═══════════════════════════════════════════════════════════════════
   WEIGHTED PATHOGENICITY SCORING MODEL
   Final Score =
     (Domain Impact × 0.25) +
     (Mutation Type Severity × 0.20) +
     (ClinVar Evidence × 0.25) +
     (COSMIC Frequency × 0.15) +
     (Conservation Score × 0.10) +
     (Structural Disruption × 0.05)
   ═══════════════════════════════════════════════════════════════════ */
const scorePathogenicity = (mutation, domainMapping, geneKey = 'TP53', clinvarData = null, cosmicData = null) => {
  const reasons = []; let componentScores = {};

  // ── Truncating variants — immediate pathogenic ──
  if (mutation.is_frameshift) return {
    level: 'PATHOGENIC', label: 'Pathogenic', color: '#EF4444', bgClass: 'path-pathogenic', score: 95,
    reasons: ['Frameshift disrupts downstream reading frame', 'Truncated/nonfunctional protein expected', 'Loss-of-function mutation (PVS1-equivalent)'],
    shortLabel: 'P', acmgCriteria: ['PVS1'], componentScores: { mutationType: 1.0, domainImpact: 1.0, clinvar: 0, cosmic: 0, conservation: 0.8, structural: 0 }
  };
  if (mutation.mutation_class === 'Nonsense') return {
    level: 'PATHOGENIC', label: 'Pathogenic', color: '#EF4444', bgClass: 'path-pathogenic', score: 90,
    reasons: ['Premature stop codon introduced', 'Protein function likely abolished', 'Nonsense-mediated mRNA decay probable (PVS1-equivalent)'],
    shortLabel: 'P', acmgCriteria: ['PVS1'], componentScores: { mutationType: 1.0, domainImpact: 1.0, clinvar: 0, cosmic: 0, conservation: 0.8, structural: 0 }
  };
  if (mutation.mutation_class === 'Silent') return {
    level: 'LIKELY_BENIGN', label: 'Likely Benign', color: '#10B981', bgClass: 'path-benign', score: 8,
    reasons: ['Synonymous change — protein sequence unchanged', 'No amino acid alteration (BP7-equivalent)', 'May rarely affect splicing'],
    shortLabel: 'LB', acmgCriteria: ['BP7'], componentScores: { mutationType: 0, domainImpact: 0, clinvar: 0, cosmic: 0, conservation: 0, structural: 0 }
  };

  // ── Component 1: Domain Impact (weight 0.25) ──
  let domainImpact = 0;
  if (domainMapping.functionalRegion === 'Critical') { domainImpact = 1.0; reasons.push('Located in critical functional domain (PM1)'); }
  else if (domainMapping.functionalRegion === 'Structural') { domainImpact = 0.60; reasons.push('Located in structural domain'); }
  else { domainImpact = 0.15; reasons.push('Inter-domain linker region (lower impact)'); }
  componentScores.domainImpact = domainImpact;

  // ── Component 2: Mutation Type Severity (weight 0.20) ──
  let mutTypeSev = 0;
  const sift = mutation.reference_amino_acid && mutation.alternate_amino_acid
    ? estimateSIFT(mutation.reference_amino_acid, mutation.alternate_amino_acid) : null;
  const polyphen = mutation.reference_amino_acid && mutation.alternate_amino_acid
    ? estimatePolyPhen({ ...mutation, aaPosition: domainMapping.aaPosition }, domainMapping, geneKey) : null;
  if (mutation.mutation_class === 'Missense') {
    const refP = AA_PROPERTIES[mutation.reference_amino_acid];
    const altP = AA_PROPERTIES[mutation.alternate_amino_acid];
    if (refP && altP) {
      if (refP.charge !== altP.charge) { mutTypeSev += 0.50; reasons.push(`Charge change: ${refP.charge} to ${altP.charge} (PS3-proxy)`); }
      if (refP.polarity !== altP.polarity) { mutTypeSev += 0.25; reasons.push(`Polarity shift: ${refP.polarity} to ${altP.polarity}`); }
      if (refP.size !== altP.size) { mutTypeSev += 0.15; reasons.push(`Size change: ${refP.size} to ${altP.size}`); }
      if (refP.charge === altP.charge && refP.polarity === altP.polarity && refP.size === altP.size) { mutTypeSev -= 0.20; reasons.push('Conservative substitution (BP4-proxy)'); }
    }
    if (mutation.alternate_amino_acid === 'P') { mutTypeSev += 0.20; reasons.push('Proline introduction (helix/sheet breaker)'); }
    if (mutation.alternate_amino_acid === 'G' && domainMapping.functionalRegion !== 'N/A') { mutTypeSev += 0.10; reasons.push('Glycine introduction (conformational flexibility)'); }
    if (sift && !sift.tolerated) { mutTypeSev += 0.20; reasons.push(`SIFT-like score ${sift.score} — ${sift.label} (BLOSUM62: ${sift.blosum62})`); }
  } else {
    mutTypeSev = domainMapping.functionalRegion === 'Critical' ? 0.70 : 0.40;
    reasons.push(`In-frame indel in ${domainMapping.functionalRegion} domain`);
  }
  mutTypeSev = Math.max(0, Math.min(1, mutTypeSev));
  componentScores.mutationType = mutTypeSev;

  // ── Component 3: ClinVar Evidence (weight 0.25) ──
  let clinvarScore = 0; const cvData = clinvarData;
  if (cvData) {
    if (cvData.sig?.toLowerCase().includes('pathogenic') && !cvData.sig?.toLowerCase().includes('likely')) { clinvarScore = 1.0; reasons.push(`ClinVar: Pathogenic — ${cvData.condition} (${cvData.accession})`); }
    else if (cvData.sig?.toLowerCase().includes('likely pathogenic')) { clinvarScore = 0.75; reasons.push(`ClinVar: Likely Pathogenic (${cvData.accession})`); }
    else if (cvData.sig?.toLowerCase().includes('uncertain')) { clinvarScore = 0.40; reasons.push(`ClinVar: VUS (${cvData.accession})`); }
    else if (cvData.sig?.toLowerCase().includes('likely benign')) { clinvarScore = 0.10; reasons.push(`ClinVar: Likely Benign (${cvData.accession})`); }
    else if (cvData.sig?.toLowerCase().includes('benign')) { clinvarScore = 0; reasons.push(`ClinVar: Benign (${cvData.accession})`); }
  }
  componentScores.clinvar = clinvarScore;

  // ── Component 4: COSMIC Frequency (weight 0.15) ──
  let cosmicScore = 0; const cosData = cosmicData;
  if (cosData) {
    cosmicScore = Math.min(1.0, cosData.freq * 8); // normalize: 12.5% freq → max
    reasons.push(`COSMIC: ${cosData.samples.toLocaleString()} samples, freq ${(cosData.freq * 100).toFixed(1)}% — ${cosData.tissues.slice(0, 2).join(', ')} (${cosData.cosmic_id})`);
  }
  componentScores.cosmic = cosmicScore;

  // ── Component 5: Conservation Score (weight 0.10) ──
  const conserv = estimateConservation({ ...mutation, aaPosition: domainMapping.aaPosition }, geneKey);
  const conservScore = conserv.score;
  if (conserv.score > 0.7) reasons.push(`Conservation: ${conserv.label}`);
  componentScores.conservation = conservScore;

  // ── Component 6: Structural Disruption (weight 0.05) ──
  const structScore = polyphen ? polyphen.score : 0;
  if (polyphen && polyphen.score > 0.45) reasons.push(`PolyPhen-like: ${polyphen.label} (score ${polyphen.score})`);
  componentScores.structural = structScore;

  // ── Final weighted score ──
  const finalScore = (
    (domainImpact * 0.25) +
    (mutTypeSev * 0.20) +
    (clinvarScore * 0.25) +
    (cosmicScore * 0.15) +
    (conservScore * 0.10) +
    (structScore * 0.05)
  );
  const pct = Math.round(finalScore * 100);

  // ── ACMG-like classification ──
  let level, label, color, bgClass, shortLabel, acmgCriteria = [];
  if (clinvarScore === 1.0 && domainImpact >= 0.60) { acmgCriteria.push('PS1', 'PM1'); }
  else if (conservScore > 0.90) { acmgCriteria.push('PP3'); }
  if (sift && !sift.tolerated) acmgCriteria.push('PP3');
  if (cosData && cosData.freq > 0.05) acmgCriteria.push('PS4');
  if (domainImpact === 1.0) acmgCriteria.push('PM1');

  if (pct >= 72) { level = 'PATHOGENIC'; label = 'Pathogenic'; color = '#EF4444'; bgClass = 'path-pathogenic'; shortLabel = 'P'; }
  else if (pct >= 52) { level = 'LIKELY_PATHOGENIC'; label = 'Likely Pathogenic'; color = '#F59E0B'; bgClass = 'path-likely'; shortLabel = 'LP'; }
  else if (pct >= 30) { level = 'VUS'; label = 'Uncertain Significance'; color = '#818CF8'; bgClass = 'path-vus'; shortLabel = 'VUS'; }
  else if (pct >= 12) { level = 'LIKELY_BENIGN'; label = 'Likely Benign'; color = '#10B981'; bgClass = 'path-benign'; shortLabel = 'LB'; }
  else { level = 'BENIGN'; label = 'Benign'; color = '#6EE7B7'; bgClass = 'path-benign'; shortLabel = 'B'; }

  return {
    level, label, color, bgClass, score: pct, reasons, shortLabel, acmgCriteria, componentScores,
    sift, polyphen, conservation: conserv, cosmic: cosData, clinvar: cvData
  };
};

const MAX_SEQ_LENGTH = 5000;
const normalizeSequence = raw => { let s = raw.replace(/^>.*$/gm, ''); let out = ''; for (let i = 0; i < s.length; i++) { const c = s[i]; if (c !== ' ' && c !== '\n' && c !== '\r' && c !== '\t') out += c; } return out.toUpperCase(); };
const findFirstDifference = (a, b) => { for (let i = 0; i < Math.min(a.length, b.length); i++) { if (a[i] !== b[i]) return i; } return -1; };

const detectMutations = (ref, alt, frame, strand) => {
  let seq1 = normalizeSequence(ref); let seq2 = normalizeSequence(alt);
  if (seq1.length > MAX_SEQ_LENGTH || seq2.length > MAX_SEQ_LENGTH) throw new Error(`Sequence too long (max ${MAX_SEQ_LENGTH.toLocaleString()} bp).`);
  if (strand === 'reverse') { seq1 = revComp(seq1); seq2 = revComp(seq2); }
  const lengthDiff = seq2.length - seq1.length; const mutations = []; const warnings = [];
  const offset = parseInt(frame) - 1;
  if (seq1.length % 3 !== 0) warnings.push('Reference sequence length not divisible by 3');
  if (lengthDiff !== 0 && Math.abs(lengthDiff) % 3 !== 0) warnings.push('Length difference suggests frameshift mutation');
  if (lengthDiff === 0) {
    for (let i = 0; i < seq1.length; i++) {
      if (seq1[i] !== seq2[i]) {
        const codonIndex = Math.floor((i - offset) / 3); const codonStart = codonIndex * 3 + offset;
        if (codonStart >= 0 && codonStart + 3 <= seq1.length) {
          const refCodon = seq1.substring(codonStart, codonStart + 3); const altCodon = seq2.substring(codonStart, codonStart + 3);
          if (refCodon.length === 3 && altCodon.length === 3) {
            const refAA = translateCodon(refCodon); const altAA = translateCodon(altCodon);
            let mutClass = 'Missense'; if (refAA === altAA) mutClass = 'Silent'; else if (altAA === '*') mutClass = 'Nonsense';
            if (!mutations.some(m => m.codon_position === codonStart)) {
              mutations.push({ type: 'SNP', position: i, codon_position: codonStart, reference: seq1[i], alternate: seq2[i], reference_codon: refCodon, alternate_codon: altCodon, reference_amino_acid: refAA, alternate_amino_acid: altAA, mutation_class: mutClass });
            }
          }
        }
      }
    }
  } else {
    let pLen = 0; const minLen = Math.min(seq1.length, seq2.length);
    while (pLen < minLen && seq1[pLen] === seq2[pLen]) pLen++;
    let e1 = seq1.length - 1, e2 = seq2.length - 1;
    while (e1 > pLen && e2 > pLen && seq1[e1] === seq2[e2]) { e1--; e2--; }
    const middle1 = seq1.slice(pLen, e1 + 1); const middle2 = seq2.slice(pLen, e2 + 1);
    if (middle1.length === 0) {
      const isFS = middle2.length % 3 !== 0;
      mutations.push({ type: 'Insertion', position: pLen, codon_position: pLen, inserted_sequence: middle2, length: middle2.length, is_frameshift: isFS, mutation_class: isFS ? 'Frameshift' : 'In-frame Insertion', reference_codon: '---', alternate_codon: middle2.substring(0, 3) });
    } else if (middle2.length === 0) {
      const isFS = middle1.length % 3 !== 0;
      mutations.push({ type: 'Deletion', position: pLen, codon_position: pLen, deleted_sequence: middle1, length: middle1.length, is_frameshift: isFS, mutation_class: isFS ? 'Frameshift' : 'In-frame Deletion', reference_codon: middle1.substring(0, 3), alternate_codon: '---' });
    } else {
      const netDiff = middle2.length - middle1.length;
      if (netDiff > 0) {
        const isFS = netDiff % 3 !== 0;
        mutations.push({ type: 'Insertion', position: pLen, codon_position: pLen, inserted_sequence: middle2, length: netDiff, is_frameshift: isFS, mutation_class: isFS ? 'Frameshift' : 'In-frame Insertion', reference_codon: middle1.substring(0, 3), alternate_codon: middle2.substring(0, 3) });
      } else {
        const isFS = Math.abs(netDiff) % 3 !== 0;
        mutations.push({ type: 'Deletion', position: pLen, codon_position: pLen, deleted_sequence: middle1, length: Math.abs(netDiff), is_frameshift: isFS, mutation_class: isFS ? 'Frameshift' : 'In-frame Deletion', reference_codon: middle1.substring(0, 3), alternate_codon: middle2.substring(0, 3) });
      }
    }
  }
  const summary = { total_mutations: mutations.length, snps: mutations.filter(m => m.type === 'SNP').length, insertions: mutations.filter(m => m.type === 'Insertion').length, deletions: mutations.filter(m => m.type === 'Deletion').length, frameshift_mutations: mutations.filter(m => m.is_frameshift).length, silent_mutations: mutations.filter(m => m.mutation_class === 'Silent').length, missense_mutations: mutations.filter(m => m.mutation_class === 'Missense').length, nonsense_mutations: mutations.filter(m => m.mutation_class === 'Nonsense').length };
  return { mutations, summary, warnings, sequences: { reference: seq1, alternate: seq2, reference_length: seq1.length, alternate_length: seq2.length, length_difference: lengthDiff, reading_frame: frame, strand } };
};

const generatePDF = (analysisData, annotatedMutations, analysisParams, vcfMeta, geneKeyOrObj = 'TP53') => {
  const gene = typeof geneKeyOrObj === 'string' ? (GENE_PANEL[geneKeyOrObj] || GENE_PANEL.TP53) : geneKeyOrObj;
  const isCancerGene = typeof geneKeyOrObj === 'string' && GENE_PANEL[geneKeyOrObj];
  const timestamp = new Date().toLocaleString();
  const date = new Date().toISOString().split('T')[0];
  const W = 80;
  let pdf = '';
  pdf += '='.repeat(W) + '\n';
  pdf += isCancerGene ? `  ${gene.symbol} CLINICAL MUTATION ANALYSIS REPORT\n` : `  DNA MUTATION ANALYSIS REPORT\n`;
  pdf += `  Multi-Source Interpretation Pipeline v2.0\n`;
  pdf += '='.repeat(W) + '\n\n';
  pdf += `Gene:            ${gene.symbol} — ${gene.name}\n`;
  pdf += `Transcript:      ${gene.id}\n`;
  pdf += `Chromosome:      ${gene.chromosome}\n`;
  pdf += `Protein Length:  ${gene.proteinLength} amino acids\n`;
  pdf += `Analysis Date:   ${timestamp}\n`;
  pdf += `Pipeline:        BLOSUM62 SIFT-like + PolyPhen-like + COSMIC + ClinVar + Conservation\n\n`;
  pdf += 'MUTATION SUMMARY\n' + '-'.repeat(W) + '\n';
  pdf += `Total variants:     ${analysisData.summary.total_mutations}\n`;
  pdf += `SNPs:               ${analysisData.summary.snps}\n`;
  pdf += `Missense:           ${analysisData.summary.missense_mutations}\n`;
  pdf += `Nonsense:           ${analysisData.summary.nonsense_mutations}\n`;
  pdf += `Frameshift:         ${analysisData.summary.frameshift_mutations}\n`;
  pdf += `Silent (synonymous):${analysisData.summary.silent_mutations}\n\n`;
  if (annotatedMutations?.length > 0) {
    pdf += 'INDIVIDUAL MUTATION ANALYSIS\n' + '='.repeat(W) + '\n';
    annotatedMutations.forEach((am, idx) => {
      const path = am.pathogenicity || { label: 'Unknown', score: 0, shortLabel: '?', acmgCriteria: [], reasons: [] };
      pdf += `\nMutation ${idx + 1}: ${am.hgvs}\n`;
      pdf += '-'.repeat(60) + '\n';
      pdf += `Type:             ${am.mutation.type} (${am.mutation.mutation_class})\n`;
      pdf += `Position:         AA ${am.positions.aaPosition} (nucleotide ${am.positions.nucleotidePosition})\n`;
      pdf += `Domain:           ${am.domainMapping.proteinDomain} (${am.domainMapping.functionalRegion})\n`;
      if (am.mutation.reference_amino_acid && am.mutation.alternate_amino_acid) {
        pdf += `AA Substitution:  ${am.mutation.reference_amino_acid} (${AA_PROPERTIES?.[am.mutation.reference_amino_acid]?.name || am.mutation.reference_amino_acid}) → ${am.mutation.alternate_amino_acid} (${AA_PROPERTIES?.[am.mutation.alternate_amino_acid]?.name || am.mutation.alternate_amino_acid})\n`;
        pdf += `Codons:           ${am.mutation.reference_codon} → ${am.mutation.alternate_codon}\n`;
      }
      pdf += '\nIN SILICO PREDICTIONS\n';
      if (am.sift) pdf += `  SIFT-like:        ${am.sift.label} (score ${am.sift.score}, BLOSUM62: ${am.sift.blosum62})\n`;
      if (am.polyphen) pdf += `  PolyPhen-like:    ${am.polyphen.label} (score ${am.polyphen.score})\n`;
      if (am.conservation) pdf += `  Conservation:     ${am.conservation.label} (score ${am.conservation.score})\n`;
      pdf += '\nDATABASE EVIDENCE\n';
      const cv = am.clinvarLive || am.clinvar;
      if (cv) {
        pdf += `  ClinVar:          ${cv.sig} | ${cv.accession}\n`;
        pdf += `  Condition:        ${cv.condition}\n`;
        pdf += `  Review Status:    ${cv.review}\n`;
        if (cv.live) pdf += `  [Source: Live NCBI query]\n`;
      } else { pdf += `  ClinVar:          Not found in local catalogue\n`; }
      if (am.cosmic) {
        pdf += `  COSMIC:           ${(am.cosmic.freq * 100).toFixed(1)}% frequency, ${am.cosmic.samples.toLocaleString()} samples (${am.cosmic.cosmic_id})\n`;
        pdf += `  Tissues:          ${am.cosmic.tissues.join(', ')}\n`;
      } else { pdf += `  COSMIC:           Not in hotspot catalogue\n`; }
      pdf += '\nPATHOGENICITY ASSESSMENT\n';
      pdf += `  Classification:   ${path.label} [${path.shortLabel}]\n`;
      pdf += `  Weighted Score:   ${path.score}/100\n`;
      if (path.acmgCriteria?.length > 0) pdf += `  ACMG Criteria:    ${path.acmgCriteria.join(', ')}\n`;
      if (path.componentScores) {
        pdf += `  Score Components: Domain ${(path.componentScores.domainImpact * 100).toFixed(0)}% | MutType ${(path.componentScores.mutationType * 100).toFixed(0)}% | ClinVar ${(path.componentScores.clinvar * 100).toFixed(0)}% | COSMIC ${(path.componentScores.cosmic * 100).toFixed(0)}% | Conserv ${(path.componentScores.conservation * 100).toFixed(0)}% | Struct ${(path.componentScores.structural * 100).toFixed(0)}%\n`;
      }
      pdf += '\nEVIDENCE TRAIL\n';
      path.reasons?.forEach(r => { pdf += `  · ${r}\n`; });
      pdf += '\nBIOLOGICAL INTERPRETATION\n';
      pdf += `  ${am.interpretation.scientificNote}\n`;
    });
  }
  pdf += '\n' + '='.repeat(W) + '\n';
  pdf += `DISCLAIMER\n${'-'.repeat(W)}\n`;
  pdf += `This report is for research and educational purposes only. It does not constitute\n`;
  pdf += `clinical medical advice or diagnosis. All variants require clinical validation in a\n`;
  pdf += `certified laboratory. Consult a clinical geneticist or molecular oncologist for\n`;
  pdf += `patient care decisions. ClinVar data sourced from NCBI. COSMIC data from Wellcome\n`;
  pdf += `Sanger Institute. Structural data from PDB (${gene.pdb?.id}).\n`;
  pdf += '='.repeat(W) + '\n';
  const blob = new Blob([pdf], { type: 'text/plain;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `${gene.symbol}_Clinical_Report_${date}.txt`;
  document.body.appendChild(link); link.click();
  document.body.removeChild(link); window.URL.revokeObjectURL(url);
  return true;
};

/* ═══════════════════════════════════════════════════════════════════════════
   MOLECULAR CPK PANEL COMPONENT (always-visible ball-and-stick)
   ═══════════════════════════════════════════════════════════════════════════ */
function MolecularDetailPanel({ domain, gene, color }) {
  const svgRef = useRef(null);
  if (!domain) return null;

  const rng = (s) => { let x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  // Representative amino acids for the domain based on domain type
  const AA_SEQ = ['G', 'A', 'V', 'L', 'I', 'P', 'F', 'W', 'M', 'S', 'T', 'C', 'Y', 'H', 'D', 'E', 'N', 'Q', 'K', 'R'];
  const CPK = { C: '#22d3ee', N: '#3b82f6', O: '#ef4444', S: '#fbbf24', CA: '#06b6d4', H: '#e2e8f0' };

  // Show more residues for a denser, more realistic diagram
  const domLen = Math.min(domain.end - domain.start + 1, 32);
  const W = 680, H = 280;
  const padX = 32, padY = 24;
  const startX = padX, endX = W - padX;
  const baseY = H / 2 + 10;
  const step = (endX - startX) / Math.max(domLen - 1, 1);
  const ssType = domain.functionalRegion === 'Critical' ? 'helix' :
    domain.functionalRegion === 'Structural' ? 'sheet' : 'loop';

  const atoms = [], bonds = [], hbonds = [];
  const caPositions = [];

  for (let i = 0; i < domLen; i++) {
    const aa = AA_SEQ[(domain.start + i) % AA_SEQ.length];
    const cx = startX + i * step;
    let cy;
    if (ssType === 'helix') cy = baseY + Math.sin(i * 0.95) * 32;
    else if (ssType === 'sheet') cy = baseY + (i % 2 === 0 ? -22 : 22);
    else cy = baseY + Math.sin(i * 0.6) * 18 + (rng(i * 3.7) - 0.5) * 9;
    caPositions.push({ x: cx, y: cy });

    const caIdx = atoms.length;
    atoms.push({ x: cx, y: cy, elem: 'CA', label: `${aa}${domain.start + i}`, r: 7.5, col: CPK.CA });

    // Backbone amide N — between this Cα and previous
    if (i > 0) {
      const prevCa = caPositions[i - 1];
      const nIdx = atoms.length;
      atoms.push({ x: (cx + prevCa.x) / 2, y: cy - 14, elem: 'N', label: 'N', r: 5.5, col: CPK.N });
      bonds.push({ a: caIdx, b: nIdx, sc: false });
      bonds.push({ a: nIdx, b: caIdx - 1 - (atoms.length - caIdx - 1), sc: false, prevCaIdx: caIdx - 1 });
    }

    // Carbonyl C=O — between this and next Cα
    if (i < domLen - 1) {
      const cIdx = atoms.length;
      atoms.push({ x: cx + step * 0.38, y: cy + 12, elem: 'C', label: "C'", r: 5, col: CPK.C });
      bonds.push({ a: caIdx, b: cIdx, sc: false });
      const oIdx = atoms.length;
      // Carbonyl O slightly offset (double-bond implied)
      atoms.push({ x: cx + step * 0.38 + (rng(i * 7.1) - 0.5) * 6, y: cy + 26, elem: 'O', label: 'O', r: 5, col: CPK.O });
      bonds.push({ a: cIdx, b: oIdx, sc: false });
    }

    // Side chain Cβ
    const scDir = i % 2 === 0 ? -1 : 1;
    const scLen = 18 + rng(i * 5.7) * 15;
    const scAngle = scDir * (0.9 + rng(i * 3.3) * 0.6);
    const sc1x = cx + Math.sin(scAngle) * scLen;
    const sc1y = cy - Math.cos(scAngle) * scLen;
    const scElem = ['C', 'N', 'O', 'S', 'C', 'O', 'N', 'C', 'S', 'C', 'N', 'O', 'C', 'C', 'N', 'O', 'S', 'C', 'C', 'O', 'N', 'C', 'S', 'C'][i % 24];
    const sc1Idx = atoms.length;
    atoms.push({ x: sc1x, y: sc1y, elem: scElem, label: aa, r: 4.5, col: CPK[scElem] || CPK.C });
    bonds.push({ a: caIdx, b: sc1Idx, sc: true });

    // Cγ/Cδ for longer side chains (Arg, Lys, Glu, Gln, etc.)
    if (['R', 'K', 'E', 'Q', 'N', 'D', 'H', 'W', 'Y', 'F', 'M', 'I', 'L'].includes(aa)) {
      const sc2x = sc1x + Math.sin(scAngle + 0.6) * 12;
      const sc2y = sc1y - Math.cos(scAngle + 0.6) * 12;
      const sc2Elem = ['N', 'O', 'O', 'N', 'O', 'C', 'N', 'C', 'S', 'O'][i % 10];
      const sc2Idx = atoms.length;
      atoms.push({ x: sc2x, y: sc2y, elem: sc2Elem, label: sc2Elem, r: 4, col: CPK[sc2Elem] || CPK.C });
      bonds.push({ a: sc1Idx, b: sc2Idx, sc: true });
    }

    // H-bonds: α-helix i→i+4, β-sheet i→i+2
    if (ssType === 'helix' && i + 4 < domLen) {
      hbonds.push({ x1: cx, y1: cy - 8, x2: startX + (i + 4) * step, y2: (caPositions[i + 4]?.y ?? baseY) - 8 });
    } else if (ssType === 'sheet' && i + 2 < domLen && i % 2 === 0) {
      hbonds.push({ x1: cx, y1: cy, x2: startX + (i + 2) * step, y2: caPositions[i + 2]?.y ?? baseY });
    }
  }

  const cpkLegend = [
    { col: '#06b6d4', label: 'Cα (backbone)' }, { col: '#3b82f6', label: 'N (amide)' },
    { col: '#ef4444', label: 'O (carbonyl)' }, { col: '#22d3ee', label: "C'" }, { col: '#fbbf24', label: 'S' },
  ];
  const gradIds = { 'CA': 'mdgCA', 'N': 'mdgN', 'O': 'mdgO', 'C': 'mdgC', 'S': 'mdgS' };
  const gradCols = { 'CA': '#06b6d4', 'N': '#3b82f6', 'O': '#ef4444', 'C': '#22d3ee', 'S': '#fbbf24' };

  return (
    <div style={{ background: 'linear-gradient(180deg, #040610 0%, #060a14 100%)', border: '1px solid #152540', borderRadius: 12, overflow: 'hidden', marginBottom: '1rem', boxShadow: '0 4px 24px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.02)' }}>
      <div style={{ padding: '.55rem .9rem', background: 'rgba(6,182,212,.07)', borderBottom: '1px solid #152540', display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '.8rem', fontWeight: 700, color: '#67e8f9', textTransform: 'uppercase', letterSpacing: '.07em' }}>
          CPK Ball-and-Stick · {domain.name}
        </span>
        <span style={{ fontSize: '.68rem', color: '#2a3a50', fontFamily: '"JetBrains Mono",monospace' }}>
          AA {domain.start}–{Math.min(domain.start + domLen - 1, domain.end)} · {ssType === 'helix' ? 'α-helix backbone' : ssType === 'sheet' ? 'β-strand ladder' : 'loop/coil'} · dashed = H-bonds
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '.45rem', flexWrap: 'wrap' }}>
          {cpkLegend.map((l, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '.2rem' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: l.col, boxShadow: `0 0 5px ${l.col}` }}></div>
              <span style={{ fontSize: '.62rem', color: '#6b7080' }}>{l.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ overflowX: 'auto', background: '#020407' }}>
        <svg ref={svgRef} width={W} height={H} style={{ display: 'block', minWidth: W }}>
          <defs>
            {/* Radial gradients for sphere-like atom appearance */}
            {Object.entries(gradCols).map(([k, c]) => (
              <radialGradient key={k} id={gradIds[k]} cx="30%" cy="28%" r="65%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
                <stop offset="40%" stopColor={c} stopOpacity="1" />
                <stop offset="100%" stopColor={c} stopOpacity="0.55" />
              </radialGradient>
            ))}
            {/* Default gradient for other elements */}
            <radialGradient id="mdgDef" cx="30%" cy="28%" r="65%">
              <stop offset="0%" stopColor="#fff" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.6" />
            </radialGradient>
          </defs>

          {/* Background grid (reference style) */}
          {Array.from({ length: 8 }).map((_, i) => (
            <line key={`g${i}`} x1={0} y1={i * (H / 7)} x2={W} y2={i * (H / 7)} stroke="#0c1020" strokeWidth="0.5" />
          ))}

          {/* Backbone ribbon trace */}
          <polyline points={caPositions.map(p => `${p.x},${p.y}`).join(' ')}
            fill="none" stroke={`#${color || '06b6d4'}`} strokeWidth="3.5" opacity="0.25"
            strokeLinejoin="round" strokeLinecap="round" />

          {/* H-bonds (dashed blue, PyMOL/Chimera style) */}
          {hbonds.map((hb, i) => (
            <line key={`hb${i}`} x1={hb.x1} y1={hb.y1} x2={hb.x2} y2={hb.y2}
              stroke="#38bdf8" strokeWidth="1.3" strokeDasharray="5,3.5" opacity="0.6" />
          ))}

          {/* Covalent bonds */}
          {bonds.map((b, i) => {
            const a1 = atoms[b.a];
            const a2 = b.prevCaIdx !== undefined ? atoms[b.prevCaIdx] : atoms[b.b];
            if (!a1 || !a2) return null;
            return <line key={`b${i}`} x1={a1.x} y1={a1.y} x2={a2.x} y2={a2.y}
              stroke={b.sc ? '#0f1e30' : '#1a3558'} strokeWidth={b.sc ? 1.2 : 1.8} opacity={b.sc ? 0.6 : 0.85} />;
          })}

          {/* Atom spheres with lighting gradients */}
          {atoms.map((a, i) => {
            const gId = gradIds[a.elem] || 'mdgDef';
            const glow = a.elem === 'CA' ? 0.25 : a.elem === 'O' ? 0.2 : 0.12;
            return (
              <g key={`a${i}`}>
                {/* Outer glow */}
                <circle cx={a.x} cy={a.y} r={a.r + 3.5} fill={a.col} opacity={glow} />
                {/* Atom sphere with gradient */}
                <circle cx={a.x} cy={a.y} r={a.r} fill={`url(#${gId})`} stroke={a.col} strokeWidth="0.5" />
                {/* Residue label above Cα atoms */}
                {a.elem === 'CA' && (
                  <text x={a.x} y={a.y - a.r - 4} textAnchor="middle" fontSize="6.5"
                    fill={a.col} fontFamily='"JetBrains Mono",monospace' fontWeight="600" opacity="0.85">
                    {a.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* SS type label */}
          <text x={6} y={H - 6} textAnchor="start" fontSize="8" fill="#0e1a2e"
            fontFamily='"JetBrains Mono",monospace' fontWeight="600">
            {ssType === 'helix' ? 'α-HELIX' : ssType === 'sheet' ? 'β-STRAND' : 'LOOP/COIL'} · CPK colours · H-bonds dashed
          </text>
          <text x={W - 6} y={H - 6} textAnchor="end" fontSize="8" fill="#0e1a2e"
            fontFamily='"JetBrains Mono",monospace'>
            {gene.symbol} · {domain.name}
          </text>
        </svg>
      </div>
      {domain.detail && (
        <div style={{ padding: '.6rem .9rem', borderTop: '1px solid #0f1620', background: '#030508', display: 'flex', gap: '.5rem', alignItems: 'flex-start' }}>
          <span style={{ fontSize: '.78rem', color: '#2a4060', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', flexShrink: 0, marginTop: '.05rem' }}>Key residues:</span>
          <span style={{ fontSize: '.78rem', color: '#3a5a80', fontFamily: '"JetBrains Mono",monospace', lineHeight: 1.65 }}>{domain.detail}</span>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   3D MOLECULAR VIEWER — FULLY CONNECTED RIBBON + CPK ATOMS + ZOOM-TO-DOMAIN
   ═══════════════════════════════════════════════════════════════════════════ */
function StructureViewer({ gene, showRCSB, setShowRCSB, mutPins }) {
  const containerRef = useRef(null);
  const frameRef = useRef(null);
  const sceneRef = useRef({});        // ← was sceneStateRef, now properly declared
  const [clickedDomain, setClickedDomain] = useState(null);
  const [isSpinning, setIsSpinning] = useState(true);
  const [tooltip, setTooltip] = useState(null);
  const [viewMode, setViewMode] = useState('ribbon'); // 'ribbon'|'ballstick'|'cpk'

  // ─── CONTINUOUS BACKBONE BUILDER v3 ───────────────────────────────────────
  // ROOT FIX: The chain CENTER advances through 3D space — helices/sheets coil
  // AROUND a moving center rather than returning to zero. No more isolated blobs.
  const buildBackbone = useCallback((gene) => {
    const SS_DEFS = {
      TP53: [
        { t: 'loop', s: 1, e: 30 }, { t: 'helix', s: 30, e: 55, turns: 2.5 },
        { t: 'loop', s: 55, e: 93 }, { t: 'sheet', s: 102, e: 125 },
        { t: 'loop', s: 125, e: 140 }, { t: 'sheet', s: 140, e: 162 },
        { t: 'loop', s: 162, e: 175 }, { t: 'helix', s: 175, e: 200, turns: 3 },
        { t: 'loop', s: 200, e: 220 }, { t: 'sheet', s: 220, e: 240 },
        { t: 'loop', s: 240, e: 255 }, { t: 'sheet', s: 255, e: 275 },
        { t: 'loop', s: 275, e: 292 }, { t: 'loop', s: 292, e: 320 },
        { t: 'helix', s: 320, e: 356, turns: 3.5 }, { t: 'loop', s: 356, e: 370 },
        { t: 'helix', s: 370, e: 393, turns: 2 },
      ],
      KRAS: [
        { t: 'loop', s: 1, e: 10 }, { t: 'helix', s: 10, e: 18, turns: 1.5 },
        { t: 'sheet', s: 18, e: 30 }, { t: 'loop', s: 30, e: 42 },
        { t: 'sheet', s: 42, e: 57 }, { t: 'loop', s: 57, e: 76 },
        { t: 'helix', s: 76, e: 93, turns: 2.5 }, { t: 'sheet', s: 93, e: 116 },
        { t: 'loop', s: 116, e: 130 }, { t: 'helix', s: 130, e: 155, turns: 3 },
        { t: 'sheet', s: 155, e: 167 }, { t: 'loop', s: 167, e: 189 },
      ],
      BRCA1: [
        { t: 'helix', s: 1, e: 45, turns: 3 }, { t: 'loop', s: 45, e: 109 },
        { t: 'loop', s: 109, e: 500 }, { t: 'loop', s: 500, e: 900 },
        { t: 'loop', s: 900, e: 1364 }, { t: 'helix', s: 1364, e: 1437, turns: 6 },
        { t: 'loop', s: 1437, e: 1642 }, { t: 'helix', s: 1642, e: 1680, turns: 3 },
        { t: 'sheet', s: 1680, e: 1710 }, { t: 'helix', s: 1710, e: 1736, turns: 2.5 },
        { t: 'loop', s: 1736, e: 1756 }, { t: 'helix', s: 1756, e: 1800, turns: 4 },
        { t: 'sheet', s: 1800, e: 1830 }, { t: 'helix', s: 1830, e: 1863, turns: 2.5 },
      ],
      EGFR: [
        { t: 'loop', s: 1, e: 100 }, { t: 'helix', s: 100, e: 180, turns: 5 },
        { t: 'loop', s: 180, e: 360 }, { t: 'helix', s: 360, e: 480, turns: 7 },
        { t: 'loop', s: 480, e: 646 }, { t: 'loop', s: 646, e: 712 },
        { t: 'sheet', s: 712, e: 735 }, { t: 'loop', s: 735, e: 756 },
        { t: 'helix', s: 756, e: 790, turns: 3 }, { t: 'loop', s: 790, e: 835 },
        { t: 'sheet', s: 835, e: 858 }, { t: 'loop', s: 858, e: 870 },
        { t: 'helix', s: 870, e: 940, turns: 5 }, { t: 'sheet', s: 940, e: 960 },
        { t: 'helix', s: 960, e: 979, turns: 2 }, { t: 'loop', s: 979, e: 1100 },
        { t: 'helix', s: 1100, e: 1180, turns: 5 }, { t: 'loop', s: 1180, e: 1210 },
      ],
    };
    const rng = seed => { let x = Math.sin(seed + 1.9) * 43758.5453; return x - Math.floor(x); };
    const defs = (SS_DEFS[gene.symbol] || SS_DEFS.TP53).map(d => ({
      ...d, domain: gene.domains.find(dom => ((d.s + d.e) / 2) >= dom.start && ((d.s + d.e) / 2) <= dom.end) || null,
    }));
    const total = gene.proteinLength;
    const toX = aa => ((aa - 1) / (total - 1)) * 120 - 60;

    /* ── v3: chain CENTER advances continuously through 3D space ──────────
       Each segment shifts cY/cZ by a random delta → no more "collapsing to
       same point" at boundaries.  Helix/sheet coils AROUND the moving center.
       ──────────────────────────────────────────────────────────────────── */
    const pts = [];
    let cY = 0, cZ = 0;
    defs.forEach((seg, si) => {
      const len = seg.e - seg.s;
      const steps = Math.max(seg.t === 'helix' ? len * 4 : len * 2, 16);
      // Where does this segment's CENTER drift to?
      const dY = (rng(si * 17.3 + 1) - 0.5) * (seg.t === 'loop' ? 11 : 6);
      const dZ = (rng(si * 17.3 + 5) - 0.5) * (seg.t === 'loop' ? 8 : 4);
      const eCY = Math.max(-18, Math.min(18, cY + dY));
      const eCZ = Math.max(-18, Math.min(18, cZ + dZ));
      const entryCY = cY, entryCZ = cZ;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const aa = seg.s + t * len;
        const x = toX(aa);
        // Smoothstep interpolation of center position
        const sm = t * t * (3 - 2 * t);
        const centY = entryCY + (eCY - entryCY) * sm;
        const centZ = entryCZ + (eCZ - entryCZ) * sm;
        let y, z;
        if (seg.t === 'helix') {
          // Short fade at tips (5%) so the join is smooth, not a spike
          const env = Math.min(1, Math.min(t / 0.05, (1 - t) / 0.05));
          const angle = t * Math.PI * 2 * (seg.turns || 2);
          y = centY + Math.sin(angle) * 5.5 * env;
          z = centZ + Math.cos(angle) * 3.5 * env;
        } else if (seg.t === 'sheet') {
          const env = Math.min(1, Math.min(t / 0.05, (1 - t) / 0.05));
          y = centY + Math.sin(t * Math.PI * 3) * 4.5 * env;
          z = centZ + Math.cos(t * Math.PI * 2) * 2.5 * env;
        } else {
          // Loop: follow center with small wobble
          const wY = (rng(si * 997 + k * 7.1) - 0.5) * 1.2;
          const wZ = (rng(si * 997 + k * 3.9) - 0.5) * 1.2;
          y = centY + wY; z = centZ + wZ;
        }
        if (k === 0 && pts.length > 0) continue;
        pts.push({ aa, x, y, z, ss: seg.t, domain: seg.domain, segIdx: si });
      }
      cY = eCY; cZ = eCZ;
    });
    return { pts, defs };
  }, []);

  /* ── 3D Viewer Init useEffect ─────────────────────────────────────── */
  useEffect(() => {
    if (!showRCSB) return;
    const container = containerRef.current;
    if (!container) return;
    const W = container.offsetWidth || 820;

    const timer = setTimeout(() => {
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || W < 600;
      const H = isMobile ? 380 : 480;

      const launch = () => {
        const THREE = window.THREE;

        /* ── Renderer ── */
        const renderer = new THREE.WebGLRenderer({
          antialias: false, alpha: false,
          powerPreference: isMobile ? 'low-power' : 'high-performance'
        });
        renderer.setSize(W, H);
        // Mobile: cap pixel ratio at 1.0 to prevent GPU overload & lag
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.0 : 2));
        renderer.setClearColor(0x04060f, 1);
        renderer.shadowMap.enabled = false;
        container.innerHTML = '';
        container.appendChild(renderer.domElement);
        Object.assign(renderer.domElement.style, { width: '100%', height: H + 'px', display: 'block', touchAction: 'none' });

        /* ── Scene & Camera ── */
        const scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x04060f, 0.004);
        const camera = new THREE.PerspectiveCamera(isMobile ? 48 : 38, W / H, 0.1, 2000);
        camera.position.set(0, isMobile ? 18 : 12, isMobile ? 170 : 145);
        camera.lookAt(0, 0, 0);

        /* ── Lights — enhanced for deep molecular look ── */
        scene.add(new THREE.AmbientLight(0xffffff, 0.35));
        const key = new THREE.DirectionalLight(0x67e8f9, 4.0); key.position.set(60, 90, 70); scene.add(key);
        const fill = new THREE.DirectionalLight(0xa78bfa, 2.2); fill.position.set(-70, -40, -50); scene.add(fill);
        const back = new THREE.DirectionalLight(0xfbbf24, 1.5); back.position.set(0, -70, -90); scene.add(back);
        const rim = new THREE.DirectionalLight(0xffffff, 0.9); rim.position.set(0, 110, -110); scene.add(rim);
        const topWash = new THREE.DirectionalLight(0x818cf8, 0.6); topWash.position.set(-30, 120, 40); scene.add(topWash);
        const selLight = new THREE.PointLight(0xffffff, 0, 60); scene.add(selLight);
        /* Hemisphere light for ambient depth */
        const hemiLight = new THREE.HemisphereLight(0x67e8f9, 0x1a1d2a, 0.3); scene.add(hemiLight);

        /* ── Build backbone ── */
        const { pts: allPts, defs: bbDefs } = buildBackbone(gene);
        // On mobile subsample to ~half
        const pts = isMobile ? allPts.filter((_, i) => i % 2 === 0 || i === allPts.length - 1) : allPts;

        /* ── Color helpers ── */
        const DOMAIN_COLS = { Critical: [0x06b6d4, 0x22d3ee, 0x0891b2], Structural: [0x8b5cf6, 0xa78bfa, 0x7c3aed], Regulatory: [0x10b981, 0x34d399, 0x059669] };
        const LOOP_COL = 0x1a2535;
        const domainAt = aa => gene.domains.find(d => aa >= d.start && aa <= d.end) || null;
        const colOf = aa => {
          const d = domainAt(aa); if (!d) return LOOP_COL;
          const pal = DOMAIN_COLS[d.functionalRegion] || DOMAIN_COLS.Critical;
          const idx = gene.domains.filter(x => x.functionalRegion === d.functionalRegion).indexOf(d);
          return pal[Math.max(0, idx) % pal.length];
        };

        /* ── Geometry helpers ── */
        const makeTube = (vpts, r, col, emiss = 0.18, opacity = 1, shine = 140) => {
          if (vpts.length < 2) return null;
          const curve = new THREE.CatmullRomCurve3(vpts, false, 'catmullrom', 0.5);
          // Mobile: fewer path segments AND radial segments (4 vs 12) for huge perf gain
          const segs = Math.max(vpts.length * (isMobile ? 1 : 5), isMobile ? 4 : 24);
          const geo = new THREE.TubeGeometry(curve, segs, r, isMobile ? 4 : 12, false);
          const mat = new THREE.MeshPhongMaterial({ color: col, emissive: col, emissiveIntensity: emiss, shininess: shine, specular: 0x4488aa, transparent: opacity < 1, opacity });
          return new THREE.Mesh(geo, mat);
        };

        /* ── Groups ── */
        const root = new THREE.Group(); root.rotation.x = 0.15; scene.add(root);
        const ribbonGrp = new THREE.Group(); root.add(ribbonGrp);
        const atomGrp = new THREE.Group(); root.add(atomGrp); atomGrp.visible = false;
        const pinGrp = new THREE.Group(); root.add(pinGrp);

        /* ─────────────────────────────────────────────────────────────────
           RIBBON — split pts by segIdx, share boundary points for seamless join
           ───────────────────────────────────────────────────────────────── */
        const clickableMeshes = []; // {mesh,midAA,domain,ssType,isLinker}
        let segStart = 0;
        for (let i = 1; i <= pts.length; i++) {
          const isLast = (i === pts.length);
          if (isLast || (pts[i].segIdx !== pts[i - 1].segIdx)) {
            // include one extra point across boundary → no gap
            const slice = pts.slice(segStart, isLast ? i : Math.min(i + 1, pts.length));
            if (slice.length >= 2) {
              const mid = slice[Math.floor(slice.length / 2)];
              const ssType = mid.ss;
              const domain = mid.domain;
              const midAA = (slice[0].aa + slice[slice.length - 1].aa) / 2;
              const col = colOf(midAA);
              const isLnk = col === LOOP_COL;
              const vpts = slice.map(p => new THREE.Vector3(p.x, p.y, p.z));

              let r = 0.4, emiss = 0.0, op = 0.6, shine = 80;
              if (ssType === 'helix') { r = isMobile ? 2.1 : 2.0; emiss = 0.28; op = 1.0; shine = 200; }
              else if (ssType === 'sheet') { r = isMobile ? 1.8 : 1.6; emiss = 0.24; op = 1.0; shine = 180; }

              const tube = makeTube(vpts, isLnk ? Math.min(r, 0.42) : r, col, isLnk ? 0 : emiss, op, shine);
              if (tube) {
                tube.userData = { ssType, midAA, domain, segIdx: pts[i - 1].segIdx, isLinker: isLnk };
                ribbonGrp.add(tube);
                // Subtle glow for non-linker, desktop only
                if (!isLnk && !isMobile) {
                  const glow = makeTube(vpts, r * 2.2, col, 0, 0.04);
                  if (glow) { glow.material.depthWrite = false; glow.userData = { isGlow: true }; ribbonGrp.add(glow); }
                }
                if (!isLnk) clickableMeshes.push({ mesh: tube, midAA, domain, ssType, isLinker: isLnk });
              }
            }
            segStart = i;
          }
        }

        /* ─────────────────────────────────────────────────────────────────
           BALL-AND-STICK / CPK ATOMS
           Standard CPK colours:
             C  = #2dd4bf (teal-green, distinct from white backbone)
             N  = #3b82f6 (blue)
             O  = #ef4444 (red)
             S  = #fbbf24 (yellow)
             H  = #e2e8f0 (white-ish, only on surface H-donors)
             Cα = #22d3ee (bright cyan — backbone alpha carbon)
           Atoms are placed along the sampled backbone with realistic offsets.
           Bonds are thin cylinder stubs (not TubeGeometry — cheaper).
           ───────────────────────────────────────────────────────────────── */
        const CPK = { CA: 0x22d3ee, C: 0x2dd4bf, N: 0x3b82f6, O: 0xef4444, S: 0xfbbf24, H: 0xe2e8f0 };
        const sCache = {};
        // Mobile: very low sphere detail (4 segments) — still looks spherical at small sizes
        const sphereGeo = r => { const k = r.toFixed(2); if (!sCache[k]) sCache[k] = new THREE.SphereGeometry(r, isMobile ? 4 : 14, isMobile ? 4 : 14); return sCache[k]; };
        const atomMat = col => new THREE.MeshPhongMaterial({ color: col, emissive: col, emissiveIntensity: 0.45, shininess: 300, specular: 0xbbddff });
        const bondMat = new THREE.MeshPhongMaterial({ color: 0x1e4a6a, emissive: 0x0c2030, emissiveIntensity: 0.18, shininess: 100 });

        const addAtom = (x, y, z, elem, r = 0.55) => {
          const m = new THREE.Mesh(sphereGeo(r), atomMat(CPK[elem] || CPK.C));
          m.position.set(x, y, z); m.userData = { isAtom: true }; atomGrp.add(m); return m;
        };

        /* Cylinder bond between two points */
        const addBond = (x1, y1, z1, x2, y2, z2, r = 0.14) => {
          const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
          const len = Math.sqrt(dx * dx + dy * dy + dz * dz); if (len < 0.01) return;
          const geo = new THREE.CylinderGeometry(r, r, len, isMobile ? 3 : 6, 1);
          const m = new THREE.Mesh(geo, bondMat);
          m.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
          m.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(dx / len, dy / len, dz / len)
          );
          m.userData = { isAtom: true }; atomGrp.add(m);
        };

        /* Dashed H-bond (PyMOL style) */
        const addHBond = (x1, y1, z1, x2, y2, z2) => {
          const N = 8;
          for (let k = 0; k < N; k += 2) {
            const t0 = k / N, t1 = (k + 0.8) / N;
            addBond(x1 + (x2 - x1) * t0, y1 + (y2 - y1) * t0, z1 + (z2 - z1) * t0,
              x1 + (x2 - x1) * t1, y1 + (y2 - y1) * t1, z1 + (z2 - z1) * t1, 0.09);
          }
        };

        const rng2 = s => { let x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
        /* Side-chain element cycling — approximates real AA distribution */
        const SC_ELEMS = ['C', 'N', 'O', 'O', 'S', 'C', 'N', 'C', 'O', 'C', 'N', 'O', 'S', 'C', 'C', 'N', 'O', 'O'];
        const SC2_ELEMS = ['O', 'N', 'C', 'S', 'C', 'O', 'N', 'C'];

        /* Sample every STEP backbone points for atoms */
        const STEP = Math.max(2, Math.floor(pts.length / 140));
        const STEP_MOB = Math.max(3, Math.floor(pts.length / 55)); // fewer atoms on mobile

        /* ── MOBILE: Backbone + side chains (lighter than desktop but enough for Ball+Stick/CPK) ── */
        if (isMobile) {
          pts.forEach((p, pi) => {
            if (pi % STEP_MOB !== 0) return;
            if (!p.domain && p.ss === 'loop') return;
            const { x, y, z } = p;
            const pp = pts[Math.max(0, pi - STEP_MOB)];

            // Ca backbone atom
            addAtom(x, y, z, 'CA', 0.65);

            // Backbone bond to previous Ca
            if (pi > 0 && pi % STEP_MOB === 0) {
              const pp2 = pts[Math.max(0, pi - STEP_MOB)];
              addBond(pp2.x, pp2.y, pp2.z, x, y, z, 0.15);
            }

            // Amide N between this and previous Ca
            const nx = (x + pp.x) / 2, ny = (y + pp.y) / 2 + 0.5, nz = (z + pp.z) / 2;
            addAtom(nx, ny, nz, 'N', 0.38);
            addBond(nx, ny, nz, x, y, z, 0.12);

            // Carbonyl C=O
            const pn = pts[Math.min(pts.length - 1, pi + STEP_MOB)];
            const cx = (x + pn.x) / 2, cy = (y + pn.y) / 2 - 0.3, cz = (z + pn.z) / 2;
            addAtom(cx, cy, cz, 'C', 0.32);
            addBond(x, y, z, cx, cy, cz, 0.12);
            const ox = cx + (rng2(pi * 13.1) - 0.5) * 0.8;
            const oy = cy - 0.7;
            const oz = cz + (rng2(pi * 7.9) - 0.5) * 0.8;
            addAtom(ox, oy, oz, 'O', 0.38);
            addBond(cx, cy, cz, ox, oy, oz, 0.10);

            // Side chain (Cb)
            const ang = rng2(pi * 7.3) * Math.PI * 2;
            const scL = 1.1 + rng2(pi * 3.7) * 1.0;
            const sc1x = x + Math.cos(ang) * scL * 0.6;
            const sc1y = y + (rng2(pi * 5.2) - 0.3) * scL + 1.2;
            const sc1z = z + Math.sin(ang) * scL * 0.6;
            const e1 = SC_ELEMS[pi % SC_ELEMS.length];
            addAtom(sc1x, sc1y, sc1z, e1, 0.38);
            addBond(x, y, z, sc1x, sc1y, sc1z, 0.10);
          });
        }

        /* ── DESKTOP: Full CPK ball-and-stick ── */
        if (!isMobile) {
          pts.forEach((p, pi) => {
            if (pi % STEP !== 0) return;
            if (!p.domain && p.ss === 'loop') return; // skip non-domain loops
            const { x, y, z, ss } = p;
            const pp = pts[Math.max(0, pi - STEP)], pn = pts[Math.min(pts.length - 1, pi + STEP)];

            /* Backbone atoms */
            addAtom(x, y, z, 'CA', 0.62);  // Cα — larger for visibility

            /* Amide N, between this Cα and previous */
            const nx = (x + pp.x) / 2, ny = (y + pp.y) / 2 + 0.6, nz = (z + pp.z) / 2;
            /* Carbonyl C and O */
            const cx = (x + pn.x) / 2, cy = (y + pn.y) / 2 - 0.4, cz = (z + pn.z) / 2;
            const ox = cx + (rng2(pi * 13.1) - 0.5) * 1.0;
            const oy = cy - 0.9;
            const oz = cz + (rng2(pi * 7.9) - 0.5) * 1.0;

            addAtom(nx, ny, nz, 'N', 0.46);
            addAtom(cx, cy, cz, 'C', 0.40);
            addAtom(ox, oy, oz, 'O', 0.48);

            /* Backbone bonds */
            addBond(nx, ny, nz, x, y, z, 0.14);          // N-Cα
            addBond(x, y, z, cx, cy, cz, 0.14);           // Cα-C
            addBond(cx, cy, cz, ox, oy, oz, 0.13);        // C=O

            /* Side chain — Cβ */
            const ang = rng2(pi * 7.3) * Math.PI * 2;
            const scL = 1.3 + rng2(pi * 3.7) * 1.4;
            const sc1x = x + Math.cos(ang) * scL * 0.7;
            const sc1y = y + (rng2(pi * 5.2) - 0.3) * scL + 1.5;
            const sc1z = z + Math.sin(ang) * scL * 0.7;
            const e1 = SC_ELEMS[pi % SC_ELEMS.length];
            addAtom(sc1x, sc1y, sc1z, e1, 0.48);
            addBond(x, y, z, sc1x, sc1y, sc1z, 0.14);

            /* Cγ for longer side chains */
            if (pi % 3 === 0) {
              const ang2 = ang + 1.1;
              const sc2x = sc1x + Math.cos(ang2) * 1.2;
              const sc2y = sc1y + (rng2(pi * 9.1) - 0.5) * 0.8;
              const sc2z = sc1z + Math.sin(ang2) * 1.2;
              const e2 = SC2_ELEMS[pi % SC2_ELEMS.length];
              addAtom(sc2x, sc2y, sc2z, e2, 0.44);
              addBond(sc1x, sc1y, sc1z, sc2x, sc2y, sc2z, 0.13);
              /* Cδ for aromatic/long-chain residues */
              if (pi % 5 === 0) {
                const ang3 = ang + 2.2;
                const sc3x = sc2x + Math.cos(ang3) * 1.0;
                const sc3y = sc2y + (rng2(pi * 11.3) - 0.5) * 0.6;
                const sc3z = sc2z + Math.sin(ang3) * 1.0;
                const e3 = ['C', 'N', 'O'][pi % 3];
                addAtom(sc3x, sc3y, sc3z, e3, 0.36);
                addBond(sc2x, sc2y, sc2z, sc3x, sc3y, sc3z, 0.10);
              }
              /* H-bond donor/acceptor */
              if (['N', 'O', 'S'].includes(e2) && pi % 5 === 0) {
                const hbIdx = Math.min(pts.length - 1, pi + STEP * 4);
                const hp = pts[hbIdx];
                if (hp && hp.domain) addHBond(sc2x, sc2y, sc2z, hp.x, hp.y, hp.z);
              }
            }

            /* Secondary-structure H-bonds */
            if (ss === 'helix') {
              const hp = pts[Math.min(pts.length - 1, pi + STEP * 4)];
              if (hp && hp.domain) addHBond(nx, ny, nz, hp.x, hp.y - 0.4, hp.z);
            } else if (ss === 'sheet') {
              const hp = pts[Math.min(pts.length - 1, pi + STEP * 2)];
              if (hp && hp.domain) addHBond(nx, ny, nz, hp.x, hp.y - 0.4, hp.z);
            }
          });

          /* Solvation water molecules near domain surface — denser shell */
          for (let w = 0; w < 60; w++) {
            const idx = Math.floor(rng2(w * 11.7) * pts.length);
            const p = pts[idx]; if (!p || !p.domain) continue;
            const wr = 2.2 + rng2(w * 7.7) * 3.0;
            const wa = rng2(w * 13.3) * Math.PI * 2;
            const wh = (rng2(w * 5.1) - 0.5) * 4.0;
            addAtom(p.x + Math.cos(wa) * wr, p.y + wh, p.z + Math.sin(wa) * wr, 'O', 0.24);
            /* Add H atoms near water O for realism */
            if (w % 3 === 0) {
              const hoff = 0.6;
              addAtom(p.x + Math.cos(wa) * wr + hoff, p.y + wh + 0.3, p.z + Math.sin(wa) * wr, 'H', 0.16);
              addAtom(p.x + Math.cos(wa) * wr - hoff, p.y + wh - 0.3, p.z + Math.sin(wa) * wr + hoff, 'H', 0.16);
            }
          }

          /* Counter-ions (Mg2+, Zn2+) near domain centers */
          gene.domains.forEach((dom, di) => {
            const midAA = (dom.start + dom.end) / 2;
            const dp = pts.reduce((b, p) => Math.abs(p.aa - midAA) < Math.abs(b.aa - midAA) ? p : b, pts[0]);
            if (dp && dom.functionalRegion === 'Critical') {
              const ionSphere = new THREE.Mesh(sphereGeo(0.70), new THREE.MeshPhongMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 0.8, shininess: 400, specular: 0xffffff, transparent: true, opacity: 0.85 }));
              ionSphere.position.set(dp.x + (rng2(di * 31) - 0.5) * 3, dp.y + 2.5, dp.z + (rng2(di * 47) - 0.5) * 3);
              ionSphere.userData = { isAtom: true };
              atomGrp.add(ionSphere);
            }
          });
        }

        /* ── Mutation pins ── */
        if (mutPins && mutPins.length > 0) {
          mutPins.forEach(pin => {
            const bp = pts.reduce((b, p) => Math.abs(p.aa - pin.pos) < Math.abs(b.aa - pin.pos) ? p : b, pts[0]);
            if (!bp) return;
            const col = parseInt((pin.color || '#ef4444').replace('#', ''), 16);
            const spike = makeTube([new THREE.Vector3(bp.x, bp.y, bp.z), new THREE.Vector3(bp.x, bp.y + 24, bp.z)], 0.2, col, 0.8);
            if (spike) { spike.userData = { isPin: true, pin }; pinGrp.add(spike); }
            const bm = new THREE.Mesh(new THREE.SphereGeometry(2.2, isMobile ? 8 : 16, isMobile ? 8 : 16),
              new THREE.MeshPhongMaterial({ color: col, emissive: col, emissiveIntensity: 1, shininess: 280 }));
            bm.position.set(bp.x, bp.y + 26, bp.z); bm.userData = { isPin: true, pin }; pinGrp.add(bm);
            const gm = new THREE.Mesh(new THREE.SphereGeometry(4.5, 8, 8),
              new THREE.MeshPhongMaterial({ color: col, transparent: true, opacity: 0.12, depthWrite: false }));
            gm.position.set(bp.x, bp.y + 26, bp.z); pinGrp.add(gm);
          });
        }

        /* ── Grid floor ── */
        const grid = new THREE.GridHelper(240, 48, 0x0c1420, 0x0c1420);
        grid.position.y = -32; grid.material.opacity = 0.18; grid.material.transparent = true; scene.add(grid);

        /* Depth-atmosphere: gradient plane behind structure */
        const bgGeo = new THREE.PlaneGeometry(300, 200);
        const bgMat = new THREE.MeshBasicMaterial({ color: 0x06081a, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
        const bgPlane = new THREE.Mesh(bgGeo, bgMat);
        bgPlane.position.set(0, 0, -80);
        scene.add(bgPlane);

        /* ── View mode switching ── */
        const applyViewMode = mode => {
          if (mode === 'ribbon') {
            ribbonGrp.visible = true; atomGrp.visible = false;
            ribbonGrp.children.forEach(c => { if (c.material && !c.userData.isGlow) { c.material.opacity = 1; c.material.transparent = false; } });
          } else if (mode === 'ballstick') {
            ribbonGrp.visible = true; atomGrp.visible = true;
            ribbonGrp.children.forEach(c => { if (c.material && !c.userData.isGlow) { c.material.opacity = isMobile ? 0.35 : 0.18; c.material.transparent = true; } });
          } else if (mode === 'cpk') {
            ribbonGrp.visible = false; atomGrp.visible = true;
          }
        };
        applyViewMode('ribbon');
        sceneRef.current.applyViewMode = applyViewMode;

        /* ── Raycaster & interaction ── */
        const raycaster = new THREE.Raycaster();
        raycaster.params.Line = { threshold: 1 };
        const mouse = new THREE.Vector2();
        let selectedMesh = null;
        let autoSpin = { v: true };
        let rotY = 0, rotX = 0.15, dragging = false, ox = 0, oy = 0, dragDist = 0;

        /* Camera animation to zoom into selected domain region */
        let camTarget = null;
        const zoomToWorld = (wx, wy) => {
          camTarget = { localPt: new THREE.Vector3(wx, wy, 0), tz: isMobile ? 85 : 55 };
        };
        sceneRef.current.zoomTo = zoomToWorld;
        sceneRef.current.autoSpin = autoSpin;

        const getRect = () => renderer.domElement.getBoundingClientRect();
        const toNDC = (cx, cy) => { const r = getRect(); mouse.x = ((cx - r.left) / r.width) * 2 - 1; mouse.y = -((cy - r.top) / r.height) * 2 + 1; };

        const deselect = () => {
          if (selectedMesh) {
            const c = colOf(selectedMesh.userData.midAA || 0);
            selectedMesh.material.color.setHex(c);
            selectedMesh.material.emissive.setHex(c);
            selectedMesh.material.emissiveIntensity = selectedMesh.userData.isLinker ? 0 : 0.22;
            selectedMesh.scale.set(1, 1, 1);
            selectedMesh = null;
          }
          selLight.intensity = 0;
          setClickedDomain(null);
          autoSpin.v = true; setIsSpinning(true);
          // Animate camera back to default view
          camTarget = { tx: 0, ty: 0, tz: isMobile ? 180 : 155 };
        };

        const select = (mesh, hitPt) => {
          if (selectedMesh && selectedMesh !== mesh) deselect();
          if (selectedMesh === mesh) { deselect(); return; }
          selectedMesh = mesh;
          mesh.material.color.setHex(0xffffff);
          mesh.material.emissive.setHex(colOf(mesh.userData.midAA || 0));
          mesh.material.emissiveIntensity = 0.85;
          mesh.scale.set(1.1, 1.1, 1.1);
          selLight.position.copy(hitPt);
          selLight.color.setHex(colOf(mesh.userData.midAA || 0));
          selLight.intensity = 4;
          autoSpin.v = false; setIsSpinning(false);

          const domain = mesh.userData.domain;
          const full = domain ? gene.domains.find(d => d.name === domain.name) : null;
          setClickedDomain({ domain: full || domain, midAA: Math.round(mesh.userData.midAA || 0), ssType: mesh.userData.ssType, isLinker: mesh.userData.isLinker, color: (colOf(mesh.userData.midAA || 0)).toString(16).padStart(6, '0') });

          /* Zoom camera toward hit — perfectly centered tracking */
          const localPt = root.worldToLocal(hitPt.clone());
          camTarget = { localPt, tz: isMobile ? 85 : 55 };
        };

        const handleClick = e => {
          e.preventDefault();
          // Guard: skip if drag, use try/catch to prevent mobile crash
          if (dragDist > 8) return;
          const cx = e.clientX, cy = e.clientY;
          // Mobile: defer raycasting to idle callback so the UI thread stays responsive
          const doRaycast = () => {
            try {
              toNDC(cx, cy);
              raycaster.setFromCamera(mouse, camera);
              // Mobile: only raycast domain meshes (skip linkers) to reduce WebGL load
              const targets = isMobile
                ? clickableMeshes.filter(m => !m.mesh.userData.isLinker).map(m => m.mesh)
                : clickableMeshes.map(m => m.mesh);
              const hits = raycaster.intersectObjects(targets, false);
              if (hits.length > 0 && !hits[0].object.userData.isGlow) select(hits[0].object, hits[0].point);
              else deselect();
            } catch (err) { deselect(); }
          };
          if (isMobile) {
            setTimeout(doRaycast, 10);
          } else {
            doRaycast();
          }
        };

        const el = renderer.domElement;
        el.style.cursor = isMobile ? 'default' : 'grab';
        el.style.touchAction = 'none'; // CRITICAL: Stop mobile from freezing on drag

        if (isMobile) {
          // Touch events — more reliable than pointer on iOS/Android
          let touchMoved = false;
          el.addEventListener('touchstart', e => {
            if (e.touches.length !== 1) return;
            dragging = true; touchMoved = false;
            ox = e.touches[0].clientX; oy = e.touches[0].clientY; dragDist = 0;
          }, { passive: true });
          el.addEventListener('touchmove', e => {
            if (e.touches.length !== 1) return;
            const dx = e.touches[0].clientX - ox, dy = e.touches[0].clientY - oy;
            dragDist = Math.sqrt(dx * dx + dy * dy);
            if (dragDist > 6) touchMoved = true;
            rotY += (e.touches[0].clientX - ox) * 0.012; ox = e.touches[0].clientX;
            rotX += (e.touches[0].clientY - oy) * 0.012; oy = e.touches[0].clientY;
            rotX = Math.max(-1.2, Math.min(1.2, rotX));
          }, { passive: true });
          el.addEventListener('touchend', e => {
            dragging = false;
            if (!touchMoved && dragDist < 8) {
              const t = e.changedTouches[0];
              // Defer to next rAF + idle callback chain to prevent iOS/Android page freeze on tap
              requestAnimationFrame(() => {
                handleClick({ clientX: t.clientX, clientY: t.clientY, preventDefault: () => { } });
              });
            }
          }, { passive: true });
        } else {
          // Desktop: pointer events with hover tooltip
          el.addEventListener('pointerdown', e => { dragging = true; ox = e.clientX; oy = e.clientY; dragDist = 0; el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing'; });
          el.addEventListener('pointermove', e => {
            if (dragging) {
              const dx = e.clientX - ox, dy = e.clientY - oy;
              dragDist = Math.sqrt(dx * dx + dy * dy);
              rotY += (e.clientX - ox) * 0.01; ox = e.clientX;
              rotX += (e.clientY - oy) * 0.01; oy = e.clientY;
              rotX = Math.max(-1.4, Math.min(1.4, rotX));
            } else {
              toNDC(e.clientX, e.clientY);
              raycaster.setFromCamera(mouse, camera);
              const hits = raycaster.intersectObjects(clickableMeshes.map(m => m.mesh), false);
              const rect = getRect();
              if (hits.length > 0 && !hits[0].object.userData.isGlow) {
                el.style.cursor = 'pointer';
                const d = hits[0].object.userData.domain;
                setTooltip({ text: d ? d.name : `Linker ~AA${Math.round(hits[0].object.userData.midAA || 0)}`, x: e.clientX - rect.left, y: e.clientY - rect.top - 44 });
              } else { el.style.cursor = 'grab'; setTooltip(null); }
            }
          });
          el.addEventListener('pointerup', e => { if (dragDist < 5) handleClick(e); dragging = false; el.style.cursor = 'grab'; });
          el.addEventListener('wheel', e => { camera.position.z = Math.max(28, Math.min(380, camera.position.z + e.deltaY * 0.28)); e.preventDefault(); }, { passive: false });
        }

        /* ── Animate ── */
        let pulseT = 0;
        let frameCount = 0;
        const animate = () => {
          frameRef.current = requestAnimationFrame(animate);
          // Mobile: skip every other frame (~30fps) to reduce GPU load
          if (isMobile) {
            frameCount++;
            if (frameCount % 2 !== 0) return;
          }
          if (autoSpin.v) rotY += isMobile ? 0.004 : 0.005;
          root.rotation.y = rotY;
          root.rotation.x = rotX;

          /* Camera zoom animation toward selected domain */
          if (camTarget) {
            let tx = 0, ty = 0, tz = isMobile ? 180 : 155;
            if (camTarget.localPt) {
              const wpt = root.localToWorld(camTarget.localPt.clone());
              tx = wpt.x * 0.85; // Pan camera 85% towards target to keep slight context
              ty = wpt.y * 0.85;
              tz = camTarget.tz;
            } else {
              tx = camTarget.tx || 0;
              ty = camTarget.ty || 0;
              tz = camTarget.tz;
            }
            camera.position.x += (tx - camera.position.x) * 0.06;
            camera.position.y += (ty - camera.position.y) * 0.06;
            camera.position.z += (tz - camera.position.z) * 0.06;
            if (!camTarget.localPt && Math.abs(camera.position.z - tz) < 0.5 && Math.abs(camera.position.y - ty) < 0.5 && Math.abs(camera.position.x - tx) < 0.5) camTarget = null;
          }

          /* Pulse selected */
          if (selectedMesh) {
            pulseT += 0.04;
            selectedMesh.material.emissiveIntensity = 0.65 + Math.sin(pulseT) * 0.22;
            selLight.intensity = 3 + Math.sin(pulseT) * 1.5;
          } else {
            pulseT = 0;
          }

          renderer.render(scene, camera);
        };
        animate();

        const onResize = () => {
          if (!container) return;
          const W2 = container.offsetWidth;
          renderer.setSize(W2, H);
          camera.aspect = W2 / H;
          camera.updateProjectionMatrix();
        };
        window.addEventListener('resize', onResize);

        sceneRef.current = { autoSpin, renderer, applyViewMode, zoomTo, deselect };
        frameRef._cleanup = () => { window.removeEventListener('resize', onResize); renderer.dispose(); };
      };

      if (window.THREE) { launch(); }
      else if (!document.getElementById('three-js')) {
        const s = document.createElement('script'); s.id = 'three-js';
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
        s.onload = launch; document.head.appendChild(s);
      } else {
        const poll = setInterval(() => { if (window.THREE) { clearInterval(poll); launch(); } }, 80);
      }
    }, 80);

    return () => {
      clearTimeout(timer);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      // Properly dispose all geometries, materials, and textures to free GPU memory
      if (frameRef._cleanup) {
        frameRef._cleanup();
        frameRef._cleanup = null;
      }
      if (sceneRef.current?.renderer) {
        try {
          const r = sceneRef.current.renderer;
          r.dispose();
          r.forceContextLoss && r.forceContextLoss();
        } catch (_) { /* ignore */ }
      }
      if (containerRef.current) containerRef.current.innerHTML = '';
      sceneRef.current = {};
      setClickedDomain(null); setIsSpinning(true); setTooltip(null);
    };
  }, [showRCSB, gene, mutPins, buildBackbone]);

  /* Apply view mode changes reactively */
  useEffect(() => {
    sceneRef.current?.applyViewMode?.(viewMode);
  }, [viewMode]);

  const handleResume = () => {
    if (sceneRef.current?.autoSpin) sceneRef.current.autoSpin.v = true;
    if (sceneRef.current?.deselect) sceneRef.current.deselect();
    setIsSpinning(true); setClickedDomain(null); setTooltip(null);
  };

  const FREG_COL = { Critical: '#06b6d4', Structural: '#8b5cf6', Regulatory: '#10b981' };
  const [structureAI, setStructureAI] = useState(null);
  const [structureAILoading, setStructureAILoading] = useState(false);
  const isMobileDevice = typeof navigator !== 'undefined' &&
    (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768);

  // Bohrium/SciMaster structural data — PDB 2OCJ, 6OIM, 1JNX, 2ITX
  const BOHRIUM_DATA = `TP53 (PDB 2OCJ, 2.05 Ang): beta-sandwich fold residues 96-289. Two alpha-helices H1,H2 + two antiparallel beta-sheets: small (S1,S3,S8,S5), large (S6,S7,S4,S9,S10,S2prime,S2) + loops L1,L2,L3. Zinc tetrahedral: Cys176,His179,Cys238,Cys242 stabilizes L2/L3 for DNA contact. DNA contacts: Arg248,Arg273 in major groove; Ser241 backbone. MDM2 interface: F19,W23,L26 bury into MDM2; secondary site MDM2 E25,T26,V28,M50,H96,R97,Y100,T101,Y104,L107,V108,V109. MD simulation mutation consequences: R175H disrupts L114:T125 and L114:Y126, promotes aggregation. R248W/R248Q separates L2 from S5 by >20 Ang (D186/G199 = 24.6 Ang), disrupts zinc region. R273H induces L3 helical formation displacing Ser241 Ca by 7 Ang. G245S forms non-native alpha-sheet between S1/S3. All mutants share L1/H2 and L2/S5 separation plus aggregation-prone alpha-sheet gain.
KRAS (PDB 6OIM, G12C+sotorasib+GDP): G-domain residues 1-169, 6-stranded beta-sheet + 5 alpha-helices. P-loop 10-17 (GXXXXGKS/T), Switch I 30-38, Switch II 60-76. GDP contacts: guanine to N116,A146,K117; phosphates to S17,K16 and Mg2+ bridging D57. G12C: Gly→Cys in P-loop, steric hindrance disrupts GTP hydrolysis geometry, ~50-fold GTPase reduction, excited-state population drops from WT 10.2% to 7.0%. Sotorasib: covalent to Cys12 via acrylamide, Switch II pocket, contacts H95 (hydrophobic) and Y96 (pi-stack). Q61: positions catalytic water for gamma-phosphate attack; Q61 mutations disorder switch domains, destabilize V29/D30 interactions.
BRCA1 (PDB 1JNX): tandem BRCT repeats in head-to-tail arrangement, each alpha/beta fold with 4-stranded beta-sheet + alpha-helices, packed via hydrophobic interface. Phosphopeptide recognition: pSer-X-X-Phe motif; phosphoserine H-bonds backbone amides; Phe(+3) inserts into hydrophobic pocket; M1775 van der Waals contacts stabilize peptide. M1775R: Arg steric clash with Phe(+3) ring, extrudes from hydrophobic core (Trp1837,Phe1704), abolishes CtIP binding, causes hyper-recombination, thread-like PML-NB formation, elevated RAD51/RPA. RING domain: 2 Zn2+ tetrahedral sites; BRCA1-BARD1 interface: Phe36,Leu37,Ile38 vs Ile75,Leu78; C61G/C64G disrupt Zn2 site, impair UbcH5c interaction.
EGFR (PDB 2ITX): kinase domain residues 696-1022, bilobal. N-lobe (beta-rich, ATP site), C-lobe (alpha-helical, activation loop A-loop 831-875). alphaC-helix 745-759: active 'in' state Glu762 salt bridge to Lys745 (beta3). Hinge: Met793 backbone amide H-bonds ATP N1; Cys797 carbonyl contacts ATP N6. L858R: Arg858 H-bonds Arg836 carbonyl, prevents A-loop inactive helical conformation, constitutively active, 50-fold catalytic increase, gefitinib Kd 2.6 nM (vs 53.5 nM WT). T790M: bulkier Met at gatekeeper, steric clash with aniline of erlotinib/gefitinib, increases ATP affinity via enhanced van der Waals. Exon 19 del (deltaE746-A750): removes loop stabilizing inactive conformation, enforces alphaC-helix 'in', constitutively active, TKI-sensitive. Erlotinib: quinazoline H-bonds Met793; contacts Lys745,Leu788,Thr790. Osimertinib: hinge contacts + covalent Cys797 acrylamide bond, overcomes T790M.`;

  const handleStructureAI = async () => {
    setStructureAILoading(true);
    setStructureAI(null);
    try {
      const d = clickedDomain?.domain;
      const ssMap = { helix: 'alpha-helix', sheet: 'beta-strand', loop: 'loop/coil' };
      const ssType = ssMap[clickedDomain?.ssType] || 'flexible loop';

      const domainBlock = d
        ? `SELECTED DOMAIN: ${d.name} | Residues AA ${d.start}-${d.end} | Secondary structure: ${ssType} | Class: ${d.functionalRegion} | Function: ${d.description}${d.detail ? ' | Key residues: ' + d.detail : ''}. Focus primarily on this domain using exact residue contacts and mutation consequences from the structural data above.`
        : `No domain selected. Provide a full structural overview of ${gene.symbol} as displayed in the ribbon viewer.`;

      const structContext = `3D Molecular Structure Analysis for ${gene.symbol} (${gene.proteinLength} amino acids).

Protein clinical context: ${gene.clinicalContext}

Domains: ${gene.domains.map((dm, i) => `${i + 1}. ${dm.name} (AA ${dm.start}-${dm.end}, ${dm.functionalRegion}): ${dm.description}`).join('; ')}

${domainBlock}

VERIFIED STRUCTURAL DATA: ${BOHRIUM_DATA}

Provide a rigorous structural explanation covering: secondary structure elements, residue contacts, domain functions, mutation consequences, and clinical significance.`;

      const res = await fetch(`${API_URL}/api/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'Mutation Finder',
          data: {
            summary: { total_mutations: 0 },
            mutations: [],
            context: structContext
          }
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setStructureAI(data.explanation || 'No response returned.');
    } catch (err) {
      setStructureAI(`Could not reach AI explanation service.\n\nError: ${err.message}\n\nPlease ensure the backend server is running and try again.`);
    }
    setStructureAILoading(false);
  };

  return (
    <div style={{ borderTop: '1px solid #1e2130', paddingTop: '1rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.6rem', marginBottom: '.75rem' }}>
        <div>
          <div style={{ fontSize: '.85rem', fontWeight: 700, color: '#818CF8', textTransform: 'uppercase', letterSpacing: '.08em' }}>3D Molecular Viewer · PDB-style</div>
          <div style={{ fontSize: '.8rem', color: '#6b7080', marginTop: '.15rem' }}>
            <span style={{ color: '#A78BFA', fontFamily: '"JetBrains Mono",monospace', fontWeight: 700 }}>{gene.symbol}</span>
            {' '}{gene.proteinLength} aa · Click segment to inspect & zoom · Switch modes below
          </div>
        </div>
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          <a href={gene.pdb.url} target="_blank" rel="noopener noreferrer"
            style={{ padding: '.45rem .9rem', background: 'rgba(6,182,212,.1)', border: '1px solid rgba(6,182,212,.35)', borderRadius: 8, color: '#67E8F9', fontSize: '.84rem', fontWeight: 700, textDecoration: 'none' }}>
            PDB {gene.pdb.id}
          </a>
          <button onClick={() => setShowRCSB(v => !v)}
            style={{ padding: '.45rem .9rem', background: showRCSB ? 'rgba(99,102,241,.3)' : 'rgba(99,102,241,.12)', border: '1px solid rgba(99,102,241,.5)', borderRadius: 8, color: '#A78BFA', fontSize: '.84rem', fontWeight: 700, cursor: 'pointer' }}>
            {showRCSB ? 'Hide 3D Viewer' : 'Show 3D Viewer'}
          </button>
        </div>
      </div>

      {isMobileDevice && showRCSB && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.6rem', padding: '.7rem .9rem', background: 'rgba(251,191,36,.07)', border: '1px solid rgba(251,191,36,.28)', borderRadius: 9, marginBottom: '.75rem' }}>
          <span style={{ fontSize: '1rem', flexShrink: 0, fontFamily: 'monospace', color: '#fbbf24', fontWeight: 700 }}>[i]</span>
          <div>
            <div style={{ fontSize: '.79rem', fontWeight: 700, color: '#fbbf24', marginBottom: '.12rem' }}>Best viewed on Desktop</div>
            <div style={{ fontSize: '.73rem', color: '#8a7040', lineHeight: 1.55 }}>The 3D viewer works on mobile but for the best experience (click-to-inspect, smooth rotation, full CPK atoms) use <strong style={{ color: '#fbbf24' }}>Desktop Mode</strong> in your browser. On mobile, tap coloured segments to inspect domains.</div>
          </div>
        </div>
      )}

      {showRCSB && (<>
        <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(99,102,241,.3)', marginBottom: '1rem' }}>
          {/* Toolbar */}
          <div style={{ padding: '.5rem .9rem', background: 'rgba(10,12,22,.9)', borderBottom: '1px solid rgba(99,102,241,.2)', display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '.77rem', color: '#A78BFA', fontWeight: 700 }}>PDB {gene.pdb.id}</span>
            <span style={{ color: '#2a2d3a' }}>·</span>
            <span style={{ fontSize: '.72rem', color: '#4a4d5a' }}>{gene.pdb.name}</span>
            {/* View mode buttons */}
            <div style={{ display: 'flex', gap: '.3rem', marginLeft: 'auto' }}>
              {[
                { k: 'ribbon', label: 'Ribbon', tip: 'Secondary structure ribbon' },
                { k: 'ballstick', label: 'Ball+Stick', tip: 'Ribbon + CPK atoms overlay' },
                { k: 'cpk', label: 'CPK Only', tip: 'Pure ball-and-stick atoms' },
              ].map(m => (
                <button key={m.k} onClick={() => setViewMode(m.k)} title={m.tip}
                  style={{ padding: '.22rem .6rem', background: viewMode === m.k ? 'rgba(6,182,212,.25)' : 'rgba(30,33,48,.7)', border: `1px solid ${viewMode === m.k ? 'rgba(6,182,212,.6)' : 'rgba(99,102,241,.25)'}`, borderRadius: 6, color: viewMode === m.k ? '#67e8f9' : '#6b7080', fontSize: '.72rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  {m.label}
                </button>
              ))}
            </div>
            {!isSpinning && (
              <button onClick={handleResume}
                style={{ padding: '.22rem .6rem', background: 'rgba(6,182,212,.15)', border: '1px solid rgba(6,182,212,.4)', color: '#67E8F9', fontSize: '.72rem', fontWeight: 700, borderRadius: 5, cursor: 'pointer' }}>
                Resume Rotation
              </button>
            )}
            {mutPins && mutPins.length > 0 && (
              <span style={{ background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.35)', color: '#fca5a5', fontSize: '.7rem', fontWeight: 700, padding: '.15rem .5rem', borderRadius: 5 }}>
                {mutPins.length} mutation{mutPins.length !== 1 ? 's' : ''} pinned
              </span>
            )}
          </div>

          {/* Canvas */}
          <div style={{ position: 'relative' }}>
            <div ref={containerRef} style={{ width: '100%', height: 'clamp(300px,44vw,500px)', background: 'radial-gradient(ellipse at center, #080c18 0%, #04060f 100%)', position: 'relative' }} />
            {tooltip && (
              <div style={{ position: 'absolute', left: tooltip.x, top: tooltip.y, background: 'rgba(4,6,15,.93)', border: '1px solid rgba(99,102,241,.55)', borderRadius: 7, padding: '.3rem .7rem', fontSize: '.78rem', color: '#c8cad4', fontWeight: 600, pointerEvents: 'none', whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.6)' }}>
                {tooltip.text}
              </div>
            )}
            {/* Spin indicator */}
            {isSpinning && (
              <div style={{ position: 'absolute', bottom: 10, left: 10, display: 'flex', alignItems: 'center', gap: '.35rem', background: 'rgba(0,0,0,.55)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 6, padding: '.22rem .55rem' }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 6px #10b981', animation: 'domainPulse 1.5s ease-in-out infinite' }}></div>
                <span style={{ fontSize: '.7rem', color: '#5a6070' }}>Rotating — click to inspect</span>
              </div>
            )}
            {/* View mode badge */}
            <div style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(0,0,0,.6)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 6, padding: '.2rem .5rem', fontSize: '.7rem', color: '#6b7080', fontWeight: 600 }}>
              {viewMode === 'ribbon' ? 'Ribbon' : viewMode === 'ballstick' ? 'Ball+Stick' : 'CPK'}
            </div>
          </div>

          {/* Legend */}
          <div style={{ padding: '.55rem .9rem', background: 'rgba(0,0,0,.5)', display: 'flex', gap: '.8rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '.7rem', flexWrap: 'wrap' }}>
              {[{ col: '#06b6d4', label: 'Helix · Critical' }, { col: '#8b5cf6', label: 'Sheet · Structural' }, { col: '#10b981', label: 'Helix · Regulatory' }, { col: '#1a2535', label: 'Loop' }].map((l, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                  <div style={{ width: 12, height: 7, background: l.col, borderRadius: 2, boxShadow: `0 0 5px ${l.col}99` }}></div>
                  <span style={{ fontSize: '.72rem', color: '#6b7080' }}>{l.label}</span>
                </div>
              ))}
            </div>
            {/* CPK legend */}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.5rem', borderLeft: '1px solid rgba(255,255,255,.06)', paddingLeft: '.7rem' }}>
              <span style={{ fontSize: '.67rem', color: '#3a3d4a', fontWeight: 600 }}>CPK:</span>
              {[{ col: '#22d3ee', l: 'Cα' }, { col: '#3b82f6', l: 'N' }, { col: '#ef4444', l: 'O' }, { col: '#2dd4bf', l: 'C' }, { col: '#fbbf24', l: 'S' }].map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '.2rem' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: a.col, boxShadow: `0 0 4px ${a.col}aa` }}></div>
                  <span style={{ fontSize: '.66rem', color: '#5a6070', fontFamily: '"JetBrains Mono",monospace' }}>{a.l}</span>
                </div>
              ))}
              <span style={{ fontSize: '.67rem', color: '#3a3d4a', marginLeft: '.3rem' }}>Switch to Ball+Stick to reveal</span>
            </div>
          </div>
        </div>

        {/* ── Domain info panel ── */}
        {clickedDomain ? (
          <div style={{ background: '#070a12', border: `2px solid #${clickedDomain.color || '6366f1'}`, borderRadius: 13, overflow: 'hidden', marginBottom: '1rem', animation: 'fadeSlideIn .3s ease-out' }}>
            <div style={{ padding: '.7rem 1rem', background: `#${clickedDomain.color || '1e2130'}12`, borderBottom: '1px solid rgba(255,255,255,.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.4rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                <div style={{ width: 9, height: 9, borderRadius: '50%', background: `#${clickedDomain.color}`, boxShadow: `0 0 8px #${clickedDomain.color}` }}></div>
                <span style={{ fontSize: '.88rem', fontWeight: 700, color: '#e2e4e9' }}>
                  {clickedDomain.domain ? clickedDomain.domain.name : (clickedDomain.isLinker ? 'Inter-domain Linker' : 'Unknown')}
                </span>
                {clickedDomain.domain && (
                  <span style={{ background: `${FREG_COL[clickedDomain.domain.functionalRegion] || '#6366f1'}20`, border: `1px solid ${FREG_COL[clickedDomain.domain.functionalRegion] || '#6366f1'}55`, color: FREG_COL[clickedDomain.domain.functionalRegion] || '#a78bfa', fontSize: '.7rem', fontWeight: 700, padding: '.12rem .4rem', borderRadius: 5, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                    {clickedDomain.domain.functionalRegion}
                  </span>
                )}
                <span style={{ background: '#13162000', border: '1px solid #2a2d3a', color: '#5a6070', fontSize: '.68rem', fontWeight: 600, padding: '.1rem .38rem', borderRadius: 5 }}>
                  {clickedDomain.ssType === 'helix' ? 'α-Helix' : clickedDomain.ssType === 'sheet' ? 'β-Strand' : 'Loop'}
                </span>
              </div>
              <button onClick={handleResume} style={{ background: 'rgba(99,102,241,.15)', border: '1px solid rgba(99,102,241,.35)', color: '#a78bfa', fontSize: '.76rem', fontWeight: 600, padding: '.28rem .65rem', borderRadius: 6, cursor: 'pointer' }}>Resume</button>
            </div>

            {clickedDomain.domain ? (
              <div style={{ padding: '1rem' }}>
                {/* Position strip */}
                <div style={{ display: 'flex', gap: '.9rem', flexWrap: 'wrap', padding: '.65rem .85rem', background: '#0b0e18', border: '1px solid #1a1d2a', borderRadius: 8, marginBottom: '1rem' }}>
                  {[{ l: 'Start', v: `AA ${clickedDomain.domain.start}`, c: '#67e8f9' }, { l: 'End', v: `AA ${clickedDomain.domain.end}`, c: '#67e8f9' }, { l: 'Length', v: `${clickedDomain.domain.end - clickedDomain.domain.start + 1} aa`, c: '#a78bfa' }, { l: 'Clicked', v: `~AA ${clickedDomain.midAA}`, c: '#fbbf24' }].map((s, i) => (
                    <div key={i} style={{ minWidth: 80 }}>
                      <div style={{ fontSize: '.69rem', color: '#4a4d5a', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.1rem' }}>{s.l}</div>
                      <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: '.86rem', fontWeight: 700, color: s.c }}>{s.v}</div>
                    </div>
                  ))}
                </div>
                {/* Function */}
                <div style={{ marginBottom: '.85rem' }}>
                  <div style={{ fontSize: '.77rem', fontWeight: 700, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '.3rem' }}>Function</div>
                  <div style={{ fontSize: '.9rem', color: '#c8cad4', lineHeight: 1.7 }}>{clickedDomain.domain.description}</div>
                </div>
                {/* CPK Molecular Ball-and-Stick Panel */}
                <MolecularDetailPanel domain={clickedDomain.domain} gene={gene} color={clickedDomain.color} />
                {/* Clinical */}
                <div style={{ background: 'rgba(239,68,68,.05)', border: '1px solid rgba(239,68,68,.18)', borderRadius: 8, padding: '.7rem .95rem' }}>
                  <div style={{ fontSize: '.77rem', fontWeight: 700, color: '#fca5a5', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '.35rem' }}>Clinical</div>
                  <div style={{ fontSize: '.84rem', color: '#9ca3af', lineHeight: 1.7 }}>
                    {clickedDomain.domain.functionalRegion === 'Critical'
                      ? `Mutations in the ${clickedDomain.domain.name} are among the most clinically significant alterations in ${gene.symbol}. Frequently reported as Pathogenic in ClinVar.`
                      : clickedDomain.domain.functionalRegion === 'Structural'
                        ? `Structural mutations here can destabilize the ${gene.symbol} protein fold. Classified Likely Pathogenic to VUS.`
                        : `Regulatory variants range from Benign to VUS. Clinical significance is context-dependent.`}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ padding: '1rem', color: '#6b7080', fontSize: '.88rem' }}>
                Inter-domain linker near AA {clickedDomain.midAA}. Flexible connector — less conserved, typically Benign or VUS.
              </div>
            )}
          </div>
        ) : (
          <div style={{ background: '#090d16', border: '1px dashed #1e2535', borderRadius: 10, padding: '.85rem 1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '.7rem' }}>

            <div>
              <div style={{ fontSize: '.88rem', color: '#5a6070', fontWeight: 600 }}>Click any ribbon segment to inspect — camera zooms in automatically</div>
              <div style={{ fontSize: '.75rem', color: '#2e3245', marginTop: '.1rem' }}>Switch to Ball+Stick or CPK mode for atomic detail</div>
            </div>
          </div>
        )}

        {/* Domain quick reference */}
        <div style={{ background: '#090d16', border: '1px solid #1a1d2a', borderRadius: 10, overflow: 'hidden', marginBottom: '.5rem' }}>
          <div style={{ padding: '.6rem .9rem', background: 'rgba(99,102,241,.06)', borderBottom: '1px solid #1a1d2a', fontSize: '.8rem', fontWeight: 700, color: '#a78bfa' }}>
            Domain Map — {gene.symbol}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(195px,1fr))', gap: '1px', background: '#1a1d2a' }}>
            {gene.domains.map((d, i) => {
              const col = FREG_COL[d.functionalRegion] || '#6366f1';
              return (
                <div key={i} style={{ padding: '.7rem .85rem', background: '#090d16', borderLeft: `3px solid ${col}` }}>
                  <div style={{ fontSize: '.76rem', fontWeight: 700, color: col, marginBottom: '.08rem' }}>{d.name}</div>
                  <div style={{ fontSize: '.68rem', color: '#3a3d4a', fontFamily: '"JetBrains Mono",monospace', marginBottom: '.25rem' }}>AA {d.start}–{d.end}</div>
                  <div style={{ fontSize: '.73rem', color: '#7a8090', lineHeight: 1.5 }}>{d.description}</div>
                </div>
              );
            })}
          </div>
        </div>


      </>)
      }

      {
        !showRCSB && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '.85rem 1rem', background: '#0b0e18', border: '1px dashed #1e2535', borderRadius: 10 }}>
            <div style={{ width: 24, height: 24, borderRadius: 4, background: 'rgba(6,182,212,.15)', border: '1px solid rgba(6,182,212,.3)', flexShrink: 0 }}></div>
            <div>
              <div style={{ fontSize: '.88rem', color: '#5a6070' }}>Click <strong style={{ color: '#A78BFA' }}>Show 3D</strong> to launch the molecular viewer for <strong style={{ color: gene.color }}>{gene.symbol}</strong></div>
              <div style={{ fontSize: '.75rem', color: '#2e3245', marginTop: '.18rem' }}>Ribbon, Ball+Stick, CPK view modes available. Click segments to zoom and inspect. <a href={gene.pdb.url} target="_blank" rel="noopener noreferrer" style={{ color: '#67e8f9', textDecoration: 'none' }}>View PDB {gene.pdb.id}</a></div>
            </div>
          </div>
        )
      }
    </div >
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */
export default function CancerGeneMutationAnalyzer() {
  const [seq1, setSeq1] = useState('');
  const [seq2, setSeq2] = useState('');
  const [mutations, setMutations] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [readingFrame, setReadingFrame] = useState('1');
  const [strand, setStrand] = useState('forward');
  const [annotatedMutations, setAnnotatedMutations] = useState([]);
  const [aiExplanation, setAiExplanation] = useState('');
  const [loadingAI, setLoadingAI] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [showSampleMenu, setShowSampleMenu] = useState(false);
  const [currentSample, setCurrentSample] = useState(null);
  const [sampleBannerVisible, setSampleBannerVisible] = useState(false);
  const [diffInfo, setDiffInfo] = useState(null);
  const [vcfMode, setVcfMode] = useState(false);
  const [vcfFile, setVcfFile] = useState(null);
  const [vcfParsed, setVcfParsed] = useState(null);
  const [vcfSelectedIdx, setVcfSelectedIdx] = useState(0);
  const [vcfLoading, setVcfLoading] = useState(false);
  const [vcfError, setVcfError] = useState('');
  const [vcfMeta, setVcfMeta] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const vcfInputRef = useRef(null);
  const [selectedGene, setSelectedGene] = useState('TP53');
  const [showRCSB, setShowRCSB] = useState(false);
  const [analysisMode, setAnalysisMode] = useState('research'); // 'research' | 'cancer'
  const [cancerInput, setCancerInput] = useState('');
  const [cancerInputType, setCancerInputType] = useState('sequence'); // 'hgvs' | 'sequence'

  const isCancerMode = analysisMode === 'cancer';
  const activeGene = isCancerMode ? GENE_PANEL[selectedGene] : (mutations?.sequences ? buildResearchGene(Math.floor(mutations.sequences.reference_length / 3)) : buildResearchGene(100));

  const switchMode = (mode) => {
    setAnalysisMode(mode);
    setMutations(null); setAnnotatedMutations([]); setError(''); setAiExplanation('');
    setDiffInfo(null); setShowRCSB(false); setCancerInput('');
    if (mode === 'cancer') {
      setSeq1(CANONICAL_REFERENCES[selectedGene] || ''); setSeq2('');
    } else {
      setSeq1(''); setSeq2('');
    }
  };

  const loadSample = (s) => {
    if (isCancerMode) {
      if (s.gene) setSelectedGene(s.gene);
      setSeq1(CANONICAL_REFERENCES[s.gene || selectedGene] || ''); setSeq2('');
      setCancerInputType(s.inputType || 'hgvs');
      setCancerInput(s.input || '');
    } else {
      setSeq1(s.reference || ''); setSeq2(s.alternate || '');
      setReadingFrame(s.readingFrame || '1'); setStrand(s.strand || 'forward');
    }
    setCurrentSample(s); setSampleBannerVisible(true); setShowSampleMenu(false);
    setMutations(null); setError(''); setAiExplanation(''); setDiffInfo(null);
    setVcfMode(false); setVcfParsed(null); setVcfFile(null);
  };

  useEffect(() => {
    const close = () => setShowSampleMenu(false);
    if (showSampleMenu) { document.addEventListener('click', close); return () => document.removeEventListener('click', close); }
  }, [showSampleMenu]);

  const handleVcfFile = (file) => {
    if (!file) return;
    if (!file.name.endsWith('.vcf') && !file.name.endsWith('.txt')) { setVcfError('Please upload a .vcf file'); return; }
    setVcfLoading(true); setVcfError(''); setVcfParsed(null); setVcfFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const result = parseVCF(e.target.result);
        if (result.variants.length === 0) { setVcfError('No valid variants found in VCF file.'); setVcfLoading(false); return; }
        setVcfParsed(result); setVcfSelectedIdx(0); loadVcfVariant(result.variants[0]);
      } catch (err) { setVcfError(`Failed to parse VCF: ${err.message}`); }
      setVcfLoading(false);
    };
    reader.onerror = () => { setVcfError('Failed to read file'); setVcfLoading(false); };
    reader.readAsText(file);
  };

  const loadVcfVariant = (variant) => { setSeq1(variant.ref); setSeq2(variant.alt); setVcfMeta(variant); setMutations(null); setError(''); setAiExplanation(''); setDiffInfo(null); };
  const handleVcfInputChange = (e) => handleVcfFile(e.target.files[0]);
  const handleDrop = (e) => { e.preventDefault(); setIsDragOver(false); handleVcfFile(e.dataTransfer.files[0]); };
  const handleDragOver = (e) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = () => setIsDragOver(false);
  const validateBases = (seq) => { for (let i = 0; i < seq.length; i++) { const c = seq[i]; if (c !== 'A' && c !== 'T' && c !== 'G' && c !== 'C') return false; } return true; };

  const handleAnalyze = async () => {
    // Cancer Mode: HGVS input — create synthetic mutation directly
    if (isCancerMode && cancerInputType === 'hgvs' && cancerInput.trim()) {
      const parsed = parseHGVS(cancerInput);
      if (!parsed || !parsed.valid) { setError('Invalid HGVS notation. Use format like R175H, p.R248W, or Arg175His'); return; }
      setLoading(true); setError('');
      await new Promise(r => setTimeout(r, 50));
      const gene = GENE_PANEL[selectedGene];
      const syntheticMutation = {
        type: 'SNP', position: (parsed.position - 1) * 3, codon_position: (parsed.position - 1) * 3,
        reference_amino_acid: parsed.refAA, alternate_amino_acid: parsed.altAA,
        mutation_class: parsed.mutClass, reference_codon: '---', alternate_codon: '---',
        aaPosition: parsed.position, is_frameshift: false,
      };
      const syntheticResult = {
        mutations: [syntheticMutation],
        summary: {
          total_mutations: 1, snps: 1, insertions: 0, deletions: 0, frameshift_mutations: 0,
          silent_mutations: parsed.mutClass === 'Silent' ? 1 : 0,
          missense_mutations: parsed.mutClass === 'Missense' ? 1 : 0,
          nonsense_mutations: parsed.mutClass === 'Nonsense' ? 1 : 0
        },
        warnings: [], sequences: { reference: '', alternate: '', reference_length: gene.proteinLength * 3, alternate_length: gene.proteinLength * 3, length_difference: 0, reading_frame: '1', strand: 'forward' },
      };
      setMutations(syntheticResult); setDiffInfo({ identical: false, refLen: 0, altLen: 0 });
      setLoading(false); return;
    }
    // Sequence-based analysis (both modes)
    const ref = isCancerMode ? (CANONICAL_REFERENCES[selectedGene] || seq1) : seq1;
    const alt = isCancerMode ? cancerInput.trim() : seq2;
    if (!ref.trim() || !alt.trim()) { setError(isCancerMode ? 'Please enter a mutant DNA sequence or HGVS variant' : 'Both sequences are required'); return; }
    const cleanSeq1 = normalizeSequence(ref); const cleanSeq2 = normalizeSequence(alt);
    if (cleanSeq1.length > MAX_SEQ_LENGTH || cleanSeq2.length > MAX_SEQ_LENGTH) { setError(`Sequence too long — max ${MAX_SEQ_LENGTH.toLocaleString()} bp`); return; }
    if (!validateBases(cleanSeq1)) { setError('Reference sequence contains invalid characters (only A, T, G, C allowed).'); return; }
    if (!validateBases(cleanSeq2)) { setError('Alternate sequence contains invalid characters (only A, T, G, C allowed).'); return; }
    const firstDiffIdx = findFirstDifference(cleanSeq1, cleanSeq2);
    if (firstDiffIdx >= 0) { setDiffInfo({ index: firstDiffIdx, position: firstDiffIdx + 1, refBase: cleanSeq1[firstDiffIdx], altBase: cleanSeq2[firstDiffIdx], refLen: cleanSeq1.length, altLen: cleanSeq2.length, identical: false }); }
    else if (cleanSeq1.length !== cleanSeq2.length) { setDiffInfo({ index: Math.min(cleanSeq1.length, cleanSeq2.length), position: Math.min(cleanSeq1.length, cleanSeq2.length) + 1, refLen: cleanSeq1.length, altLen: cleanSeq2.length, identical: false }); }
    else { setDiffInfo({ identical: true, refLen: cleanSeq1.length, altLen: cleanSeq2.length }); }
    setLoading(true); setError('');
    await new Promise(resolve => setTimeout(resolve, 50));
    try { const result = detectMutations(cleanSeq1, cleanSeq2, readingFrame, strand); setMutations(result); }
    catch (e) { setError(`Analysis failed: ${e.message}`); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (mutations?.mutations && readingFrame) {
      // In Research Mode, use generic gene; in Cancer Mode, use selected cancer gene
      const isResearch = analysisMode !== 'cancer';
      const effectiveGene = isResearch
        ? buildResearchGene(Math.floor((mutations.sequences?.reference_length || 300) / 3))
        : (GENE_PANEL[selectedGene] || GENE_PANEL.TP53);
      // For database lookups (COSMIC, ClinVar, conservation), use actual gene key in Cancer Mode,
      // or a non-existent key in Research Mode so lookups return null gracefully
      const lookupKey = isResearch ? '__RESEARCH__' : selectedGene;

      const refSeq = mutations.sequences?.reference ?? '';
      const baseAnnotated = mutations.mutations.map(mutation => {
        const positionIndex = mutation.codon_position ?? mutation.position ?? 0;
        const positions = calculatePositions(positionIndex, readingFrame);
        const hgvs = generateHGVS(mutation, positions, refSeq, readingFrame, effectiveGene);
        const domainMapping = getDomainMapping(positions.aaPosition, effectiveGene);
        const interpretation = getBiologicalInterpretation(mutation, domainMapping, effectiveGene);
        // Augment mutation with aaPosition for scoring
        const augMut = { ...mutation, aaPosition: positions.aaPosition };
        // Local lookups (only meaningful in Cancer Mode, returns null in Research Mode)
        const clinvarLocal = lookupClinVar(augMut, lookupKey);
        const cosmicLocal = lookupCOSMIC(augMut, lookupKey);
        const pathogenicity = scorePathogenicity(augMut, domainMapping, lookupKey, clinvarLocal, cosmicLocal);
        const sift = mutation.reference_amino_acid && mutation.alternate_amino_acid
          ? estimateSIFT(mutation.reference_amino_acid, mutation.alternate_amino_acid) : null;
        const polyphen = mutation.reference_amino_acid && mutation.alternate_amino_acid
          ? estimatePolyPhen(augMut, domainMapping, lookupKey) : null;
        const conservation = estimateConservation(augMut, lookupKey);
        return {
          mutation: augMut, positions, hgvs, domainMapping, interpretation, pathogenicity,
          sift, polyphen, conservation, clinvar: clinvarLocal, cosmic: cosmicLocal, clinvarLive: null
        };
      });
      setAnnotatedMutations(baseAnnotated);
      // Background: attempt live ClinVar queries (only in Cancer Mode)
      if (!isResearch) {
        Promise.allSettled(baseAnnotated.map(async (am, idx) => {
          if (!am.mutation.reference_amino_acid) return am;
          const live = await fetchClinVarLive(am.hgvs, selectedGene);
          return { idx, live };
        })).then(results => {
          setAnnotatedMutations(prev => {
            const updated = [...prev];
            results.forEach(r => {
              if (r.status === 'fulfilled' && r.value?.live) {
                const { idx, live } = r.value;
                if (updated[idx]) {
                  updated[idx] = {
                    ...updated[idx], clinvarLive: live,
                    pathogenicity: scorePathogenicity(updated[idx].mutation, updated[idx].domainMapping, selectedGene, live, updated[idx].cosmic)
                  };
                }
              }
            });
            return updated;
          });
        });
      }
    }
  }, [mutations, readingFrame, selectedGene, analysisMode]);

  const handleExportPDF = () => {
    if (!mutations) return;
    try { generatePDF(mutations, annotatedMutations, { readingFrame, strand }, vcfMeta, isCancerMode ? selectedGene : activeGene); }
    catch (e) { setError(`PDF export failed: ${e.message}`); }
  };

  const MUTATION_STRUCTURAL_DATA = {
    TP53: `TP53 (PDB 2OCJ): beta-sandwich fold AA96-289. Zinc finger: Cys176,His179,Cys238,Cys242 — tetrahedral coordination stabilizes L2/L3 loops. DNA contacts: Arg248 and Arg273 contact major groove; Ser241 contacts backbone. MDM2 binding: Phe19,Trp23,Leu26. Hotspot consequences (MD simulation): R175H — disrupts L114:T125 and L114:Y126 H-bonds, promotes aggregation. R248W/R248Q — D186/G199 distance opens to 24.6 Ang (normally <8 Ang), separates L2 from S5 strand. R273H — L3 loop helical rearrangement, Ser241 Ca displaced by 7 Ang. G245S — non-native alpha-sheet forms between S1/S3. All gain-of-function mutants share L1/H2 and L2/S5 separation.`,
    KRAS: `KRAS (PDB 6OIM): G-domain AA1-169, 6-strand beta-sheet + 5 alpha-helices. P-loop AA10-17 (GXXXXGKS/T), Switch I AA30-38, Switch II AA60-76. G12C: P-loop Gly→Cys, steric block of GTP hydrolysis geometry, 50-fold GTPase reduction, excited state from 10.2% to 7.0%, locks effector-binding conformation. G12D: introduces negative charge, disrupts Mg2+ coordination. Q61: positions catalytic water; Q61L/H/R abolish hydrolysis. Sotorasib: covalent Cys12, contacts H95/Y96, stabilizes GDP-bound inactive.`,
    BRCA1: `BRCA1 (PDB 1JNX): tandem BRCT repeats AA1642-1863, each alpha/beta with 4-strand beta-sheet + helices. Phosphopeptide groove: pSer-X-X-Phe motif, phosphoserine H-bonds to S1655/T1700/K1702, Phe+3 inserts into hydrophobic pocket. M1775R: Arg steric clash with Phe+3, disrupts Trp1837/Phe1704 hydrophobic core, abolishes CtIP/BACH1 binding. RING domain: Zn1 (Cys24,Cys27,His41,Cys44), Zn2 (Cys61,Cys64,His74,Cys77), E3 ligase with BARD1 (Phe36,Leu37,Ile38 vs Ile75,Leu78). C61G/C64G disrupt Zn2, impair UbcH5c.`,
    EGFR: `EGFR (PDB 2ITX): kinase AA696-1022, bilobal. alphaC-helix AA745-759: active state Glu762 salt bridge to Lys745. Hinge: Met793 NH H-bonds ATP N1, Cys797 CO contacts ATP N6. L858R: Arg858 H-bonds Arg836 CO, prevents A-loop (AA831-875) inactive helix, constitutively active, 50-fold catalytic increase, gefitinib Kd 2.6 nM vs 53.5 nM WT. T790M: gatekeeper steric clash with erlotinib/gefitinib aniline, increased ATP affinity. Exon 19 del (deltaE746-A750): removes alphaC-helix stabilizing loop, enforces active conformation. Osimertinib: covalent Cys797 acrylamide, overcomes T790M.`
  };

  const handleAI = async () => {
    if (!mutations) return;
    setLoadingAI(true); setError('');
    try {
      const gene = isCancerMode ? (GENE_PANEL[selectedGene] || GENE_PANEL.TP53) : activeGene;
      const totalMut = mutations.summary.total_mutations;
      const criticalMuts = annotatedMutations.filter(am => am.domainMapping.functionalRegion === 'Critical');
      const frameshiftMuts = annotatedMutations.filter(am => am.mutation.is_frameshift);
      const nonsenseMuts = annotatedMutations.filter(am => am.mutation.mutation_class === 'Nonsense');
      const missenseMuts = annotatedMutations.filter(am => am.mutation.mutation_class === 'Missense');
      const silentMuts = annotatedMutations.filter(am => am.mutation.mutation_class === 'Silent');

      const structData = MUTATION_STRUCTURAL_DATA[gene.symbol] || '';

      const mutationList = annotatedMutations.map((am, i) =>
        `Mutation ${i + 1}: ${am.hgvs} | Type: ${am.mutation.mutation_class} | Domain: ${am.domainMapping.proteinDomain} (${am.domainMapping.functionalRegion})${am.mutation.reference_amino_acid ? ' | AA: ' + am.mutation.reference_amino_acid + ' to ' + am.mutation.alternate_amino_acid : ''} | Pathogenicity: ${am.interpretation.level || 'unknown'}`
      ).join('\n');

      const analysisPrompt = `You are a clinical molecular oncologist writing a structured mutation analysis report for ${gene.symbol} (${gene.name}).

VERIFIED STRUCTURAL DATA FOR ${gene.symbol}:
${structData}

PROTEIN INFORMATION:
Gene: ${gene.symbol} (${gene.name})
Type: ${gene.type}
Transcript: ${gene.id}
Chromosome: ${gene.chromosome}
Protein length: ${gene.proteinLength} amino acids
Clinical context: ${gene.clinicalContext}
Associated cancers: ${gene.cancerAssociations.join(', ')}

DETECTED MUTATIONS (${totalMut} total):
${totalMut === 0 ? 'No mutations detected — sequences are identical.' : mutationList}

SUMMARY STATISTICS:
SNPs: ${mutations.summary.snps || 0}
Insertions: ${mutations.summary.insertions || 0}
Deletions: ${mutations.summary.deletions || 0}
Frameshift: ${mutations.summary.frameshift_mutations || 0}
Missense: ${mutations.summary.missense_mutations || 0}
Nonsense: ${mutations.summary.nonsense_mutations || 0}
Silent: ${mutations.summary.silent_mutations || 0}
Critical domain hits: ${criticalMuts.length}

Write a rigorous clinical mutation analysis report with these exact plain-text sections (ALL CAPS headers, dashes underneath):

GENE AND PROTEIN OVERVIEW
(Describe the protein's role, structure, clinical importance using the structural data above)

MUTATION DETECTION SUMMARY
(Total counts, mutation classes, overall burden assessment)

STRUCTURAL AND FUNCTIONAL IMPACT
(For each mutation: which domain it hits, what 3D contacts are disrupted based on the verified structural data, predicted molecular consequence. Use specific residue numbers and bond types where relevant.)

PATHOGENICITY ASSESSMENT
(Overall severity, ACMG-like classification for each mutation if applicable)

CLINICAL SIGNIFICANCE
(Which cancer types are relevant, treatment implications if applicable, comparison to known hotspots)

DISCLAIMER
Research and educational use only. Not for clinical diagnosis. Consult a certified clinical laboratory and oncologist for patient care decisions.

Write in clear scientific prose. No emojis. No bullet lists — full paragraphs only. Be specific and accurate using the structural data provided.`;

      const response = await fetch(`${API_URL}/api/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'Mutation Finder',
          data: {
            summary: mutations.summary,
            mutations: mutations.mutations?.slice(0, 10) || [],
            context: analysisPrompt
          }
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData?.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      setAiExplanation(data.explanation || 'No analysis returned.');
    } catch (e) {
      // Offline fallback report
      const gene = isCancerMode ? (GENE_PANEL[selectedGene] || GENE_PANEL.TP53) : activeGene;
      const totalMut = mutations.summary.total_mutations;
      const criticalMuts = annotatedMutations.filter(am => am.domainMapping.functionalRegion === 'Critical');
      const frameshiftMuts = annotatedMutations.filter(am => am.mutation.is_frameshift);
      const nonsenseMuts = annotatedMutations.filter(am => am.mutation.mutation_class === 'Nonsense');
      const missenseMuts = annotatedMutations.filter(am => am.mutation.mutation_class === 'Missense');
      const silentMuts = annotatedMutations.filter(am => am.mutation.mutation_class === 'Silent');
      const severity = frameshiftMuts.length > 0 || nonsenseMuts.length > 0
        ? 'HIGH — Truncating mutation detected'
        : criticalMuts.length > 0 ? 'MODERATE-HIGH — Missense in critical domain'
          : missenseMuts.length > 0 ? 'MODERATE — Missense mutation detected'
            : silentMuts.length > 0 ? 'LOW — Synonymous substitution only'
              : totalMut === 0 ? 'NONE — No mutations detected' : 'UNDETERMINED';

      let exp = '';
      exp += '='.repeat(64) + '\n';
      exp += isCancerMode ? `  ${gene.symbol} CLINICAL MUTATION ANALYSIS REPORT\n` : `  DNA MUTATION ANALYSIS REPORT\n`;
      exp += '='.repeat(64) + '\n\n';
      exp += `Gene:        ${gene.symbol} — ${gene.name}\n`;
      exp += `Type:        ${gene.type}\n`;
      exp += `Transcript:  ${gene.id}\n`;
      exp += `Chromosome:  ${gene.chromosome}\n`;
      exp += `Protein:     ${gene.proteinLength} amino acids\n`;
      exp += `Mutations:   ${totalMut} detected\n\n`;
      exp += 'MUTATION DETECTION SUMMARY\n' + '-'.repeat(60) + '\n';
      if (totalMut === 0) { exp += 'No mutations detected. Sequences are identical.\n\n'; }
      else {
        exp += `Total variants: ${totalMut}\n`;
        if (mutations.summary.snps > 0) exp += `SNPs: ${mutations.summary.snps}\n`;
        if (mutations.summary.insertions > 0) exp += `Insertions: ${mutations.summary.insertions}\n`;
        if (mutations.summary.deletions > 0) exp += `Deletions: ${mutations.summary.deletions}\n`;
        if (mutations.summary.frameshift_mutations > 0) exp += `Frameshift: ${mutations.summary.frameshift_mutations} — HIGH SEVERITY\n`;
        if (mutations.summary.missense_mutations > 0) exp += `Missense: ${mutations.summary.missense_mutations}\n`;
        if (mutations.summary.nonsense_mutations > 0) exp += `Nonsense: ${mutations.summary.nonsense_mutations} — HIGH SEVERITY\n`;
        if (mutations.summary.silent_mutations > 0) exp += `Silent: ${mutations.summary.silent_mutations} — likely benign\n`;
        exp += '\n';
      }
      if (annotatedMutations.length > 0) {
        exp += 'INDIVIDUAL MUTATION DETAILS\n' + '-'.repeat(60) + '\n';
        annotatedMutations.forEach((am, i) => {
          exp += `Mutation ${i + 1}: ${am.hgvs}\n`;
          exp += `  Type: ${am.mutation.type} (${am.mutation.mutation_class})\n`;
          exp += `  Domain: ${am.domainMapping.proteinDomain} (${am.domainMapping.functionalRegion})\n`;
          if (am.mutation.reference_amino_acid && am.mutation.alternate_amino_acid)
            exp += `  AA Change: ${am.mutation.reference_amino_acid} to ${am.mutation.alternate_amino_acid}\n`;
          exp += `  Interpretation: ${am.interpretation.scientificNote}\n\n`;
        });
      }
      if (isCancerMode) {
        exp += 'STRUCTURAL CONTEXT (Bohrium/PDB-verified)\n' + '-'.repeat(60) + '\n';
        exp += (MUTATION_STRUCTURAL_DATA[gene.symbol] || gene.clinicalContext) + '\n\n';
      }
      exp += 'SEVERITY ASSESSMENT\n' + '-'.repeat(60) + '\n';
      exp += `Severity: ${severity}\n\n`;
      if (isCancerMode && gene.cancerAssociations?.length > 0) {
        exp += 'ASSOCIATED CANCERS\n' + '-'.repeat(60) + '\n';
        gene.cancerAssociations.forEach((c, i) => { exp += `  ${i + 1}. ${c}\n`; });
        exp += '\n';
      }
      exp += '-'.repeat(64) + '\n';
      exp += 'DISCLAIMER: Research and educational use only. Not for clinical diagnosis.\n';
      exp += '-'.repeat(64) + '\n';
      exp += '\n[Note: AI service unavailable — report generated from local analysis]\n';
      setAiExplanation(exp);
    }
    finally { setLoadingAI(false); }
  };

  const buildDomainColorMap = (gene) => {
    const domainColors = { 'Critical': ['#0E7490', '#0891B2', '#06B6D4', '#22D3EE'], 'Structural': ['#6D28D9', '#7C3AED', '#8B5CF6', '#A78BFA'], 'Regulatory': ['#065F46', '#047857', '#059669', '#34D399'] };
    const colorCounters = { Critical: 0, Structural: 0, Regulatory: 0 };
    const map = {};
    gene.domains.forEach(d => { const fr = d.functionalRegion; const idx = colorCounters[fr] || 0; colorCounters[fr] = idx + 1; const palette = domainColors[fr] || domainColors.Critical; map[d.name] = palette[idx % palette.length]; });
    return map;
  };

  return (
    <div data-tour="mutation-panel" style={{ minHeight: '100vh', background: '#0c0e14', color: '#e2e4e9', fontFamily: '"Sora",sans-serif', fontSize: '1.05em' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
        *{ box-sizing:border-box; margin:0; padding:0; }
        ::-webkit-scrollbar{ width:5px; } ::-webkit-scrollbar-track{ background:#131518; } ::-webkit-scrollbar-thumb{ background:#2a2d3a; border-radius:3px; }
        .pc{ background:#141720; border:1px solid #24272f; border-radius:12px; padding:1.5rem; margin-bottom:1.2rem; animation: fadeSlideIn 0.4s ease-out; }
        .lbl{ display:block; font-size:.95rem; font-weight:600; color:#6b7080; text-transform:uppercase; letter-spacing:.08em; margin-bottom:.5rem; }
        select, textarea{ width:100%; background:#0f1117; border:1px solid #24272f; border-radius:8px; color:#e2e4e9; font-family:'Sora',sans-serif; font-size:1.05rem; padding:.8rem .95rem; outline:none; transition:all .3s ease; }
        select:focus, textarea:focus{ border-color:#06B6D4; box-shadow: 0 0 0 3px rgba(6,182,212,0.1); }
        textarea{ resize:vertical; font-family:'JetBrains Mono',monospace; font-size:.95rem; line-height:1.85; }
        textarea::placeholder{ color:#2e3145; }
        .btn-p{ display:flex; align-items:center; justify-content:center; gap:.6rem; width:100%; padding:1rem 1.35rem; background:linear-gradient(135deg,#06B6D4,#0891B2); border:none; border-radius:10px; color:#fff; font-family:'Sora',sans-serif; font-weight:600; font-size:1.1rem; cursor:pointer; transition:all .3s ease; }
        .btn-p:hover{ filter:brightness(1.12); transform:translateY(-2px); box-shadow:0 8px 24px rgba(6,182,212,.4); } .btn-p:disabled{ filter:brightness(.5); cursor:not-allowed; transform:none; }
        .btn-ai{ display:flex; align-items:center; justify-content:center; gap:.6rem; width:100%; padding:.95rem 1.35rem; background:linear-gradient(135deg,#14B8A6,#0D9488); border:none; border-radius:10px; color:#fff; font-family:'Sora',sans-serif; font-weight:600; font-size:1.05rem; cursor:pointer; transition:all .3s ease; }
        .btn-ai:hover{ filter:brightness(1.12); transform:translateY(-2px); } .btn-ai:disabled{ filter:brightness(.5); cursor:not-allowed; transform:none; }
        .btn-pdf{ display:flex; align-items:center; justify-content:center; gap:.6rem; width:100%; padding:.95rem 1.35rem; background:linear-gradient(135deg,#8B5CF6,#7C3AED); border:none; border-radius:10px; color:#fff; font-family:'Sora',sans-serif; font-weight:600; font-size:1.05rem; cursor:pointer; transition:all .3s ease; }
        .btn-pdf:hover{ filter:brightness(1.12); transform:translateY(-2px); }
        .btn-g{ display:inline-flex; align-items:center; gap:.42rem; padding:.52rem 1rem; background:transparent; border:1px solid #24272f; border-radius:7px; color:#8a8f9e; font-family:'Sora',sans-serif; font-size:.95rem; font-weight:500; cursor:pointer; transition:all .25s ease; }
        .btn-g:hover{ border-color:#06B6D4; color:#06B6D4; background:rgba(6,182,212,.06); }
        .btn-sample{ display:inline-flex; align-items:center; gap:.42rem; padding:.5rem 1rem; background:rgba(6,182,212,.1); border:1px solid rgba(6,182,212,.3); border-radius:7px; color:#67E8F9; font-family:'Sora',sans-serif; font-size:.95rem; font-weight:500; cursor:pointer; transition:all .25s ease; position:relative; }
        .btn-sample:hover{ background:rgba(6,182,212,.18); border-color:rgba(6,182,212,.55); }
        .sample-menu{ position:absolute; top:calc(100% + .35rem); left:0; background:#141720; border:1px solid #24272f; border-radius:10px; box-shadow:0 12px 32px rgba(0,0,0,.45); padding:.6rem; z-index:100; min-width:280px; animation: dropdownSlide 0.25s ease-out; }
        .sample-item{ padding:.8rem .9rem; border-radius:8px; cursor:pointer; border:1px solid transparent; margin-bottom:.32rem; transition:all .2s ease; }
        .sample-item:hover{ border-color:#06B6D4; background:rgba(6,182,212,.07); }
        .info-wrap{ overflow:hidden; transition:max-height .4s cubic-bezier(.4,0,.2,1), opacity .3s; }
        .info-wrap.closed{ max-height:0; opacity:0; } .info-wrap.open{ max-height:1200px; opacity:1; }
        .stat-b{ background:#0f1117; border:1px solid #1e2130; border-radius:10px; padding:.9rem .7rem; text-align:center; transition:all .3s ease; }
        .stat-b:hover{ transform:translateY(-3px); box-shadow:0 4px 12px rgba(6,182,212,.15); border-color:#06B6D4; }
        .stat-v{ font-size:1.6rem; font-weight:700; line-height:1.2; } .stat-l{ font-size:.85rem; color:#6b7080; text-transform:uppercase; letter-spacing:.06em; margin-top:.3rem; }
        .mut-card{ background:#0f1117; border:1px solid #1e2130; border-radius:10px; padding:1.25rem; margin-bottom:.8rem; animation: fadeSlideIn 0.3s ease-out; transition:all .3s ease; }
        .mut-card:hover{ transform:translateX(4px); box-shadow:0 4px 16px rgba(6,182,212,.1); }
        .ai-box{ background:rgba(6,182,212,.08); border:1px solid rgba(6,182,212,.3); border-radius:12px; padding:1.35rem; margin-bottom:1.1rem; }
        table{ width:100%; border-collapse:collapse; margin-top:1rem; } th,td{ padding:0.75rem; text-align:left; border-bottom:1px solid #24272f; font-size:0.9rem; }
        th{ background:#0f1117; font-weight:600; color:#67E8F9; text-transform:uppercase; font-size:0.8rem; letter-spacing:0.05em; } td{ color:#8a8f9e; }
        .badge{ display:inline-block; padding:0.25rem 0.5rem; border-radius:4px; font-size:0.75rem; font-weight:600; }
        .badge-missense{ background:rgba(251,191,36,0.2); color:#FBBF24; border:1px solid rgba(251,191,36,0.3); }
        .badge-nonsense{ background:rgba(239,68,68,0.2); color:#EF4444; border:1px solid rgba(239,68,68,0.3); }
        .badge-silent{ background:rgba(16,185,129,0.2); color:#10B981; border:1px solid rgba(16,185,129,0.3); }
        .badge-frameshift{ background:rgba(220,38,38,0.2); color:#FCA5A5; border:1px solid rgba(220,38,38,0.3); }
        .warning{ background:rgba(251,191,36,0.1); border:1px solid rgba(251,191,36,0.3); border-radius:6px; padding:0.75rem; margin-bottom:1rem; color:#FBBF24; }
        .error{ background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); border-radius:6px; padding:0.75rem; margin-bottom:1rem; color:#EF4444; }
        .seq-input-grid{ display:grid; grid-template-columns:1fr 1fr; gap:1.2rem; }
        .config-grid{ display:grid; grid-template-columns:1fr 1fr; gap:1rem; }
        .summary-grid{ display:grid; grid-template-columns:repeat(4,1fr); gap:.6rem; }
        .mode-tab{ display:flex; align-items:center; justify-content:center; gap:.45rem; padding:.65rem 1.2rem; border-radius:8px; font-family:'Sora',sans-serif; font-weight:600; font-size:.95rem; cursor:pointer; border:1px solid #24272f; background:transparent; color:#6b7080; transition:all .25s ease; flex:1; }
        .mode-tab.active{ background:rgba(6,182,212,.12); border-color:rgba(6,182,212,.45); color:#67E8F9; }
        .mode-tab:hover:not(.active){ border-color:#3a3d4a; color:#a0a4b0; }
        .vcf-drop{ border:2px dashed #24272f; border-radius:12px; padding:2.5rem 1.5rem; text-align:center; transition:all .3s ease; cursor:pointer; }
        .vcf-drop.dragover{ border-color:#06B6D4; background:rgba(6,182,212,.06); }
        .variant-row{ padding:.75rem .9rem; border-radius:8px; cursor:pointer; border:1px solid transparent; margin-bottom:.4rem; transition:all .2s ease; background:#0f1117; }
        .variant-row.selected{ border-color:#06B6D4; background:rgba(6,182,212,.08); }
        .variant-row:hover:not(.selected){ border-color:#3a3d4a; }
        .vcf-badge{ display:inline-flex; align-items:center; gap:.3rem; background:rgba(139,92,246,.15); border:1px solid rgba(139,92,246,.35); color:#A78BFA; font-size:.78rem; font-weight:600; padding:.2rem .55rem; border-radius:6px; letter-spacing:.04em; text-transform:uppercase; }
        .path-pathogenic{ background:rgba(220,38,38,.15); border:1px solid rgba(220,38,38,.4); border-radius:8px; padding:.75rem .9rem; margin-top:.75rem; }
        .path-likely{ background:rgba(245,158,11,.12); border:1px solid rgba(245,158,11,.35); border-radius:8px; padding:.75rem .9rem; margin-top:.75rem; }
        .path-benign{ background:rgba(16,185,129,.1); border:1px solid rgba(16,185,129,.3); border-radius:8px; padding:.75rem .9rem; margin-top:.75rem; }
        .path-vus{ background:rgba(99,102,241,.12); border:1px solid rgba(99,102,241,.35); border-radius:8px; padding:.75rem .9rem; margin-top:.75rem; }
        .path-label{ font-size:.82rem; font-weight:700; letter-spacing:.06em; text-transform:uppercase; margin-bottom:.35rem; display:flex; align-items:center; gap:.4rem; }
        .path-bar-wrap{ height:6px; background:#1e2130; border-radius:3px; overflow:hidden; margin:.45rem 0; }
        .path-bar{ height:100%; border-radius:3px; transition:width .6s ease; }
        @keyframes spin{ to{ transform:rotate(360deg); } }
        .spin{ display:inline-block; width:18px; height:18px; border:2px solid rgba(255,255,255,.25); border-top-color:#fff; border-radius:50%; animation:spin .5s linear infinite; }
        @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
        @keyframes fadeSlideIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        @keyframes dropdownSlide { from { opacity:0; transform:translateY(-10px); } to { opacity:1; transform:translateY(0); } }
        @keyframes domainPulse { 0%,100%{ opacity:1; } 50%{ opacity:0.3; } }
        @media(max-width:640px){
          .pc{ padding:.85rem; } .seq-input-grid{ grid-template-columns:1fr; } .config-grid{ grid-template-columns:1fr; }
          .summary-grid{ grid-template-columns:repeat(2,1fr); } .gene-grid{ grid-template-columns:repeat(2,1fr) !important; } .action-grid{ grid-template-columns:1fr !important; }
          .mode-switcher{ flex-direction:column; }
          .mode-tab{ padding:.55rem .6rem !important; font-size:.82rem !important; flex-direction:column; text-align:center; min-width:0 !important; }
          .mode-tab span{ font-size:.82rem !important; word-break:break-word; white-space:normal !important; }
          .btn-p, .btn-ai, .btn-pdf{ padding:.8rem .6rem !important; font-size:.92rem !important; }
          .btn-sample{ font-size:.82rem !important; padding:.4rem .65rem !important; }
          .sample-menu{ min-width:240px !important; max-width:calc(100vw - 2rem) !important; left:0 !important; right:0 !important; }
        }
        @media(max-width:768px){
          .seq-input-grid{ grid-template-columns:1fr; } .config-grid{ grid-template-columns:1fr; }
          .summary-grid{ grid-template-columns:repeat(2,1fr); } .gene-grid{ grid-template-columns:repeat(2,1fr) !important; } .action-grid{ grid-template-columns:1fr !important; }
          .mode-tab{ padding:.6rem .7rem !important; font-size:.88rem !important; }
          .btn-p, .btn-ai, .btn-pdf{ font-size:.95rem !important; }
        }
      `}</style>

      <div style={{ maxWidth: '860px', margin: '0 auto', padding: '1.25rem 1.2rem 3rem', overflowX: 'hidden' }}>

        {/* HEADER */}
        <div style={{ background: 'linear-gradient(180deg,#141820 0%,#0c0e14 100%)', borderBottom: '1px solid #1e2130', padding: '1.65rem 1.3rem 1.3rem', margin: '-1.25rem -1.2rem 0', marginBottom: '1.25rem' }}>
          <div style={{ maxWidth: 860, margin: '0 auto' }}>
            <div style={{ background: `linear-gradient(135deg, ${activeGene.color}22 0%, #083344 100%)`, border: `2px solid ${activeGene.color}55`, borderRadius: '14px', padding: '1rem 1.1rem', marginBottom: '.6rem', boxShadow: `0 8px 32px ${activeGene.color}25` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
                <h1 style={{ fontFamily: 'Sora', fontWeight: 700, fontSize: 'clamp(1.2rem,4vw,1.75rem)', color: '#fff', margin: 0, lineHeight: 1.2 }}>Cancer Gene Mutation Analyzer</h1>
                <span style={{ background: 'rgba(6,182,212,.2)', border: '1px solid rgba(6,182,212,.4)', color: '#67E8F9', fontSize: '.72rem', fontWeight: 600, padding: '.2rem .5rem', borderRadius: 20, letterSpacing: '.07em', textTransform: 'uppercase' }}>Research Grade</span>
                <span className="vcf-badge">VCF Support</span>
                <span style={{ background: 'rgba(16,185,129,.15)', border: '1px solid rgba(16,185,129,.35)', color: '#6EE7B7', fontSize: '.72rem', fontWeight: 600, padding: '.2rem .5rem', borderRadius: 20, textTransform: 'uppercase' }}>Multi-Gene Panel</span>
              </div>
            </div>
            <p style={{ color: '#6b7080', fontSize: '1.05rem', lineHeight: 1.6, maxWidth: 600, margin: 0 }}>Analyze mutations across TP53, BRCA1, KRAS, EGFR — with codon resolution, domain annotation, and clickable 3D structure exploration.</p>
          </div>
        </div>

        {/* TOP LEVEL MODE SWITCHER */}
        <div className="mode-switcher" style={{ display: 'flex', gap: '.6rem', marginBottom: '1.25rem', width: '100%' }}>
          <button className={`mode-tab ${!isCancerMode ? 'active' : ''}`} onClick={() => switchMode('research')} style={{ padding: '.85rem .6rem', border: !isCancerMode ? '2px solid rgba(6,182,212,.5)' : '1px solid #24272f', background: !isCancerMode ? 'rgba(6,182,212,.1)' : '#0f1117', minWidth: 0, overflow: 'hidden' }}>
            <span style={{ fontSize: 'clamp(.82rem, 2.5vw, 1.05rem)', fontWeight: 700, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Research Mode</span>
            <span style={{ fontSize: 'clamp(.62rem, 1.8vw, .75rem)', color: !isCancerMode ? '#a5f3fc' : '#6b7080', fontWeight: 400, marginTop: '.2rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Manual sequence input & analysis</span>
          </button>
          <button className={`mode-tab ${isCancerMode ? 'active' : ''}`} onClick={() => switchMode('cancer')} style={{ padding: '.85rem .6rem', border: isCancerMode ? '2px solid rgba(16,185,129,.5)' : '1px solid #24272f', background: isCancerMode ? 'rgba(16,185,129,.1)' : '#0f1117', minWidth: 0, overflow: 'hidden' }}>
            <span style={{ fontSize: 'clamp(.82rem, 2.5vw, 1.05rem)', fontWeight: 700, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Cancer Intelligence</span>
            <span style={{ fontSize: 'clamp(.62rem, 1.8vw, .75rem)', color: isCancerMode ? '#a7f3d0' : '#6b7080', fontWeight: 400, marginTop: '.2rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Gene panel & clinical reports</span>
          </button>
        </div>

        {/* GENE PANEL SELECTOR */}
        {isCancerMode && (
          <div className="pc" style={{ borderColor: 'rgba(16,185,129,.3)', background: 'rgba(16,185,129,.04)', marginBottom: '1.1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '1rem' }}>

              <span style={{ fontSize: '1rem', fontWeight: 600, color: '#6EE7B7' }}>Gene Panel Selection</span>
            </div>
            <div className="gene-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '.5rem' }}>
              {Object.values(GENE_PANEL).map(gene => (
                <button key={gene.symbol} onClick={() => { setSelectedGene(gene.symbol); setMutations(null); setAnnotatedMutations([]); setError(''); setAiExplanation(''); setShowRCSB(false); }}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.25rem', padding: '.75rem .4rem', background: selectedGene === gene.symbol ? `${gene.color}18` : '#0f1117', border: selectedGene === gene.symbol ? `2px solid ${gene.color}` : '1px solid #1e2130', borderRadius: 10, cursor: 'pointer', transition: 'all .25s ease', boxShadow: selectedGene === gene.symbol ? `0 4px 16px ${gene.color}30` : 'none' }}>
                  <span style={{ fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, fontSize: '.9rem', color: selectedGene === gene.symbol ? gene.color : '#c8cad4' }}>{gene.symbol}</span>
                  <span style={{ fontSize: '.68rem', color: '#6b7080', textAlign: 'center', lineHeight: 1.3 }}>{gene.type}</span>
                </button>
              ))}
            </div>
            <div style={{ marginTop: '1rem', padding: '.85rem 1rem', background: `${activeGene.color}0d`, border: `1px solid ${activeGene.color}30`, borderRadius: 8 }}>
              <div style={{ fontSize: '.85rem', fontWeight: 600, color: activeGene.color, marginBottom: '.3rem' }}>{activeGene.icon} {activeGene.symbol} — {activeGene.name}</div>
              <div style={{ fontSize: '.85rem', color: '#8a8f9e', lineHeight: 1.6 }}>{activeGene.clinicalContext}</div>
            </div>
          </div>
        )}

        {/* INFO TOGGLE */}
        <button className="btn-g" onClick={() => setInfoOpen(v => !v)} style={{ width: '100%', justifyContent: 'space-between', marginBottom: '1.1rem' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '.45rem' }}><span>Why This Tool Matters & How to Use It</span></span>
          <span style={{ fontSize: '.82rem', color: '#6b7080', transition: 'transform .25s', transform: infoOpen ? 'rotate(180deg)' : 'rotate(0)', display: 'inline-block' }}>▼</span>
        </button>
        <div className={`info-wrap ${infoOpen ? 'open' : 'closed'}`}>
          <div className="pc" style={{ padding: '1.45rem' }}>
            {isCancerMode ? (
              <>
                <h4 style={{ color: '#6EE7B7', marginBottom: '.6rem', fontSize: '1.1rem' }}>Cancer Intelligence Mode</h4>
                <p style={{ fontSize: '1.05rem', color: '#8a8f9e', lineHeight: 1.75, marginBottom: '1.3rem' }}>
                  This mode is engineered for translational oncology and clinical variant interpretation. It allows researchers to evaluate specific mutations in known cancer drivers (e.g., TP53, KRAS, BRCA1, EGFR) by computing their structural, biochemical, and clinical consequences in real-time.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.2rem', marginBottom: '1.5rem' }}>
                  <div>
                    <h5 style={{ color: '#c8cad4', marginBottom: '.4rem', fontSize: '.95rem' }}>Instant Clinical Context</h5>
                    <p style={{ fontSize: '.9rem', color: '#8a8f9e', lineHeight: 1.6 }}>Replaces manual literature review by instantly cross-referencing variants against COSMIC (somatic) and ClinVar (germline) databases for live pathogenicity thresholds.</p>
                  </div>
                  <div>
                    <h5 style={{ color: '#c8cad4', marginBottom: '.4rem', fontSize: '.95rem' }}>Structural Topology Mapping</h5>
                    <p style={{ fontSize: '.9rem', color: '#8a8f9e', lineHeight: 1.6 }}>Renders true PDB coordinates in 3D, allowing visual confirmation of whether a mutation destabilizes a core hydrophobic pocket or breaks a critical DNA-binding zinc finger.</p>
                  </div>
                  <div>
                    <h5 style={{ color: '#c8cad4', marginBottom: '.4rem', fontSize: '.95rem' }}>ACMG-Aligned Scoring</h5>
                    <p style={{ fontSize: '.9rem', color: '#8a8f9e', lineHeight: 1.6 }}>Calculates a weighted Pathogenicity Score using BLOSUM62 matrices, empirical frequencies, and structural disruption heuristics to predict severity.</p>
                  </div>
                  <div>
                    <h5 style={{ color: '#c8cad4', marginBottom: '.4rem', fontSize: '.95rem' }}>Automated Clinical Reports</h5>
                    <p style={{ fontSize: '.9rem', color: '#8a8f9e', lineHeight: 1.6 }}>Generates formalized, exportable reports detailing geometric structural consequences, evolutionary conservation, and biochemical polarity shifts.</p>
                  </div>
                </div>
                <h5 style={{ color: '#c8cad4', marginBottom: '.6rem', fontSize: '1rem', borderBottom: '1px solid #334155', paddingBottom: '.4rem' }}>How to Use It</h5>
                <ol style={{ fontSize: '.95rem', color: '#8a8f9e', lineHeight: 1.6, paddingLeft: '1.2rem', margin: 0 }}>
                  <li style={{ marginBottom: '.4rem' }}><strong style={{ color: '#e2e8f0' }}>Select a Target Gene:</strong> Choose an oncogene or tumor suppressor from the curated dropdown (e.g., TP53).</li>
                  <li style={{ marginBottom: '.4rem' }}><strong style={{ color: '#e2e8f0' }}>Input the Variant:</strong> Enter a clinically standard HGVS notation (like <code>R175H</code>), or paste raw sequence data.</li>
                  <li style={{ marginBottom: '.4rem' }}><strong style={{ color: '#e2e8f0' }}>Analyze & Interpret:</strong> Click 'Analyze Mutation'. The engine will translate the sequence, align the reading frame, and score the biochemical disruption.</li>
                  <li><strong style={{ color: '#e2e8f0' }}>Export Findings:</strong> Use the interactive viewer to rotate the affected domain, then export the comprehensive text report for external review.</li>
                </ol>
              </>
            ) : (
              <>
                <h4 style={{ color: '#67E8F9', marginBottom: '.6rem', fontSize: '1.1rem' }}>Research Mode</h4>
                <p style={{ fontSize: '1.05rem', color: '#8a8f9e', lineHeight: 1.75, marginBottom: '1.3rem' }}>
                  A general-purpose sandboxed environment designed for aligning and interrogating novel, proprietary, or undiscovered DNA sequences without clinical bias.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.2rem', marginBottom: '1.5rem' }}>
                  <div>
                    <h5 style={{ color: '#c8cad4', marginBottom: '.4rem', fontSize: '.95rem' }}>Unbiased Variant Detection</h5>
                    <p style={{ fontSize: '.9rem', color: '#8a8f9e', lineHeight: 1.6 }}>Computes reading frame offsets dynamically to trace raw amino acid changes, revealing complex insertions, missense, nonsense, and frameshifts.</p>
                  </div>
                  <div>
                    <h5 style={{ color: '#c8cad4', marginBottom: '.4rem', fontSize: '.95rem' }}>Total Privacy Integrity</h5>
                    <p style={{ fontSize: '.9rem', color: '#8a8f9e', lineHeight: 1.6 }}>Entirely unlinks your analysis from remote cloud-hosted cancer databases; sensitive proprietary IP never leaves your local browser memory.</p>
                  </div>
                  <div>
                    <h5 style={{ color: '#c8cad4', marginBottom: '.4rem', fontSize: '.95rem' }}>Mathematical Transparency</h5>
                    <p style={{ fontSize: '.9rem', color: '#8a8f9e', lineHeight: 1.6 }}>Translates base pairs strictly logically, bypassing pre-configured clinical heuristics to evaluate synthetic biology circuits and unknown frames.</p>
                  </div>
                  <div>
                    <h5 style={{ color: '#c8cad4', marginBottom: '.4rem', fontSize: '.95rem' }}>Dynamic 2D Modelling</h5>
                    <p style={{ fontSize: '.9rem', color: '#8a8f9e', lineHeight: 1.6 }}>Simulates basic N/C-terminal boundaries by mapping arbitrary gene lengths into a two-dimensional framework, highlighting structural collapses.</p>
                  </div>
                </div>
                <h5 style={{ color: '#c8cad4', marginBottom: '.6rem', fontSize: '1rem', borderBottom: '1px solid #334155', paddingBottom: '.4rem' }}>How to Use It</h5>
                <ol style={{ fontSize: '.95rem', color: '#8a8f9e', lineHeight: 1.6, paddingLeft: '1.2rem', margin: 0 }}>
                  <li style={{ marginBottom: '.4rem' }}><strong style={{ color: '#e2e8f0' }}>Provide Baseline:</strong> Paste the known reference sequence (or expected synthetic sequence).</li>
                  <li style={{ marginBottom: '.4rem' }}><strong style={{ color: '#e2e8f0' }}>Provide Experimental Read:</strong> Paste your alternate sequence (from sequencing data or a mutant strain).</li>
                  <li style={{ marginBottom: '.4rem' }}><strong style={{ color: '#e2e8f0' }}>Set Parameters:</strong> Adjust the reading frame (1, 2, or 3) and strand direction (forward/reverse).</li>
                  <li><strong style={{ color: '#e2e8f0' }}>Investigate the Alignment:</strong> Click 'Analyze Mutation' to dynamically map where substitutions emerged and where frameshifts destroyed the topology.</li>
                </ol>
              </>
            )}
          </div>
        </div>

        {/* LOAD SAMPLE */}
        <div style={{ position: 'relative', marginBottom: '1.1rem' }}>
          <button className="btn-sample sample-shine" onClick={e => { e.stopPropagation(); setShowSampleMenu(v => !v); }}>
            <span>Load Sample Mutations</span><span style={{ fontSize: '.82rem', color: '#6b7080', marginLeft: '.25rem' }}>▼</span>
          </button>
          {showSampleMenu && (
            <div className="sample-menu" onClick={e => e.stopPropagation()}>
              {Object.entries(isCancerMode ? CANCER_SAMPLES : RESEARCH_SAMPLES).map(([k, s]) => (
                <div key={k} className="sample-item" onClick={() => loadSample(s)} style={{ background: `${s.color}0a` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.55rem', marginBottom: '.22rem' }}><span style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: '.7rem', fontWeight: 700, color: '#fff', background: s.color, padding: '.15rem .4rem', borderRadius: 4, letterSpacing: '.04em' }}>{s.tag}</span><span style={{ fontSize: '1rem', fontWeight: 600, color: s.color }}>{s.name}</span></div>
                  <div style={{ fontSize: '.9rem', color: '#8a8f9e' }}>{s.description}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {sampleBannerVisible && currentSample && (
          <div className="pc" style={{ borderColor: currentSample.color + '55', background: `${currentSample.color}08`, marginBottom: '1.1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                <span style={{ fontSize: '1.6rem' }}>{currentSample.icon}</span>
                <div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 700, color: currentSample.color }}>Sample Loaded: {currentSample.name}</div>
                  <div style={{ fontSize: '.95rem', color: '#8a8f9e', marginTop: '.12rem' }}>{currentSample.description}</div>
                </div>
              </div>
              <button onClick={() => setSampleBannerVisible(false)} style={{ background: 'none', border: 'none', color: '#6b7080', fontSize: '1.4rem', cursor: 'pointer' }}>×</button>
            </div>
          </div>
        )}

        {/* ANALYSIS CONFIG */}
        <div className="pc" style={{ borderColor: 'rgba(6,182,212,.3)', background: 'rgba(6,182,212,.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.45rem', marginBottom: '.8rem' }}>
            <span style={{ fontSize: '1rem', fontWeight: 600, color: '#67E8F9' }}>Analysis Configuration</span>
          </div>
          <div style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.25)', borderRadius: '8px', padding: '.9rem', marginBottom: '1rem' }}>
            <label className="lbl" style={{ color: '#10B981', marginBottom: '.5rem' }}>Active Transcript</label>
            <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: '.95rem', color: activeGene.color, fontWeight: 600 }}>{activeGene.id}</div>
            <div style={{ fontSize: '.88rem', color: '#8a8f9e', fontStyle: 'italic', marginTop: '.2rem' }}>{activeGene.icon} {activeGene.fullName}</div>
          </div>
          <div className="config-grid">
            <div><label className="lbl">Reading Frame</label>
              <select value={readingFrame} onChange={e => setReadingFrame(e.target.value)}>
                <option value="1">+1 (start at position 1)</option>
                <option value="2">+2 (start at position 2)</option>
                <option value="3">+3 (start at position 3)</option>
              </select>
            </div>
            <div><label className="lbl">Strand</label>
              <select value={strand} onChange={e => setStrand(e.target.value)}>
                <option value="forward">Forward (5′ → 3′)</option>
                <option value="reverse">Reverse (3′ → 5′)</option>
              </select>
            </div>
          </div>
        </div>

        {/* INPUT MODE */}
        <div className="pc">
          <div style={{ display: 'flex', gap: '.6rem', marginBottom: '1.2rem' }}>
            <button className={`mode-tab ${!vcfMode ? 'active' : ''}`} onClick={() => { setVcfMode(false); setVcfMeta(null); }}>Manual Entry</button>
            <button className={`mode-tab ${vcfMode ? 'active' : ''}`} onClick={() => setVcfMode(true)}>
              VCF File Upload
              <span style={{ background: 'rgba(139,92,246,.2)', border: '1px solid rgba(139,92,246,.4)', color: '#A78BFA', fontSize: '.7rem', fontWeight: 700, padding: '.12rem .4rem', borderRadius: 5, marginLeft: '.35rem', textTransform: 'uppercase' }}>NGS</span>
            </button>
          </div>

          {vcfMode ? (
            <div>
              <div className={`vcf-drop ${isDragOver ? 'dragover' : ''}`} onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onClick={() => vcfInputRef.current?.click()} style={{ marginBottom: '1rem' }}>
                <input ref={vcfInputRef} type="file" accept=".vcf,.txt" onChange={handleVcfInputChange} style={{ display: 'none' }} />
                {vcfLoading ? (<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.75rem' }}><span className="spin" style={{ width: 28, height: 28, borderWidth: 3 }}></span><span style={{ color: '#6b7080' }}>Parsing VCF file…</span></div>)
                  : vcfFile && !vcfError ? (<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.5rem' }}><span style={{ fontSize: '2rem' }}>[OK]</span><div style={{ fontWeight: 600, color: '#10B981' }}>{vcfFile.name}</div><div style={{ fontSize: '.9rem', color: '#6b7080' }}>{vcfParsed?.variants.length} variant{vcfParsed?.variants.length !== 1 ? 's' : ''} found</div></div>)
                    : (<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.65rem' }}><span style={{ fontSize: '2.5rem' }}></span><div style={{ fontWeight: 600, color: '#c8cad4', fontSize: '1.05rem' }}>Drop your VCF file here</div><div style={{ fontSize: '.9rem', color: '#6b7080' }}>or click to browse</div></div>)}
              </div>
              {vcfError && <div className="error" style={{ marginBottom: '1rem' }}>{vcfError}</div>}
              {vcfParsed && vcfParsed.variants.length > 0 && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.65rem' }}>
                    <label className="lbl" style={{ margin: 0 }}>Select Variant to Analyze</label>
                    <span style={{ fontSize: '.85rem', color: '#6b7080' }}>{vcfParsed.variants.length} variants</span>
                  </div>
                  <div style={{ maxHeight: 220, overflowY: 'auto', paddingRight: '.25rem' }}>
                    {vcfParsed.variants.map((v, i) => (
                      <div key={i} className={`variant-row ${vcfSelectedIdx === i ? 'selected' : ''}`} onClick={() => { setVcfSelectedIdx(i); loadVcfVariant(v); }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem', flexWrap: 'wrap' }}>
                          <span style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: '.9rem', color: '#67E8F9', fontWeight: 600 }}>{v.chrom}:{v.pos}</span>
                          <span style={{ fontFamily: '"JetBrains Mono",monospace', color: '#60A5FA' }}>{v.ref}</span>
                          <span style={{ color: '#6b7080' }}>→</span>
                          <span style={{ fontFamily: '"JetBrains Mono",monospace', color: '#FBBF24' }}>{v.alt}</span>
                          <span style={{ fontSize: '.85rem', color: '#6b7080', marginLeft: 'auto' }}>{v.id}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#c8cad4', marginBottom: '1.1rem' }}>Sequence Input</h3>
              {isCancerMode ? (
                <div style={{ marginBottom: '1rem' }}>
                  <label className="lbl">Variant Input (HGVS Notation or Mutant DNA Sequence)</label>
                  <textarea rows={4} value={cancerInput} onChange={e => {
                    const val = e.target.value; setCancerInput(val); setCancerInputType(detectInputType(val));
                  }} placeholder={`Enter variant (e.g. R175H, p.Arg175His) or complete mutant DNA sequence for ${selectedGene}…`} />
                  <div style={{ marginTop: '.38rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '.85rem', fontFamily: '"JetBrains Mono",monospace', color: cancerInputType === 'hgvs' ? '#10B981' : cancerInputType === 'sequence' ? '#60A5FA' : '#6b7080', fontWeight: 600 }}>
                      Detected format: {cancerInputType.toUpperCase()}
                    </span>
                    {cancerInputType === 'sequence' && <span style={{ fontSize: '.85rem', fontFamily: '"JetBrains Mono",monospace', color: '#6b7080' }}>
                      {cancerInput.trim().replace(/\s/g, '').length.toLocaleString()} bp vs Reference {CANONICAL_REFERENCES[selectedGene].length.toLocaleString()} bp
                    </span>}
                  </div>
                </div>
              ) : (
                <div className="seq-input-grid" style={{ marginBottom: '1rem' }}>
                  <div>
                    <label className="lbl">Reference Sequence</label>
                    <textarea rows={5} value={seq1} onChange={e => setSeq1(e.target.value)} placeholder="Paste reference DNA sequence (ATGC)…" />
                    <div style={{ marginTop: '.38rem', fontSize: '.88rem', fontFamily: '"JetBrains Mono",monospace', color: '#6b7080' }}>{seq1.trim().length.toLocaleString()} bp</div>
                  </div>
                  <div>
                    <label className="lbl">Alternate Sequence</label>
                    <textarea rows={5} value={seq2} onChange={e => setSeq2(e.target.value)} placeholder="Paste alternate DNA sequence (ATGC)…" />
                    <div style={{ marginTop: '.38rem', fontSize: '.88rem', fontFamily: '"JetBrains Mono",monospace', color: '#6b7080' }}>{seq2.trim().length.toLocaleString()} bp</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {error && <div className="error" style={{ marginBottom: '1rem' }}>{error}</div>}
          {(() => {
            const canAnalyze = isCancerMode
              ? (cancerInput.trim().length > 0)
              : (seq1.trim().length > 0 && seq2.trim().length > 0);
            return (
              <button className="btn-p" onClick={handleAnalyze} disabled={loading || !canAnalyze} style={{ opacity: !canAnalyze ? 0.5 : 1 }}>
                {loading ? <><span className="spin"></span><span>Analyzing...</span></> : <><span>Analyze Mutations</span></>}
              </button>
            );
          })()}
        </div>

        {/* RESULTS */}
        {mutations && (<>
          {mutations.warnings?.length > 0 && (<div className="warning"><strong>Validation Warnings:</strong><ul style={{ marginTop: '.5rem', paddingLeft: '1.5rem' }}>{mutations.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>)}

          <div className="action-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem', marginBottom: '.8rem', maxWidth: '100%', overflow: 'hidden' }}>
            <button className="btn-ai" onClick={handleAI} disabled={loadingAI} style={{ minWidth: 0, overflow: 'hidden' }}>{loadingAI ? <><span className="spin"></span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Generating…</span></> : <><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Get AI Explanation</span></>}</button>
            <button className="btn-pdf" onClick={handleExportPDF} style={{ minWidth: 0, overflow: 'hidden' }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Download Report</span></button>
          </div>

          {aiExplanation && (
            <div className="ai-box">
              <div style={{ display: 'flex', alignItems: 'center', gap: '.45rem', marginBottom: '.65rem' }}><span style={{ fontSize: '1rem', fontWeight: 600, color: '#67E8F9' }}>AI Analysis</span></div>
              <div style={{ fontSize: '1rem', color: '#e2e4e9', lineHeight: 1.8, whiteSpace: 'pre-wrap', maxHeight: 440, overflowY: 'auto', background: 'rgba(0,0,0,.25)', borderRadius: 8, padding: '.85rem', border: '1px solid #24272f' }}>{aiExplanation}</div>
            </div>
          )}

          {/* SUMMARY */}
          <div className="pc">
            <div style={{ display: 'flex', alignItems: 'center', gap: '.45rem', marginBottom: '.65rem' }}>
              <span>{activeGene.icon}</span><span style={{ fontSize: '1rem', fontWeight: 600, color: '#c8cad4' }}>{activeGene.symbol} — Summary Statistics</span>
            </div>
            <div className="summary-grid">
              {[{ l: 'Total', v: mutations.summary.total_mutations, c: '#fff' }, { l: 'SNPs', v: mutations.summary.snps, c: '#60A5FA' }, { l: 'Missense', v: mutations.summary.missense_mutations, c: '#FBBF24' }, { l: 'Nonsense', v: mutations.summary.nonsense_mutations, c: '#EF4444' }, { l: 'Silent', v: mutations.summary.silent_mutations, c: '#10B981' }, { l: 'Insertions', v: mutations.summary.insertions, c: '#F59E0B' }, { l: 'Deletions', v: mutations.summary.deletions, c: '#EF4444' }, { l: 'Frameshift', v: mutations.summary.frameshift_mutations, c: '#DC2626' }].map((s, i) => (
                <div key={i} className="stat-b"><div className="stat-v" style={{ color: s.c }}>{s.v}</div><div className="stat-l">{s.l}</div></div>
              ))}
            </div>
          </div>

          {/* MUTATION OVERVIEW TABLE */}
          {annotatedMutations.length > 0 && (
            <div className="pc" data-tour="mutation-details">
              <div style={{ display: 'flex', alignItems: 'center', gap: '.55rem', marginBottom: '.8rem' }}>
                <span style={{ fontSize: '1rem', fontWeight: 600, color: '#c8cad4' }}>Mutation Overview Table</span>
                <span style={{ background: 'rgba(16,185,129,.18)', color: '#10B981', fontSize: '.8rem', fontWeight: 600, padding: '.18rem .48rem', borderRadius: 8 }}>{annotatedMutations.length} annotated</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead><tr><th>Nucleotide</th><th>Codon</th><th>AA Pos</th><th>HGVS</th><th>Type</th><th>Effect</th><th>Domain</th></tr></thead>
                  <tbody>
                    {annotatedMutations.map((am, i) => (
                      <tr key={i}>
                        <td style={{ fontFamily: '"JetBrains Mono",monospace', color: '#67E8F9' }}>{am.positions.nucleotidePosition}</td>
                        <td style={{ fontFamily: '"JetBrains Mono",monospace', color: '#67E8F9' }}>{am.positions.codonNumber}</td>
                        <td style={{ fontFamily: '"JetBrains Mono",monospace', color: '#10B981', fontWeight: 600 }}>{am.positions.aaPosition}</td>
                        <td style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: '.82rem', color: '#60A5FA' }}>{am.hgvs}</td>
                        <td style={{ color: '#c8cad4' }}>{am.mutation.type}</td>
                        <td><span className={`badge badge-${am.mutation.mutation_class?.toLowerCase()}`}>{am.mutation.mutation_class}</span></td>
                        <td style={{ fontSize: '.85rem', color: '#8a8f9e' }}>{am.domainMapping.proteinDomain}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* PROTEIN STRUCTURE VISUALIZATION */}
          {isCancerMode && (() => {
            const gene = activeGene;
            const totalLen = gene.proteinLength;
            const domainColorMap = buildDomainColorMap(gene);
            const mutPins = annotatedMutations.map(am => ({ pos: am.positions.aaPosition, hgvs: am.hgvs, color: am.mutation.is_frameshift ? '#EF4444' : am.mutation.mutation_class === 'Missense' ? '#FBBF24' : am.mutation.mutation_class === 'Nonsense' ? '#EF4444' : '#10B981' }));

            return (
              <div className="pc" data-tour="mutation-structure" style={{ borderColor: 'rgba(99,102,241,.35)', background: 'rgba(99,102,241,.04)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>

                    <span style={{ fontSize: '1rem', fontWeight: 600, color: '#c8cad4' }}>Protein Structure Visualization</span>
                    <span style={{ background: 'rgba(99,102,241,.2)', border: '1px solid rgba(99,102,241,.4)', color: '#A78BFA', fontSize: '.72rem', fontWeight: 600, padding: '.15rem .45rem', borderRadius: 6, textTransform: 'uppercase' }}>2D + 3D Interactive</span>
                  </div>
                </div>

                {/* 2D DOMAIN MAP */}
                <div style={{ marginBottom: '1.2rem' }}>
                  <div style={{ fontSize: '.85rem', fontWeight: 600, color: '#818CF8', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '.6rem' }}>2D Domain Architecture</div>
                  <div style={{ position: 'relative', marginBottom: '2.8rem' }}>
                    <div style={{ position: 'relative', height: '28px', background: '#1a1d26', borderRadius: 4, border: '1px solid #2a2d3a' }}>
                      {gene.domains.map((d, di) => {
                        const left = ((d.start - 1) / totalLen) * 100;
                        const width = ((d.end - d.start + 1) / totalLen) * 100;
                        const col = domainColorMap[d.name] || '#06B6D4';
                        return (
                          <div key={di} title={`${d.name} (${d.start}–${d.end})\n${d.description}`}
                            style={{ position: 'absolute', top: 0, left: `${left}%`, width: `${Math.max(width, 1.5)}%`, height: '100%', background: col, borderRadius: 3, opacity: .9, cursor: 'help', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                            {width > 6 && <span style={{ fontSize: '.6rem', color: 'rgba(255,255,255,.9)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 3px' }}>{d.name.replace(' Domain', '').replace(' Signal', '').replace(' Region', '')}</span>}
                          </div>
                        );
                      })}
                      {mutPins.map((pin, pi) => {
                        const pct = ((pin.pos - 1) / totalLen) * 100;
                        return (
                          <div key={pi} title={pin.hgvs} style={{ position: 'absolute', top: '-2px', left: `${pct}%`, transform: 'translateX(-50%)', zIndex: 10 }}>
                            <div style={{ width: 2, height: 36, background: pin.color, margin: '0 auto', borderRadius: 1 }}></div>
                            <div style={{ width: 10, height: 10, background: pin.color, borderRadius: '50%', margin: '-6px auto 0', border: '2px solid #0c0e14', boxShadow: `0 0 6px ${pin.color}` }}></div>
                            <div style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 4, whiteSpace: 'nowrap', fontSize: '.62rem', color: pin.color, fontFamily: '"JetBrains Mono",monospace', fontWeight: 600, background: '#0c0e14', padding: '1px 4px', borderRadius: 3 }}>
                              {pin.hgvs.split(':p.')[1] || pin.hgvs}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.45rem', marginTop: '.5rem' }}>
                    {gene.domains.map((d, di) => (
                      <div key={di} style={{ display: 'flex', alignItems: 'center', gap: '.3rem', background: '#0f1117', border: '1px solid #1e2130', borderRadius: 6, padding: '.25rem .55rem' }}>
                        <div style={{ width: 10, height: 10, background: domainColorMap[d.name] || '#06B6D4', borderRadius: 2, flexShrink: 0 }}></div>
                        <span style={{ fontSize: '.75rem', color: '#8a8f9e' }}>{d.name}</span>
                        <span style={{ fontSize: '.7rem', color: '#4a4d5a', fontFamily: '"JetBrains Mono",monospace' }}>{d.start}–{d.end}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3D VIEWER */}
                <StructureViewer gene={gene} showRCSB={showRCSB} setShowRCSB={setShowRCSB} mutPins={mutPins} />
              </div>
            );
          })()}

          {/* DETAILED MUTATION REPORT */}
          {annotatedMutations.length > 0 && (
            <div className="pc">
              <div style={{ fontSize: '1rem', fontWeight: 600, color: '#c8cad4', marginBottom: '.8rem' }}>Detailed Mutation Interpretation</div>
              {annotatedMutations.map((am, idx) => {
                const path = am.pathogenicity || scorePathogenicity(am.mutation, am.domainMapping, isCancerMode ? selectedGene : '__RESEARCH__', am.clinvar, am.cosmic);
                const cardColor = am.mutation.is_frameshift ? '#DC2626' : am.mutation.mutation_class === 'Nonsense' ? '#EF4444' : am.mutation.mutation_class === 'Missense' ? '#FBBF24' : '#10B981';
                return (
                  <div key={idx} className="mut-card" style={{ borderLeft: `4px solid ${cardColor}`, marginBottom: '1.25rem' }}>
                    {/* Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '.75rem', flexWrap: 'wrap', gap: '.4rem' }}>
                      <div>
                        <div style={{ fontSize: '.72rem', color: '#4a4d5a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '.15rem' }}>Mutation {idx + 1} — {am.mutation.type}</div>
                        <div style={{ fontSize: '1rem', fontFamily: '"JetBrains Mono",monospace', color: '#10B981', fontWeight: 700 }}>{am.hgvs}</div>
                      </div>
                      <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        {path.acmgCriteria?.length > 0 && path.acmgCriteria.map((c, ci) => (
                          <span key={ci} style={{ background: 'rgba(129,140,248,.15)', border: '1px solid rgba(129,140,248,.35)', color: '#818CF8', fontSize: '.67rem', fontWeight: 700, padding: '.1rem .38rem', borderRadius: 4, fontFamily: 'monospace' }}>{c}</span>
                        ))}
                        <span style={{ background: path.color + '22', border: `1px solid ${path.color}55`, color: path.color, fontSize: '.82rem', fontWeight: 800, padding: '.2rem .6rem', borderRadius: 6, minWidth: 36, textAlign: 'center' }}>{path.shortLabel}</span>
                      </div>
                    </div>

                    {/* Amino acid change */}
                    {am.mutation.reference_amino_acid && am.mutation.alternate_amino_acid && (
                      <div style={{ background: 'rgba(6,182,212,.05)', border: '1px solid rgba(6,182,212,.18)', padding: '.65rem .8rem', borderRadius: 7, marginBottom: '.7rem' }}>
                        <div style={{ fontSize: '.72rem', color: '#67E8F9', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '.4rem' }}>Amino Acid Substitution</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: '1.05rem', color: '#60A5FA', fontWeight: 700 }}>{am.mutation.reference_codon}</div>
                            <div style={{ fontSize: '.72rem', color: '#4a6080', marginTop: '.1rem' }}>{AA_PROPERTIES[am.mutation.reference_amino_acid]?.name} ({am.mutation.reference_amino_acid})</div>
                          </div>
                          <div style={{ color: '#3a4050', fontSize: '1.1rem', fontWeight: 300 }}>→</div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: '1.05rem', color: '#FBBF24', fontWeight: 700 }}>{am.mutation.alternate_codon}</div>
                            <div style={{ fontSize: '.72rem', color: '#6a5020', marginTop: '.1rem' }}>{AA_PROPERTIES[am.mutation.alternate_amino_acid]?.name} ({am.mutation.alternate_amino_acid})</div>
                          </div>
                        </div>
                        {am.interpretation.biochemicalAnalysis && (
                          <div style={{ display: 'flex', gap: '.5rem', marginTop: '.45rem', flexWrap: 'wrap' }}>
                            {am.interpretation.biochemicalAnalysis.chargeChange && <span style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)', color: '#fca5a5', fontSize: '.68rem', fontWeight: 600, padding: '.1rem .38rem', borderRadius: 4 }}>Charge change</span>}
                            {am.interpretation.biochemicalAnalysis.polarityChange && <span style={{ background: 'rgba(251,191,36,.12)', border: '1px solid rgba(251,191,36,.3)', color: '#fde68a', fontSize: '.68rem', fontWeight: 600, padding: '.1rem .38rem', borderRadius: 4 }}>Polarity shift</span>}
                            {am.interpretation.biochemicalAnalysis.sizeChange && <span style={{ background: 'rgba(99,102,241,.12)', border: '1px solid rgba(99,102,241,.3)', color: '#c7d2fe', fontSize: '.68rem', fontWeight: 600, padding: '.1rem .38rem', borderRadius: 4 }}>Size change</span>}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 4-column in-silico scores */}
                    {am.mutation.mutation_class === 'Missense' && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: '.5rem', marginBottom: '.7rem' }}>
                        {/* SIFT */}
                        {am.sift && (
                          <div style={{ background: 'rgba(10,12,22,.8)', border: '1px solid #1a1d2a', borderRadius: 7, padding: '.55rem .65rem' }}>
                            <div style={{ fontSize: '.67rem', color: '#3a3d4a', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '.2rem' }}>SIFT-like</div>
                            <div style={{ fontFamily: 'monospace', fontSize: '.95rem', fontWeight: 700, color: am.sift.labelColor }}>{am.sift.score}</div>
                            <div style={{ fontSize: '.68rem', color: am.sift.labelColor, marginTop: '.1rem' }}>{am.sift.label}</div>
                            <div style={{ fontSize: '.64rem', color: '#2a2d3a', marginTop: '.1rem' }}>BLOSUM62: {am.sift.blosum62}</div>
                          </div>
                        )}
                        {/* PolyPhen */}
                        {am.polyphen && (
                          <div style={{ background: 'rgba(10,12,22,.8)', border: '1px solid #1a1d2a', borderRadius: 7, padding: '.55rem .65rem' }}>
                            <div style={{ fontSize: '.67rem', color: '#3a3d4a', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '.2rem' }}>PolyPhen-like</div>
                            <div style={{ fontFamily: 'monospace', fontSize: '.95rem', fontWeight: 700, color: am.polyphen.labelColor }}>{am.polyphen.score}</div>
                            <div style={{ fontSize: '.68rem', color: am.polyphen.labelColor, marginTop: '.1rem' }}>{am.polyphen.label}</div>
                          </div>
                        )}
                        {/* Conservation */}
                        {am.conservation && (
                          <div style={{ background: 'rgba(10,12,22,.8)', border: '1px solid #1a1d2a', borderRadius: 7, padding: '.55rem .65rem' }}>
                            <div style={{ fontSize: '.67rem', color: '#3a3d4a', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '.2rem' }}>Conservation</div>
                            <div style={{ fontFamily: 'monospace', fontSize: '.95rem', fontWeight: 700, color: am.conservation.color }}>{am.conservation.score}</div>
                            <div style={{ fontSize: '.68rem', color: am.conservation.color, marginTop: '.1rem' }}>{am.conservation.label}</div>
                          </div>
                        )}
                        {/* COSMIC - Cancer Mode Only */}
                        {isCancerMode && (
                          <div style={{ background: 'rgba(10,12,22,.8)', border: `1px solid ${am.cosmic ? 'rgba(239,68,68,.35)' : '#1a1d2a'}`, borderRadius: 7, padding: '.55rem .65rem' }}>
                            <div style={{ fontSize: '.67rem', color: '#3a3d4a', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '.2rem' }}>COSMIC</div>
                            {am.cosmic ? <>
                              <div style={{ fontFamily: 'monospace', fontSize: '.82rem', fontWeight: 700, color: '#fca5a5' }}>{(am.cosmic.freq * 100).toFixed(1)}% freq</div>
                              <div style={{ fontSize: '.68rem', color: '#7a3030', marginTop: '.1rem' }}>{am.cosmic.samples.toLocaleString()} samples</div>
                              <div style={{ fontSize: '.63rem', color: '#4a2020', marginTop: '.08rem' }}>{am.cosmic.cosmic_id}</div>
                            </> : <div style={{ fontSize: '.72rem', color: '#2a2d3a', marginTop: '.2rem' }}>Not in catalogue</div>}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ClinVar evidence - Cancer Mode Only */}
                    {isCancerMode && (am.clinvar || am.clinvarLive) && (() => {
                      const cv = am.clinvarLive || am.clinvar;
                      const sigColor = cv.sig?.toLowerCase().includes('pathogenic') && !cv.sig?.toLowerCase().includes('likely') ? '#EF4444'
                        : cv.sig?.toLowerCase().includes('likely pathogenic') ? '#F59E0B'
                          : cv.sig?.toLowerCase().includes('uncertain') ? '#818CF8' : '#10B981';
                      return (
                        <div style={{ background: 'rgba(239,68,68,.04)', border: `1px solid rgba(239,68,68,.18)`, borderRadius: 7, padding: '.6rem .75rem', marginBottom: '.7rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.35rem', flexWrap: 'wrap', gap: '.3rem' }}>
                            <div style={{ fontSize: '.72rem', color: '#7a3a3a', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 700 }}>ClinVar Evidence {cv.live && <span style={{ color: '#10B981', fontSize: '.62rem' }}>(live)</span>}</div>
                            <div style={{ display: 'flex', gap: '.2rem' }}>{[...Array(3)].map((_, si) => <div key={si} style={{ width: 9, height: 9, borderRadius: 2, background: si < (cv.stars || 1) ? '#fbbf24' : '#1a1d2a' }}></div>)}</div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.2rem', flexWrap: 'wrap' }}>
                            <span style={{ background: sigColor + '18', border: `1px solid ${sigColor}44`, color: sigColor, fontSize: '.74rem', fontWeight: 700, padding: '.12rem .4rem', borderRadius: 5 }}>{cv.sig}</span>
                            <span style={{ fontFamily: 'monospace', fontSize: '.7rem', color: '#3a3d4a' }}>{cv.accession}</span>
                          </div>
                          <div style={{ fontSize: '.73rem', color: '#5a4040', lineHeight: 1.5, marginTop: '.2rem' }}>{cv.condition}</div>
                          <div style={{ fontSize: '.67rem', color: '#3a2a2a', marginTop: '.2rem' }}>{cv.review}</div>
                        </div>
                      );
                    })()}

                    {/* Domain annotation */}
                    <div style={{ background: 'rgba(16,185,129,.04)', border: '1px solid rgba(16,185,129,.15)', padding: '.6rem .75rem', borderRadius: 7, marginBottom: '.7rem' }}>
                      <div style={{ fontSize: '.72rem', color: '#0a6040', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 700, marginBottom: '.3rem' }}>Domain Annotation</div>
                      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '.3rem' }}>
                        <div><div style={{ fontSize: '.67rem', color: '#2a4a3a' }}>Domain</div><div style={{ fontSize: '.82rem', color: '#10B981', fontWeight: 600 }}>{am.domainMapping.proteinDomain}</div></div>
                        {!am.domainMapping.isInterDomain && <>
                          <div><div style={{ fontSize: '.67rem', color: '#2a4a3a' }}>Class</div><div style={{ fontSize: '.82rem', color: '#10B981', fontWeight: 600 }}>{am.domainMapping.functionalRegion}</div></div>
                          <div><div style={{ fontSize: '.67rem', color: '#2a4a3a' }}>Range</div><div style={{ fontSize: '.82rem', color: '#10B981', fontWeight: 600, fontFamily: 'monospace' }}>AA {am.domainMapping.start}–{am.domainMapping.end}</div></div>
                        </>}
                      </div>
                      <div style={{ fontSize: '.77rem', color: '#3a6050', lineHeight: 1.55 }}>{am.domainMapping.interpretation}</div>
                    </div>

                    {/* Biological interpretation */}
                    <div style={{ background: 'rgba(251,191,36,.04)', border: '1px solid rgba(251,191,36,.15)', padding: '.6rem .75rem', borderRadius: 7, marginBottom: '.7rem' }}>
                      <div style={{ fontSize: '.72rem', color: '#5a4a0a', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 700, marginBottom: '.3rem' }}>Biological Interpretation</div>
                      <div style={{ fontSize: '.82rem', color: '#7a7060', lineHeight: 1.65 }}>{am.interpretation.scientificNote}</div>
                    </div>

                    {/* Weighted pathogenicity score */}
                    <div className={path.bgClass} style={{ marginTop: '.2rem' }}>
                      <div className="path-label" style={{ color: path.color }}>
                        <span style={{ fontFamily: 'monospace', fontSize: '.9rem', fontWeight: 800 }}>{path.shortLabel}</span>
                        {path.label}
                        <span style={{ marginLeft: 'auto', fontSize: '.72rem', color: '#4a4d5a', fontWeight: 600 }}>Weighted score: {path.score}/100</span>
                      </div>
                      <div className="path-bar-wrap"><div className="path-bar" style={{ width: `${path.score}%`, background: path.score >= 72 ? '#EF4444' : path.score >= 52 ? '#F59E0B' : path.score >= 30 ? '#818CF8' : '#10B981' }}></div></div>
                      {/* Component breakdown */}
                      {path.componentScores && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '.3rem', margin: '.5rem 0', padding: '.4rem', background: 'rgba(0,0,0,.2)', borderRadius: 5 }}>
                          {[
                            { k: 'domainImpact', l: 'Domain', w: '×0.25' },
                            { k: 'mutationType', l: 'Mut. Type', w: '×0.20' },
                            { k: 'clinvar', l: 'ClinVar', w: '×0.25' },
                            { k: 'cosmic', l: 'COSMIC', w: '×0.15' },
                            { k: 'conservation', l: 'Conserv.', w: '×0.10' },
                            { k: 'structural', l: 'Structural', w: '×0.05' },
                          ].map(c => (
                            <div key={c.k} style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: '.6rem', color: '#3a3d4a', marginBottom: '.1rem' }}>{c.l} <span style={{ color: '#2a2d3a' }}>{c.w}</span></div>
                              <div style={{ fontSize: '.72rem', fontFamily: 'monospace', color: (path.componentScores[c.k] || 0) > 0.6 ? path.color : '#5a6070', fontWeight: 600 }}>{((path.componentScores[c.k] || 0) * 100).toFixed(0)}%</div>
                            </div>
                          ))}
                        </div>
                      )}
                      {path.reasons.map((r, ri) => (<div key={ri} style={{ fontSize: '.77rem', color: '#6a7080', display: 'flex', gap: '.4rem' }}><span style={{ color: path.color, flexShrink: 0 }}>·</span>{r}</div>))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {mutations.mutations?.length === 0 && (
            <div className="pc" style={{ textAlign: 'center', padding: '2.2rem', borderColor: 'rgba(16,185,129,.3)', background: 'rgba(16,185,129,.06)' }}>
              <div style={{ fontSize: '1.85rem', marginBottom: '.4rem' }}>[OK]</div>
              <div style={{ fontSize: '1.05rem', color: '#10B981', fontWeight: 700 }}>No mutations detected — sequences are identical</div>
            </div>
          )}
        </>)}
      </div>
    </div >
  );
}
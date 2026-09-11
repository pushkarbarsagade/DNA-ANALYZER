import requests
import xml.etree.ElementTree as ET

# 5 target BioSample candidates + SAMN13050471
candidates = [
    'SAMN13050471',
    'SAMN03177674',
    'SAMN03177676',
    'SAMN03177659',
    'SAMN03177675',
    'SAMN03177664'
]

ENTREZ_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
PDG_AMR_TSV_URL = (
    "https://ftp.ncbi.nlm.nih.gov/pathogen/Results/"
    "Escherichia_coli_Shigella/PDG000000004.6296/"
    "AMR/PDG000000004.6296.amr.metadata.tsv"
)

# Strict Explicit Mapping Table with Mapping Basis
# Gene Pattern -> (Mapped Antibiotic Keywords, Mapping Basis)
DOCUMENTED_MAPPINGS = [
    ('blaTEM', ['ampicillin', 'amoxicillin', 'penicillin'], 'Project heuristic (TEM beta-lactamase spectrum)'),
    ('blaCMY', ['ampicillin', 'amoxicillin-clavulanic acid', 'cefazolin', 'cefoxitin', 'ceftiofur', 'ceftriaxone', 'ceftazidime', 'cephalexin', 'cefpodoxime', 'cefovecin'], 'Project heuristic (AmpC beta-lactamase spectrum)'),
    ('blaCTX', ['ceftriaxone', 'cefotaxime', 'ceftiofur', 'ceftazidime'], 'Project heuristic (ESBL CTX-M spectrum)'),
    ('blaEC', ['ampicillin'], 'Project heuristic (Core chrom. E. coli beta-lactamase)'),
    ('tet(', ['tetracycline', 'doxycycline'], 'Project heuristic (Tetracycline efflux pump tet(A))'),
    ('sul1', ['sulfisoxazole'], 'Project heuristic (Sulfonamide resistance gene sul1)'),
    ('sul2', ['sulfisoxazole'], 'Project heuristic (Sulfonamide resistance gene sul2)'),
    ('dfrA', ['trimethoprim'], 'Project heuristic (Dihydrofolate reductase dfrA)'),
    ('floR', ['chloramphenicol', 'florfenicol'], 'Project parser/heuristic (Phenicol exporter floR)'),
    ('aph(3\'\')-Ib', ['streptomycin'], 'Project heuristic (Streptomycin phosphotransferase)'),
    ('aph(6)-Id', ['streptomycin'], 'Project heuristic (Streptomycin phosphotransferase)'),
]

# Combination Drug Rule: trimethoprim-sulfamethoxazole requires BOTH dfrA AND sul1/sul2
COMBINATION_RULES = {
    'trimethoprim-sulfamethoxazole': {
        'required_genes': ['dfrA', ['sul1', 'sul2']], # dfrA AND (sul1 OR sul2)
        'basis': 'Project heuristic (Combined dfrA + sul for co-trimoxazole)'
    }
}

def get_mapped_genes_for_abx(gene_str, abx):
    genes = [g.strip().strip('"') for g in gene_str.replace('"', '').split(',') if g.strip()]
    abx_clean = abx.strip().lower()
    
    # Check combination rules first
    if abx_clean in COMBINATION_RULES:
        rule = COMBINATION_RULES[abx_clean]
        matched_genes = []
        has_dfr = any('dfra' in g.lower() for g in genes)
        has_sul = any('sul1' in g.lower() or 'sul2' in g.lower() for g in genes)
        if has_dfr and has_sul:
            for g in genes:
                if 'dfra' in g.lower() or 'sul1' in g.lower() or 'sul2' in g.lower():
                    matched_genes.append(g)
            return sorted(set(matched_genes)), rule['basis']
        else:
            # Combination not met
            return [], ""

    # Standard single drug mapping check
    matched_genes = []
    bases = set()
    for g in genes:
        for pat, abx_list, basis in DOCUMENTED_MAPPINGS:
            if pat.lower() in g.lower():
                for target_abx in abx_list:
                    if target_abx.lower() == abx_clean or target_abx.lower() in abx_clean:
                        matched_genes.append(g)
                        bases.add(basis)
    if matched_genes:
        return sorted(set(matched_genes)), "; ".join(sorted(bases))
    return [], ""

# Fetch TSV
print("1. Fetching TSV metadata for candidates...")
r = requests.get(PDG_AMR_TSV_URL, stream=True, timeout=120)
r.raise_for_status()

pdg_data = {}
buffer = ""
header_cols = []
for chunk in r.iter_content(chunk_size=1024*1024, decode_unicode=True):
    if not chunk: continue
    buffer += chunk
    lines = buffer.split('\n')
    buffer = lines.pop()
    for line in lines:
        if not line.strip(): continue
        if not header_cols:
            header_cols = [c.strip() for c in line.split('\t')]
            continue
        for acc in candidates:
            if acc in line and acc not in pdg_data:
                parts = line.split('\t')
                pdg_data[acc] = {header_cols[i]: (parts[i] if i < len(parts) else '') for i in range(len(header_cols))}
    if len(pdg_data) == len(candidates):
        r.close()
        break

print("2. Processing records under strict revised rules...\n")
all_comparisons = []

for acc in candidates[1:]: # Process 5-isolate validation set
    tsv_row = pdg_data.get(acc, {})
    asm_acc = tsv_row.get('asm_acc', '')
    amr_raw = tsv_row.get('AMR_genotypes', '').strip('"')
    organism = "Escherichia coli"

    url = f"{ENTREZ_BASE}/efetch.fcgi?db=biosample&id={acc}&retmode=xml"
    xr = requests.get(url, timeout=30)
    root = ET.fromstring(xr.content)

    table_el = root.find('.//Table')
    if table_el is not None:
        for row in table_el.findall('.//Row'):
            cells = [cell.text.strip() if cell.text else '' for cell in row.findall('Cell')]
            if len(cells) >= 2:
                abx = cells[0]
                ph = cells[1].strip()
                sign = cells[2] if len(cells) > 2 else ''
                meas = cells[3] if len(cells) > 3 else ''
                units = cells[4] if len(cells) > 4 else ''
                method = cells[5] if len(cells) > 5 else ''
                guideline = cells[9] if len(cells) > 9 else (cells[8] if len(cells) > 8 else '')

                mic_str = f"{sign} {meas} {units}".strip() if sign and sign != '==' else f"{meas} {units}".strip()

                mapped_genes, basis = get_mapped_genes_for_abx(amr_raw, abx)
                evidence_str = "; ".join(mapped_genes) if mapped_genes else "(none)"
                basis_str = basis if basis else "(none)"

                ph_lower = ph.lower()
                is_defined = ph_lower not in ('not defined', '')

                if not mapped_genes:
                    classification = "Not comparable"
                    reason = "No validated genotype-to-antibiotic mapping"
                elif not is_defined:
                    classification = "Not evaluable"
                    reason = "Phenotype is 'not defined' in NCBI XML"
                else:
                    # Mapped genes exist AND phenotype is defined (S, I, R, NS, SSD)
                    if ph_lower in ('resistant', 'r', 'non-susceptible', 'ns'):
                        classification = "Concordant"
                        reason = f"Mapped gene(s) present ({evidence_str}) and observed phenotype is resistant ({ph})"
                    elif ph_lower in ('susceptible', 's', 'ssd'):
                        classification = "Discordant"
                        reason = f"Mapped gene(s) present ({evidence_str}) but observed phenotype is susceptible ({ph})"
                    elif ph_lower in ('intermediate', 'i'):
                        classification = "Not comparable"
                        reason = f"Observed phenotype is intermediate ({ph}) for mapped gene(s) ({evidence_str})"
                    else:
                        classification = "Not comparable"
                        reason = f"Unrecognized defined phenotype format ({ph})"

                all_comparisons.append({
                    'biosample': acc,
                    'assembly': asm_acc,
                    'organism': organism,
                    'antibiotic': abx,
                    'mic': mic_str,
                    'phenotype': ph,
                    'guideline': guideline,
                    'method': method,
                    'mapped_genes': evidence_str,
                    'mapping_basis': basis_str,
                    'classification': classification,
                    'reason': reason
                })

# Summary Metrics
tot_ast = len(all_comparisons)
def_ph = sum(1 for c in all_comparisons if c['phenotype'].lower() not in ('not defined', ''))
rec_mapped = sum(1 for c in all_comparisons if c['mapped_genes'] != '(none)')
gen_comp = sum(1 for c in all_comparisons if c['mapped_genes'] != '(none)' and c['phenotype'].lower() not in ('not defined', ''))
conc = sum(1 for c in all_comparisons if c['classification'] == 'Concordant')
disc = sum(1 for c in all_comparisons if c['classification'] == 'Discordant')
not_comp = sum(1 for c in all_comparisons if c['classification'] == 'Not comparable')
not_eval = sum(1 for c in all_comparisons if c['classification'] == 'Not evaluable')

print("SUMMARY REPORT (5 Isolates):")
print(f"Total AST records:                          {tot_ast}")
print(f"Defined phenotypes:                         {def_ph}")
print(f"Records with validated genotype-antibiotic mapping: {rec_mapped}")
print(f"Genuinely comparable pairs:                 {gen_comp}")
print(f"Concordant:                                 {conc}")
print(f"Discordant:                                 {disc}")
print(f"Not comparable:                             {not_comp}")
print(f"Not evaluable:                              {not_eval}")

import requests
import xml.etree.ElementTree as ET
import sys

# 5 target BioSample candidates
candidates = [
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

# Curated Heuristic Mapping (Gene Family -> Antibiotics)
GENE_TO_DRUG_MAP = {
    'blaTEM': ['ampicillin', 'amoxicillin', 'penicillin'],
    'blaCMY': ['ampicillin', 'amoxicillin', 'cephalosporin', 'cefazolin', 'cefpodoxime', 'ceftazidime', 'cephalexin', 'cefoxitin', 'ceftiofur', 'ceftriaxone', 'amoxicillin-clavulanic acid'],
    'blaCTX': ['ceftriaxone', 'cefotaxime', 'cephalosporin', 'ceftazidime', 'ceftiofur'],
    'blaEC': ['ampicillin', 'penicillin'],
    'tet(': ['tetracycline', 'doxycycline'],
    'sul1': ['sulfisoxazole', 'trimethoprim-sulfamethoxazole'],
    'sul2': ['sulfisoxazole', 'trimethoprim-sulfamethoxazole'],
    'dfrA': ['trimethoprim', 'trimethoprim-sulfamethoxazole'],
    'floR': ['chloramphenicol', 'florfenicol'],
    'aph(3'')-Ib': ['streptomycin', 'kanamycin'],
    'aph(6)-Id': ['streptomycin', 'kanamycin'],
    'aac(3)': ['gentamicin'],
    'qnr': ['ciprofloxacin', 'nalidixic acid'],
}

def map_genes_to_abx(gene_str):
    mapping = {}
    genes = [g.strip().strip('"') for g in gene_str.replace('"', '').split(',') if g.strip()]
    for g in genes:
        drugs = []
        for pat, abx_list in GENE_TO_DRUG_MAP.items():
            if pat.lower() in g.lower():
                drugs.extend(abx_list)
        if drugs:
            mapping[g] = sorted(set(drugs))
    return mapping, genes

print("1. Fetching PDG TSV metadata for candidates...")
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
                print(f"  Got TSV row for {acc}")
    if len(pdg_data) == len(candidates):
        r.close()
        break

print("\n2. Fetching BioSample XML for candidates and verifying raw records...")
results = []

for acc in candidates:
    tsv_row = pdg_data.get(acc, {})
    asm_acc = tsv_row.get('asm_acc', '') or tsv_row.get('assembly', '')
    amr_genotypes_raw = tsv_row.get('AMR_genotypes', '') or tsv_row.get('amr_genotypes', '')
    organism = tsv_row.get('organism_name', '') or 'Escherichia coli'

    # efetch XML
    url = f"{ENTREZ_BASE}/efetch.fcgi?db=biosample&id={acc}&retmode=xml"
    xr = requests.get(url, timeout=30)
    xr.raise_for_status()
    root = ET.fromstring(xr.content)

    # Parse XML table
    ast_rows = []
    for table in root.findall('.//Table'):
        cls = table.attrib.get('class', '')
        if 'Antibiogram' in cls:
            # XML schema Row/Cell
            for row_el in table.findall('.//Row'):
                cells = [cell.text.strip() if cell.text else '' for cell in row_el.findall('Cell')]
                if len(cells) >= 2:
                    abx = cells[0]
                    phenotype = cells[1]
                    sign = cells[2] if len(cells) > 2 else ''
                    meas = cells[3] if len(cells) > 3 else ''
                    units = cells[4] if len(cells) > 4 else ''
                    method = cells[5] if len(cells) > 5 else ''
                    guideline = cells[9] if len(cells) > 9 else (cells[8] if len(cells) > 8 else '')
                    
                    mic_str = f"{sign} {meas} {units}".strip() if sign and sign != '==' else f"{meas} {units}".strip()
                    ast_rows.append({
                        'antibiotic': abx,
                        'phenotype': phenotype,
                        'mic': mic_str,
                        'method': method,
                        'guideline': guideline
                    })
            break

    gene_map, all_genes = map_genes_to_abx(amr_genotypes_raw)

    print(f"\n=======================================================")
    print(f"BioSample: {acc}")
    print(f"Assembly:  {asm_acc}")
    print(f"Organism:  {organism}")
    print(f"AMR Genotypes Raw: {amr_genotypes_raw}")
    print(f"Total AST records: {len(ast_rows)}")

    # For each AST record in this isolate, perform strict classification
    for ast in ast_rows:
        abx = ast['antibiotic']
        ph = ast['phenotype'].strip()
        ph_lower = ph.lower()
        
        # Mapped genes for this antibiotic
        matching_genes = []
        for g, mapped_abx in gene_map.items():
            for ma in mapped_abx:
                if ma.lower() in abx.lower() or abx.lower() in ma.lower():
                    matching_genes.append(g)
        matching_genes = sorted(set(matching_genes))
        evidence_str = '; '.join(matching_genes) if matching_genes else 'none'

        if ph_lower in ('not defined', ''):
            classification = 'Not comparable' # or Not evaluable
        elif ph_lower in ('susceptible', 's', 'ssd'):
            if matching_genes:
                classification = 'Discordant'
            else:
                classification = 'Concordant' # No gene + Susceptible
        elif ph_lower in ('resistant', 'r', 'non-susceptible', 'ns'):
            if matching_genes:
                classification = 'Concordant'
            else:
                classification = 'Not comparable' # No gene + Resistant
        elif ph_lower in ('intermediate', 'i'):
            classification = 'Not comparable'
        else:
            classification = 'Not comparable'

        results.append({
            'biosample': acc,
            'assembly': asm_acc,
            'organism': organism,
            'amr_genotype': amr_genotypes_raw,
            'antibiotic': abx,
            'ast_phenotype': ph,
            'mic': ast['mic'],
            'guideline': ast['guideline'],
            'method': ast['method'],
            'evidence': evidence_str,
            'classification': classification
        })

print("\n\nDone parsing all 5 candidates!")

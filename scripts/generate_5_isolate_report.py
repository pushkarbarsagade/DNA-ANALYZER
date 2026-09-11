import requests
import xml.etree.ElementTree as ET

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

GENE_TO_DRUG_MAP = {
    'blaTEM': ['ampicillin', 'amoxicillin', 'penicillin'],
    'blaCMY': ['ampicillin', 'amoxicillin-clavulanic acid', 'cefoxitin', 'ceftiofur', 'ceftriaxone', 'cefazolin'],
    'blaCTX': ['ceftriaxone', 'cefotaxime', 'ceftiofur'],
    'blaEC': ['ampicillin'],
    'tet(': ['tetracycline'],
    'sul1': ['sulfisoxazole', 'trimethoprim-sulfamethoxazole'],
    'sul2': ['sulfisoxazole', 'trimethoprim-sulfamethoxazole'],
    'dfrA': ['trimethoprim-sulfamethoxazole', 'trimethoprim'],
    'floR': ['chloramphenicol'],
    'aph(3\'\')-Ib': ['streptomycin'],
    'aph(6)-Id': ['streptomycin'],
}

def get_matching_genes(gene_str, abx):
    genes = [g.strip().strip('"') for g in gene_str.replace('"', '').split(',') if g.strip()]
    matched = []
    for g in genes:
        for pat, abx_list in GENE_TO_DRUG_MAP.items():
            if pat.lower() in g.lower():
                for a in abx_list:
                    if a.lower() in abx.lower() or abx.lower() in a.lower():
                        matched.append(g)
    return sorted(set(matched))

# Fetch TSV
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

for acc in candidates:
    tsv_row = pdg_data.get(acc, {})
    asm_acc = tsv_row.get('asm_acc', '')
    amr_raw = tsv_row.get('AMR_genotypes', '').strip('"')
    organism = "Escherichia coli"

    # fetch XML
    url = f"{ENTREZ_BASE}/efetch.fcgi?db=biosample&id={acc}&retmode=xml"
    xr = requests.get(url, timeout=30)
    root = ET.fromstring(xr.content)

    print(f"\n### BioSample: {acc}")
    print(f"- **Assembly**: `{asm_acc}`")
    print(f"- **Organism**: `{organism}`")
    print(f"- **AMR Genotype**: `{amr_raw}`\n")

    print("| BioSample | Assembly | Organism | AMR Genotype | Antibiotic | AST Phenotype | MIC | Guideline | Method | Classification |")
    print("| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |")

    table_el = root.find('.//Table')
    if table_el is not None:
        for row in table_el.findall('.//Row'):
            cells = [cell.text.strip() if cell.text else '' for cell in row.findall('Cell')]
            if len(cells) >= 2:
                abx = cells[0]
                ph = cells[1]
                sign = cells[2] if len(cells) > 2 else ''
                meas = cells[3] if len(cells) > 3 else ''
                units = cells[4] if len(cells) > 4 else ''
                method = cells[5] if len(cells) > 5 else ''
                guideline = cells[9] if len(cells) > 9 else (cells[8] if len(cells) > 8 else '')

                mic_str = f"{sign} {meas} {units}".strip() if sign and sign != '==' else f"{meas} {units}".strip()

                matching_genes = get_matching_genes(amr_raw, abx)
                ph_lower = ph.lower()

                if ph_lower in ('resistant', 'r', 'non-susceptible', 'ns'):
                    if matching_genes:
                        cls = 'Concordant'
                    else:
                        cls = 'Not comparable'
                elif ph_lower in ('susceptible', 's', 'ssd'):
                    if matching_genes:
                        cls = 'Discordant'
                    else:
                        cls = 'Concordant'
                else:
                    cls = 'Not comparable'

                print(f"| {acc} | {asm_acc} | {organism} | {amr_raw} | {abx} | {ph} | {mic_str} | {guideline} | {method} | **{cls}** |")

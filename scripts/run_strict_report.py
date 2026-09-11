import requests
import xml.etree.ElementTree as ET

from compare_amr_genotype_phenotype import (
    DOCUMENTED_MAPPINGS,
    COMBINATION_RULES,
    get_mapped_genes_for_abx,
    compare
)

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

import time

def fetch_with_retry(url, stream=False, timeout=120, retries=5):
    for i in range(retries):
        try:
            r = requests.get(url, stream=stream, timeout=timeout)
            r.raise_for_status()
            return r
        except Exception as e:
            if i == retries - 1:
                raise e
            time.sleep(2)

print("1. Fetching TSV metadata for 5 validation isolates...")
r = fetch_with_retry(PDG_AMR_TSV_URL, stream=True, timeout=120)

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

all_comparisons = []
per_isolate_results = {}

for acc in candidates:
    tsv_row = pdg_data.get(acc, {})
    asm_acc = tsv_row.get('asm_acc', '')
    amr_raw = tsv_row.get('AMR_genotypes', '').strip('"')
    organism = "Escherichia coli"

    url = f"{ENTREZ_BASE}/efetch.fcgi?db=biosample&id={acc}&retmode=xml"
    xr = fetch_with_retry(url, timeout=30)
    root = ET.fromstring(xr.content)

    ast_rows = []
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

                mic_str = f"{sign} {meas}".strip() if sign and sign != '==' else meas
                ast_rows.append({
                    'antibiotic': abx,
                    'phenotype': ph,
                    'mic': mic_str,
                    'units': units,
                    'method': method,
                    'guideline': guideline
                })

    iso_comps = compare([tsv_row], ast_rows)
    for c in iso_comps:
        c['biosample'] = acc
        c['assembly'] = asm_acc
        c['organism'] = organism

    per_isolate_results[acc] = (asm_acc, organism, amr_raw, iso_comps)
    all_comparisons.extend(iso_comps)

# Compute Summary Metrics across the 5 validation isolates
tot_ast = len(all_comparisons)
def_ph = sum(1 for c in all_comparisons if c['phenotype'].lower() not in ('not defined', ''))
rec_mapped = sum(1 for c in all_comparisons if c['genotype_evidence'] != '(none)')
gen_comp = sum(1 for c in all_comparisons if c['genotype_evidence'] != '(none)' and c['phenotype'].lower() not in ('not defined', ''))
conc = sum(1 for c in all_comparisons if c['classification'] == 'Concordant')
disc = sum(1 for c in all_comparisons if c['classification'] == 'Discordant')
not_comp = sum(1 for c in all_comparisons if c['classification'] == 'Not comparable')
not_eval = sum(1 for c in all_comparisons if c['classification'] == 'Not evaluable')

print("\n" + "=" * 80)
print("FINAL SUMMARY REPORT (5 Validation Isolates, Strict Mappings)")
print("=" * 80)
print(f"Total AST records:                          {tot_ast}")
print(f"Defined phenotypes:                         {def_ph}")
print(f"Records with validated genotype-antibiotic mapping: {rec_mapped}")
print(f"Genuinely comparable pairs:                 {gen_comp}")
print(f"Concordant:                                 {conc}")
print(f"Discordant:                                 {disc}")
print(f"Not comparable:                             {not_comp}")
print(f"Not evaluable:                              {not_eval}")

print("\n" + "=" * 80)
print("PER-ISOLATE COMPARISON TABLES")
print("=" * 80)

for acc in candidates:
    asm_acc, organism, amr_raw, comps = per_isolate_results[acc]
    print(f"\n### BioSample: `{acc}`")
    print(f"- **Assembly**: `{asm_acc}`")
    print(f"- **Organism**: `{organism}`")
    print(f"- **AMR Genotype**: `{amr_raw}`\n")
    print("| BioSample | Assembly | Organism | Antibiotic | MIC | Phenotype | Guideline | Method | Mapped Gene(s) | Mapping Basis | Classification | Reason |")
    print("| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |")
    for c in comps:
        print(f"| {acc} | {asm_acc} | {organism} | {c['antibiotic']} | {c['mic']} | {c['phenotype']} | {c['guideline']} | {c['method']} | `{c['genotype_evidence']}` | {c['mapping_basis']} | **{c['classification']}** | {c['reason']} |")

import requests
import xml.etree.ElementTree as ET
import sys
import time

ENTREZ_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
PDG_AMR_TSV_URL = (
    "https://ftp.ncbi.nlm.nih.gov/pathogen/Results/"
    "Escherichia_coli_Shigella/PDG000000004.6296/"
    "AMR/PDG000000004.6296.amr.metadata.tsv"
)

# Step 1: Query Entrez for BioSamples with CLSI/EUCAST AST tables in E. coli
print("STEP 1: Entrez search for E. coli BioSamples with CLSI/EUCAST AST tables...")
term = '(CLSI[all fields] OR EUCAST[all fields]) AND "Escherichia coli"[Organism]'
r = requests.get(f"{ENTREZ_BASE}/esearch.fcgi", params={
    'db': 'biosample',
    'term': term,
    'retmax': 2000,
    'retmode': 'xml'
})
r.raise_for_status()
root = ET.fromstring(r.content)
cnt = root.findtext("Count", "0")
uids = [el.text for el in root.findall(".//IdList/Id") if el.text]
print(f"  Hit count: {cnt}, UIDs retrieved: {len(uids)}")

# Fetch accessions for UIDs in batches
accessions = set()
batch_size = 200
for i in range(0, len(uids), batch_size):
    batch = uids[i:i+batch_size]
    sr = requests.get(f"{ENTREZ_BASE}/esummary.fcgi", params={
        'db': 'biosample',
        'id': ','.join(batch),
        'retmode': 'xml'
    })
    sr.raise_for_status()
    sroot = ET.fromstring(sr.content)
    for docsum in sroot.findall(".//DocumentSummary"):
        acc = docsum.findtext("Accession", "")
        if acc.startswith("SAM"):
            accessions.add(acc)
    time.sleep(0.3)

print(f"  Resolved {len(accessions)} BioSample accessions")

# Step 2: Stream PDG TSV and intersect
print("\nSTEP 2: Streaming PDG AMR TSV to find intersection...")
resp = requests.get(PDG_AMR_TSV_URL, stream=True, timeout=120)
resp.raise_for_status()
it = resp.iter_lines(decode_unicode=True)
header = next(it)
cols = [c.strip() for c in header.split('\t')]
biosample_col = cols.index('biosample_acc') if 'biosample_acc' in cols else 18

matched_by_bio = {}
line_count = 0
for line in it:
    line_count += 1
    if not line:
        continue
    parts = line.split('\t')
    if biosample_col < len(parts):
        bio = parts[biosample_col].strip()
        if bio in accessions:
            row = {cols[j]: parts[j] if j < len(parts) else '' for j in range(len(cols))}
            matched_by_bio.setdefault(bio, []).append(row)
            if len(matched_by_bio) >= 5:
                resp.close()
                break

print(f"  Scanned {line_count:,} lines")
print(f"  Found {len(matched_by_bio)} candidate BioSamples in intersection!")
for bio, rows in matched_by_bio.items():
    print(f"    - {bio}: {len(rows)} AMR genotype rows")

if matched_by_bio:
    first_candidate = list(matched_by_bio.keys())[0]
    print(f"\n>>> TARGET CANDIDATE BIOSAMPLE: {first_candidate}")

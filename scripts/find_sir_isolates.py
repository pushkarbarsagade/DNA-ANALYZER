import requests
import xml.etree.ElementTree as ET

PDG_AMR_TSV_URL = (
    "https://ftp.ncbi.nlm.nih.gov/pathogen/Results/"
    "Escherichia_coli_Shigella/PDG000000004.6296/"
    "AMR/PDG000000004.6296.amr.metadata.tsv"
)

print("Streaming PDG AMR TSV to find isolates with explicit SIR phenotypes in AST_phenotypes column...")
r = requests.get(PDG_AMR_TSV_URL, stream=True, timeout=120)
r.raise_for_status()

buffer = ""
matched_isolates = []
header_cols = []

for chunk in r.iter_content(chunk_size=1024*1024, decode_unicode=True):
    if not chunk:
        continue
    buffer += chunk
    lines = buffer.split('\n')
    buffer = lines.pop()
    
    for line in lines:
        if not line.strip():
            continue
        if not header_cols:
            header_cols = [c.strip() for c in line.split('\t')]
            ast_col = header_cols.index('AST_phenotypes') if 'AST_phenotypes' in header_cols else -1
            amr_col = header_cols.index('AMR_genotypes') if 'AMR_genotypes' in header_cols else -1
            bio_col = header_cols.index('biosample_acc') if 'biosample_acc' in header_cols else 18
            print(f"Header parsed: bio_col={bio_col}, ast_col={ast_col}, amr_col={amr_col}")
            continue
            
        parts = line.split('\t')
        if ast_col < len(parts) and amr_col < len(parts):
            ast_val = parts[ast_col].strip()
            amr_val = parts[amr_col].strip()
            # Check if AST_phenotypes contains explicit SIR (not just ND)
            # e.g., contains =R, =S, =I, =resistant, =susceptible
            ast_lower = ast_val.lower()
            if any(term in ast_lower for term in ['=r', '=s', '=i', '=resistant', '=susceptible', '=ns', '=ssd']):
                if amr_val and amr_val != 'NULL' and amr_val != '""':
                    bio_acc = parts[bio_col].strip()
                    row = {header_cols[i]: parts[i] if i < len(parts) else '' for i in range(len(header_cols))}
                    matched_isolates.append((bio_acc, row))
                    print(f"Found Candidate {len(matched_isolates)}: {bio_acc} | AMR: {amr_val} | AST: {ast_val[:100]}")
                    if len(matched_isolates) >= 10:
                        r.close()
                        break
    if len(matched_isolates) >= 10:
        break

print(f"\nTotal candidate isolates found: {len(matched_isolates)}")

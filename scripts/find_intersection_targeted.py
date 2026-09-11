#!/usr/bin/env python3
"""
Targeted intersection: find a real isolate with BOTH AMR genotype rows
in the NCBI Pathogen Detection (PDG) AMR TSV AND AST phenotype rows in
the BioSample Antibiogram table.

Step 1: Entrez esearch for BioSamples containing "Antibiogram"
Step 2: Stream PDG AMR TSV once and check set membership
Step 3: Verify the first intersecting candidate
Step 4: Print verification summary
"""
from __future__ import annotations

import sys
import time
import xml.etree.ElementTree as ET
from typing import Dict, List, Set

import requests

# ── Configuration ──────────────────────────────────────────────────────────
ENTREZ_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"

# We search across organisms; the PDG TSV is organism-specific
PDG_AMR_TSV_URL = (
    "https://ftp.ncbi.nlm.nih.gov/pathogen/Results/"
    "Escherichia_coli_Shigella/PDG000000004.6296/"
    "AMR/PDG000000004.6296.amr.metadata.tsv"
)
PDG_RELEASE = "PDG000000004.6296"
ORGANISM = "Escherichia_coli_Shigella"


def step1_esearch_antibiogram_biosamples(max_results: int = 2000) -> Set[str]:
    """Entrez esearch: BioSamples whose XML contains 'Antibiogram'."""
    print("=" * 70)
    print("STEP 1: Entrez esearch for BioSamples with 'Antibiogram'")
    print("=" * 70)

    # esearch to get the count and WebEnv/QueryKey for efetch of IDs
    url = f"{ENTREZ_BASE}/esearch.fcgi"
    params = {
        "db": "biosample",
        "term": "Antibiogram[Attribute Name]",
        "retmax": max_results,
        "retmode": "xml",
        "usehistory": "y",
    }
    r = requests.get(url, params=params, timeout=30)
    r.raise_for_status()
    root = ET.fromstring(r.content)

    count = int(root.findtext("Count", "0"))
    print(f"  esearch hit count: {count}")

    # Collect UIDs from esearch result
    uids = [id_el.text for id_el in root.findall(".//IdList/Id") if id_el.text]
    print(f"  UIDs returned in this batch: {len(uids)}")

    if not uids:
        print("  No BioSample UIDs found. Trying broader search...")
        # Try with a broader query
        params["term"] = "antibiogram"
        r = requests.get(url, params=params, timeout=30)
        r.raise_for_status()
        root = ET.fromstring(r.content)
        count = int(root.findtext("Count", "0"))
        print(f"  Broader esearch hit count: {count}")
        uids = [id_el.text for id_el in root.findall(".//IdList/Id") if id_el.text]
        print(f"  UIDs returned in this batch: {len(uids)}")

    if not uids:
        print("  ERROR: No UIDs found at all.", file=sys.stderr)
        sys.exit(1)

    # Convert UIDs to BioSample accessions via esummary (batches of 200)
    accessions: Set[str] = set()
    batch_size = 200
    for i in range(0, len(uids), batch_size):
        batch = uids[i:i + batch_size]
        summary_url = f"{ENTREZ_BASE}/esummary.fcgi"
        summary_params = {
            "db": "biosample",
            "id": ",".join(batch),
            "retmode": "xml",
        }
        sr = requests.get(summary_url, params=summary_params, timeout=30)
        sr.raise_for_status()
        sroot = ET.fromstring(sr.content)
        for docsum in sroot.findall(".//DocumentSummary"):
            acc = docsum.findtext("Accession", "")
            if acc.startswith("SAM"):
                accessions.add(acc)
        time.sleep(0.35)  # be polite to NCBI

    print(f"  Resolved {len(accessions)} BioSample accessions")
    # Print a few examples
    sample_list = sorted(accessions)[:10]
    print(f"  Examples: {sample_list}")
    return accessions


def step2_intersect_with_pdg(antibiogram_accs: Set[str]) -> List[Dict[str, str]]:
    """Stream PDG AMR TSV once and find rows whose biosample is in the set."""
    print("\n" + "=" * 70)
    print("STEP 2: Streaming PDG AMR TSV to find intersection")
    print(f"  URL: {PDG_AMR_TSV_URL}")
    print("=" * 70)

    r = requests.get(PDG_AMR_TSV_URL, stream=True, timeout=120)
    r.raise_for_status()
    it = r.iter_lines(decode_unicode=True)
    header = next(it)
    cols = header.split('\t')

    # Find biosample column
    biosample_col = None
    for i, c in enumerate(cols):
        cl = c.strip().lower()
        if cl in ('biosample_acc', 'biosample', 'bio_sample'):
            biosample_col = i
            break
    if biosample_col is None:
        # fallback: look for partial match
        for i, c in enumerate(cols):
            if 'biosample' in c.lower():
                biosample_col = i
                break
    if biosample_col is None:
        print(f"  ERROR: cannot find biosample column. Header columns: {cols[:20]}", file=sys.stderr)
        sys.exit(2)

    print(f"  Biosample column: index {biosample_col} ('{cols[biosample_col]}')")

    matched_rows: List[Dict[str, str]] = []
    matched_accs: Set[str] = set()
    line_count = 0

    for line in it:
        line_count += 1
        if not line:
            continue
        parts = line.split('\t')
        if biosample_col >= len(parts):
            continue
        bio = parts[biosample_col].strip()
        if bio in antibiogram_accs:
            row = {cols[j].strip(): (parts[j] if j < len(parts) else '') for j in range(len(cols))}
            matched_rows.append(row)
            matched_accs.add(bio)
            if len(matched_accs) >= 5:
                # We have enough candidates; stop streaming
                r.close()
                break

        # Progress
        if line_count % 500000 == 0:
            print(f"  ... scanned {line_count:,} lines, matched {len(matched_accs)} biosamples so far")

    print(f"  Scanned {line_count:,} lines total")
    print(f"  Found {len(matched_rows)} AMR genotype rows across {len(matched_accs)} intersecting biosamples")
    if matched_accs:
        print(f"  Intersecting BioSample accessions: {sorted(matched_accs)}")
    return matched_rows


def step3_verify_candidate(biosample_acc: str, genotype_rows: List[Dict[str, str]]) -> dict:
    """Verify the candidate by fetching BioSample XML and extracting Antibiogram."""
    print("\n" + "=" * 70)
    print(f"STEP 3: Verifying candidate {biosample_acc}")
    print("=" * 70)

    # ── 3a. Fetch BioSample XML ──
    efetch_url = (
        f"{ENTREZ_BASE}/efetch.fcgi?db=biosample&id={biosample_acc}&retmode=xml"
    )
    print(f"  Fetching BioSample XML: {efetch_url}")
    r = requests.get(efetch_url, timeout=30)
    r.raise_for_status()
    root = ET.fromstring(r.content)

    # Extract antibiogram rows
    antibiogram_rows = []
    for table in root.findall('.//Table'):
        cls = table.attrib.get('class', '')
        if 'Antibiogram' in cls:
            for tr in table.findall('.//TR'):
                cells = [td.text.strip() if td.text else '' for td in tr.findall('TD')]
                if not cells:
                    continue
                while len(cells) < 6:
                    cells.append('')
                antibiogram_rows.append({
                    'antibiotic': cells[0],
                    'phenotype': cells[1],
                    'mic': cells[2],
                    'units': cells[3],
                    'method': cells[4],
                    'guideline': cells[5],
                })
            break

    # Extract organism
    organism = ""
    for attr in root.findall('.//Attribute'):
        if attr.attrib.get('harmonized_name', '') == 'organism':
            organism = attr.text or ''
            break
    if not organism:
        for attr in root.findall('.//Organism'):
            organism = attr.attrib.get('taxonomy_name', '') or attr.text or ''
            break

    # ── 3b. Assembly accession from genotype rows ──
    assemblies = set()
    for row in genotype_rows:
        asm = row.get('asm_acc', '') or row.get('assembly', '') or row.get('assembly_accession', '')
        if asm:
            assemblies.add(asm)

    result = {
        'biosample': biosample_acc,
        'organism': organism,
        'assemblies': sorted(assemblies),
        'genotype_row_count': len(genotype_rows),
        'antibiogram_row_count': len(antibiogram_rows),
        'antibiogram_rows': antibiogram_rows,
        'genotype_rows': genotype_rows,
        'efetch_url': efetch_url,
        'pdg_tsv_url': PDG_AMR_TSV_URL,
        'pdg_release': PDG_RELEASE,
    }

    print(f"  Organism: {organism}")
    print(f"  Assembly accessions: {sorted(assemblies)}")
    print(f"  AMR genotype rows: {len(genotype_rows)}")
    print(f"  AST phenotype (antibiogram) rows: {len(antibiogram_rows)}")

    if antibiogram_rows:
        print("\n  Antibiogram rows found:")
        for ar in antibiogram_rows:
            print(f"    {ar['antibiotic']:30s}  {ar['phenotype']:15s}  MIC={ar['mic']} {ar['units']}")

    return result


def step4_print_summary(result: dict) -> None:
    """Print verification summary."""
    print("\n" + "=" * 70)
    print("STEP 4: VERIFICATION SUMMARY")
    print("=" * 70)
    print(f"  BioSample accession:      {result['biosample']}")
    print(f"  Assembly accession(s):     {', '.join(result['assemblies']) if result['assemblies'] else 'N/A'}")
    print(f"  Organism:                  {result['organism']}")
    print(f"  AMR genotypes exist?       {'YES' if result['genotype_row_count'] > 0 else 'NO'}  (count: {result['genotype_row_count']})")
    print(f"  AST phenotypes exist?      {'YES' if result['antibiogram_row_count'] > 0 else 'NO'}  (count: {result['antibiogram_row_count']})")
    print()
    print("  NCBI sources used:")
    print(f"    PDG AMR TSV:   {result['pdg_tsv_url']}")
    print(f"    PDG Release:   {result['pdg_release']}")
    print(f"    Entrez efetch: {result['efetch_url']}")
    print(f"    Organism path: /pathogen/Results/{ORGANISM}/")
    print()
    if result['genotype_row_count'] > 0 and result['antibiogram_row_count'] > 0:
        print("  [OK] This isolate has BOTH genotype AND phenotype data -- suitable for comparison.")
    else:
        print("  [SKIP] Missing one or both data types; need to check next candidate.")


def main():
    start = time.time()

    # Step 1
    antibiogram_accs = step1_esearch_antibiogram_biosamples(max_results=2000)
    elapsed = time.time() - start
    print(f"  [Step 1 took {elapsed:.1f}s]")

    # Step 2
    t2 = time.time()
    matched_rows = step2_intersect_with_pdg(antibiogram_accs)
    elapsed2 = time.time() - t2
    print(f"  [Step 2 took {elapsed2:.1f}s]")

    if not matched_rows:
        print("\nNo intersection found. Trying broader search or different PDG release may be needed.")
        sys.exit(3)

    # Group rows by biosample
    by_biosample: Dict[str, List[Dict[str, str]]] = {}
    for row in matched_rows:
        bio = row.get('biosample_acc', '') or row.get('biosample', '')
        by_biosample.setdefault(bio, []).append(row)

    # Step 3 & 4: Verify first candidate
    for biosample_acc, genotype_rows in by_biosample.items():
        t3 = time.time()
        result = step3_verify_candidate(biosample_acc, genotype_rows)
        elapsed3 = time.time() - t3
        print(f"  [Step 3 took {elapsed3:.1f}s]")

        step4_print_summary(result)

        if result['genotype_row_count'] > 0 and result['antibiogram_row_count'] > 0:
            # Found a valid candidate! Print its accession for use in step 5
            print(f"\n>>> CANDIDATE BIOSAMPLE FOR STEP 5: {biosample_acc}")
            total = time.time() - start
            print(f"\nTotal time: {total:.1f}s")
            return biosample_acc

    print("\nAll intersecting candidates lacked one data type. Need broader search.")
    total = time.time() - start
    print(f"\nTotal time: {total:.1f}s")
    sys.exit(4)


if __name__ == '__main__':
    result = main()

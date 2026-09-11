#!/usr/bin/env python3
"""Find first BioSample in a PDG AMR metadata TSV that has an Antibiogram table.

Usage: run with the workspace venv python to avoid installing packages.
"""
import sys
import requests
import xml.etree.ElementTree as ET

PDG_AMR_TSV_URL = (
    "https://ftp.ncbi.nlm.nih.gov/pathogen/Results/Escherichia_coli_Shigella/PDG000000004.6296/AMR/PDG000000004.6296.amr.metadata.tsv"
)


def has_antibiogram(biosample_acc):
    url = (
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
    )
    params = {"db": "biosample", "id": biosample_acc, "retmode": "xml"}
    try:
        r = requests.get(url, params=params, timeout=30)
        r.raise_for_status()
    except Exception as e:
        print(f"[ERR] efetch {biosample_acc}: {e}", file=sys.stderr)
        return False
    try:
        root = ET.fromstring(r.text)
    except Exception as e:
        print(f"[ERR] parse XML {biosample_acc}: {e}", file=sys.stderr)
        return False
    # Look for Table elements with class attribute containing 'Antibiogram'
    for table in root.findall('.//Table'):
        cls = table.get('class') or ''
        if 'Antibiogram' in cls:
            return True
    return False


def main():
    seen = set()
    max_biosamples = 2000
    max_lines = 200000
    print(f"Scanning PDG AMR TSV for biosamples (url={PDG_AMR_TSV_URL})")
    resp = requests.get(PDG_AMR_TSV_URL, stream=True, timeout=60)
    resp.raise_for_status()
    it = resp.iter_lines(decode_unicode=True)
    header = next(it)
    cols = header.split('\t')
    # find biosample column
    biosample_col = None
    for i, c in enumerate(cols):
        if 'biosample' in c.lower() or 'bio_sample' in c.lower() or 'biosample_accession' in c.lower():
            biosample_col = i
            break
    if biosample_col is None:
        print("Could not find biosample column in TSV header:", file=sys.stderr)
        print(header, file=sys.stderr)
        sys.exit(2)
    print(f"Found biosample column at index {biosample_col} (name={cols[biosample_col]})")

    for ln_no, line in enumerate(it, start=2):
        if not line:
            continue
        parts = line.split('\t')
        if biosample_col >= len(parts):
            continue
        bio = parts[biosample_col].strip()
        if not bio or bio in seen:
            continue
        seen.add(bio)
        if len(seen) >= max_biosamples or ln_no >= max_lines:
            print("Reached scan limit without finding antibiogram.")
            break
        # check biosample
        print(f"Checking {bio} (seen {len(seen)})...", flush=True)
        try:
            if has_antibiogram(bio):
                print("FOUND", bio)
                return 0
        except Exception as e:
            print(f"[ERR] checking {bio}: {e}", file=sys.stderr)
    print("No biosample with antibiogram found in scanned rows.")
    return 1


if __name__ == '__main__':
    sys.exit(main())

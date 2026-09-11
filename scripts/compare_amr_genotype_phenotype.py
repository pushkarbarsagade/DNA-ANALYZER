#!/usr/bin/env python3
"""
Compare AMRFinder-derived genotype rows from NCBI Pathogen Results
with BioSample antibiogram phenotype rows (one isolate PoC).

Usage:
  python scripts/compare_amr_genotype_phenotype.py --biosample SAMN05170351

Notes:
 - This script streams PDG AMR metadata TSV files from the NCBI FTP for
   `Escherichia_coli_Shigella` and finds rows matching the provided BioSample
   accession. It also fetches the BioSample XML via Entrez efetch to parse the
   antibiogram table.
 - The genotype->antibiotic mapping is a small curated heuristic used only for
   this PoC and is conservative. Rules are explained in the output.
"""
from __future__ import annotations

import argparse
import csv
import io
import sys
import xml.etree.ElementTree as ET
from typing import Dict, List, Optional

import requests


FTP_BASE = "https://ftp.ncbi.nlm.nih.gov/pathogen/Results/Escherichia_coli_Shigella/"


def fetch_biosample_antibiogram(biosample_acc: str) -> List[Dict[str, str]]:
    """Fetch BioSample XML via Entrez efetch and extract the Antibiogram table.

    Supports both HTML-style (TR/TD) and XML-style (Row/Cell) table structures.
    Returns list of rows as dicts with keys: antibiotic, phenotype, mic, units, method, guideline
    """
    url = (
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
        f"?db=biosample&id={biosample_acc}&retmode=xml"
    )
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    root = ET.fromstring(r.content)

    rows = []
    for table in root.findall('.//Table'):
        cls = table.attrib.get('class', '')
        if 'Antibiogram' in cls:
            # Check for <Row> elements (NCBI BioSample schema)
            xml_rows = table.findall('.//Row')
            if xml_rows:
                for row_el in xml_rows:
                    cells = [cell.text.strip() if cell.text else '' for cell in row_el.findall('Cell')]
                    if not cells:
                        continue
                    while len(cells) < 10:
                        cells.append('')
                    
                    # Format MIC with sign if available (e.g. <= 0.25)
                    sign = cells[2]
                    meas = cells[3]
                    mic_str = f"{sign} {meas}".strip() if sign and sign != '==' else meas
                    
                    row = {
                        'antibiotic': cells[0],
                        'phenotype': cells[1],
                        'mic': mic_str,
                        'units': cells[4],
                        'method': cells[5],
                        'guideline': cells[9] if len(cells) > 9 else (cells[8] if len(cells) > 8 else ''),
                    }
                    rows.append(row)
                break
            
            # Check for <TR> elements (HTML style schema)
            tr_rows = table.findall('.//TR')
            if tr_rows:
                for tr in tr_rows:
                    cells = [td.text.strip() if td.text else '' for td in tr.findall('TD')]
                    if not cells:
                        continue
                    while len(cells) < 6:
                        cells.append('')
                    row = {
                        'antibiotic': cells[0],
                        'phenotype': cells[1],
                        'mic': cells[2],
                        'units': cells[3],
                        'method': cells[4],
                        'guideline': cells[5],
                    }
                    rows.append(row)
                break
    return rows


def list_pdg_dirs() -> List[str]:
    """Fetch the Escherichia_coli_Shigella FTP directory and return PDG subfolders.
    These folder names end with a trailing slash in the HTML index and start with PDG
    """
    r = requests.get(FTP_BASE, timeout=30)
    r.raise_for_status()
    text = r.text
    pdgs = []
    for line in text.splitlines():
        if 'PDG' in line and 'href="PDG' in line:
            # crude parse: href="PDG.../"
            start = line.find('href="')
            if start != -1:
                start += len('href="')
                end = line.find('"', start)
                if end != -1:
                    href = line[start:end]
                    if href.endswith('/') and href.startswith('PDG'):
                        pdgs.append(href)
    # return newest-first to find recent PDG quickly
    return sorted(pdgs, reverse=True)


def find_genotype_rows_for_biosample(biosample_acc: str, target_pdg: Optional[str] = None) -> List[Dict[str, str]]:
    """Iterate PDG AMR metadata TSVs and return genotype rows for the biosample.

    This scans PDG folders in descending order and streams the TSV until a match is found.
    """
    if target_pdg:
        if not target_pdg.endswith('/'):
            target_pdg += '/'
        pdgs = [target_pdg]
    else:
        pdgs = list_pdg_dirs()
        
    found_rows = []
    for pdg in pdgs:
        amr_tsv_url = FTP_BASE + pdg + 'AMR/' + pdg.rstrip('/') + '.amr.metadata.tsv'
        print(f"Checking release {pdg.rstrip('/')}...", flush=True)
        try:
            r = requests.get(amr_tsv_url, stream=True, timeout=60)
            if r.status_code != 200:
                continue
            
            buffer = ""
            header_cols = []
            for chunk in r.iter_content(chunk_size=1024*1024, decode_unicode=True):
                if not chunk:
                    continue
                buffer += chunk
                lines = buffer.split('\n')
                buffer = lines.pop() # Keep partial line
                
                for line in lines:
                    if not line.strip():
                        continue
                    if not header_cols:
                        header_cols = [c.strip() for c in line.split('\t')]
                        continue
                    if biosample_acc in line:
                        parts = line.split('\t')
                        row = {header_cols[i]: (parts[i] if i < len(parts) else '') for i in range(len(header_cols))}
                        found_rows.append(row)
                    elif found_rows:
                        break
                if found_rows:
                    r.close()
                    break
            if found_rows:
                break
        except Exception as e:
            print(f"Error checking {pdg}: {e}", flush=True)
            continue
    return found_rows


DOCUMENTED_MAPPINGS = [
    ('blaTEM', ['ampicillin', 'amoxicillin', 'penicillin'], 'Project heuristic (TEM beta-lactamase spectrum)'),
    ('blaCMY', ['ampicillin', 'amoxicillin-clavulanic acid', 'cefazolin', 'cefoxitin', 'ceftiofur', 'ceftriaxone', 'ceftazidime', 'cephalexin', 'cefpodoxime', 'cefovecin'], 'Project heuristic (AmpC beta-lactamase spectrum)'),
    ('blaCTX', ['ceftriaxone', 'cefotaxime', 'ceftiofur', 'ceftazidime'], 'Project heuristic (ESBL CTX-M spectrum)'),
    ('blaEC', ['ampicillin'], 'Project heuristic (Core chrom. E. coli beta-lactamase)'),
    ('tet(', ['tetracycline', 'doxycycline'], 'Project heuristic (Tetracycline efflux pump tet(A))'),
    ('sul1', ['sulfisoxazole'], 'Project heuristic (Sulfonamide resistance gene sul1)'),
    ('sul2', ['sulfisoxazole'], 'Project heuristic (Sulfonamide resistance gene sul2)'),
    ('dfrA', ['trimethoprim'], 'Project heuristic (Dihydrofolate reductase dfrA)'),
    ('floR', ['chloramphenicol', 'florfenicol'], 'Project heuristic (Phenicol exporter floR)'),
    ('aph(3\'\')-Ib', ['streptomycin'], 'Project heuristic (Streptomycin phosphotransferase)'),
    ('aph(6)-Id', ['streptomycin'], 'Project heuristic (Streptomycin phosphotransferase)'),
]

COMBINATION_RULES = {
    'trimethoprim-sulfamethoxazole': {
        'required_genes': ['dfrA', ['sul1', 'sul2']],
        'basis': 'Project heuristic (Combined dfrA + sul for co-trimoxazole)'
    }
}


def get_mapped_genes_for_abx(gene_str: str, abx: str) -> tuple[List[str], str]:
    genes = [g.strip().strip('"') for g in gene_str.replace('"', '').split(',') if g.strip()]
    abx_clean = abx.strip().lower()

    # Check combination rules first
    if abx_clean in COMBINATION_RULES:
        rule = COMBINATION_RULES[abx_clean]
        has_dfr = any('dfra' in g.lower() for g in genes)
        has_sul = any('sul1' in g.lower() or 'sul2' in g.lower() for g in genes)
        if has_dfr and has_sul:
            matched = [g for g in genes if 'dfra' in g.lower() or 'sul1' in g.lower() or 'sul2' in g.lower()]
            return sorted(set(matched)), rule['basis']
        else:
            return [], ""

    # Standard single drug mapping check
    matched = []
    bases = set()
    for g in genes:
        for pat, abx_list, basis in DOCUMENTED_MAPPINGS:
            if pat.lower() in g.lower():
                for target_abx in abx_list:
                    if target_abx.lower() == abx_clean:
                        matched.append(g)
                        bases.add(basis)
    if matched:
        return sorted(set(matched)), "; ".join(sorted(bases))
    return [], ""


def compare(genotype_rows: List[Dict[str, str]], antibiogram_rows: List[Dict[str, str]]) -> List[Dict[str, str]]:
    # Extract raw AMR genotypes string from raw TSV
    genotype_str = ""
    if genotype_rows:
        r0_lower = {k.lower(): v for k, v in genotype_rows[0].items()}
        genotype_str = r0_lower.get('amr_genotypes') or r0_lower.get('amr_genotypes_core') or ''

    comparisons = []
    for ph in antibiogram_rows:
        abx = ph.get('antibiotic', '').strip()
        phenotype = ph.get('phenotype', '').strip()
        mic = ph.get('mic', '').strip()
        units = ph.get('units', '').strip()
        method = ph.get('method', '').strip()
        guideline = ph.get('guideline', '').strip()

        mapped_genes, mapping_basis = get_mapped_genes_for_abx(genotype_str, abx)
        evidence_str = "; ".join(mapped_genes) if mapped_genes else "(none)"
        basis_str = mapping_basis if mapping_basis else "(none)"

        ph_lower = phenotype.lower()
        is_defined = ph_lower not in ('not defined', '')

        if not mapped_genes:
            classification = "Not comparable"
            reason = "No validated genotype-to-antibiotic mapping"
        elif not is_defined:
            classification = "Not evaluable"
            reason = "Phenotype is 'not defined' in NCBI BioSample XML"
        else:
            ph_upper = phenotype.upper()
            if ph_upper in ('R', 'NS', 'RESISTANT', 'NON-SUSCEPTIBLE'):
                classification = "Concordant"
                reason = f"Mapped gene(s) present ({evidence_str}) and observed phenotype is resistant ({phenotype})"
            elif ph_upper in ('S', 'SSD', 'SUSCEPTIBLE'):
                classification = "Discordant"
                reason = f"Mapped gene(s) present ({evidence_str}) but observed phenotype is susceptible ({phenotype})"
            elif ph_upper in ('I', 'INTERMEDIATE'):
                classification = "Not comparable"
                reason = f"Observed phenotype is intermediate ({phenotype}) for mapped gene(s) ({evidence_str})"
            else:
                classification = "Not comparable"
                reason = f"Unrecognized defined phenotype format ({phenotype})"

        formatted_mic = f"{mic} {units}".strip() if units else mic

        comparisons.append(
            {
                'antibiotic': abx,
                'mic': formatted_mic,
                'phenotype': phenotype,
                'genotype_evidence': evidence_str,
                'mapping_basis': basis_str,
                'classification': classification,
                'comparison_status': classification,
                'reason': reason,
                'method': method,
                'guideline': guideline,
            }
        )
    return comparisons


def print_table(title: str, rows: List[Dict[str, str]], cols: Optional[List[str]] = None) -> None:
    print('\n' + '=' * 80)
    print(title)
    print('=' * 80)
    if not rows:
        print('(no rows)')
        return
    if cols is None:
        cols = list(rows[0].keys())
    # print header
    print('\t'.join(cols))
    for r in rows:
        print('\t'.join(r.get(c, '') for c in cols))


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument('--biosample', required=True, help='BioSample accession (eg. SAMN13050471)')
    p.add_argument('--pdg', required=False, default='PDG000000004.6296', help='PDG release ID (eg. PDG000000004.6296)')
    args = p.parse_args()

    biosample = args.biosample
    pdg_arg = args.pdg
    print(f'Fetching BioSample {biosample} antibiogram via Entrez efetch...', flush=True)
    try:
        antibiogram = fetch_biosample_antibiogram(biosample)
    except Exception as e:
        print('Failed to fetch BioSample:', e, file=sys.stderr)
        sys.exit(1)

    print(f'Found {len(antibiogram)} antibiogram rows.', flush=True)

    print('Searching Pathogen Results AMR metadata (Escherichia_coli_Shigella) for genotype rows...', flush=True)
    genotype_rows = find_genotype_rows_for_biosample(biosample, target_pdg=pdg_arg)
    print(f'Found {len(genotype_rows)} genotype rows (across PDG releases).', flush=True)

    # Output genotype table and phenotype table
    if genotype_rows:
        desired_cols = ['biosample_acc', 'asm_acc', 'amr_genotypes', 'amr_genotypes_core', 'virulence_genotypes', 'organism_name', 'strain', 'host']
        row_keys_lower = {k.lower(): k for k in genotype_rows[0].keys()}
        valid_cols = [row_keys_lower[dc] for dc in desired_cols if dc in row_keys_lower]
        if not valid_cols:
            valid_cols = list(genotype_rows[0].keys())[:8]
        print_table('Genotype rows (raw TSV fields)', genotype_rows, cols=valid_cols)
    else:
        print('\nNo genotype rows found in Pathogen Results for this BioSample.')

    print_table('Phenotype (BioSample antibiogram)', antibiogram, cols=['antibiotic', 'phenotype', 'mic', 'units', 'method', 'guideline'])

    comparisons = compare(genotype_rows, antibiogram)
    print_table('Comparison table', comparisons, cols=['antibiotic', 'mic', 'phenotype', 'genotype_evidence', 'mapping_basis', 'classification', 'reason'])

    # Summary Metrics Reporting
    num_ast_records = len(antibiogram)
    num_defined_phenotype = sum(1 for c in comparisons if c['phenotype'].lower() not in ('not defined', ''))
    num_validated_mapping = sum(1 for c in comparisons if c['genotype_evidence'] != '(none)')
    num_genuinely_comparable = sum(1 for c in comparisons if c['genotype_evidence'] != '(none)' and c['phenotype'].lower() not in ('not defined', ''))
    num_concordant = sum(1 for c in comparisons if c['classification'] == 'Concordant')
    num_discordant = sum(1 for c in comparisons if c['classification'] == 'Discordant')
    num_not_comparable = sum(1 for c in comparisons if c['classification'] == 'Not comparable')
    num_not_evaluable = sum(1 for c in comparisons if c['classification'] == 'Not evaluable')

    print('\n' + '=' * 80)
    print('ISOLATE COMPARISON SUMMARY REPORT')
    print('=' * 80)
    print(f"  - Total AST records:                           {num_ast_records}")
    print(f"  - Defined phenotypes:                          {num_defined_phenotype}")
    print(f"  - Records with validated genotype-antibiotic mapping: {num_validated_mapping}")
    print(f"  - Genuinely comparable pairs:                  {num_genuinely_comparable}")
    print(f"  - Concordant:                                  {num_concordant}")
    print(f"  - Discordant:                                  {num_discordant}")
    print(f"  - Not comparable:                              {num_not_comparable}")
    print(f"  - Not evaluable:                               {num_not_evaluable}")


if __name__ == '__main__':
    main()

"""
backend/services/amr_engine.py

Extracted and frozen AMR Genotype-Phenotype Concordance Engine.
Source of Truth: scripts/compare_amr_genotype_phenotype.py

Provides:
- DOCUMENTED_MAPPINGS: Curated heuristic mappings of AMR genes to antibiotics.
- COMBINATION_RULES: Specific multi-gene rules (e.g. trimethoprim-sulfamethoxazole).
- get_mapped_genes_for_abx: Evaluates AMR genotype strings against tested antibiotics.
- compare: Evaluates antibiogram phenotype rows against genotype metadata.
- calculate_concordance_metrics: Aggregates summary statistics over comparison rows.
- parse_biosample_xml_antibiogram: Parses BioSample XML table structures into AST records.
- fetch_biosample_antibiogram: Live Entrez retrieval helper.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional, Tuple

import requests


FTP_BASE = "https://ftp.ncbi.nlm.nih.gov/pathogen/Results/Escherichia_coli_Shigella/"

# ==============================================================================
# SCIENTIFIC MAPPINGS (FROZEN FOR PHASE 1)
# ==============================================================================

DOCUMENTED_MAPPINGS: List[Tuple[str, List[str], str]] = [
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

COMBINATION_RULES: Dict[str, Dict[str, Any]] = {
    'trimethoprim-sulfamethoxazole': {
        'required_genes': ['dfrA', ['sul1', 'sul2']],
        'basis': 'Project heuristic (Combined dfrA + sul for co-trimoxazole)'
    }
}


# ==============================================================================
# CORE GENOTYPE-TO-ANTIBIOTIC MATCHING
# ==============================================================================

def get_mapped_genes_for_abx(gene_str: str, abx: str) -> Tuple[List[str], str]:
    """
    Match an isolate's AMR genotype string against a tested antibiotic.

    Follows strict exact drug name matching against documented drug lists.
    Returns (sorted_matched_genes, provenance_basis_string).
    """
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


# ==============================================================================
# CONCORDANCE COMPARISON ENGINE
# ==============================================================================

def compare(
    genotype_rows: List[Dict[str, str]],
    antibiogram_rows: List[Dict[str, str]]
) -> List[Dict[str, str]]:
    """
    Compare AMRFinder-derived genotype rows with BioSample antibiogram phenotype rows.

    Exact behavior preserved from scripts/compare_amr_genotype_phenotype.py:
    - No mapped gene -> 'Not comparable' (Reason: 'No validated genotype-to-antibiotic mapping')
    - Mapped gene present + phenotype is 'not defined' or empty -> 'Not evaluable'
    - Mapped gene present + resistant phenotype -> 'Concordant'
    - Mapped gene present + susceptible phenotype -> 'Discordant'
    - Mapped gene present + intermediate phenotype -> 'Not comparable'
    - Mapped gene present + unrecognized phenotype -> 'Not comparable'
    """
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

        ph_upper = phenotype.upper()
        # Phenotype eligibility: Must be an explicit categorical call (S, I, R, NS, SSD)
        # Undefined, blank, null, unknown, or MIC-only records are NOT EVALUABLE
        is_eligible_phenotype = ph_upper in (
            'R', 'RESISTANT', 'NS', 'NON-SUSCEPTIBLE',
            'S', 'SUSCEPTIBLE', 'SSD',
            'I', 'INTERMEDIATE'
        )

        # Scientific Hierarchy:
        # 1. Is phenotype explicit S/I/R? NO -> Not Evaluable
        # 2. YES -> Is there validated genotype-antibiotic mapping? NO -> Not Comparable
        # 3. YES -> Compare -> Concordant / Discordant
        if not is_eligible_phenotype:
            classification = "Not evaluable"
            if not phenotype or phenotype.lower() in ('not defined', 'unknown', 'none'):
                reason = "Phenotype is 'not defined' in NCBI BioSample XML"
            else:
                reason = f"Phenotype '{phenotype}' is not an eligible S/I/R categorical determination"
        elif not mapped_genes:
            classification = "Not comparable"
            reason = "No validated genotype-to-antibiotic mapping"
        else:
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

        comparisons.append({
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
        })
    return comparisons


def calculate_concordance_metrics(comparisons: List[Dict[str, str]]) -> Dict[str, Any]:
    """
    Calculate summary validation metrics over a collection of comparison records.
    """
    total_ast = len(comparisons)
    eligible_sir = sum(
        1 for c in comparisons
        if c.get('phenotype', '').upper() in (
            'R', 'RESISTANT', 'NS', 'NON-SUSCEPTIBLE',
            'S', 'SUSCEPTIBLE', 'SSD',
            'I', 'INTERMEDIATE'
        )
    )
    defined_ph = sum(1 for c in comparisons if c.get('phenotype', '').lower() not in ('not defined', ''))
    rec_mapped = sum(1 for c in comparisons if c.get('genotype_evidence') != '(none)')
    gen_comp = sum(
        1 for c in comparisons
        if c.get('classification') in ('Concordant', 'Discordant')
    )
    conc = sum(1 for c in comparisons if c.get('classification') == 'Concordant')
    disc = sum(1 for c in comparisons if c.get('classification') == 'Discordant')
    not_comp = sum(1 for c in comparisons if c.get('classification') == 'Not comparable')
    not_eval = sum(1 for c in comparisons if c.get('classification') == 'Not evaluable')

    concordance_rate = (conc / gen_comp * 100.0) if gen_comp > 0 else 0.0

    return {
        'total_ast_records': total_ast,
        'eligible_sir_records': eligible_sir,
        'defined_phenotypes': defined_ph,
        'records_with_validated_mapping': rec_mapped,
        'comparable_pairs': gen_comp,
        'concordant': conc,
        'discordant': disc,
        'not_comparable': not_comp,
        'not_evaluable': not_eval,
        'concordance_percentage': round(concordance_rate, 1) if gen_comp > 0 else None,
        'concordance_raw': concordance_rate if gen_comp > 0 else None,
    }


# ==============================================================================
# BIOSAMPLE XML PARSING & RETRIEVAL HELPERS
# ==============================================================================

def parse_biosample_xml_antibiogram(xml_content: str | bytes) -> List[Dict[str, str]]:
    """
    Parse BioSample XML and extract the Antibiogram table.
    Supports both NCBI formal schema (<Row>/<Cell>) and HTML table schema (<TR>/<TD>).
    """
    if isinstance(xml_content, str):
        root = ET.fromstring(xml_content)
    else:
        root = ET.fromstring(xml_content)

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


def fetch_biosample_antibiogram(biosample_acc: str) -> List[Dict[str, str]]:
    """Fetch BioSample XML via Entrez efetch and extract the Antibiogram table."""
    url = (
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
        f"?db=biosample&id={biosample_acc}&retmode=xml"
    )
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    return parse_biosample_xml_antibiogram(r.content)

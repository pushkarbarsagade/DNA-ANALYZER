"""
backend/services/amr_ml_dataset.py

Phase 11 — AMR Machine Learning Dataset Discovery & Extraction Service.

Discovers eligible (organism, antibiotic) combinations with sufficient sample
sizes and balanced classes from NCBI Pathogen Detection data (via BigQuery or
cached/streamed releases). Extracts clean binary datasets adhering to strict
AMR scientific rules.

Scientific Rules:
- Explicit S/R phenotypes only (S=0, R=1).
- Intermediate (I), Not Defined (ND), and MIC-only are strictly excluded.
- No breakpoint inference from MIC values.
- Duplicate isolate observations are deduplicated by BioSample accession.
- Zero-determinant isolates are preserved as all-zero feature vectors (x = 0).
- The five frozen validation benchmark isolates are 100% excluded.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)

FROZEN_BENCHMARK_BIOSAMPLES = frozenset({
    "SAMN03177674",
    "SAMN03177676",
    "SAMN03177659",
    "SAMN03177675",
    "SAMN03177664"
})

# Configurable minimum-data thresholds (Engineering quality gates)
DEFAULT_MIN_TOTAL_ISOLATES = 100
DEFAULT_MIN_PER_CLASS = 20


def parse_amr_genes(amr_str: Any) -> Set[str]:
    """
    Parse an AMRFinderPlus genotype string or array into normalized determinant names.
    Supports comma-separated strings as well as structured lists/dicts.
    """
    if not amr_str or amr_str in ("NULL", "-", ""):
        return set()

    genes = set()
    if isinstance(amr_str, (list, tuple)):
        for item in amr_str:
            if isinstance(item, dict):
                sym = item.get("gene_symbol") or item.get("element_symbol") or item.get("name")
                subtype = item.get("subtype") or "COMPLETE"
                if sym:
                    feat = sym if subtype in ("COMPLETE", "") else f"{sym}={subtype}"
                    genes.add(feat)
            elif isinstance(item, str) and item.strip():
                genes.update(parse_amr_genes(item))
        return genes

    for item in str(amr_str).split(","):
        item = item.strip().strip('"\'')
        if not item:
            continue
        parts = item.split("=")
        gene_name = parts[0].strip()
        subtype = parts[1].strip() if len(parts) > 1 else "COMPLETE"
        is_partial = False
        if len(parts) > 2:
            is_partial = (parts[2].strip().lower() == "true")

        feat_name = gene_name
        if subtype and subtype != "COMPLETE":
            feat_name += f"={subtype}"
        if is_partial:
            feat_name += "=PARTIAL"
        genes.add(feat_name)

    return genes


def normalize_phenotype_binary(raw_pheno: Any) -> Optional[int]:
    """
    Map explicit phenotype string to binary label.
    Returns 0 for Susceptible, 1 for Resistant.
    Returns None for I, ND, MIC-only, non-standard (strictly excluded).
    """
    if not raw_pheno:
        return None
    p = str(raw_pheno).strip().upper()
    if p in ("S", "SUSCEPTIBLE", "SSD"):
        return 0
    if p in ("R", "RESISTANT", "NON-SUSCEPTIBLE", "NS"):
        return 1
    # Intermediate, Not Defined, MIC-only -> strictly excluded
    return None


def extract_ast_pairs(ast_raw: Any) -> List[Tuple[str, str]]:
    """
    Extract (antibiotic, raw_phenotype) pairs from various BigQuery/NCBI AST formats:
    - Comma-separated 'ampicillin=R,tetracycline=S'
    - JSON array of objects [{'antibiotic': 'ampicillin', 'phenotype': 'Resistant'}]
    """
    if not ast_raw:
        return []

    pairs = []
    if isinstance(ast_raw, str):
        ast_str = ast_raw.strip()
        if ast_str.startswith("["):
            try:
                parsed_json = json.loads(ast_str)
                if isinstance(parsed_json, list):
                    return extract_ast_pairs(parsed_json)
            except Exception:
                pass

        for item in ast_str.replace('"', '').split(","):
            if "=" in item:
                drug, pheno = item.split("=", 1)
                d = drug.strip().lower()
                p = pheno.strip()
                if d and p:
                    pairs.append((d, p))
    elif isinstance(ast_raw, (list, tuple)):
        for item in ast_raw:
            if isinstance(item, dict):
                d = item.get("antibiotic") or item.get("drug")
                p = item.get("phenotype")
                if d and p:
                    pairs.append((str(d).strip().lower(), str(p).strip()))

    return pairs


# ---------------------------------------------------------------------------
# BigQuery Query Helpers
# ---------------------------------------------------------------------------

def _get_bq_client() -> Optional[Any]:
    """Instantiate BigQuery client if configured, else None."""
    try:
        from backend.services.bigquery_provider import _create_bigquery_client, get_bigquery_config_status
        status = get_bigquery_config_status()
        if status.get("configured"):
            return _create_bigquery_client()
    except Exception as e:
        logger.warning("BigQuery client not available: %s", e)
    return None


def query_candidate_summary_from_bigquery(
    limit_isolates: int = 50000,
    client: Optional[Any] = None
) -> List[Dict[str, Any]]:
    """
    Run a targeted aggregation query on `ncbi-pathogen-detect.pdbrowser.isolates`
    to discover organism × antibiotic sample counts.
    """
    bq = client or _get_bq_client()
    if bq is None:
        return []

    query = f"""
    WITH unnested_ast AS (
      SELECT
        COALESCE(scientific_name, taxgroup_name) AS organism,
        ast.antibiotic AS antibiotic,
        UPPER(TRIM(ast.phenotype)) AS phenotype
      FROM `ncbi-pathogen-detect.pdbrowser.isolates`,
      UNNEST(ast_phenotypes) AS ast
      WHERE biosample_acc NOT IN ('SAMN03177674', 'SAMN03177676', 'SAMN03177659', 'SAMN03177675', 'SAMN03177664')
      LIMIT {limit_isolates}
    )
    SELECT
      organism,
      antibiotic,
      COUNT(*) AS total_n,
      COUNTIF(phenotype IN ('S', 'SUSCEPTIBLE')) AS susceptible_count,
      COUNTIF(phenotype IN ('R', 'RESISTANT')) AS resistant_count,
      COUNTIF(phenotype NOT IN ('S', 'SUSCEPTIBLE', 'R', 'RESISTANT')) AS excluded_count
    FROM unnested_ast
    WHERE organism IS NOT NULL AND antibiotic IS NOT NULL
    GROUP BY organism, antibiotic
    ORDER BY total_n DESC
    """
    try:
        query_job = bq.query(query)
        rows = list(query_job.result(timeout=60.0))
        results = []
        for r in rows:
            results.append({
                "organism": r.get("organism"),
                "antibiotic": r.get("antibiotic"),
                "total_n": int(r.get("total_n", 0)),
                "susceptible_count": int(r.get("susceptible_count", 0)),
                "resistant_count": int(r.get("resistant_count", 0)),
                "excluded_count": int(r.get("excluded_count", 0)),
            })
        return results
    except Exception as e:
        logger.error("BigQuery candidate summary query failed: %s", e)
        return []


# ---------------------------------------------------------------------------
# Candidate Discovery Pipeline
# ---------------------------------------------------------------------------

def discover_candidates(
    raw_isolate_records: Optional[List[Dict[str, Any]]] = None,
    min_total_isolates: int = DEFAULT_MIN_TOTAL_ISOLATES,
    min_per_class: int = DEFAULT_MIN_PER_CLASS,
    use_bigquery: bool = True
) -> List[Dict[str, Any]]:
    """
    Discover all organism × antibiotic combinations and determine their eligibility
    for automated model training.
    """
    counts: Dict[Tuple[str, str], Dict[str, int]] = {}

    # Source 1: If raw isolate records are provided in-memory
    if raw_isolate_records:
        for iso in raw_isolate_records:
            bs = iso.get("biosample_acc") or iso.get("biosample_accession")
            if bs in FROZEN_BENCHMARK_BIOSAMPLES:
                continue

            org = iso.get("organism") or "Escherichia coli"
            ast_pairs = iso.get("ast_records") or extract_ast_pairs(iso.get("ast_phenotypes"))

            for drug, pheno in ast_pairs:
                key = (org.strip(), drug.strip().capitalize())
                if key not in counts:
                    counts[key] = {"total_n": 0, "susceptible": 0, "resistant": 0, "excluded": 0}

                label = normalize_phenotype_binary(pheno)
                if label == 0:
                    counts[key]["susceptible"] += 1
                    counts[key]["total_n"] += 1
                elif label == 1:
                    counts[key]["resistant"] += 1
                    counts[key]["total_n"] += 1
                else:
                    counts[key]["excluded"] += 1

    # Source 2: BigQuery if configured and no memory records passed
    elif use_bigquery:
        bq_rows = query_candidate_summary_from_bigquery()
        for r in bq_rows:
            key = (r["organism"], r["antibiotic"].capitalize())
            counts[key] = {
                "total_n": r["susceptible_count"] + r["resistant_count"],
                "susceptible": r["susceptible_count"],
                "resistant": r["resistant_count"],
                "excluded": r["excluded_count"]
            }

    # Evaluate eligibility against quality gates
    candidates = []
    for (org, abx), data in counts.items():
        total = data["total_n"]
        s = data["susceptible"]
        r = data["resistant"]
        min_class = min(s, r)

        eligible = True
        reasons = []

        if total < min_total_isolates:
            eligible = False
            reasons.append(f"Insufficient total isolates ({total} < {min_total_isolates})")

        if min_class < min_per_class:
            eligible = False
            reasons.append(f"Insufficient minority class ({min_class} < {min_per_class})")

        candidates.append({
            "organism": org,
            "antibiotic": abx,
            "total_usable_isolates": total,
            "susceptible_count": s,
            "resistant_count": r,
            "excluded_count": data["excluded"],
            "eligible": eligible,
            "rejection_reason": "; ".join(reasons) if not eligible else None
        })

    return sorted(candidates, key=lambda c: c["total_usable_isolates"], reverse=True)


# ---------------------------------------------------------------------------
# Training Dataset Builder
# ---------------------------------------------------------------------------

def build_dataset_for_scope(
    organism: str,
    antibiotic: str,
    raw_isolate_records: List[Dict[str, Any]],
    exclude_benchmark: bool = True
) -> Dict[str, Any]:
    """
    Filter and construct a clean dataset for training a specific (organism, antibiotic) model.
    """
    from backend.services.amr_model_registry import normalize_organism_key, normalize_antibiotic_key
    target_org_key = normalize_organism_key(organism)
    target_abx_key = normalize_antibiotic_key(antibiotic)

    usable_isolates = []
    seen_biosamples = set()
    zero_gene_count = 0
    s_count = 0
    r_count = 0

    for iso in raw_isolate_records:
        bs = iso.get("biosample_acc") or iso.get("biosample_accession")
        if not bs or bs in seen_biosamples:
            continue

        if exclude_benchmark and bs in FROZEN_BENCHMARK_BIOSAMPLES:
            continue

        iso_org = iso.get("organism") or "Escherichia coli"
        if normalize_organism_key(iso_org) != target_org_key:
            continue

        # Extract AST phenotype for target antibiotic
        ast_pairs = iso.get("ast_records")
        if not ast_pairs:
            ast_pairs = extract_ast_pairs(iso.get("ast_phenotypes"))

        matching_pheno = None
        for drug, pheno in ast_pairs:
            if normalize_antibiotic_key(drug) == target_abx_key:
                matching_pheno = pheno
                break

        if not matching_pheno:
            continue

        label = normalize_phenotype_binary(matching_pheno)
        if label is None:
            # Exclude I, ND, MIC-only
            continue

        # Extract AMR determinants
        amr_raw = iso.get("amr_genotypes") or iso.get("AMR_genotypes") or ""
        genes = parse_amr_genes(amr_raw)
        has_amr = len(genes) > 0
        if not has_amr:
            zero_gene_count += 1

        seen_biosamples.add(bs)
        if label == 0:
            s_count += 1
        else:
            r_count += 1

        usable_isolates.append({
            "biosample_acc": bs,
            "organism": iso_org,
            "antibiotic": antibiotic,
            "target_label": label,
            "phenotype_str": "R" if label == 1 else "S",
            "amr_genes": genes,
            "has_amr": has_amr
        })

    return {
        "organism": organism,
        "antibiotic": antibiotic,
        "total_isolates": len(usable_isolates),
        "susceptible_count": s_count,
        "resistant_count": r_count,
        "zero_gene_isolates": zero_gene_count,
        "isolates": usable_isolates
    }

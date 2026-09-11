"""
backend/services/amr_reconciliation.py

Deterministic Evidence Reconciliation Engine (Phase 5).
Reconciles Genomic Evidence, NCBI AST observations, and optional User Laboratory Evidence.

Scientific Principles:
- Deterministic structured rules produce the facts before any AI explanation.
- No negative genotype inference: Absence of a mapped gene does not establish susceptibility.
- Qualitative evidence labeling: "Available", "Limited", "Conflicting", "Not comparable", "Not evaluable".
- No numerical probability fabrication (e.g. no fake "87% confidence").
- Possible research explanations provided for discordance/conflicts without claiming definitive clinical cause.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

try:
    from services.amr_engine import compare, get_mapped_genes_for_abx
except ImportError:
    from backend.services.amr_engine import compare, get_mapped_genes_for_abx


POSSIBLE_DISCORDANCE_EXPLANATIONS = [
    "The resistance determinant may not be functionally expressed or may exhibit low transcriptional activity in this isolate.",
    "The determinant may have context-dependent effects or require auxiliary co-factors/mutations for phenotypic expression.",
    "Genotype–phenotype relationships are not universally deterministic across all isolate backgrounds and sequence variants.",
    "Differences in isolate passage history, culturing conditions, or laboratory environmental factors may contribute.",
    "Phenotypic susceptibility testing methodologies (e.g., broth microdilution, disk diffusion, gradient strip) and laboratory interpretation criteria may differ.",
    "Curated reference databases and rule-based genotype–phenotype mappings have inherent scope limitations."
]


def normalize_phenotype(phenotype: Optional[str]) -> str:
    """Normalize phenotype string to standard uppercase designation."""
    if not phenotype:
        return ""
    p = phenotype.strip().upper()
    if p in ("R", "RESISTANT", "NON-SUSCEPTIBLE", "NS"):
        return "Resistant"
    if p in ("S", "SUSCEPTIBLE", "SSD"):
        return "Susceptible"
    if p in ("I", "INTERMEDIATE"):
        return "Intermediate"
    if p in ("NOT DEFINED", ""):
        return "Not defined"
    return p.capitalize()


def reconcile_single_antibiotic(
    antibiotic: str,
    genotype_str: str,
    ncbi_record: Optional[Dict[str, Any]] = None,
    user_record: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Deterministically reconcile evidence for a single antibiotic across:
    1. Genomic Evidence
    2. NCBI AST
    3. User Laboratory Evidence (optional)
    """
    abx_clean = antibiotic.strip()
    mapped_genes, mapping_basis = get_mapped_genes_for_abx(genotype_str, abx_clean)
    has_genomic = len(mapped_genes) > 0
    evidence_str = "; ".join(mapped_genes) if has_genomic else "(none)"
    basis_str = mapping_basis if mapping_basis else "(none)"

    # Structure Genomic Evidence
    genomic_info = {
        "genes": mapped_genes,
        "evidence_str": evidence_str,
        "has_determinant": has_genomic,
        "mapping_basis": basis_str,
        "source": "AMR genotype information from the validated NCBI Pathogen Detection workflow."
    }

    # Structure NCBI AST
    ncbi_ast_info: Dict[str, Any] = {
        "available": False,
        "phenotype": "Not available",
        "mic": "",
        "method": "",
        "guideline": "",
        "source": "NCBI Pathogen Detection Antibiogram"
    }
    if ncbi_record:
        raw_ph = ncbi_record.get("phenotype", "")
        norm_ph = normalize_phenotype(raw_ph)
        ncbi_ast_info = {
            "available": bool(raw_ph and norm_ph != "Not defined"),
            "raw_phenotype": raw_ph,
            "phenotype": norm_ph if norm_ph else "Not defined",
            "mic": ncbi_record.get("mic", ""),
            "method": ncbi_record.get("method", ""),
            "guideline": ncbi_record.get("guideline", ""),
            "source": "NCBI Pathogen Detection Antibiogram"
        }

    # Structure User Laboratory Evidence
    user_lab_info: Dict[str, Any] = {
        "available": False,
        "phenotype": "Not supplied",
        "mic": "",
        "unit": "",
        "method": "",
        "note": "",
        "source": "User Laboratory Evidence"
    }
    if user_record:
        raw_user_ph = user_record.get("phenotype", "")
        norm_user_ph = normalize_phenotype(raw_user_ph)
        user_lab_info = {
            "available": bool(raw_user_ph and norm_user_ph not in ("", "Not defined")),
            "raw_phenotype": raw_user_ph,
            "phenotype": norm_user_ph if norm_user_ph else "Not defined",
            "mic": user_record.get("mic", ""),
            "unit": user_record.get("unit", ""),
            "method": user_record.get("method", ""),
            "note": user_record.get("note", ""),
            "source": "User Laboratory Evidence"
        }

    # Evaluate Evidence Consistency
    reconciliation_status = ""
    reconciliation_category = ""
    evidence_strength = "Available"
    has_conflict = False
    conflict_summary = ""
    explanation_factors: List[str] = []

    # Case 1: No mapped genomic determinant
    if not has_genomic:
        # Scientific Rule: Do not infer negative genotype ("no gene = susceptible")
        genomic_info["note"] = "No applicable genomic resistance determinant was identified by the current comparison rules."
        if not ncbi_ast_info["available"] and not user_lab_info["available"]:
            reconciliation_status = "Not evaluable"
            reconciliation_category = "not_evaluable"
            evidence_strength = "Not evaluable"
        elif ncbi_ast_info["available"] or user_lab_info["available"]:
            # Check user vs ncbi if both exist
            if ncbi_ast_info["available"] and user_lab_info["available"]:
                if ncbi_ast_info["phenotype"] != user_lab_info["phenotype"] and "Intermediate" not in (ncbi_ast_info["phenotype"], user_lab_info["phenotype"]):
                    has_conflict = True
                    reconciliation_status = "Conflict between evidence sources"
                    reconciliation_category = "conflict"
                    evidence_strength = "Conflicting"
                    conflict_summary = f"NCBI AST ({ncbi_ast_info['phenotype']}) conflicts with User Laboratory observation ({user_lab_info['phenotype']}). No validated genomic determinant was identified for this antibiotic."
                    explanation_factors = POSSIBLE_DISCORDANCE_EXPLANATIONS.copy()
                else:
                    reconciliation_status = "Not comparable"
                    reconciliation_category = "not_comparable"
                    evidence_strength = "Not comparable"
                    conflict_summary = "Phenotypic observations are available, but no validated genotype–antibiotic rule is established for genomic comparison."
            else:
                reconciliation_status = "Not comparable"
                reconciliation_category = "not_comparable"
                evidence_strength = "Not comparable"
                conflict_summary = "No applicable genomic resistance determinant was identified by the current comparison rules."

    # Case 2: Mapped genomic determinant present (predicts resistance)
    else:
        # Evaluate phenotypes
        ncbi_ph = ncbi_ast_info["phenotype"] if ncbi_ast_info["available"] else None
        user_ph = user_lab_info["phenotype"] if user_lab_info["available"] else None

        # Both NCBI AST and User Lab available (3 sources)
        if ncbi_ph and user_ph:
            if ncbi_ph == "Resistant" and user_ph == "Resistant":
                reconciliation_status = "Concordant across available evidence"
                reconciliation_category = "concordant_all"
                evidence_strength = "Available"
                conflict_summary = f"Genomic determinants ({evidence_str}), NCBI AST (Resistant), and User Laboratory observation (Resistant) are in agreement."
            elif ncbi_ph == "Resistant" and user_ph == "Susceptible":
                has_conflict = True
                reconciliation_status = "Conflict between evidence sources"
                reconciliation_category = "conflict"
                evidence_strength = "Conflicting"
                conflict_summary = f"Genomic evidence ({evidence_str}) and NCBI AST (Resistant) conflict with User Laboratory observation (Susceptible)."
                explanation_factors = POSSIBLE_DISCORDANCE_EXPLANATIONS.copy()
            elif ncbi_ph == "Susceptible" and user_ph == "Resistant":
                has_conflict = True
                reconciliation_status = "Conflict between evidence sources"
                reconciliation_category = "conflict"
                evidence_strength = "Conflicting"
                conflict_summary = f"Genomic evidence ({evidence_str}) and User Laboratory observation (Resistant) conflict with NCBI AST (Susceptible)."
                explanation_factors = POSSIBLE_DISCORDANCE_EXPLANATIONS.copy()
            elif ncbi_ph == "Susceptible" and user_ph == "Susceptible":
                has_conflict = True
                reconciliation_status = "Conflict between evidence sources"
                reconciliation_category = "conflict"
                evidence_strength = "Conflicting"
                conflict_summary = f"Genomic evidence ({evidence_str}) indicates resistance, but both NCBI AST and User Laboratory observations indicate Susceptibility."
                explanation_factors = POSSIBLE_DISCORDANCE_EXPLANATIONS.copy()
            else:
                # Intermediate or mixed
                reconciliation_status = "Partial evidence"
                reconciliation_category = "partial"
                evidence_strength = "Limited"
                conflict_summary = f"Genomic determinants ({evidence_str}) present with intermediate/qualifying phenotype observations."

        # Only NCBI AST available (2 sources: Genomic + NCBI)
        elif ncbi_ph:
            if ncbi_ph == "Resistant":
                reconciliation_status = "Concordant with NCBI AST"
                reconciliation_category = "concordant_ncbi"
                evidence_strength = "Available"
                conflict_summary = f"Genomic determinant ({evidence_str}) is concordant with observed NCBI AST (Resistant)."
            elif ncbi_ph == "Susceptible":
                has_conflict = True
                reconciliation_status = "Conflict between evidence sources"
                reconciliation_category = "conflict"
                evidence_strength = "Conflicting"
                conflict_summary = f"Genomic determinant ({evidence_str}) indicates resistance, but observed NCBI AST is Susceptible (Known Genotype–Phenotype Discordance)."
                explanation_factors = POSSIBLE_DISCORDANCE_EXPLANATIONS.copy()
            else:
                reconciliation_status = "Not comparable"
                reconciliation_category = "not_comparable"
                evidence_strength = "Not comparable"
                conflict_summary = f"Observed NCBI AST is {ncbi_ph} for mapped determinant ({evidence_str})."

        # Only User Lab available (2 sources: Genomic + User Lab)
        elif user_ph:
            if user_ph == "Resistant":
                reconciliation_status = "Concordant with User Laboratory AST"
                reconciliation_category = "concordant_user"
                evidence_strength = "Available"
                conflict_summary = f"Genomic determinant ({evidence_str}) is concordant with User Laboratory observation (Resistant)."
            elif user_ph == "Susceptible":
                has_conflict = True
                reconciliation_status = "Conflict between evidence sources"
                reconciliation_category = "conflict"
                evidence_strength = "Conflicting"
                conflict_summary = f"Genomic determinant ({evidence_str}) indicates resistance, but User Laboratory observation is Susceptible."
                explanation_factors = POSSIBLE_DISCORDANCE_EXPLANATIONS.copy()
            else:
                reconciliation_status = "Partial evidence"
                reconciliation_category = "partial"
                evidence_strength = "Limited"
                conflict_summary = f"User laboratory observation is {user_ph} for mapped determinant ({evidence_str})."

        # Neither phenotype available
        else:
            reconciliation_status = "Not evaluable"
            reconciliation_category = "not_evaluable"
            evidence_strength = "Not evaluable"
            conflict_summary = f"Genomic determinant ({evidence_str}) identified, but no eligible phenotypic AST data were provided."

    return {
        "antibiotic": abx_clean,
        "genomic_evidence": genomic_info,
        "ncbi_ast": ncbi_ast_info,
        "user_lab": user_lab_info,
        "reconciliation_status": reconciliation_status,
        "reconciliation_category": reconciliation_category,
        "evidence_strength": evidence_strength,
        "has_conflict": has_conflict,
        "conflict_summary": conflict_summary,
        "explanation_factors": explanation_factors
    }


def reconcile_isolate_evidence(
    isolate_data: Dict[str, Any],
    user_lab_records: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Perform full deterministic evidence reconciliation for an isolate.
    """
    biosample = isolate_data.get("biosample_accession", "")
    assembly = isolate_data.get("assembly_accession", "")
    organism = isolate_data.get("organism", "Escherichia coli")
    genotype_str = isolate_data.get("amr_genotypes", "")
    if not genotype_str and "raw_genotype_row" in isolate_data:
        genotype_str = isolate_data["raw_genotype_row"].get("amr_genotypes", "")

    ncbi_records = isolate_data.get("ast_records", [])
    user_lab_list = user_lab_records if isinstance(user_lab_records, list) else []

    # Map NCBI records by antibiotic (case-insensitive)
    ncbi_by_abx: Dict[str, Dict[str, Any]] = {}
    for r in ncbi_records:
        abx = r.get("antibiotic", "").strip()
        if abx:
            ncbi_by_abx[abx.lower()] = r

    # Map User records by antibiotic (case-insensitive)
    user_by_abx: Dict[str, Dict[str, Any]] = {}
    for r in user_lab_list:
        if isinstance(r, dict):
            abx = r.get("antibiotic", "").strip()
            if abx:
                user_by_abx[abx.lower()] = r

    # Gather union of all antibiotics
    all_abx_keys = list(dict.fromkeys(list(ncbi_by_abx.keys()) + list(user_by_abx.keys())))

    reconciled_findings = []
    for abx_k in all_abx_keys:
        ncbi_rec = ncbi_by_abx.get(abx_k)
        user_rec = user_by_abx.get(abx_k)
        display_name = (ncbi_rec.get("antibiotic") if ncbi_rec else None) or (user_rec.get("antibiotic") if user_rec else None) or abx_k
        finding = reconcile_single_antibiotic(
            antibiotic=display_name,
            genotype_str=genotype_str,
            ncbi_record=ncbi_rec,
            user_record=user_rec
        )
        reconciled_findings.append(finding)

    # Summary metrics of reconciliation
    total_evaluated = len(reconciled_findings)
    concordant_count = sum(1 for f in reconciled_findings if f["reconciliation_category"].startswith("concordant"))
    conflict_count = sum(1 for f in reconciled_findings if f["has_conflict"])
    not_comparable_count = sum(1 for f in reconciled_findings if f["reconciliation_category"] == "not_comparable")
    not_evaluable_count = sum(1 for f in reconciled_findings if f["reconciliation_category"] == "not_evaluable")
    partial_count = sum(1 for f in reconciled_findings if f["reconciliation_category"] == "partial")

    return {
        "biosample_accession": biosample,
        "assembly_accession": assembly,
        "organism": organism,
        "amr_genotypes": genotype_str,
        "total_evaluated_antibiotics": total_evaluated,
        "reconciliation_summary": {
            "total_antibiotics": total_evaluated,
            "concordant": concordant_count,
            "conflicts": conflict_count,
            "not_comparable": not_comparable_count,
            "not_evaluable": not_evaluable_count,
            "partial_evidence": partial_count
        },
        "findings": reconciled_findings
    }

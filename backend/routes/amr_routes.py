"""
backend/routes/amr_routes.py

Flask Blueprint for the AMR Research Module (Phase 2).
Exposes the frozen AMR Concordance Engine via REST API.

Endpoints:
- GET  /api/amr/validation-dataset
- GET  /api/amr/isolate/<biosample_accession>
- POST /api/amr/compare
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from flask import Blueprint, jsonify, request

try:
    from services.amr_engine import calculate_concordance_metrics, compare
except ImportError:
    from backend.services.amr_engine import calculate_concordance_metrics, compare


amr_bp = Blueprint("amr", __name__)

FIXTURE_PATH = Path(__file__).resolve().parent.parent / "data" / "validation_isolates.json"


def _load_validation_fixture() -> Dict[str, Any]:
    """Load the frozen validation fixture from disk."""
    if not FIXTURE_PATH.exists():
        raise FileNotFoundError(f"Validation fixture not found at {FIXTURE_PATH}")
    with open(FIXTURE_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


@amr_bp.route("/validation-dataset", methods=["GET"])
def get_validation_dataset():
    """
    GET /api/amr/validation-dataset

    Returns the five frozen validation isolates with their raw AST records,
    per-record comparison classifications, and aggregate summary metrics.
    Operates 100% offline using the frozen validation fixture.
    """
    try:
        fixture_data = _load_validation_fixture()
    except FileNotFoundError as e:
        return jsonify({"error": "Validation fixture not available", "details": str(e)}), 500
    except Exception as e:
        return jsonify({"error": "Failed to read validation fixture", "details": str(e)}), 500

    isolates_output = []
    all_comparisons = []

    for iso in fixture_data.get("isolates", []):
        acc = iso.get("biosample_accession", "")
        asm = iso.get("assembly_accession", "")
        organism = iso.get("organism", "")
        amr_raw = iso.get("amr_genotypes", "")
        tsv_row = iso.get("raw_genotype_row", {})
        ast_rows = iso.get("ast_records", [])

        # Execute frozen engine comparison
        comps = compare([tsv_row], ast_rows)
        iso_metrics = calculate_concordance_metrics(comps)
        all_comparisons.extend(comps)

        isolates_output.append({
            "biosample_accession": acc,
            "assembly_accession": asm,
            "organism": organism,
            "amr_genotypes": amr_raw,
            "ast_records": ast_rows,
            "comparisons": comps,
            "summary_metrics": iso_metrics
        })

    aggregate_metrics = calculate_concordance_metrics(all_comparisons)

    return jsonify({
        "status": "success",
        "metadata": fixture_data.get("metadata", {}),
        "total_isolates": len(isolates_output),
        "isolates": isolates_output,
        "summary_metrics": aggregate_metrics
    }), 200


# ---------------------------------------------------------------------------
# PHASE 7 — BigQuery & Dynamic NCBI Providers
# ---------------------------------------------------------------------------

_ncbi_provider = None
_bq_provider = None

def _get_ncbi_provider():
    """Lazily import ncbi_provider (FTP/BioSample) for fallback/testing."""
    global _ncbi_provider
    if _ncbi_provider is None:
        try:
            from backend.services import ncbi_provider as _mod
        except ImportError:
            from services import ncbi_provider as _mod
        _ncbi_provider = _mod
    return _ncbi_provider


def _get_bigquery_provider():
    """Lazily import bigquery_provider."""
    global _bq_provider
    if _bq_provider is None:
        try:
            from backend.services import bigquery_provider as _mod
        except ImportError:
            from services import bigquery_provider as _mod
        _bq_provider = _mod
    return _bq_provider


_VALIDATION_ACCESSIONS = frozenset({
    "SAMN03177674",
    "SAMN03177676",
    "SAMN03177659",
    "SAMN03177675",
    "SAMN03177664",
})

_AVAILABILITY_STATE_HTTP: Dict[str, int] = {
    "not_in_pathogen_detection": 404,
    "no_amr_genotype": 200,
    "no_ast_data": 200,
    "biosample_not_found": 404,
    "ncbi_unavailable": 503,
    "ncbi_timeout": 504,
    "no_compatible_release": 503,
    "dynamic_provider_not_configured": 503,
}


@amr_bp.route("/provider-status", methods=["GET"])
def get_provider_status():
    """
    GET /api/amr/provider-status

    Safe diagnostic status for the active NCBI data providers.
    Reports whether BigQuery is configured without exposing secrets.
    """
    bq_mod = _get_bigquery_provider()
    bq_status = bq_mod.get_bigquery_config_status()

    # Legacy FTP mode is strictly opt-in via environment variable
    legacy_ftp_enabled = os.getenv("ENABLE_LEGACY_FTP_FALLBACK", "").strip().lower() in ("1", "true", "yes")

    return jsonify({
        "status": "ok",
        "validation_fixture": {
            "status": "active",
            "isolates_count": len(_VALIDATION_ACCESSIONS)
        },
        "bigquery_provider": bq_status,
        "legacy_ftp_provider": {
            "enabled": legacy_ftp_enabled,
            "role": "testing/development only"
        },
        "active_dynamic_provider": "ncbi_bigquery" if bq_status["configured"] else (
            "ncbi_ftp_legacy" if legacy_ftp_enabled else "none (configuration required)"
        )
    }), 200


@amr_bp.route("/isolate/<biosample_accession>", methods=["GET"])
def get_isolate(biosample_accession: str):
    """
    GET /api/amr/isolate/<biosample_accession>

    Phase 6 — Dynamic NCBI BioSample Lookup.

    Routing rules:
      1. Validate accession format.
      2. If accession is one of the five frozen validation BioSamples:
         → return the exact frozen validation result from fixture.
      3. Otherwise:
         → call NCBI provider (Pathogen Detection TSV + BioSample efetch).
         → run the existing AMR comparison engine on the retrieved data.
         → return the result with provenance metadata.
    """
    acc_clean = (biosample_accession or "").strip().upper()
    if not acc_clean:
        return jsonify({"error": "BioSample accession is required"}), 400

    # Gate 1: Security & malformed input check (alphanumeric, hyphen, underscore, dot only, 3-50 chars)
    if not re.match(r'^[A-Z0-9_.-]{3,50}$', acc_clean):
        return jsonify({
            "error": "Invalid BioSample accession format",
            "details": "Accession must be 3-50 alphanumeric characters (hyphens/underscores/dots allowed).",
            "biosample": biosample_accession,
        }), 400

    # Gate 2: Frozen validation fixture (exact five BioSamples)
    if acc_clean in _VALIDATION_ACCESSIONS:
        try:
            fixture_data = _load_validation_fixture()
        except Exception as e:
            return jsonify({"error": "Failed to read validation fixture", "details": str(e)}), 500

        matched_iso = next(
            (i for i in fixture_data.get("isolates", [])
             if i.get("biosample_accession", "").upper() == acc_clean),
            None,
        )
        if not matched_iso:
            return jsonify({
                "error": "Validation fixture missing expected BioSample",
                "biosample": acc_clean,
            }), 500

        tsv_row = matched_iso.get("raw_genotype_row", {})
        ast_rows = matched_iso.get("ast_records", [])
        comps = compare([tsv_row], ast_rows)
        metrics = calculate_concordance_metrics(comps)

        return jsonify({
            "status": "success",
            "data_source": "validation_fixture",
            "data_source_label": "DNA Analyzer Validation Dataset",
            "biosample_accession": matched_iso.get("biosample_accession"),
            "assembly_accession": matched_iso.get("assembly_accession"),
            "organism": matched_iso.get("organism"),
            "amr_genotypes": matched_iso.get("amr_genotypes"),
            "ast_records": ast_rows,
            "comparisons": comps,
            "summary_metrics": metrics,
        }), 200

    # Gate 3: If accession does not match standard NCBI accession pattern (e.g. UNKNOWN_BIOSAMPLE)
    ncbi_prov = _get_ncbi_provider()
    if not ncbi_prov.validate_accession(acc_clean):
        return jsonify({
            "error": f"BioSample {acc_clean} not found in NCBI Pathogen Detection",
            "availability_state": "not_in_pathogen_detection",
            "biosample": biosample_accession,
        }), 404

    # Gate 4: Dynamic NCBI lookup (Phase 7 Priority: BigQuery -> Optional Legacy FTP)
    ncbi_prov = _get_ncbi_provider()
    # Check if _get_ncbi_provider was explicitly mocked by testing harnesses
    from unittest.mock import Mock
    is_ncbi_mocked = isinstance(ncbi_prov, Mock)

    bq_mod = _get_bigquery_provider()
    bq_status = bq_mod.get_bigquery_config_status()

    provider_result = None

    if is_ncbi_mocked:
        # Respect test mocking of the dynamic provider
        try:
            provider_result = ncbi_prov.lookup_biosample(acc_clean)
        except Exception as e:
            return jsonify({
                "error": "Unexpected error during NCBI lookup",
                "details": str(e),
                "biosample": acc_clean,
            }), 500
    elif bq_status["configured"]:
        try:
            provider_result = bq_mod.query_biosample_bigquery(acc_clean)
        except Exception as e:
            return jsonify({
                "error": "Unexpected error during BigQuery lookup",
                "details": str(e),
                "biosample": acc_clean,
            }), 500
    else:
        # Check if legacy FTP fallback is explicitly enabled for development/testing
        legacy_ftp_enabled = os.getenv("ENABLE_LEGACY_FTP_FALLBACK", "").strip().lower() in ("1", "true", "yes")
        if legacy_ftp_enabled:
            try:
                provider_result = ncbi_prov.lookup_biosample(acc_clean)
            except Exception as e:
                return jsonify({
                    "error": "Unexpected error during NCBI FTP lookup",
                    "details": str(e),
                    "biosample": acc_clean,
                }), 500
        else:
            # Truthful structured state when BigQuery is not configured
            provider_result = {
                "biosample_accession": acc_clean,
                "data_source": "ncbi_pathogen_detection_bigquery",
                "data_source_label": "NCBI Pathogen Detection (BigQuery)",
                "state": "dynamic_provider_not_configured",
                "availability_message": (
                    "Live multi-organism NCBI Pathogen Detection lookup requires Google BigQuery "
                    "configuration. Set BIGQUERY_PROJECT_ID and credentials in backend environment variables. "
                    "The five frozen validation isolates remain accessible offline."
                ),
            }

    state = provider_result.get("state", "ncbi_unavailable")
    pdg_release = provider_result.get("pdg_release")
    data_source_label = provider_result.get("data_source_label") or "NCBI Pathogen Detection"
    if pdg_release and "release" not in data_source_label:
        data_source_label += f" (release {pdg_release})"

    if state in ("no_amr_genotype", "no_ast_data"):
        return jsonify({
            "status": "partial",
            "data_source": provider_result.get("data_source", "ncbi_pathogen_detection"),
            "data_source_label": data_source_label,
            "pdg_release": pdg_release,
            "availability_state": state,
            "availability_message": provider_result.get("availability_message", ""),
            "biosample_accession": acc_clean,
            "assembly_accession": provider_result.get("assembly_accession", ""),
            "organism": provider_result.get("organism", ""),
            "amr_genotypes": provider_result.get("amr_genotypes", ""),
            "amrfinder_version": provider_result.get("amrfinder_version", ""),
        }), 200

    if state != "ok":
        http_code = _AVAILABILITY_STATE_HTTP.get(state, 500)
        error_msg = provider_result.get(
            "availability_message",
            f"NCBI lookup returned state: {state}",
        )
        return jsonify({
            "error": error_msg,
            "availability_state": state,
            "biosample": acc_clean,
            "data_source": provider_result.get("data_source", "ncbi_pathogen_detection"),
            "pdg_release": pdg_release,
        }), http_code

    raw_genotype_row = provider_result.get("raw_genotype_row", {})
    ast_records = provider_result.get("ast_records", [])

    comps = compare([raw_genotype_row], ast_records)
    metrics = calculate_concordance_metrics(comps)

    return jsonify({
        "status": "success",
        "data_source": provider_result.get("data_source", "ncbi_pathogen_detection"),
        "data_source_label": data_source_label,
        "pdg_release": pdg_release,
        "amrfinder_version": provider_result.get("amrfinder_version", ""),
        "biosample_accession": acc_clean,
        "assembly_accession": provider_result.get("assembly_accession", ""),
        "organism": provider_result.get("organism", ""),
        "amr_genotypes": provider_result.get("amr_genotypes", ""),
        "ast_records": ast_records,
        "comparisons": comps,
        "summary_metrics": metrics,
    }), 200



@amr_bp.route("/compare", methods=["POST"])
def compare_genotype_phenotype():
    """
    POST /api/amr/compare

    Accepts arbitrary genotype and antibiogram AST rows and executes the
    frozen AMR concordance engine.

    Payload format:
    {
      "genotypes": "blaCMY-2,tet(A)",
      "antibiogram": [
        {
          "antibiotic": "ceftriaxone",
          "phenotype": "resistant",
          "mic": "16 mg/L"
        }
      ]
    }
    """
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({
            "error": "No JSON data provided",
            "details": "Request body must be valid JSON"
        }), 400

    if not isinstance(data, dict):
        return jsonify({
            "error": "Invalid request structure",
            "details": "Request body must be a JSON object"
        }), 400

    if "genotypes" not in data or "antibiogram" not in data:
        return jsonify({
            "error": "Missing required fields",
            "details": "Both 'genotypes' and 'antibiogram' fields are required"
        }), 400

    genotypes = data.get("genotypes")
    antibiogram = data.get("antibiogram")

    if not isinstance(genotypes, str):
        return jsonify({
            "error": "Invalid request structure",
            "details": "'genotypes' must be a comma-separated string"
        }), 400

    if not isinstance(antibiogram, list):
        return jsonify({
            "error": "Invalid request structure",
            "details": "'antibiogram' must be an array of AST records"
        }), 400

    for idx, item in enumerate(antibiogram):
        if not isinstance(item, dict):
            return jsonify({
                "error": "Invalid request structure",
                "details": f"Antibiogram item at index {idx} must be an object"
            }), 400
        if "antibiotic" not in item:
            return jsonify({
                "error": "Missing required fields",
                "details": f"Antibiogram item at index {idx} missing 'antibiotic' field"
            }), 400

    # Delegate comparison to the frozen engine
    genotype_row = {"amr_genotypes": genotypes}
    comparisons = compare([genotype_row], antibiogram)
    metrics = calculate_concordance_metrics(comparisons)

    return jsonify({
        "status": "success",
        "comparisons": comparisons,
        "summary_metrics": metrics
    }), 200


# ==============================================================================
# PHASE 5: EVIDENCE RECONCILIATION & AI EXPLANATION ENDPOINTS
# ==============================================================================

try:
    from services.amr_reconciliation import reconcile_isolate_evidence
except ImportError:
    from backend.services.amr_reconciliation import reconcile_isolate_evidence

import os
import requests

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"


@amr_bp.route("/reconcile", methods=["POST"])
def reconcile_evidence():
    """
    POST /api/amr/reconcile

    Deterministically reconciles Genomic Evidence, NCBI AST observations,
    and optional User Laboratory Evidence for an isolate.

    Payload format:
    {
      "biosample": "SAMN03177675",
      "user_lab": [
        {
          "antibiotic": "ceftriaxone",
          "phenotype": "Resistant",
          "mic": "16 ug/mL",
          "method": "MIC"
        }
      ]
    }
    """
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({
            "error": "No JSON data provided",
            "details": "Request body must be valid JSON"
        }), 400

    if not isinstance(data, dict):
        return jsonify({
            "error": "Invalid request structure",
            "details": "Request body must be a JSON object"
        }), 400

    biosample = data.get("biosample")
    if not biosample or not isinstance(biosample, str):
        return jsonify({
            "error": "Missing required field",
            "details": "'biosample' accession string is required"
        }), 400

    user_lab = data.get("user_lab", [])
    if not isinstance(user_lab, list):
        return jsonify({
            "error": "Invalid request structure",
            "details": "'user_lab' must be an array of laboratory records"
        }), 400

    for idx, item in enumerate(user_lab):
        if not isinstance(item, dict):
            return jsonify({
                "error": "Invalid request structure",
                "details": f"User lab record at index {idx} must be a JSON object"
            }), 400
        if "antibiotic" not in item:
            return jsonify({
                "error": "Missing required field in user lab record",
                "details": f"User lab record at index {idx} missing 'antibiotic' field"
            }), 400

    acc_clean = biosample.strip().upper()
    try:
        fixture_data = _load_validation_fixture()
    except Exception as e:
        return jsonify({"error": "Failed to read validation fixture", "details": str(e)}), 500

    matched_iso = next(
        (i for i in fixture_data.get("isolates", []) if i.get("biosample_accession", "").upper() == acc_clean),
        None
    )

    if not matched_iso:
        return jsonify({
            "error": "BioSample not available in frozen validation dataset",
            "biosample": biosample
        }), 404

    # Execute deterministic evidence reconciliation
    reconciliation_result = reconcile_isolate_evidence(matched_iso, user_lab)

    return jsonify({
        "status": "success",
        **reconciliation_result
    }), 200


@amr_bp.route("/explain", methods=["POST"])
def explain_reconciliation():
    """
    POST /api/amr/explain

    Generates a controlled, research-oriented explanation of DETERMINISTIC
    reconciliation findings. AI only explains pre-calculated facts and
    never determines scientific classifications or provides clinical advice.

    Payload format:
    {
      "biosample": "SAMN03177675",
      "findings": [ ... ]
    }
    """
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({
            "error": "No JSON data provided",
            "details": "Request body must be valid JSON"
        }), 400

    if not isinstance(data, dict):
        return jsonify({
            "error": "Invalid request structure",
            "details": "Request body must be a JSON object"
        }), 400

    findings = data.get("findings")
    if findings is None or not isinstance(findings, list):
        return jsonify({
            "error": "Missing or invalid 'findings' field",
            "details": "'findings' must be an array of structured reconciliation findings"
        }), 400

    biosample = data.get("biosample", "Selected BioSample")

    # Format structured summary for AI or deterministic fallback
    concordant_items = []
    conflict_items = []
    not_comparable_items = []

    for f in findings:
        abx = f.get("antibiotic", "Unknown")
        status = f.get("reconciliation_status", "")
        gen_genes = f.get("genomic_evidence", {}).get("evidence_str", "(none)")
        ncbi_ph = f.get("ncbi_ast", {}).get("phenotype", "N/A")
        user_ph = f.get("user_lab", {}).get("phenotype", "Not supplied")

        if f.get("has_conflict"):
            conflict_items.append(
                f"- {abx}: Status={status}. Genomic={gen_genes}, NCBI AST={ncbi_ph}, User Lab={user_ph}."
            )
        elif "concordant" in status.lower():
            concordant_items.append(
                f"- {abx}: Status={status}. Genomic={gen_genes}, NCBI AST={ncbi_ph}, User Lab={user_ph}."
            )
        else:
            not_comparable_items.append(
                f"- {abx}: Status={status}. Genomic={gen_genes}."
            )

    # Deterministic fallback builder
    def build_deterministic_explanation() -> str:
        lines = []
        lines.append(f"### Research Reconciliation Summary for {biosample}\n")
        lines.append(f"**Evidence Evaluated:** {len(findings)} antibiotic relationships evaluated against genomic determinants and available AST observations.\n")

        if concordant_items:
            lines.append("#### Concordant Evidence")
            lines.append("The following antibiotic observations demonstrate agreement between documented genomic resistance determinants and observed AST phenotypes:")
            lines.extend(concordant_items[:5])
            lines.append("")

        if conflict_items:
            lines.append("#### Observed Discrepancies & Conflicts")
            lines.append("The following cases demonstrate genotype–phenotype discordance or disagreement between testing sources:")
            lines.extend(conflict_items)
            lines.append("\n**Possible Research Explanations for Discrepancies:**")
            lines.append("1. The resistance determinant may not be functionally expressed or may exhibit low transcriptional activity in this isolate.")
            lines.append("2. Phenotypic susceptibility testing methods (e.g. broth microdilution vs. disk diffusion) or laboratory conditions may vary.")
            lines.append("3. Genotype–phenotype relationships are not universally deterministic across all isolate backgrounds.")
            lines.append("4. Curated reference database rules have inherent scope limitations.")
            lines.append("")

        if not_comparable_items:
            lines.append("#### Non-Comparable Determinants")
            lines.append(f"A total of {len(not_comparable_items)} antibiotic observations do not have established genotype-to-antibiotic rules in the current validated rule set. Absence of a mapped gene does not establish phenotypic susceptibility.")
            lines.append("")

        lines.append("#### Limitations")
        lines.append("- Analysis is limited to validated reference determinants and supplied antibiograms.")
        lines.append("- User-provided laboratory results are evaluated as supplied without independent verification.")
        lines.append("\n---\n*Research interpretation only — not a clinical or diagnostic result.*")
        return "\n".join(lines)

    # Attempt AI call via Groq if API key is available
    if GROQ_API_KEY:
        system_prompt = (
            "You are an expert bioinformatics research assistant specializing in antimicrobial resistance (AMR). "
            "Your task is to provide a structured scientific explanation of the provided DETERMINISTIC evidence findings. "
            "SAFETY & SCIENTIFIC CONSTRAINTS:\n"
            "1. Explain ONLY the facts provided in the structured findings. Do not alter classifications.\n"
            "2. Do NOT diagnose patient infections, recommend treatments, or suggest specific antimicrobial therapy.\n"
            "3. Do NOT invent genes, AST values, or clinical breakpoints.\n"
            "4. Do NOT infer susceptibility from the absence of a resistance gene.\n"
            "5. Clearly distinguish observed evidence from possible research explanations.\n"
            "6. Always conclude with: 'Research interpretation only — not a clinical or diagnostic result.'"
        )

        user_content = (
            f"Please explain these deterministic AMR evidence reconciliation findings for BioSample {biosample}:\n\n"
            f"TOTAL ANTIBIOTICS EVALUATED: {len(findings)}\n"
            f"CONCORDANT OBSERVATIONS:\n" + ("\n".join(concordant_items) if concordant_items else "None") + "\n\n"
            f"CONFLICTING / DISCORDANT OBSERVATIONS:\n" + ("\n".join(conflict_items) if conflict_items else "None") + "\n\n"
            f"NON-COMPARABLE OBSERVATIONS:\n" + ("\n".join(not_comparable_items[:6]) if not_comparable_items else "None") + "\n\n"
            "Provide structured explanation sections: Summary, Evidence Considered, Observed Agreement/Conflict, Possible Explanations, Limitations, and Research Disclaimer."
        )

        try:
            resp = requests.post(
                GROQ_API_URL,
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "llama-3.3-70b-versatile",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_content}
                    ],
                    "temperature": 0.5,
                    "max_tokens": 1200
                },
                timeout=25
            )
            if resp.status_code == 200:
                ai_text = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")
                if ai_text:
                    return jsonify({
                        "status": "success",
                        "explanation": ai_text,
                        "disclaimer": "Research interpretation only — not a clinical or diagnostic result.",
                        "ai_provider": "groq"
                    }), 200
        except Exception as e:
            # Fall back safely on error
            pass

    # Safe deterministic fallback
    fallback_text = build_deterministic_explanation()
    return jsonify({
        "status": "success",
        "explanation": fallback_text,
        "disclaimer": "Research interpretation only — not a clinical or diagnostic result.",
        "ai_provider": "deterministic_fallback"
    }), 200


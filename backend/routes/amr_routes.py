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


@amr_bp.route("/isolate/<biosample_accession>", methods=["GET"])
def get_isolate(biosample_accession: str):
    """
    GET /api/amr/isolate/<biosample_accession>

    Returns frozen validation isolate data and calculated concordance results.
    If the isolate is not in the frozen validation fixture, returns HTTP 404.
    (No live NCBI retrieval in Phase 2).
    """
    acc_clean = (biosample_accession or "").strip().upper()
    if not acc_clean:
        return jsonify({"error": "BioSample accession is required"}), 400

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
            "biosample": biosample_accession
        }), 404

    tsv_row = matched_iso.get("raw_genotype_row", {})
    ast_rows = matched_iso.get("ast_records", [])

    comps = compare([tsv_row], ast_rows)
    metrics = calculate_concordance_metrics(comps)

    return jsonify({
        "status": "success",
        "biosample_accession": matched_iso.get("biosample_accession"),
        "assembly_accession": matched_iso.get("assembly_accession"),
        "organism": matched_iso.get("organism"),
        "amr_genotypes": matched_iso.get("amr_genotypes"),
        "ast_records": ast_rows,
        "comparisons": comps,
        "summary_metrics": metrics
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

"""
backend/services/bigquery_provider.py

NCBI Pathogen Detection Google BigQuery Provider (Phase 7).

Queries the public dataset:
    `ncbi-pathogen-detect.pdbrowser.isolates`
across all supported organism groups (Escherichia, Salmonella, Klebsiella, etc.).

Environment Variables:
    BIGQUERY_PROJECT_ID: Google Cloud Project ID (required for billing compute)
    BIGQUERY_CREDENTIALS_JSON: Raw Service Account key JSON string (optional if GOOGLE_APPLICATION_CREDENTIALS is set)
    GOOGLE_APPLICATION_CREDENTIALS: Path to service account key file (standard GCP env var)
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

_VALID_ACCESSION_RE = re.compile(r"^SAM[NED][A-Z]?\d{4,}$", re.IGNORECASE)

class _TtlCache:
    """Thread-safe key->value cache with per-entry TTL."""

    def __init__(self, ttl_seconds: int = 3600, max_entries: int = 256):
        self._ttl = ttl_seconds
        self._max = max_entries
        self._store: Dict[str, Tuple[Any, float]] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            value, ts = entry
            if time.time() - ts > self._ttl:
                del self._store[key]
                return None
            return value

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            if len(self._store) >= self._max:
                oldest = min(self._store.items(), key=lambda kv: kv[1][1])
                del self._store[oldest[0]]
            self._store[key] = (value, time.time())

    def clear(self) -> None:
        with self._lock:
            self._store.clear()


_bq_result_cache = _TtlCache(ttl_seconds=3600, max_entries=512)


def clear_caches() -> None:
    """Clear provider in-memory caches."""
    _bq_result_cache.clear()


def validate_accession(acc: str) -> bool:
    """Validate BioSample accession pattern."""
    return bool(_VALID_ACCESSION_RE.match((acc or "").strip()))


def get_bigquery_config_status() -> Dict[str, Any]:
    """
    Check if Google BigQuery credentials and project configuration are available.
    Returns safe diagnostics without exposing secrets.
    """
    project_id = os.getenv("BIGQUERY_PROJECT_ID")
    has_creds_json = bool(os.getenv("BIGQUERY_CREDENTIALS_JSON"))
    has_creds_file = bool(os.getenv("GOOGLE_APPLICATION_CREDENTIALS"))

    is_configured = bool(project_id and (has_creds_json or has_creds_file))

    status = {
        "provider": "ncbi_bigquery",
        "configured": is_configured,
        "project_id_set": bool(project_id),
        "credentials_source": (
            "BIGQUERY_CREDENTIALS_JSON"
            if has_creds_json
            else ("GOOGLE_APPLICATION_CREDENTIALS" if has_creds_file else "none")
        ),
    }

    if not is_configured:
        status["diagnostic_message"] = (
            "BigQuery provider is not configured. Set BIGQUERY_PROJECT_ID and "
            "BIGQUERY_CREDENTIALS_JSON (or GOOGLE_APPLICATION_CREDENTIALS) in environment."
        )
    else:
        status["diagnostic_message"] = "BigQuery provider configuration detected."

    return status


def _create_bigquery_client():
    """
    Instantiate a google.cloud.bigquery.Client if dependencies and credentials exist.
    Raises RuntimeError if unconfigured or dependencies missing.
    """
    try:
        from google.cloud import bigquery
        from google.oauth2 import service_account
    except ImportError as exc:
        raise RuntimeError(
            "google-cloud-bigquery library is not installed. Install with: pip install google-cloud-bigquery"
        ) from exc

    project_id = os.getenv("BIGQUERY_PROJECT_ID")
    if not project_id:
        raise RuntimeError("BIGQUERY_PROJECT_ID environment variable is not set.")

    creds_json_str = os.getenv("BIGQUERY_CREDENTIALS_JSON")
    creds_file = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")

    if creds_json_str:
        try:
            key_dict = json.loads(creds_json_str)
            credentials = service_account.Credentials.from_service_account_info(key_dict)
            return bigquery.Client(project=project_id, credentials=credentials)
        except Exception as exc:
            raise RuntimeError(f"Invalid BIGQUERY_CREDENTIALS_JSON format: {exc}") from exc

    if creds_file:
        if not os.path.exists(creds_file):
            raise RuntimeError(f"GOOGLE_APPLICATION_CREDENTIALS file not found: {creds_file}")
        return bigquery.Client(project=project_id)

    try:
        return bigquery.Client(project=project_id)
    except Exception as exc:
        raise RuntimeError(
            f"Unable to authenticate Google Cloud BigQuery client: {exc}"
        ) from exc


def query_biosample_bigquery(
    biosample_acc: str,
    client: Optional[Any] = None,
    timeout_seconds: float = 30.0,
) -> Dict[str, Any]:
    """
    Execute targeted BigQuery query on `ncbi-pathogen-detect.pdbrowser.isolates`.
    Returns normalized isolate result or typed error state.
    """
    acc_clean = (biosample_acc or "").strip().upper()

    cached = _bq_result_cache.get(acc_clean)
    if cached is not None:
        logger.info("BigQuery cache hit for %s", acc_clean)
        return cached

    base_result: Dict[str, Any] = {
        "biosample_accession": acc_clean,
        "data_source": "ncbi_pathogen_detection_bigquery",
        "data_source_label": "NCBI Pathogen Detection (BigQuery)",
    }

    status = get_bigquery_config_status()
    if not status["configured"]:
        result = {
            **base_result,
            "state": "dynamic_provider_not_configured",
            "availability_message": (
                "NCBI BigQuery provider is not configured. Configure BIGQUERY_PROJECT_ID "
                "and service account credentials in server environment variables to enable "
                "live multi-organism NCBI lookups."
            ),
        }
        return result

    if client is None:
        try:
            client = _create_bigquery_client()
        except Exception as exc:
            logger.error("Failed to initialize BigQuery client: %s", exc)
            return {
                **base_result,
                "state": "dynamic_provider_not_configured",
                "availability_message": str(exc),
            }

    query = """
    SELECT
        biosample_acc,
        taxgroup_name,
        scientific_name,
        asm_acc,
        amr_genotypes,
        amr_genotypes_core,
        amrfinderplus_version,
        amrfinderplus_analysis_type,
        ast_phenotypes
    FROM `ncbi-pathogen-detect.pdbrowser.isolates`
    WHERE biosample_acc = @biosample_acc
    LIMIT 1
    """

    try:
        try:
            from google.cloud import bigquery
            job_config = bigquery.QueryJobConfig(
                query_parameters=[
                    bigquery.ScalarQueryParameter("biosample_acc", "STRING", acc_clean)
                ]
            )
        except ImportError:
            job_config = None

        if job_config is not None:
            query_job = client.query(query, job_config=job_config, timeout=timeout_seconds)
        else:
            query_job = client.query(query, timeout=timeout_seconds)

        rows = list(query_job.result(timeout=timeout_seconds))
    except Exception as exc:
        exc_str = str(exc)
        logger.error("BigQuery query error for %s: %s", acc_clean, exc)
        if "timeout" in exc_str.lower() or "deadline" in exc_str.lower():
            return {
                **base_result,
                "state": "ncbi_timeout",
                "availability_message": (
                    "NCBI BigQuery query timed out while querying the Pathogen Detection dataset. "
                    "Please retry shortly."
                ),
            }
        return {
            **base_result,
            "state": "ncbi_unavailable",
            "availability_message": f"NCBI BigQuery query failure: {exc}",
        }

    if not rows:
        result = {
            **base_result,
            "state": "not_in_pathogen_detection",
            "availability_message": (
                f"BioSample {acc_clean} was not found in the NCBI Pathogen Detection dataset "
                "(`ncbi-pathogen-detect.pdbrowser.isolates`)."
            ),
        }
        _bq_result_cache.set(acc_clean, result)
        return result

    row = rows[0]

    taxgroup_name = (row.get("taxgroup_name") or "").strip()
    scientific_name = (row.get("scientific_name") or "").strip()
    organism = scientific_name or taxgroup_name or "Unknown"

    asm_acc = (row.get("asm_acc") or "").strip()
    amr_genotypes_raw = (row.get("amr_genotypes") or "").strip()
    amr_genotypes_core = (row.get("amr_genotypes_core") or "").strip()
    amrfinder_version = (row.get("amrfinderplus_version") or "").strip()
    amrfinder_analysis_type = (row.get("amrfinderplus_analysis_type") or "").strip()

    base_result["organism"] = organism
    base_result["taxgroup_name"] = taxgroup_name
    base_result["assembly_accession"] = asm_acc
    base_result["amrfinder_version"] = amrfinder_version
    base_result["amrfinder_analysis_type"] = amrfinder_analysis_type
    base_result["AMR_genotypes_core"] = amr_genotypes_core

    if not amr_genotypes_raw:
        result = {
            **base_result,
            "state": "no_amr_genotype",
            "amr_genotypes": "",
            "availability_message": (
                f"BioSample {acc_clean} was found in NCBI Pathogen Detection, but no AMR "
                "genotypes (AMR_genotypes) were detected by AMRFinderPlus."
            ),
        }
        _bq_result_cache.set(acc_clean, result)
        return result

    base_result["amr_genotypes"] = amr_genotypes_raw
    base_result["raw_genotype_row"] = {"amr_genotypes": amr_genotypes_raw}

    raw_ast = row.get("ast_phenotypes")
    ast_records: List[Dict[str, str]] = []

    if raw_ast:
        for ast in raw_ast:
            if isinstance(ast, dict):
                abx = str(ast.get("antibiotic") or "").strip()
                ph = str(ast.get("phenotype") or "").strip()
                mic = str(ast.get("mic") or "").strip()
                units = str(ast.get("units") or "").strip()
                method = str(ast.get("method") or "").strip()
                guideline = str(ast.get("guideline") or "").strip()
            elif hasattr(ast, "keys"):
                abx = str(ast["antibiotic"] or "").strip() if "antibiotic" in ast else ""
                ph = str(ast["phenotype"] or "").strip() if "phenotype" in ast else ""
                mic = str(ast["mic"] or "").strip() if "mic" in ast else ""
                units = str(ast["units"] or "").strip() if "units" in ast else ""
                method = str(ast["method"] or "").strip() if "method" in ast else ""
                guideline = str(ast["guideline"] or "").strip() if "guideline" in ast else ""
            else:
                continue

            if abx:
                ast_records.append({
                    "antibiotic": abx,
                    "phenotype": ph,
                    "mic": f"{mic} {units}".strip() if units else mic,
                    "units": units,
                    "method": method,
                    "guideline": guideline,
                })

    if not ast_records:
        result = {
            **base_result,
            "state": "no_ast_data",
            "ast_records": [],
            "availability_message": (
                f"AMR genotypes for {acc_clean} were retrieved from NCBI Pathogen Detection, "
                "but no submitted AST phenotype records were found for this isolate."
            ),
        }
        _bq_result_cache.set(acc_clean, result)
        return result

    result = {
        **base_result,
        "state": "ok",
        "ast_records": ast_records,
    }
    _bq_result_cache.set(acc_clean, result)
    return result

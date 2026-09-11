"""
backend/services/ncbi_provider.py

NCBI Pathogen Detection Data Provider for the AMR Research Module (Phase 6).

Responsibilities:
  - Discover the newest NCBI Pathogen Detection release whose metadata TSV
    contains the REQUIRED columns (identified by name, not by release number).
  - Retrieve AMR_genotypes for a given BioSample accession by streaming the
    selected release TSV until the matching row is found.
  - Retrieve AST phenotype records from the NCBI BioSample Entrez efetch API.
  - Normalize both data sources into the internal isolate structure consumed
    by amr_engine.compare().
  - Return typed error states instead of exceptions when data are unavailable.

Data Sources (both official NCBI):
  AMR genotypes:
    NCBI Pathogen Detection FTP TSV
    https://ftp.ncbi.nlm.nih.gov/pathogen/Results/Escherichia_coli_Shigella/
    <PDG_release>/Metadata/<PDG_release>.metadata.tsv
    (published NCBI open data, updated weekly)

  AST phenotypes:
    NCBI BioSample Entrez efetch
    https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi
    ?db=biosample&id=<ACCESSION>&retmode=xml

Required TSV columns (verified by name before a release is selected):
    biosample_acc, asm_acc, scientific_name, AMR_genotypes

Optional columns (included when present):
    AMR_genotypes_core, AST_phenotypes, amrfinder_version, amrfinder_analysis_type

Typed availability states returned in result dict under key "state":
    "ok"                     – AMR genotype retrieved, AST retrieved
    "no_ast_data"            – AMR genotype retrieved, no AST phenotype rows
    "no_amr_genotype"        – Row found in TSV, AMR_genotypes field is empty
    "not_in_pathogen_detection" – BioSample not found in the selected PDG release
    "biosample_not_found"    – NCBI efetch returned no BioSample record
    "ncbi_unavailable"       – Network/HTTP failure on any NCBI request
    "no_compatible_release"  – No PDG release with required columns found

Caching:
    A simple per-process LRU cache (TTL: 3600 s) is used to avoid re-streaming
    the large TSV for repeated queries within the same server session.
    Cache is keyed on (pdg_release, biosample_acc).
    No persistent storage; no user data is retained across process restarts.

IMPORTANT:
  - The frozen validation fixture (5 BioSamples) is handled entirely in
    amr_routes.py BEFORE this provider is called.
  - This provider is ONLY called for non-validation BioSamples.
  - This provider never manufactures AMR results.
  - Provenance (data_source, pdg_release, amrfinder_version) is always
    included in the returned dict.
"""

from __future__ import annotations

import logging
import re
import threading
import time
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional, Tuple

import requests

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

_NCBI_FTP_BASE = (
    "https://ftp.ncbi.nlm.nih.gov/pathogen/Results/Escherichia_coli_Shigella/"
)
_NCBI_EFETCH_URL = (
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
)
_REQUEST_TIMEOUT_FTP = 60      # seconds — streaming large TSV
_REQUEST_TIMEOUT_EFETCH = 20   # seconds — single BioSample XML

# Columns that MUST be present in the TSV header for a release to be selected.
_REQUIRED_COLUMNS: Tuple[str, ...] = (
    "biosample_acc",
    "asm_acc",
    "scientific_name",
    "AMR_genotypes",
)

# Optional columns — included in the normalized result when present.
_OPTIONAL_COLUMNS: Tuple[str, ...] = (
    "AMR_genotypes_core",
    "AST_phenotypes",
    "amrfinder_version",
    "amrfinder_analysis_type",
)

_VALID_ACCESSION_RE = re.compile(
    r"^SAM[NED][A-Z]?\d{4,}$", re.IGNORECASE
)

# ---------------------------------------------------------------------------
# Simple in-process LRU / TTL cache
# ---------------------------------------------------------------------------

class _TtlCache:
    """Thread-safe key→value cache with per-entry TTL."""

    def __init__(self, ttl_seconds: int = 3600, max_entries: int = 128):
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
                # Evict oldest entry
                oldest = min(self._store.items(), key=lambda kv: kv[1][1])
                del self._store[oldest[0]]
            self._store[key] = (value, time.time())


# Two caches: one for TSV rows, one for the selected PDG release
_row_cache = _TtlCache(ttl_seconds=3600, max_entries=256)
_release_cache = _TtlCache(ttl_seconds=3600, max_entries=4)


def clear_caches() -> None:
    """Clear in-memory caches (for testing and manual reset)."""
    with _row_cache._lock:
        _row_cache._store.clear()
    with _release_cache._lock:
        _release_cache._store.clear()


# ---------------------------------------------------------------------------
# Release discovery — schema-first, never by numeric threshold
# ---------------------------------------------------------------------------

def _get_release_listing() -> List[str]:
    """
    Fetch the FTP directory listing and return all discovered PDG release
    identifiers in the order they appear in the listing.
    """
    try:
        r = requests.get(_NCBI_FTP_BASE, timeout=15)
        r.raise_for_status()
    except requests.RequestException as exc:
        raise RuntimeError(f"Cannot reach NCBI FTP: {exc}") from exc

    releases = re.findall(r"PDG\d+\.\d+", r.text)
    # Preserve order, remove duplicates
    seen: Dict[str, None] = {}
    for rel in releases:
        seen[rel] = None
    return list(seen.keys())


def _inspect_tsv_header(pdg_release: str) -> Optional[List[str]]:
    """
    Fetch only the first line (header row) of a release metadata TSV.
    Returns the list of column names, or None if the URL is unreachable.
    """
    meta_url = (
        f"{_NCBI_FTP_BASE}{pdg_release}/Metadata/{pdg_release}.metadata.tsv"
    )
    try:
        r = requests.get(meta_url, timeout=15, stream=True)
        if r.status_code != 200:
            r.close()
            return None
        for raw_line in r.iter_lines():
            r.close()
            return raw_line.decode("utf-8").split("\t")
        r.close()
        return None
    except requests.RequestException:
        return None


def _has_required_columns(columns: List[str]) -> bool:
    """Return True if every required column name is present in the column list."""
    col_set = set(columns)
    return all(req in col_set for req in _REQUIRED_COLUMNS)


def discover_compatible_release() -> Dict[str, Any]:
    """
    Discover and return the newest NCBI Pathogen Detection release whose
    metadata TSV contains all required column names.

    Schema is always checked by column name — never by release number or
    numeric threshold. A newer release that lacks required columns is skipped
    and the next-most-recent compatible release is used.

    Returns:
        {
            "pdg_release": "PDG000000004.XXXX",
            "columns": [...],
            "meta_url": "https://..."
        }

    Raises RuntimeError if no compatible release can be found.
    """
    cache_key = "compatible_release"
    cached = _release_cache.get(cache_key)
    if cached is not None:
        return cached

    releases = _get_release_listing()
    if not releases:
        raise RuntimeError("No PDG releases found in NCBI FTP listing.")

    # Iterate from newest to oldest (last → first in the listing order)
    for pdg_release in reversed(releases):
        logger.debug("Inspecting PDG release: %s", pdg_release)
        columns = _inspect_tsv_header(pdg_release)
        if columns is None:
            logger.debug("  → TSV unreachable; skipping")
            continue
        if _has_required_columns(columns):
            logger.info(
                "Selected compatible PDG release: %s (%d columns)",
                pdg_release,
                len(columns),
            )
            result = {
                "pdg_release": pdg_release,
                "columns": columns,
                "meta_url": (
                    f"{_NCBI_FTP_BASE}{pdg_release}/Metadata/"
                    f"{pdg_release}.metadata.tsv"
                ),
            }
            _release_cache.set(cache_key, result)
            return result
        else:
            missing = [c for c in _REQUIRED_COLUMNS if c not in set(columns)]
            logger.debug(
                "  → Skipping %s: missing required columns %s",
                pdg_release,
                missing,
            )

    raise RuntimeError(
        "No NCBI Pathogen Detection release with required columns "
        f"({', '.join(_REQUIRED_COLUMNS)}) was found."
    )


# ---------------------------------------------------------------------------
# TSV row lookup (streaming with early exit)
# ---------------------------------------------------------------------------

def _lookup_tsv_row(
    biosample_acc: str,
    release_info: Dict[str, Any],
) -> Optional[Dict[str, str]]:
    """
    Stream the PDG metadata TSV until the row for *biosample_acc* is found.
    Returns the row as a dict {column_name: value}, or None if not found.
    Results are cached by (pdg_release, biosample_acc).
    """
    pdg_release = release_info["pdg_release"]
    cache_key = f"{pdg_release}::{biosample_acc}"
    cached = _row_cache.get(cache_key)
    if cached is not None:
        return cached  # type: ignore[return-value]

    columns = release_info["columns"]
    try:
        bs_col_idx = columns.index("biosample_acc")
    except ValueError:
        logger.error("'biosample_acc' column not found in release schema")
        return None

    meta_url = release_info["meta_url"]
    logger.info(
        "Streaming TSV %s to find %s (col %d)",
        meta_url,
        biosample_acc,
        bs_col_idx,
    )

    try:
        r = requests.get(meta_url, timeout=_REQUEST_TIMEOUT_FTP, stream=True)
        if r.status_code != 200:
            r.close()
            logger.warning("TSV HTTP %d for %s", r.status_code, meta_url)
            return None

        row_dict: Optional[Dict[str, str]] = None
        for i, raw_line in enumerate(r.iter_lines()):
            if i == 0:
                continue  # skip header (already parsed)
            parts = raw_line.decode("utf-8").split("\t")
            if len(parts) <= bs_col_idx:
                continue
            if parts[bs_col_idx].strip().upper() == biosample_acc.upper():
                row_dict = dict(zip(columns, parts))
                break
        r.close()
    except requests.RequestException as exc:
        logger.error("TSV streaming error: %s", exc)
        return None

    if row_dict is not None:
        # Strip surrounding quotes that NCBI sometimes adds to genotype strings
        for k in list(row_dict.keys()):
            row_dict[k] = row_dict[k].strip().strip('"')
        _row_cache.set(cache_key, row_dict)
    return row_dict


# ---------------------------------------------------------------------------
# AST phenotype retrieval via NCBI BioSample efetch
# ---------------------------------------------------------------------------

def _fetch_biosample_ast(
    biosample_acc: str,
) -> Tuple[str, List[Dict[str, str]]]:
    """
    Fetch the BioSample record via NCBI Entrez efetch and extract:
      - organism name
      - AST rows from the Antibiogram table

    Returns (organism: str, ast_rows: list).
    Raises requests.RequestException on network failure.
    Raises ValueError if the biosample is not found.
    """
    # Accept NCBI API key from environment if available
    import os
    api_key = os.getenv("NCBI_API_KEY", "")
    params: Dict[str, str] = {
        "db": "biosample",
        "id": biosample_acc,
        "retmode": "xml",
    }
    if api_key:
        params["api_key"] = api_key

    r = requests.get(
        _NCBI_EFETCH_URL,
        params=params,
        timeout=_REQUEST_TIMEOUT_EFETCH,
        headers={"User-Agent": "DNA-Analyzer-AMR-Module/6.0 (+research)"},
    )
    r.raise_for_status()

    root = ET.fromstring(r.content)
    samples = root.findall(".//BioSample")
    if not samples:
        raise ValueError(f"BioSample {biosample_acc} not found in NCBI efetch response")

    sample = samples[0]

    # Organism
    org_el = sample.find(".//OrganismName")
    organism = org_el.text.strip() if org_el is not None and org_el.text else "Unknown"

    # Antibiogram table
    ast_rows: List[Dict[str, str]] = []
    for table in sample.findall(".//Table"):
        tclass = table.attrib.get("class", "")
        if "Antibiogram" not in tclass and "antibiogram" not in tclass.lower():
            continue
        xml_rows = table.findall(".//Row")
        if xml_rows:
            for row_el in xml_rows:
                cells = [
                    (c.text.strip() if c.text else "")
                    for c in row_el.findall("Cell")
                ]
                while len(cells) < 10:
                    cells.append("")
                sign = cells[2]
                meas = cells[3]
                mic_str = (
                    f"{sign} {meas}".strip()
                    if sign and sign != "=="
                    else meas
                )
                ast_rows.append(
                    {
                        "antibiotic": cells[0],
                        "phenotype": cells[1],
                        "mic": mic_str,
                        "units": cells[4],
                        "method": cells[5],
                        "guideline": cells[9] if len(cells) > 9 else "",
                    }
                )
            break  # Only parse the first Antibiogram table

    return organism, ast_rows


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------

def validate_accession(acc: str) -> bool:
    """
    Return True if *acc* matches a plausible BioSample accession format.
    Accepted prefixes: SAMN, SAMD, SAME (case-insensitive).
    Minimum 5 digits required after the prefix.
    """
    return bool(_VALID_ACCESSION_RE.match((acc or "").strip()))


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def lookup_biosample(biosample_acc: str) -> Dict[str, Any]:
    """
    Look up a BioSample accession dynamically via NCBI Pathogen Detection.

    IMPORTANT: This function must NEVER be called for the five frozen
    validation BioSamples. That gate is enforced in amr_routes.py BEFORE
    calling this provider.

    Returns a dict with at minimum:
        state:           one of the typed state strings (see module docstring)
        biosample_accession: the accession looked up
        data_source:     "ncbi_pathogen_detection"
        pdg_release:     the selected PDG release identifier (when known)

    On state == "ok":
        Also contains: organism, assembly_accession, amr_genotypes,
        raw_genotype_row (for amr_engine.compare()), ast_records,
        amrfinder_version, AMR_genotypes_core (if available).
    """
    acc_clean = (biosample_acc or "").strip().upper()

    base_result: Dict[str, Any] = {
        "biosample_accession": acc_clean,
        "data_source": "ncbi_pathogen_detection",
        "pdg_release": None,
    }

    # ── Step 1: Discover compatible release ──────────────────────────────
    try:
        release_info = discover_compatible_release()
    except RuntimeError as exc:
        logger.error("Release discovery failed: %s", exc)
        return {
            **base_result,
            "state": "no_compatible_release",
            "availability_message": (
                f"No compatible NCBI Pathogen Detection release found: {exc}"
            ),
        }
    except requests.RequestException as exc:
        logger.error("NCBI FTP unreachable during release discovery: %s", exc)
        return {
            **base_result,
            "state": "ncbi_unavailable",
            "availability_message": (
                f"NCBI Pathogen Detection FTP is currently unreachable: {exc}"
            ),
        }

    pdg_release = release_info["pdg_release"]
    base_result["pdg_release"] = pdg_release

    # ── Step 2: Look up the TSV row for this BioSample ───────────────────
    try:
        tsv_row = _lookup_tsv_row(acc_clean, release_info)
    except Exception as exc:
        logger.error("TSV lookup error: %s", exc)
        return {
            **base_result,
            "state": "ncbi_unavailable",
            "availability_message": (
                f"Error streaming NCBI Pathogen Detection TSV: {exc}"
            ),
        }

    if tsv_row is None:
        return {
            **base_result,
            "state": "not_in_pathogen_detection",
            "availability_message": (
                f"BioSample {acc_clean} was not found in the NCBI Pathogen "
                f"Detection Escherichia_coli_Shigella dataset "
                f"(release {pdg_release}). The BioSample may belong to a "
                "different organism dataset, or may not yet be included in "
                "Pathogen Detection."
            ),
        }

    # Extract required fields from TSV row
    amr_genotypes_raw = tsv_row.get("AMR_genotypes", "").strip().strip('"')
    asm_acc = tsv_row.get("asm_acc", "").strip()
    scientific_name = tsv_row.get("scientific_name", "").strip()
    amr_genotypes_core = tsv_row.get("AMR_genotypes_core", "").strip().strip('"')
    amrfinder_version = tsv_row.get("amrfinder_version", "").strip()
    amrfinder_analysis_type = tsv_row.get("amrfinder_analysis_type", "").strip()

    base_result["assembly_accession"] = asm_acc
    base_result["amrfinder_version"] = amrfinder_version
    base_result["amrfinder_analysis_type"] = amrfinder_analysis_type
    base_result["AMR_genotypes_core"] = amr_genotypes_core

    if not amr_genotypes_raw:
        return {
            **base_result,
            "state": "no_amr_genotype",
            "organism": scientific_name,
            "amr_genotypes": "",
            "availability_message": (
                f"BioSample {acc_clean} was found in NCBI Pathogen Detection "
                f"(release {pdg_release}), but no AMR genotype data "
                "(AMR_genotypes) are recorded for this isolate."
            ),
        }

    base_result["amr_genotypes"] = amr_genotypes_raw
    # raw_genotype_row mimics the TSV row format expected by amr_engine.compare()
    base_result["raw_genotype_row"] = {"amr_genotypes": amr_genotypes_raw}

    # ── Step 3: Fetch AST data from NCBI BioSample efetch ────────────────
    try:
        organism, ast_rows = _fetch_biosample_ast(acc_clean)
    except ValueError as exc:
        # BioSample exists in PD but not found in BioSample DB — unlikely but possible
        logger.warning("BioSample efetch not found: %s", exc)
        return {
            **base_result,
            "state": "biosample_not_found",
            "organism": scientific_name,
            "availability_message": (
                f"BioSample {acc_clean} was found in NCBI Pathogen Detection "
                "but could not be retrieved from the NCBI BioSample database."
            ),
        }
    except requests.RequestException as exc:
        logger.error("NCBI efetch network error: %s", exc)
        return {
            **base_result,
            "state": "ncbi_unavailable",
            "organism": scientific_name,
            "availability_message": (
                f"NCBI BioSample service is currently unreachable: {exc}"
            ),
        }

    # Use organism from BioSample efetch (authoritative); fall back to TSV
    base_result["organism"] = organism or scientific_name

    if not ast_rows:
        return {
            **base_result,
            "state": "no_ast_data",
            "ast_records": [],
            "availability_message": (
                f"AMR genotype data for {acc_clean} was retrieved from NCBI "
                f"Pathogen Detection (release {pdg_release}), but no eligible "
                "Antibiogram / AST phenotype records were found in the NCBI "
                "BioSample record."
            ),
        }

    # ── Step 4: Return fully populated result ────────────────────────────
    return {
        **base_result,
        "state": "ok",
        "ast_records": ast_rows,
    }

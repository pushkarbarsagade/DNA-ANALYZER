"""
backend/services/amr_model_registry.py

Phase 11 — Dynamic Multi-Organism / Multi-Antibiotic AMR Model Registry.

Provides a centralized registry abstraction for validated and candidate
machine-learning models. Decouples ML inference from any hard-coded organism
or antibiotic, enabling dynamic model discovery, versioning, and lookup.

Key Invariants:
- Models are scoped to specific (organism, antibiotic) combinations.
- No universal or cross-species inference without explicit validation.
- Unvalidated or rejected models are never exposed for user predictions.
- The baseline AMR-ML-ECOLI-AMP-v0.1 model is permanently registered as validated.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Registry paths
_ML_RESEARCH_DIR = Path(__file__).resolve().parent.parent / "data" / "ml_research"
_REGISTRY_FILE = _ML_RESEARCH_DIR / "model_registry.json"
_MODELS_DIR = _ML_RESEARCH_DIR / "models"

# Ensure models directory exists
_MODELS_DIR.mkdir(parents=True, exist_ok=True)

# Baseline frozen model definition
BASELINE_MODEL_ID = "AMR-ML-ECOLI-AMP-v0.1"
BASELINE_ENTRY: Dict[str, Any] = {
    "model_id": BASELINE_MODEL_ID,
    "model_version": BASELINE_MODEL_ID,
    "model_family": "specialist",
    "organism": "Escherichia coli",
    "organism_key": "escherichia_coli",
    "antibiotic": "Ampicillin",
    "antibiotic_key": "ampicillin",
    "status": "validated",
    "model_path": "backend/data/ml_research/amr_ml_ecoli_amp_v0_1_poc.joblib",
    "vocabulary_path": "backend/data/ml_research/amr_ml_features_vocab.json",
    "model_type": "Logistic Regression (L2)",
    "algorithm": "Logistic Regression (L2)",
    "threshold": 0.50,
    "feature_count": 223,
    "n_isolates": 321,
    "susceptible_count": 72,
    "resistant_count": 249,
    "validation_metrics": {
        "accuracy": 0.9538,
        "sensitivity": 0.9636,
        "specificity": 0.9000,
        "precision": 0.9815,
        "npv": 0.8182,
        "f1": 0.9725,
        "roc_auc": 0.9782,
        "tp": 53,
        "fp": 1,
        "fn": 2,
        "tn": 9,
        "vme": 0.0364,
        "me": 0.1000,
        "test_n": 65
    },
    "training_release": "PDG000000004.6300",
    "research_only": True,
    "created_at": "2026-09-12T09:56:00Z",
    "notes": "Phase 8B validated baseline. Frozen benchmark isolates excluded."
}

_registry_lock = threading.Lock()
_cached_registry: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Key Normalization Helpers
# ---------------------------------------------------------------------------

def normalize_organism_key(organism: str) -> str:
    """
    Convert organism names into a canonical normalized key.
    Handles synonyms and taxonomy variants.
    e.g. 'Escherichia coli', 'E. coli', 'Escherichia coli/Shigella' -> 'escherichia_coli'
    e.g. 'Klebsiella pneumoniae', 'K. pneumoniae' -> 'klebsiella_pneumoniae'
    """
    if not organism:
        return ""
    org_clean = organism.strip().lower()

    # Pre-mapped standard pathogens
    if any(p in org_clean for p in ("escherichia coli", "e. coli", "e.coli", "shigella")):
        return "escherichia_coli"
    if any(p in org_clean for p in ("klebsiella pneumoniae", "k. pneumoniae", "k.pneumoniae")):
        return "klebsiella_pneumoniae"
    if any(p in org_clean for p in ("salmonella enterica", "salmonella", "s. enterica")):
        return "salmonella_enterica"
    if any(p in org_clean for p in ("pseudomonas aeruginosa", "p. aeruginosa")):
        return "pseudomonas_aeruginosa"
    if any(p in org_clean for p in ("acinetobacter baumannii", "a. baumannii")):
        return "acinetobacter_baumannii"
    if any(p in org_clean for p in ("staphylococcus aureus", "s. aureus")):
        return "staphylococcus_aureus"
    if org_clean == "escherichia":
        return "escherichia_coli"
    if org_clean == "klebsiella":
        return "klebsiella_pneumoniae"

    # Generic alphanumeric normalization
    normalized = re.sub(r"[^a-z0-9]+", "_", org_clean).strip("_")
    return normalized


def normalize_antibiotic_key(antibiotic: str) -> str:
    """
    Convert antibiotic names into a canonical normalized key.
    e.g. 'Ampicillin' -> 'ampicillin'
    e.g. 'Trimethoprim-sulfamethoxazole' -> 'trimethoprim_sulfamethoxazole'
    e.g. 'Amoxicillin / clavulanic acid' -> 'amoxicillin_clavulanic_acid'
    """
    if not antibiotic:
        return ""
    abx_clean = antibiotic.strip().lower()

    # Strip parenthetical/bracketed tokens e.g. 'Ampicillin (AMP)' -> 'Ampicillin'
    abx_clean = re.sub(r"\s*[\(\[].*?[\)\]]", "", abx_clean).strip()

    # Common synonym and formulation mapping
    synonyms = {
        "co-trimoxazole": "trimethoprim_sulfamethoxazole",
        "trimethoprim/sulfamethoxazole": "trimethoprim_sulfamethoxazole",
        "trimethoprim-sulfamethoxazole": "trimethoprim_sulfamethoxazole",
        "amox/clav": "amoxicillin_clavulanic_acid",
        "augmentin": "amoxicillin_clavulanic_acid",
        "ampicillin sodium": "ampicillin",
        "ampicillin-sodium": "ampicillin",
        "ceftriaxone sodium": "ceftriaxone",
        "ciprofloxacin hcl": "ciprofloxacin",
        "ciprofloxacin hydrochloride": "ciprofloxacin",
    }
    if abx_clean in synonyms:
        return synonyms[abx_clean]

    normalized = re.sub(r"[^a-z0-9]+", "_", abx_clean).strip("_")
    if normalized in synonyms:
        return synonyms[normalized]

    return normalized


def make_scope_key(organism: str, antibiotic: str) -> str:
    """Combine normalized organism and antibiotic keys."""
    return f"{normalize_organism_key(organism)}::{normalize_antibiotic_key(antibiotic)}"


# ---------------------------------------------------------------------------
# Registry Storage & Loading
# ---------------------------------------------------------------------------

def load_registry(force_reload: bool = False) -> Dict[str, Any]:
    """
    Load the model registry from disk or return cached in-memory instance.
    Seeds the registry with the baseline model if not already present.
    """
    global _cached_registry

    with _registry_lock:
        if _cached_registry is not None and not force_reload:
            return _cached_registry

        registry: Dict[str, Any] = {
            "schema_version": "1.0",
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "models": {},
            "active_models": {}
        }

        if _REGISTRY_FILE.exists():
            try:
                with open(_REGISTRY_FILE, "r", encoding="utf-8") as f:
                    disk_data = json.load(f)
                if isinstance(disk_data, dict) and "models" in disk_data:
                    registry = disk_data
            except Exception as e:
                logger.error("Failed to load model registry from %s: %s", _REGISTRY_FILE, e)

        # Ensure baseline model is always registered
        if BASELINE_MODEL_ID not in registry["models"]:
            registry["models"][BASELINE_MODEL_ID] = BASELINE_ENTRY
            scope_key = make_scope_key(BASELINE_ENTRY["organism"], BASELINE_ENTRY["antibiotic"])
            registry["active_models"][scope_key] = BASELINE_MODEL_ID
            _save_registry_unlocked(registry)

        _cached_registry = registry
        return _cached_registry


def _save_registry_unlocked(registry: Dict[str, Any]) -> None:
    """Save registry to disk without acquiring the lock."""
    registry["last_updated"] = datetime.now(timezone.utc).isoformat()
    try:
        with open(_REGISTRY_FILE, "w", encoding="utf-8") as f:
            json.dump(registry, f, indent=2)
    except Exception as e:
        logger.error("Failed to save model registry to %s: %s", _REGISTRY_FILE, e)


def save_registry(registry: Dict[str, Any]) -> None:
    """Save the registry to disk thread-safely."""
    with _registry_lock:
        _save_registry_unlocked(registry)
        global _cached_registry
        _cached_registry = registry


def reset_registry_cache() -> None:
    """Clear in-memory cache. Used for testing."""
    global _cached_registry
    with _registry_lock:
        _cached_registry = None


# ---------------------------------------------------------------------------
# Registry Query & Mutation APIs
# ---------------------------------------------------------------------------

def get_model_entry(organism: str, antibiotic: str) -> Optional[Dict[str, Any]]:
    """
    Retrieve the active validated model entry for an organism and antibiotic.
    Returns None if no validated model is registered for this scope.
    """
    reg = load_registry()
    scope_key = make_scope_key(organism, antibiotic)
    active_model_id = reg.get("active_models", {}).get(scope_key)
    if not active_model_id:
        return None

    model_entry = reg.get("models", {}).get(active_model_id)
    if model_entry and model_entry.get("status") == "validated":
        return model_entry
    return None


def has_model(organism: str, antibiotic: str) -> bool:
    """Check if an active validated specialist model exists for the scope."""
    return get_model_entry(organism, antibiotic) is not None


def get_experimental_model_entry(organism: str, antibiotic: str) -> Optional[Dict[str, Any]]:
    """
    Retrieve an experimental specialist model entry if one exists for this scope.
    Strictly returns None if a validated specialist model is already active.
    """
    if has_model(organism, antibiotic):
        return None
    reg = load_registry()
    org_key = normalize_organism_key(organism)
    abx_key = normalize_antibiotic_key(antibiotic)
    for mid, m in reg.get("models", {}).items():
        if m.get("model_family") != "broad" and m.get("status") == "experimental":
            if m.get("organism_key") == org_key and m.get("antibiotic_key") == abx_key:
                return m
    return None


def get_broad_model_entry() -> Optional[Dict[str, Any]]:
    """
    Retrieve the active validated Broad ML1 model entry.
    Returns None if no validated broad model is registered.
    """
    reg = load_registry()
    active_broad_id = reg.get("active_broad_model") or "AMR-ML1-BROAD-v0.1"
    model_entry = reg.get("models", {}).get(active_broad_id)
    if model_entry and model_entry.get("status") == "validated":
        return model_entry
    return None


def has_broad_model() -> bool:
    """Check if an active validated Broad ML1 model exists."""
    return get_broad_model_entry() is not None


def get_available_antibiotics_for_organism(organism: str) -> List[str]:
    """Return all antibiotics with validated models for a given organism."""
    reg = load_registry()
    org_key = normalize_organism_key(organism)
    available = []
    for scope_key, model_id in reg.get("active_models", {}).items():
        if scope_key.startswith(f"{org_key}::"):
            model_entry = reg.get("models", {}).get(model_id, {})
            if model_entry.get("status") == "validated":
                available.append(model_entry.get("antibiotic", scope_key.split("::")[1]))
    return sorted(list(set(available)))


def list_models(
    status: Optional[str] = "validated",
    model_family: Optional[str] = "specialist"
) -> List[Dict[str, Any]]:
    """
    List all registered models, optionally filtered by status ('validated', 'rejected', or None for all)
    and model_family ('specialist', 'broad', or None for all).
    """
    reg = load_registry()
    models = list(reg.get("models", {}).values())
    if model_family is not None:
        if model_family == "specialist":
            models = [m for m in models if m.get("model_family") != "broad"]
        elif model_family == "broad":
            models = [m for m in models if m.get("model_family") == "broad"]
    if status is not None:
        models = [m for m in models if m.get("status") == status]
    return sorted(models, key=lambda m: (m.get("organism", ""), m.get("antibiotic", "")))


def register_model(
    model_entry: Dict[str, Any],
    set_active_if_validated: bool = True
) -> Dict[str, Any]:
    """
    Register a candidate or validated model into the registry.
    If status is 'validated' and set_active_if_validated is True,
    it becomes the active model for that (organism, antibiotic) scope.
    """
    reg = load_registry()
    model_id = model_entry.get("model_id") or model_entry.get("model_version")
    if not model_id:
        raise ValueError("model_entry must include a 'model_id' or 'model_version'")

    org = model_entry.get("organism", "")
    abx = model_entry.get("antibiotic", "")
    org_key = normalize_organism_key(org)
    abx_key = normalize_antibiotic_key(abx)

    model_entry["model_id"] = model_id
    model_entry["organism_key"] = org_key
    model_entry["antibiotic_key"] = abx_key
    model_entry["created_at"] = model_entry.get("created_at") or datetime.now(timezone.utc).isoformat()

    scope_key = f"{org_key}::{abx_key}"

    with _registry_lock:
        reg["models"][model_id] = model_entry

        if model_entry.get("status") == "validated" and set_active_if_validated:
            # Model comparison gate: check if there's already an active model
            current_active_id = reg.get("active_models", {}).get(scope_key)
            if current_active_id and current_active_id != model_id:
                current_entry = reg["models"].get(current_active_id, {})
                current_f1 = current_entry.get("validation_metrics", {}).get("f1", 0.0)
                new_f1 = model_entry.get("validation_metrics", {}).get("f1", 0.0)
                # Promote only if new model is at least as good as current
                if new_f1 >= current_f1:
                    reg["active_models"][scope_key] = model_id
                    logger.info("Promoted %s over %s for scope %s (F1: %.4f >= %.4f)",
                                model_id, current_active_id, scope_key, new_f1, current_f1)
                else:
                    logger.info("Retained existing %s over %s for scope %s (F1: %.4f > %.4f)",
                                current_active_id, model_id, scope_key, current_f1, new_f1)
            else:
                reg["active_models"][scope_key] = model_id
                logger.info("Registered new active model %s for scope %s", model_id, scope_key)

        _save_registry_unlocked(reg)

    return model_entry


# Initialize registry on import
load_registry()

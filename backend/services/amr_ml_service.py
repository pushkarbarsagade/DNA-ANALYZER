"""
backend/services/amr_ml_service.py

Phase 11 — Dynamic Multi-Organism / Multi-Antibiotic AMR Machine Learning Service.

Provides dynamic, research-only ML predictions across any organism and antibiotic
combination for which a validated model is registered in the model registry.

Scientific & Architectural Rules:
- ML is INFORMATIONAL ONLY; it never overrides deterministic classification.
- Scope is dynamic and strictly bounded by the Model Registry.
- No silent fallback to an unrelated model if no validated model exists.
- Models are loaded once per process (lazy/cached by model_id).
- No retraining at request time.
- No training on user laboratory data.
- Unknown determinants are safely ignored (no crash or ordering shift).
- Zero-AMR isolates map to all-zero feature vectors (wild-type baseline).
- Any failure returns a structured unavailable response.
"""
from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import numpy as np

try:
    from backend.services.amr_model_registry import (
        get_model_entry, has_model, get_broad_model_entry, has_broad_model,
        get_experimental_model_entry,
        get_available_antibiotics_for_organism,
        list_models, normalize_organism_key, normalize_antibiotic_key
    )
    from backend.services.amr_ml_dataset import parse_amr_genes
except ImportError:
    from services.amr_model_registry import (
        get_model_entry, has_model, get_broad_model_entry, has_broad_model,
        get_experimental_model_entry,
        get_available_antibiotics_for_organism,
        list_models, normalize_organism_key, normalize_antibiotic_key
    )
    from services.amr_ml_dataset import parse_amr_genes

logger = logging.getLogger(__name__)

ML_DISCLAIMER = (
    "Machine-learning predictions are statistical research estimates from a model "
    "developed for specific organism–antibiotic combinations. They are intended for educational and "
    "preliminary research use only and must not be interpreted as clinical diagnostic "
    "results, susceptibility testing, or treatment recommendations."
)

_DEFAULT_BASELINE_PATH = Path("backend/data/ml_research/amr_ml_ecoli_amp_v0_1_poc.joblib")
_MODEL_PATH = _DEFAULT_BASELINE_PATH

# ---------------------------------------------------------------------------
# Lazy / Cached Model Loading by Model ID
# ---------------------------------------------------------------------------

_model_cache_lock = threading.Lock()
_model_cache: Dict[str, Any] = {}
_vocab_cache: Dict[str, Tuple[List[str], Set[str]]] = {}


def _resolve_file_path(path_str: str) -> Path:
    """Resolve relative or absolute model artifact paths."""
    p = Path(path_str)
    if p.is_absolute() and p.exists():
        return p
    # Try resolving relative to current working directory
    cwd_path = Path.cwd() / path_str
    if cwd_path.exists():
        return cwd_path
    # Try resolving relative to repository root
    repo_root = Path(__file__).resolve().parent.parent.parent
    repo_path = repo_root / path_str
    if repo_path.exists():
        return repo_path
    return p


def _load_model_and_vocab(model_entry: Dict[str, Any]) -> Tuple[Optional[Any], Optional[List[str]], Optional[Set[str]], Optional[str]]:
    """
    Lazily load model and feature vocabulary for a registered model entry.
    Thread-safe and cached by model_id.
    """
    model_id = model_entry.get("model_id") or model_entry.get("model_version")
    if not model_id:
        return None, None, None, "Invalid model entry: missing model_id"

    with _model_cache_lock:
        if model_id in _model_cache and model_id in _vocab_cache:
            vocab_list, vocab_set = _vocab_cache[model_id]
            return _model_cache[model_id], vocab_list, vocab_set, None

        model_path_str = model_entry.get("model_path", "")
        vocab_path_str = model_entry.get("vocabulary_path", "")

        if _MODEL_PATH != _DEFAULT_BASELINE_PATH:
            model_path = _MODEL_PATH
        else:
            model_path = _resolve_file_path(model_path_str)
        vocab_path = _resolve_file_path(vocab_path_str)

        # Load vocabulary
        vocab_list: Optional[List[str]] = None
        if vocab_path.exists():
            try:
                with open(vocab_path, "r", encoding="utf-8") as f:
                    vocab_list = json.load(f)
            except Exception as e:
                logger.error("Failed to load vocabulary from %s: %s", vocab_path, e)

        # Load model artifact
        if not model_path.exists():
            err_msg = f"Model artifact file not found at {model_path}"
            logger.error(err_msg)
            return None, None, None, err_msg

        try:
            import joblib
            loaded = joblib.load(model_path)
            if isinstance(loaded, dict):
                model_obj = loaded.get("model")
                if vocab_list is None and "features" in loaded:
                    vocab_list = loaded["features"]
            else:
                model_obj = loaded

            if model_obj is None:
                err_msg = f"Model artifact at {model_path} contains null model"
                logger.error(err_msg)
                return None, None, None, err_msg

        except Exception as e:
            err_msg = f"Failed to load model from {model_path}: {e}"
            logger.error(err_msg)
            return None, None, None, err_msg

        if not isinstance(vocab_list, list) or len(vocab_list) == 0:
            err_msg = f"Vocabulary for model {model_id} is empty or invalid"
            logger.error(err_msg)
            return None, None, None, err_msg

        vocab_set = set(vocab_list)

        _model_cache[model_id] = model_obj
        _vocab_cache[model_id] = (vocab_list, vocab_set)
        logger.info("Loaded and cached model %s (vocab size: %d)", model_id, len(vocab_list))
        return model_obj, vocab_list, vocab_set, None


def reset_model_cache() -> None:
    """Clear in-memory model cache. Used for testing."""
    with _model_cache_lock:
        _model_cache.clear()
        _vocab_cache.clear()


# ---------------------------------------------------------------------------
# Scope & Provenance Inspection
# ---------------------------------------------------------------------------

def is_in_scope(organism: str, antibiotic: str = "ampicillin") -> bool:
    """Check if an active validated model is registered for this organism & antibiotic."""
    return has_model(organism, antibiotic)


def get_model_provenance(
    organism: str = "Escherichia coli",
    antibiotic: str = "Ampicillin"
) -> Dict[str, Any]:
    """Return model provenance metadata for an organism + antibiotic, or general registry status."""
    entry = get_model_entry(organism, antibiotic)
    if entry:
        return {
            "model": entry.get("model_version"),
            "model_version": entry.get("model_version"),
            "organism": entry.get("organism"),
            "antibiotic": entry.get("antibiotic"),
            "algorithm": entry.get("algorithm", "Logistic Regression (L2)"),
            "threshold": entry.get("threshold", 0.50),
            "status": entry.get("status", "validated"),
            "feature_count": entry.get("feature_count", 0),
            "n_isolates": entry.get("n_isolates", 0),
            "validation_metrics": entry.get("validation_metrics", {}),
            "model_loaded": True,
            "disclaimer": ML_DISCLAIMER,
        }

    # If specific model not found, return summary of all registered models
    all_models = list_models(status="validated")
    return {
        "model": "AMR-ML-REGISTRY",
        "status": "active",
        "registered_validated_models_count": len(all_models),
        "available_scopes": [
            f"{m.get('organism')} + {m.get('antibiotic')}" for m in all_models
        ],
        "disclaimer": ML_DISCLAIMER
    }


# ---------------------------------------------------------------------------
# Feature Vector Construction
# ---------------------------------------------------------------------------

def build_feature_vector_for_vocab(
    genotype_str: str,
    vocab_list: List[str],
    vocab_set: Set[str]
) -> Dict[str, Any]:
    """
    Construct a binary feature vector from an AMR genotype string against a specific model vocabulary.
    Zero-determinant isolates cleanly map to an all-zero vector (x = 0).
    Unknown/synthetic determinants map safely to 0 and are tracked in unrecognized_features.
    """
    parsed = list(parse_amr_genes(genotype_str))
    recognized = []
    unrecognized = []

    for feat in parsed:
        if feat in vocab_set:
            recognized.append(feat)
        else:
            unrecognized.append(feat)

    feat_to_idx = {feat: idx for idx, feat in enumerate(vocab_list)}
    vector = [0.0] * len(vocab_list)
    for feat in recognized:
        idx = feat_to_idx.get(feat)
        if idx is not None:
            vector[idx] = 1.0

    return {
        "vector": vector,
        "recognized_count": len(recognized),
        "total_determinants": len(parsed),
        "recognized_features": recognized,
        "unrecognized_features": unrecognized,
    }


# ---------------------------------------------------------------------------
# Dynamic Prediction APIs
# ---------------------------------------------------------------------------

def predict(
    organism: str,
    genotype_str: str,
    antibiotic: str = "ampicillin"
) -> Dict[str, Any]:
    """
    Generate an ML research prediction dynamically using the registered validated model
    for the specified (organism, antibiotic) combination.
    """
    model_entry = get_model_entry(organism, antibiotic)
    if not model_entry:
        return {
            "available": False,
            "reason": "no_validated_model",
            "error_code": "MODEL_SCOPE_LIMITED_TO_REGISTERED_COMBINATIONS",
            "organism": organism,
            "organism_provided": organism,
            "antibiotic": antibiotic,
            "antibiotic_requested": antibiotic,
            "disclaimer": ML_DISCLAIMER,
        }

    model_obj, vocab_list, vocab_set, load_err = _load_model_and_vocab(model_entry)
    if load_err or model_obj is None or vocab_list is None:
        return {
            "available": False,
            "reason": "ML_SERVICE_ERROR",
            "error": load_err or "Model artifact unavailable",
            "model": model_entry.get("model_version"),
            "organism": model_entry.get("organism"),
            "antibiotic": model_entry.get("antibiotic"),
            "disclaimer": ML_DISCLAIMER,
        }

    try:
        feat_info = build_feature_vector_for_vocab(genotype_str, vocab_list, vocab_set)
        vector = feat_info["vector"]

        X = np.array([vector], dtype=np.float32)
        probabilities = model_obj.predict_proba(X)[0]

        # Class 0: Susceptible, Class 1: Resistant
        prob_susceptible = float(probabilities[0])
        prob_resistant = float(probabilities[1])
        threshold = float(model_entry.get("threshold", 0.50))
        predicted_class = "Resistant" if prob_resistant >= threshold else "Susceptible"

        return {
            "available": True,
            "model_family": "specialist",
            "model": model_entry.get("model_version"),
            "model_version": model_entry.get("model_version"),
            "organism": model_entry.get("organism"),
            "antibiotic": model_entry.get("antibiotic"),
            "algorithm": model_entry.get("algorithm", "Logistic Regression (L2)"),
            "threshold": threshold,
            "status": model_entry.get("status", "validated"),
            "prediction": predicted_class,
            "predicted_probability": round(prob_resistant, 4),
            "probability_resistant": round(prob_resistant, 4),
            "probability_susceptible": round(prob_susceptible, 4),
            "training_sample_count": model_entry.get("n_isolates", 0),
            "feature_count": len(vocab_list),
            "recognized_features": feat_info["recognized_count"],
            "total_determinants": feat_info["total_determinants"],
            "recognized_feature_names": feat_info["recognized_features"],
            "unrecognized_features": feat_info["unrecognized_features"],
            "research_only": True,
            "disclaimer": ML_DISCLAIMER,
        }

    except Exception as e:
        logger.error("Prediction execution failed for %s + %s: %s", organism, antibiotic, e)
        return {
            "available": False,
            "model_family": "specialist",
            "reason": "ML_SERVICE_ERROR",
            "error": str(e),
            "model": model_entry.get("model_version"),
            "organism": organism,
            "antibiotic": antibiotic,
            "disclaimer": ML_DISCLAIMER,
        }


# ---------------------------------------------------------------------------
# Broad ML1 Feature Construction & Prediction APIs
# ---------------------------------------------------------------------------

def build_broad_feature_vector(
    organism: str,
    genotype_str: str,
    antibiotic: str,
    vocab_list: List[str],
    vocab_set: Set[str]
) -> Dict[str, Any]:
    """
    Constructs conditioned feature vector for AMR-ML1-BROAD-v0.1:
    [org:<organism_key>, abx:<antibiotic_key>, gene:<determinant>, ...]
    Unseen determinants, organisms, or antibiotics are safely mapped to 0.0
    and reported in unrecognized_features.
    """
    org_key = normalize_organism_key(organism)
    abx_key = normalize_antibiotic_key(antibiotic)

    feat_to_idx = {feat: idx for idx, feat in enumerate(vocab_list)}
    vector = [0.0] * len(vocab_list)
    recognized = []
    unrecognized = []

    org_feat = f"org:{org_key}"
    if org_feat in vocab_set:
        vector[feat_to_idx[org_feat]] = 1.0
        recognized.append(org_feat)
    else:
        unrecognized.append(f"organism:{organism}")

    abx_feat = f"abx:{abx_key}"
    if abx_feat in vocab_set:
        vector[feat_to_idx[abx_feat]] = 1.0
        recognized.append(abx_feat)
    else:
        unrecognized.append(f"antibiotic:{antibiotic}")

    parsed_genes = list(parse_amr_genes(genotype_str))
    for gene in parsed_genes:
        g_feat = f"gene:{gene}"
        if g_feat in vocab_set:
            vector[feat_to_idx[g_feat]] = 1.0
            recognized.append(g_feat)
        else:
            unrecognized.append(f"gene:{gene}")

    in_domain = (org_feat in vocab_set and abx_feat in vocab_set)

    return {
        "vector": vector,
        "recognized_count": len(recognized),
        "total_determinants": len(parsed_genes),
        "recognized_features": recognized,
        "unrecognized_features": unrecognized,
        "in_domain": in_domain,
    }


def predict_broad(
    organism: str,
    genotype_str: str,
    antibiotic: str = "ampicillin"
) -> Dict[str, Any]:
    """
    Generate an ML research prediction dynamically using the registered Broad ML1 model (AMR-ML1-BROAD-v0.1)
    conditioned on (organism, antibiotic, genomic determinant vector).
    """
    broad_entry = get_broad_model_entry()
    if not broad_entry:
        return {
            "available": False,
            "model_family": "broad",
            "reason": "no_validated_model",
            "error_code": "BROAD_MODEL_NOT_REGISTERED",
            "organism": organism,
            "antibiotic": antibiotic,
            "disclaimer": ML_DISCLAIMER,
        }

    model_obj, vocab_list, vocab_set, load_err = _load_model_and_vocab(broad_entry)
    if load_err or model_obj is None or vocab_list is None:
        return {
            "available": False,
            "model_family": "broad",
            "reason": "ML_SERVICE_ERROR",
            "error": load_err or "Broad ML1 artifact unavailable",
            "model": broad_entry.get("model_version", "AMR-ML1-BROAD-v0.1"),
            "organism": organism,
            "antibiotic": antibiotic,
            "disclaimer": ML_DISCLAIMER,
        }

    try:
        feat_info = build_broad_feature_vector(organism, genotype_str, antibiotic, vocab_list, vocab_set)
        if not feat_info["in_domain"]:
            return {
                "available": False,
                "model_family": "broad",
                "reason": "no_validated_model",
                "error_code": "SCOPE_NOT_IN_BROAD_MODEL_DOMAIN",
                "model": broad_entry.get("model_version"),
                "organism": organism,
                "antibiotic": antibiotic,
                "unrecognized_features": feat_info["unrecognized_features"],
                "disclaimer": ML_DISCLAIMER,
            }

        vector = feat_info["vector"]
        X = np.array([vector], dtype=np.float32)
        probabilities = model_obj.predict_proba(X)[0]

        prob_susceptible = float(probabilities[0])
        prob_resistant = float(probabilities[1])
        threshold = float(broad_entry.get("threshold", 0.50))
        predicted_class = "Resistant" if prob_resistant >= threshold else "Susceptible"

        return {
            "available": True,
            "model_family": "broad",
            "model": broad_entry.get("model_version"),
            "model_version": broad_entry.get("model_version"),
            "organism": organism,
            "antibiotic": antibiotic,
            "algorithm": broad_entry.get("algorithm", "Conditioned Logistic Regression (L2)"),
            "threshold": threshold,
            "status": broad_entry.get("status", "validated"),
            "prediction": predicted_class,
            "predicted_probability": round(prob_resistant, 4),
            "probability_resistant": round(prob_resistant, 4),
            "probability_susceptible": round(prob_susceptible, 4),
            "training_sample_count": broad_entry.get("n_isolates", 0),
            "total_observations": broad_entry.get("total_observations", 0),
            "feature_count": len(vocab_list),
            "recognized_features": feat_info["recognized_count"],
            "total_determinants": feat_info["total_determinants"],
            "recognized_feature_names": feat_info["recognized_features"],
            "unrecognized_features": feat_info["unrecognized_features"],
            "research_only": True,
            "disclaimer": ML_DISCLAIMER,
        }
    except Exception as e:
        logger.error("Broad ML1 prediction execution failed for %s + %s: %s", organism, antibiotic, e)
        return {
            "available": False,
            "model_family": "broad",
            "reason": "ML_SERVICE_ERROR",
            "error": str(e),
            "model": broad_entry.get("model_version"),
            "organism": organism,
            "antibiotic": antibiotic,
            "disclaimer": ML_DISCLAIMER,
        }


def predict_specialist(
    organism: str,
    genotype_str: str,
    antibiotic: str = "ampicillin"
) -> Dict[str, Any]:
    """Alias for specialist model prediction."""
    return predict(organism, genotype_str, antibiotic)


# ---------------------------------------------------------------------------
# Model Selection Logic (Part 8 & Part 15)
# ---------------------------------------------------------------------------

def evaluate_ml_selection(
    organism: str,
    genotype_str: str = "",
    antibiotic: Optional[str] = None
) -> Dict[str, Any]:
    """
    Evaluates both Broad ML1 and Specialist models for the given (organism, genotype, antibiotic).
    Supports flexible signatures:
      evaluate_ml_selection(organism, genotype_str, antibiotic)
      evaluate_ml_selection(organism, antibiotic)
      evaluate_ml_selection(organism=..., genotype_str=..., antibiotic=...)
    Applies explicit selection hierarchy:
      1. Validated Specialist Model
      2. Broad ML1 Research Model
      3. Experimental Specialist Model
      4. No applicable model
    """
    if antibiotic is None:
        # Called as evaluate_ml_selection(organism, antibiotic)
        antibiotic = genotype_str or ""
        genotype_str = ""
    else:
        genotype_str = genotype_str or ""

    spec_pred = predict(organism, genotype_str, antibiotic)
    broad_pred = predict_broad(organism, genotype_str, antibiotic)

    has_spec = bool(spec_pred.get("available"))
    has_broad = bool(broad_pred.get("available"))

    if has_spec and has_broad:
        case = "both"
        note = "Broad ML1 and Specialist models are both available. Specialist model provides organism- and drug-specific context; Broad ML1 provides multi-organism dataset-conditioned research prediction."
    elif has_spec and not has_broad:
        case = "specialist_only"
        note = "Specialist model prediction available for this specific organism–antibiotic combination."
    elif has_broad and not has_spec:
        case = "broad_only"
        note = "Broad model prediction available; no specialist model currently validated for this combination."
    else:
        case = "none"
        note = "No validated ML prediction available for this organism–antibiotic combination."

    # Priority 1: If validated specialist exists, experimental is never active
    exp_entry = None
    if not has_spec:
        exp_entry = get_experimental_model_entry(organism, antibiotic)
    has_exp = exp_entry is not None
    exp_id = (exp_entry.get("model_version") or exp_entry.get("model_id")) if exp_entry else None

    # For Phase 12 backward-compatibility: 'available' indicates specialist model availability,
    # while 'has_broad' and 'broad_prediction' provide the broad-spectrum ML1 inference.
    primary = spec_pred if has_spec else (broad_pred if has_broad else spec_pred)

    return {
        "organism": organism,
        "antibiotic": antibiotic,
        "available": has_spec,
        "selection_case": case,
        "display_note": note,
        "has_specialist": has_spec,
        "has_broad": has_broad,
        "has_experimental": has_exp,
        "experimental_model": exp_id,
        "specialist_prediction": spec_pred if has_spec else None,
        "broad_prediction": broad_pred if has_broad else None,
        # Backward-compatible flat fields:
        "model": primary.get("model") or primary.get("model_version"),
        "model_version": primary.get("model_version") or primary.get("model"),
        "prediction": primary.get("prediction"),
        "predicted_probability": primary.get("predicted_probability"),
        "probability_resistant": primary.get("probability_resistant"),
        "probability_susceptible": primary.get("probability_susceptible"),
        "threshold": primary.get("threshold", 0.50),
        "algorithm": primary.get("algorithm", "Logistic Regression (L2)"),
        "status": "validated" if (has_spec or has_broad) else "rejected",
        "reason": spec_pred.get("reason") if not has_spec else None,
        "recognized_features": primary.get("recognized_features", 0),
        "total_determinants": primary.get("total_determinants", 0),
        "recognized_feature_names": primary.get("recognized_feature_names", []),
        "unrecognized_features": primary.get("unrecognized_features", []),
        "research_only": True,
        "disclaimer": ML_DISCLAIMER,
    }


def predict_for_biosample(
    organism: str,
    genotype_str: str,
    ast_records: Optional[List[Dict[str, Any]]] = None,
    requested_antibiotic: Optional[str] = None
) -> Dict[str, Any]:
    """
    Dynamically evaluate ML predictions for a BioSample across all eligible tested
    antibiotics or for a specifically requested antibiotic, computing both Broad ML1
    and Specialist model predictions.
    """
    if requested_antibiotic:
        selected_eval = evaluate_ml_selection(organism, genotype_str, requested_antibiotic)
        is_avail = bool(selected_eval.get("has_specialist") or selected_eval.get("has_broad"))
        active = selected_eval.get("specialist_prediction") if selected_eval.get("has_specialist") else (selected_eval.get("broad_prediction") or {})
        return {
            "organism": organism,
            "predictions": [selected_eval],
            "available_count": 1 if is_avail else 0,
            "total_drugs": 1,
            "available": is_avail,
            "model": active.get("model_version") or active.get("model"),
            "model_version": active.get("model_version") or active.get("model"),
            "prediction": active.get("prediction"),
            "predicted_probability": active.get("predicted_probability"),
            "probability_resistant": active.get("probability_resistant"),
            "probability_susceptible": active.get("probability_susceptible"),
            "threshold": active.get("threshold", 0.50),
            "research_only": True,
            "disclaimer": ML_DISCLAIMER,
            **selected_eval,
            "available": is_avail,
        }

    # Discover candidate antibiotics — deduplicate by normalized registry key so that
    # AST record names (e.g. lowercase "ampicillin") and registry names (e.g. "Ampicillin")
    # produce exactly one prediction per organism×antibiotic combination.
    seen_keys: Set[str] = set()
    canonical_abx: Dict[str, str] = {}

    # 1. From model registry for this organism (preferred canonical names)
    registered_abx = get_available_antibiotics_for_organism(organism)
    for abx in registered_abx:
        key = normalize_antibiotic_key(abx)
        canonical_abx[key] = abx

    # 2. From AST records (only add if not already covered by registry)
    if ast_records:
        for rec in ast_records:
            drug = rec.get("antibiotic") or rec.get("drug")
            if drug:
                drug = drug.strip()
                key = normalize_antibiotic_key(drug)
                if key not in canonical_abx:
                    canonical_abx[key] = drug

    # 3. Default fallback if no candidates at all
    if not canonical_abx:
        canonical_abx["ampicillin"] = "Ampicillin"

    predictions = []
    for _key, abx in sorted(canonical_abx.items()):
        if _key in seen_keys:
            continue
        seen_keys.add(_key)
        pred_eval = evaluate_ml_selection(organism, genotype_str, abx)
        predictions.append(pred_eval)

    specialist_available = [p for p in predictions if p.get("available")]
    broad_available = [p for p in predictions if p.get("has_broad")]
    available_preds = [p for p in predictions if p.get("available") or p.get("has_broad")]
    primary_pred = specialist_available[0] if specialist_available else (broad_available[0] if broad_available else (predictions[0] if predictions else {}))

    broad_entry = get_broad_model_entry()

    response: Dict[str, Any] = {
        "organism": organism,
        "predictions": predictions,
        "available_count": len(available_preds),
        "total_drugs": len(predictions),
        "broad_model_available": has_broad_model(),
        "broad_model_version": broad_entry.get("model_version") if broad_entry else None,
        # Backward-compatible fields from primary prediction
        "available": bool(primary_pred.get("available")),
        "model": primary_pred.get("model_version") or primary_pred.get("model"),
        "model_version": primary_pred.get("model_version") or primary_pred.get("model"),
        "prediction": primary_pred.get("prediction"),
        "predicted_probability": primary_pred.get("predicted_probability"),
        "probability_resistant": primary_pred.get("probability_resistant"),
        "probability_susceptible": primary_pred.get("probability_susceptible"),
        "threshold": primary_pred.get("threshold", 0.50),
        "research_only": True,
        "disclaimer": ML_DISCLAIMER,
    }

    if not primary_pred.get("available") and "reason" in primary_pred:
        response["reason"] = primary_pred["reason"]

    return response

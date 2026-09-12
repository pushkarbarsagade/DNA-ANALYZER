"""
backend/services/amr_ml_trainer.py

Phase 11 — Automated AMR Model Training, Validation Gates & Versioning.

Orchestrates the end-to-end model lifecycle:
1. Dataset ingestion & isolate-level grouped splitting.
2. Deterministic feature vocabulary construction.
3. Model training (Logistic Regression L2).
4. Rigorous evaluation on held-out test sets.
5. Automated validation gating.
6. Artifact persistence, model versioning & registry updates.

Invariants:
- Grouped isolate split guarantees Train ∩ Test = ∅.
- Five frozen benchmark isolates are strictly excluded.
- Zero-AMR isolates are encoded as all-zero feature vectors (x = 0).
- Only models passing all quality gates are registered as 'validated'.
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

import joblib
import numpy as np
from scipy.stats import norm
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupShuffleSplit
from sklearn.metrics import (
    accuracy_score, recall_score, precision_score, f1_score,
    roc_auc_score, confusion_matrix
)

from backend.services.amr_model_registry import (
    normalize_organism_key, normalize_antibiotic_key, register_model, load_registry
)
from backend.services.amr_ml_dataset import FROZEN_BENCHMARK_BIOSAMPLES

logger = logging.getLogger(__name__)

_ML_RESEARCH_DIR = Path(__file__).resolve().parent.parent / "data" / "ml_research"
_MODELS_DIR = _ML_RESEARCH_DIR / "models"
_MODELS_DIR.mkdir(parents=True, exist_ok=True)

# Default Project Quality Gates (Engineering Research Standards)
DEFAULT_QUALITY_GATES = {
    "min_total_isolates": 100,
    "min_per_class": 20,
    "min_sensitivity": 0.90,
    "min_f1": 0.90,
    "min_roc_auc": 0.90,
    "max_isolate_leakage": 0,
    "max_benchmark_leakage": 0,
}


# ---------------------------------------------------------------------------
# Statistical Confidence Interval Helpers
# ---------------------------------------------------------------------------

def wilson_score_interval(k: int, n: int, confidence: float = 0.95) -> Tuple[float, float]:
    """Calculate Wilson score interval for binomial proportions."""
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    z = norm.ppf(1.0 - (1.0 - confidence) / 2.0)
    denominator = 1.0 + z**2 / n
    centre_adjusted_probability = p + z**2 / (2.0 * n)
    adjusted_std_dev = math.sqrt((p * (1.0 - p) + z**2 / (4.0 * n)) / n)
    lower = (centre_adjusted_probability - z * adjusted_std_dev) / denominator
    upper = (centre_adjusted_probability + z * adjusted_std_dev) / denominator
    return (max(0.0, float(lower)), min(1.0, float(upper)))


def bootstrap_ci(
    y_true: np.ndarray,
    y_pred_prob: np.ndarray,
    metric_fn: Callable,
    n_bootstraps: int = 1000,
    seed: int = 42,
    is_prob: bool = False
) -> Tuple[float, float]:
    """Calculate 95% bootstrap confidence interval."""
    rng = np.random.RandomState(seed)
    scores = []
    n = len(y_true)

    for _ in range(n_bootstraps):
        idx = rng.randint(0, n, size=n)
        if len(np.unique(y_true[idx])) < 2 and metric_fn == roc_auc_score:
            continue
        if is_prob:
            score = metric_fn(y_true[idx], y_pred_prob[idx])
        else:
            y_pred_binary = (y_pred_prob[idx] >= 0.50).astype(int)
            score = metric_fn(y_true[idx], y_pred_binary)
        scores.append(score)

    if not scores:
        return (0.0, 0.0)

    lower = float(np.percentile(scores, 2.5))
    upper = float(np.percentile(scores, 97.5))
    return (lower, upper)


# ---------------------------------------------------------------------------
# Version Generation Helper
# ---------------------------------------------------------------------------

def generate_model_version(organism: str, antibiotic: str) -> str:
    """
    Generate next standard model version ID: AMR-ML-<ORG>-<ABX>-v<VERSION>.
    e.g. AMR-ML-ECOLI-AMP-v0.2
    """
    org_key = normalize_organism_key(organism)
    abx_key = normalize_antibiotic_key(antibiotic)

    org_abbrev = {
        "escherichia_coli": "ECOLI",
        "klebsiella_pneumoniae": "KPNEU",
        "salmonella_enterica": "SALM",
        "pseudomonas_aeruginosa": "PAERU",
        "acinetobacter_baumannii": "ABAUM",
        "staphylococcus_aureus": "SAUR",
    }.get(org_key, org_key[:5].upper())

    abx_abbrev = {
        "ampicillin": "AMP",
        "ceftriaxone": "CRO",
        "ciprofloxacin": "CIP",
        "tetracycline": "TET",
        "streptomycin": "STR",
        "gentamicin": "GEN",
        "amikacin": "AMK",
        "meropenem": "MEM",
        "chloramphenicol": "CHL",
        "trimethoprim_sulfamethoxazole": "SXT",
    }.get(abx_key, abx_key[:3].upper())

    base_prefix = f"AMR-ML-{org_abbrev}-{abx_abbrev}"

    # Check registry for existing versions
    reg = load_registry()
    existing_versions = [
        m["model_version"]
        for m in reg.get("models", {}).values()
        if m.get("model_version", "").startswith(base_prefix)
    ]

    if not existing_versions:
        return f"{base_prefix}-v0.1"

    # Find highest version number
    version_nums = []
    for v in existing_versions:
        match = re.search(r"-v(\d+)\.(\d+)", v)
        if match:
            major, minor = int(match.group(1)), int(match.group(2))
            version_nums.append((major, minor))

    if version_nums:
        highest = max(version_nums)
        next_minor = highest[1] + 1
        return f"{base_prefix}-v{highest[0]}.{next_minor}"

    return f"{base_prefix}-v0.2"


# ---------------------------------------------------------------------------
# Core Training & Validation Orchestrator
# ---------------------------------------------------------------------------

def train_and_validate_candidate(
    dataset_result: Dict[str, Any],
    quality_gates: Optional[Dict[str, Any]] = None,
    random_seed: int = 42,
    training_release: str = "PDG000000004.6300"
) -> Dict[str, Any]:
    """
    Train a candidate Logistic Regression model on an extracted dataset,
    evaluate on held-out test partition, validate against engineering gates,
    and persist artifacts.
    """
    gates = {**DEFAULT_QUALITY_GATES, **(quality_gates or {})}
    organism = dataset_result["organism"]
    antibiotic = dataset_result["antibiotic"]
    isolates = dataset_result.get("isolates", [])

    total_n = len(isolates)
    s_count = sum(1 for x in isolates if x["target_label"] == 0)
    r_count = sum(1 for x in isolates if x["target_label"] == 1)
    min_class_count = min(s_count, r_count) if (s_count > 0 and r_count > 0) else 0

    reasons: List[str] = []

    # Pre-training Gate: Sample Count
    if total_n < gates["min_total_isolates"]:
        reasons.append(f"Total isolates ({total_n}) below minimum requirement ({gates['min_total_isolates']})")
    if min_class_count < gates["min_per_class"]:
        reasons.append(f"Minority class count ({min_class_count}) below minimum requirement ({gates['min_per_class']})")

    if reasons:
        return {
            "status": "rejected",
            "organism": organism,
            "antibiotic": antibiotic,
            "total_isolates": total_n,
            "susceptible_count": s_count,
            "resistant_count": r_count,
            "reasons": reasons,
            "gates_passed": False
        }

    # Grouped Isolate Split (80/20)
    groups = [x["biosample_acc"] for x in isolates]
    y_all = np.array([x["target_label"] for x in isolates])

    gss = GroupShuffleSplit(n_splits=1, test_size=0.20, random_state=random_seed)
    train_idx, test_idx = next(gss.split(isolates, y_all, groups))

    train_isolates = [isolates[i] for i in train_idx]
    test_isolates = [isolates[i] for i in test_idx]

    train_groups = set(x["biosample_acc"] for x in train_isolates)
    test_groups = set(x["biosample_acc"] for x in test_isolates)
    group_intersection = train_groups.intersection(test_groups)

    # Verification: Zero isolate leakage
    isolate_leakage_count = len(group_intersection)
    if isolate_leakage_count > gates["max_isolate_leakage"]:
        reasons.append(f"Isolate leakage detected: {isolate_leakage_count} overlapping BioSamples")

    # Verification: Zero benchmark contamination
    benchmark_overlap = [x["biosample_acc"] for x in isolates if x["biosample_acc"] in FROZEN_BENCHMARK_BIOSAMPLES]
    if len(benchmark_overlap) > gates["max_benchmark_leakage"]:
        reasons.append(f"Benchmark contamination: {len(benchmark_overlap)} frozen BioSamples found")

    # Feature Vocabulary Construction (Derived strictly from training set)
    vocab = sorted(list(set(g for iso in train_isolates for g in iso["amr_genes"])))
    feat_to_idx = {feat: idx for idx, feat in enumerate(vocab)}
    n_features = len(vocab)

    if n_features == 0:
        reasons.append("No genomic AMR determinants identified in training partition")

    if reasons:
        return {
            "status": "rejected",
            "organism": organism,
            "antibiotic": antibiotic,
            "total_isolates": total_n,
            "reasons": reasons,
            "gates_passed": False
        }

    # Matrix Construction
    def build_matrix(iso_list: List[Dict[str, Any]]) -> Tuple[np.ndarray, np.ndarray]:
        X = np.zeros((len(iso_list), n_features), dtype=np.float32)
        for i, iso in enumerate(iso_list):
            for g in iso["amr_genes"]:
                if g in feat_to_idx:
                    X[i, feat_to_idx[g]] = 1.0
        y = np.array([iso["target_label"] for iso in iso_list], dtype=np.int32)
        return X, y

    X_train, y_train = build_matrix(train_isolates)
    X_test, y_test = build_matrix(test_isolates)

    # Model Training (L2 Logistic Regression baseline)
    lr = LogisticRegression(C=1.0, max_iter=1000, random_state=random_seed)
    lr.fit(X_train, y_train)

    # Evaluation on Held-Out Test Partition (Fixed 0.50 threshold)
    y_prob = lr.predict_proba(X_test)[:, 1]
    y_pred = (y_prob >= 0.50).astype(int)

    acc = float(accuracy_score(y_test, y_pred))
    sens = float(recall_score(y_test, y_pred, zero_division=0))
    prec = float(precision_score(y_test, y_pred, zero_division=0))
    f1 = float(f1_score(y_test, y_pred, zero_division=0))
    auc = float(roc_auc_score(y_test, y_prob)) if len(np.unique(y_test)) > 1 else 0.50

    tn, fp, fn, tp = confusion_matrix(y_test, y_pred, labels=[0, 1]).ravel()
    spec = float(tn / (tn + fp)) if (tn + fp) > 0 else 0.0
    npv = float(tn / (tn + fn)) if (tn + fn) > 0 else 0.0
    vme = float(fn / (fn + tp)) if (fn + tp) > 0 else 0.0
    me = float(fp / (fp + tn)) if (fp + tn) > 0 else 0.0

    # Calculate Confidence Intervals
    acc_ci = wilson_score_interval(int(round(acc * len(y_test))), len(y_test))
    sens_ci = wilson_score_interval(int(tp), int(tp + fn))
    spec_ci = wilson_score_interval(int(tn), int(tn + fp))
    f1_ci = bootstrap_ci(y_test, y_prob, f1_score, seed=random_seed)
    auc_ci = bootstrap_ci(y_test, y_prob, roc_auc_score, seed=random_seed, is_prob=True)

    # Quality Gate Checks
    gate_failures = []
    if sens < gates["min_sensitivity"]:
        gate_failures.append(f"Sensitivity ({sens:.4f}) below quality gate ({gates['min_sensitivity']})")
    if f1 < gates["min_f1"]:
        gate_failures.append(f"F1 score ({f1:.4f}) below quality gate ({gates['min_f1']})")
    if auc < gates["min_roc_auc"]:
        gate_failures.append(f"ROC-AUC ({auc:.4f}) below quality gate ({gates['min_roc_auc']})")

    status = "validated" if not gate_failures else "rejected"

    metrics_payload = {
        "accuracy": round(acc, 4),
        "accuracy_ci": [round(x, 4) for x in acc_ci],
        "sensitivity": round(sens, 4),
        "sensitivity_ci": [round(x, 4) for x in sens_ci],
        "specificity": round(spec, 4),
        "specificity_ci": [round(x, 4) for x in spec_ci],
        "precision": round(prec, 4),
        "npv": round(npv, 4),
        "f1": round(f1, 4),
        "f1_ci": [round(x, 4) for x in f1_ci],
        "roc_auc": round(auc, 4),
        "roc_auc_ci": [round(x, 4) for x in auc_ci],
        "tp": int(tp),
        "fp": int(fp),
        "fn": int(fn),
        "tn": int(tn),
        "vme": round(vme, 4),
        "me": round(me, 4),
        "train_n": len(train_isolates),
        "test_n": len(test_isolates)
    }

    model_version = generate_model_version(organism, antibiotic)
    model_artifact_path = _MODELS_DIR / f"{model_version}.joblib"
    vocab_artifact_path = _MODELS_DIR / f"{model_version}_vocab.json"

    # Save Model Artifact
    artifact_payload = {
        "model": lr,
        "features": vocab,
        "version": model_version,
        "organism": organism,
        "antibiotic": antibiotic,
        "metrics": metrics_payload,
        "training_timestamp": datetime.now(timezone.utc).isoformat()
    }
    joblib.dump(artifact_payload, model_artifact_path)

    with open(vocab_artifact_path, "w", encoding="utf-8") as f:
        json.dump(vocab, f, indent=2)

    # Register in Model Registry
    registry_entry = {
        "model_id": model_version,
        "model_version": model_version,
        "organism": organism,
        "antibiotic": antibiotic,
        "status": status,
        "model_path": str(model_artifact_path.relative_to(Path.cwd()).as_posix() if model_artifact_path.is_relative_to(Path.cwd()) else model_artifact_path),
        "vocabulary_path": str(vocab_artifact_path.relative_to(Path.cwd()).as_posix() if vocab_artifact_path.is_relative_to(Path.cwd()) else vocab_artifact_path),
        "model_type": "Logistic Regression (L2)",
        "algorithm": "Logistic Regression (L2)",
        "threshold": 0.50,
        "feature_count": n_features,
        "n_isolates": total_n,
        "susceptible_count": s_count,
        "resistant_count": r_count,
        "validation_metrics": metrics_payload,
        "training_release": training_release,
        "research_only": True,
        "rejection_reason": "; ".join(gate_failures) if gate_failures else None,
        "created_at": datetime.now(timezone.utc).isoformat()
    }

    registered = register_model(registry_entry, set_active_if_validated=(status == "validated"))

    return {
        "status": status,
        "model_version": model_version,
        "organism": organism,
        "antibiotic": antibiotic,
        "total_isolates": total_n,
        "n_features": n_features,
        "metrics": metrics_payload,
        "gates_passed": (status == "validated"),
        "gate_failures": gate_failures,
        "registry_entry": registered
    }

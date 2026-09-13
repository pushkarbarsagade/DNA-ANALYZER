"""
backend/services/amr_retraining_service.py

Phase 13 — Weekly / Periodic Retraining Foundation.

Implements the enterprise pipeline for periodic model retraining, validation gating,
and conditional promotion for Broad ML1 and Specialist models:

1. Ingest new public data (NCBI Pathogen Detection releases).
2. Refresh and validate dataset (quarantine benchmark, verify class balance).
3. Determine new or changed coverage across organisms and antibiotics.
4. Train candidate model with version increment (e.g., AMR-ML1-BROAD-v0.2).
5. Evaluate candidate model on held-out test partition.
6. Compare candidate metrics against active model (promote only if F1_candidate >= F1_active).
7. Gated promotion: update active_broad_model in registry.
8. Retention & rollback: previous model versions are preserved for instant rollback.

Invariants:
- Never train on user-uploaded laboratory AST records.
- Benchmark isolates remain 100% excluded.
- No automated promotion if quality gates fail.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import GroupShuffleSplit

from backend.services.amr_master_dataset import (
    DATASET_VERSION,
    SOURCE_RELEASE,
    build_master_multitask_instances,
    load_master_amr_data,
    save_master_dataset_metadata,
)
from backend.services.amr_model_registry import (
    load_registry,
    save_registry,
    get_broad_model_entry,
)

logger = logging.getLogger(__name__)

_ML_RESEARCH_DIR = Path(__file__).resolve().parent.parent / "data" / "ml_research"
_MODELS_DIR = _ML_RESEARCH_DIR / "models"
_RETRAINING_LOG = _ML_RESEARCH_DIR / "retraining_audit_log.json"


def get_retraining_history() -> List[Dict[str, Any]]:
    """Load audit log of past retraining cycles."""
    if _RETRAINING_LOG.exists():
        try:
            with open(_RETRAINING_LOG, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []
    return []


def _append_retraining_log(entry: Dict[str, Any]) -> None:
    history = get_retraining_history()
    history.append(entry)
    try:
        with open(_RETRAINING_LOG, "w", encoding="utf-8") as f:
            json.dump(history, f, indent=2)
    except Exception as e:
        logger.error("Failed to append retraining log: %s", e)


def generate_next_broad_version(current_version: str) -> str:
    """Generate next incremental version (e.g. AMR-ML1-BROAD-v0.1 -> AMR-ML1-BROAD-v0.2)."""
    import re
    match = re.search(r"-v(\d+)\.(\d+)", current_version)
    if match:
        major, minor = int(match.group(1)), int(match.group(2))
        return f"AMR-ML1-BROAD-v{major}.{minor + 1}"
    return "AMR-ML1-BROAD-v0.2"


def run_retraining_cycle(
    force_promote: bool = False,
    random_seed: int = 42
) -> Dict[str, Any]:
    """
    Executes a complete periodic retraining cycle for AMR-ML1-BROAD:
    1. Dataset refresh from public cache.
    2. Grouped split (80/20) with 0 isolate leakage.
    3. Train candidate model.
    4. Validate against quality gates.
    5. Compare against current active model.
    6. Promote if candidate passes gates and performs >= active model F1.
    """
    cycle_start = datetime.now(timezone.utc).isoformat()
    reg = load_registry()
    current_active_entry = get_broad_model_entry() or {}
    current_version = current_active_entry.get("model_version", "AMR-ML1-BROAD-v0.1")
    candidate_version = generate_next_broad_version(current_version)

    # 1. Dataset refresh
    isolates = load_master_amr_data(include_extended_cohorts=True, exclude_benchmark=True)
    instances, metadata = build_master_multitask_instances(isolates)
    save_master_dataset_metadata(metadata)

    # 2. Grouped split
    groups = [x["biosample"] for x in instances]
    y_all = np.array([x["label"] for x in instances], dtype=np.int32)
    gss = GroupShuffleSplit(n_splits=1, test_size=0.20, random_state=random_seed)
    train_idx, test_idx = next(gss.split(instances, y_all, groups))

    train_instances = [instances[i] for i in train_idx]
    test_instances = [instances[i] for i in test_idx]

    # Verify zero leakage
    train_groups = set(x["biosample"] for x in train_instances)
    test_groups = set(x["biosample"] for x in test_instances)
    leakage = len(train_groups.intersection(test_groups))
    if leakage > 0:
        return {
            "status": "aborted",
            "reason": f"Isolate leakage detected ({leakage} overlapping isolates)",
            "timestamp": cycle_start
        }

    # Vocabulary
    org_vocab = sorted(list(set(x["organism_key"] for x in train_instances)))
    abx_vocab = sorted(list(set(x["antibiotic_key"] for x in train_instances)))
    gene_vocab = sorted(list(set(g for x in train_instances for g in x["genes"])))

    full_vocab = (
        [f"org:{o}" for o in org_vocab] +
        [f"abx:{a}" for a in abx_vocab] +
        [f"gene:{g}" for g in gene_vocab]
    )
    feat_to_idx = {f: i for i, f in enumerate(full_vocab)}

    def build_matrix(inst_list):
        X = np.zeros((len(inst_list), len(full_vocab)), dtype=np.float32)
        y = np.array([inst["label"] for inst in inst_list], dtype=np.int32)
        for i, inst in enumerate(inst_list):
            ok = f"org:{inst['organism_key']}"
            if ok in feat_to_idx:
                X[i, feat_to_idx[ok]] = 1.0
            ak = f"abx:{inst['antibiotic_key']}"
            if ak in feat_to_idx:
                X[i, feat_to_idx[ak]] = 1.0
            for g in inst["genes"]:
                gk = f"gene:{g}"
                if gk in feat_to_idx:
                    X[i, feat_to_idx[gk]] = 1.0
        return X, y

    X_train, y_train = build_matrix(train_instances)
    X_test, y_test = build_matrix(test_instances)

    # 3. Train candidate model
    lr = LogisticRegression(C=1.0, max_iter=2000, random_state=random_seed)
    lr.fit(X_train, y_train)

    # 4. Evaluate candidate
    y_prob = lr.predict_proba(X_test)[:, 1]
    y_pred = (y_prob >= 0.50).astype(int)

    acc = float(accuracy_score(y_test, y_pred))
    sens = float(recall_score(y_test, y_pred, zero_division=0))
    prec = float(precision_score(y_test, y_pred, zero_division=0))
    f1 = float(f1_score(y_test, y_pred, zero_division=0))
    auc = float(roc_auc_score(y_test, y_prob))
    tn, fp, fn, tp = confusion_matrix(y_test, y_pred, labels=[0, 1]).ravel()

    candidate_metrics = {
        "accuracy": round(acc, 4),
        "sensitivity": round(sens, 4),
        "specificity": round(float(tn / (tn + fp)), 4) if (tn + fp) > 0 else 0.0,
        "precision": round(prec, 4),
        "f1": round(f1, 4),
        "roc_auc": round(auc, 4),
        "train_n": len(train_instances),
        "test_n": len(test_instances),
    }

    # Quality Gate evaluation
    gate_failures = []
    if acc < 0.75:
        gate_failures.append(f"Accuracy ({acc:.4f}) < 0.75")
    if sens < 0.75:
        gate_failures.append(f"Sensitivity ({sens:.4f}) < 0.75")
    if f1 < 0.75:
        gate_failures.append(f"F1 ({f1:.4f}) < 0.75")
    if auc < 0.80:
        gate_failures.append(f"ROC-AUC ({auc:.4f}) < 0.80")

    passed_gates = (len(gate_failures) == 0)

    # 5. Compare against active model
    current_f1 = current_active_entry.get("validation_metrics", {}).get("f1", 0.0)
    improved_or_equal = (f1 >= current_f1) or force_promote

    should_promote = passed_gates and improved_or_equal

    # Save candidate artifact regardless (for retention and audit)
    cand_model_path = _MODELS_DIR / f"{candidate_version}.joblib"
    cand_vocab_path = _MODELS_DIR / f"{candidate_version}_vocab.json"

    artifact_payload = {
        "model": lr,
        "features": full_vocab,
        "org_vocab": org_vocab,
        "abx_vocab": abx_vocab,
        "gene_vocab": gene_vocab,
        "version": candidate_version,
        "model_family": "broad",
        "metrics": candidate_metrics,
        "dataset_version": DATASET_VERSION,
        "training_release": SOURCE_RELEASE,
        "training_timestamp": cycle_start,
    }
    joblib.dump(artifact_payload, cand_model_path)
    with open(cand_vocab_path, "w", encoding="utf-8") as f:
        json.dump(full_vocab, f, indent=2)

    candidate_entry = {
        "model_id": candidate_version,
        "model_version": candidate_version,
        "model_family": "broad",
        "organism": "Multi-Organism",
        "antibiotic": "Multi-Antibiotic",
        "organism_scope": "multi-organism",
        "antibiotic_scope": "multi-antibiotic",
        "status": "validated" if should_promote else "rejected",
        "model_path": f"backend/data/ml_research/models/{candidate_version}.joblib",
        "vocabulary_path": f"backend/data/ml_research/models/{candidate_version}_vocab.json",
        "model_type": "Conditioned Logistic Regression (L2)",
        "algorithm": "Conditioned Logistic Regression (L2)",
        "threshold": 0.50,
        "feature_count": len(full_vocab),
        "n_isolates": len(isolates),
        "total_observations": len(instances),
        "supported_organisms": org_vocab,
        "supported_antibiotics": abx_vocab,
        "validation_metrics": candidate_metrics,
        "training_release": SOURCE_RELEASE,
        "dataset_version": DATASET_VERSION,
        "research_only": True,
        "rejection_reason": "; ".join(gate_failures) if not passed_gates else (
            f"F1 ({f1:.4f}) did not improve upon active model F1 ({current_f1:.4f})" if not improved_or_equal else None
        ),
        "created_at": cycle_start
    }

    # Update registry
    with open(_ML_RESEARCH_DIR / "model_registry.json", "r", encoding="utf-8") as f:
        reg_data = json.load(f)

    reg_data["models"][candidate_version] = candidate_entry
    if should_promote:
        reg_data["active_broad_model"] = candidate_version
        action = "promoted"
    else:
        action = "retained_previous"

    reg_data["last_updated"] = datetime.now(timezone.utc).isoformat()
    with open(_ML_RESEARCH_DIR / "model_registry.json", "w", encoding="utf-8") as f:
        json.dump(reg_data, f, indent=2)

    result = {
        "timestamp": cycle_start,
        "candidate_version": candidate_version,
        "previous_active_version": current_version,
        "active_model_now": reg_data["active_broad_model"],
        "action": action,
        "promoted": should_promote,
        "gates_passed": passed_gates,
        "gate_failures": gate_failures,
        "candidate_metrics": candidate_metrics,
        "previous_f1": current_f1,
        "candidate_f1": f1,
        "total_training_instances": len(train_instances),
        "total_test_instances": len(test_instances)
    }

    _append_retraining_log(result)
    return result


def rollback_broad_model(target_model_version: str) -> Dict[str, Any]:
    """
    Instantly roll back the active broad model to any previously registered version.
    """
    reg = load_registry()
    with open(_ML_RESEARCH_DIR / "model_registry.json", "r", encoding="utf-8") as f:
        reg_data = json.load(f)

    if target_model_version not in reg_data.get("models", {}):
        return {
            "status": "error",
            "message": f"Model {target_model_version} does not exist in registry"
        }

    target_entry = reg_data["models"][target_model_version]
    if target_entry.get("status") != "validated":
        return {
            "status": "error",
            "message": f"Cannot roll back to unvalidated model {target_model_version}"
        }

    previous = reg_data.get("active_broad_model")
    reg_data["active_broad_model"] = target_model_version
    reg_data["last_updated"] = datetime.now(timezone.utc).isoformat()

    with open(_ML_RESEARCH_DIR / "model_registry.json", "w", encoding="utf-8") as f:
        json.dump(reg_data, f, indent=2)

    log_entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "action": "rollback",
        "previous_model": previous,
        "active_model_now": target_model_version,
    }
    _append_retraining_log(log_entry)

    return {
        "status": "success",
        "action": "rollback",
        "previous_model": previous,
        "active_model_now": target_model_version,
    }

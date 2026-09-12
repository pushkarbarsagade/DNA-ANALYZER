"""
scripts/train_amr_models.py

Phase 11 — Automated AMR Model Discovery, Training & Validation CLI.

Discovers eligible (organism, antibiotic) combinations from NCBI Pathogen
Detection data (via BigQuery or local datasets), evaluates quality gates,
trains Logistic Regression models with grouped isolate splitting, and
registers passing models in the dynamic Model Registry.

Usage:
    python scripts/train_amr_models.py --discover
    python scripts/train_amr_models.py --train-all
    python scripts/train_amr_models.py --organism "Klebsiella pneumoniae" --antibiotic "Ceftriaxone"
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

# Ensure project root is on sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
BACKEND_DIR = PROJECT_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from backend.services.amr_model_registry import (
    list_models, load_registry, normalize_organism_key, normalize_antibiotic_key
)
from backend.services.amr_ml_dataset import discover_candidates, build_dataset_for_scope
from backend.services.amr_ml_trainer import train_and_validate_candidate

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def run_discovery_report(
    raw_records: Optional[List[Dict[str, Any]]] = None,
    min_isolates: int = 100,
    min_minority: int = 20
) -> List[Dict[str, Any]]:
    """Discover candidate combinations and print structured report."""
    print("=" * 70)
    print("NCBI PATHOGEN DETECTION — AMR MODEL CANDIDATE DISCOVERY")
    print("=" * 70)
    print(f"Filters: min_total_isolates={min_isolates}, min_minority_class={min_minority}")
    print("-" * 70)

    candidates = discover_candidates(
        raw_isolate_records=raw_records,
        min_total_isolates=min_isolates,
        min_per_class=min_minority,
        use_bigquery=(raw_records is None)
    )

    if not candidates:
        print("No combinations discovered (BigQuery unconfigured or empty dataset).")
        return []

    eligible_count = sum(1 for c in candidates if c["eligible"])
    ineligible_count = len(candidates) - eligible_count

    print(f"{'Organism':<28} | {'Antibiotic':<18} | {'Total':<6} | {'S':<5} | {'R':<5} | {'Eligible'}")
    print("-" * 75)
    for c in candidates[:40]:
        status_str = "YES" if c["eligible"] else f"NO ({c.get('rejection_reason', '')[:20]})"
        print(f"{c['organism']:<28} | {c['antibiotic']:<18} | {c['total_usable_isolates']:<6} | {c['susceptible_count']:<5} | {c['resistant_count']:<5} | {status_str}")

    print("-" * 75)
    print(f"Summary: {len(candidates)} combinations evaluated | {eligible_count} eligible | {ineligible_count} rejected")
    return candidates


def run_training_pipeline(
    candidates: List[Dict[str, Any]],
    raw_records: Optional[List[Dict[str, Any]]] = None,
    target_organism: Optional[str] = None,
    target_antibiotic: Optional[str] = None,
    dry_run: bool = False
) -> Dict[str, Any]:
    """Train and validate eligible candidate combinations."""
    print("\n" + "=" * 70)
    print("AUTOMATED AMR MODEL TRAINING & VALIDATION PIPELINE")
    print("=" * 70)

    eligible = [c for c in candidates if c["eligible"]]
    if target_organism:
        eligible = [c for c in eligible if target_organism.lower() in c["organism"].lower()]
    if target_antibiotic:
        eligible = [c for c in eligible if target_antibiotic.lower() in c["antibiotic"].lower()]

    print(f"Targeting {len(eligible)} eligible combination(s) for training.")

    results = {"attempted": 0, "passed": 0, "failed": 0, "models": []}

    for c in eligible:
        org = c["organism"]
        abx = c["antibiotic"]
        if normalize_organism_key(org) == "escherichia_coli" and normalize_antibiotic_key(abx) == "ampicillin":
            print(f"\n[PROTECTED] {org} + {abx} is the frozen baseline model (AMR-ML-ECOLI-AMP-v0.1). Preserving exact baseline.")
            continue
        print(f"\n[TRAINING] {org} + {abx} (N={c['total_usable_isolates']}, S={c['susceptible_count']}, R={c['resistant_count']})...")
        results["attempted"] += 1

        if raw_records is None:
            print("  Skipped: Full raw record stream required for matrix building.")
            continue

        dataset = build_dataset_for_scope(org, abx, raw_records, exclude_benchmark=True)
        train_res = train_and_validate_candidate(dataset)

        if train_res["status"] == "validated":
            results["passed"] += 1
            metrics = train_res.get("metrics", {})
            print(f"  --> VALIDATED: Version={train_res['model_version']}")
            print(f"      Accuracy={metrics.get('accuracy')} | Sens={metrics.get('sensitivity')} | Spec={metrics.get('specificity')} | F1={metrics.get('f1')} | AUC={metrics.get('roc_auc')}")
            results["models"].append(train_res["model_version"])
        else:
            results["failed"] += 1
            print(f"  --> REJECTED: {', '.join(train_res.get('gate_failures', []))}")

    print("\n" + "=" * 70)
    print(f"TRAINING COMPLETE: {results['attempted']} Attempted | {results['passed']} Passed | {results['failed']} Failed")
    print("=" * 70)
    return results


def print_registry_status():
    """Print the current Model Registry contents."""
    reg = load_registry(force_reload=True)
    models = list_models(status=None)
    print("\n" + "=" * 70)
    print("CURRENT AMR MODEL REGISTRY STATUS")
    print("=" * 70)
    print(f"Total Registered Models: {len(models)}")
    print(f"Active Scopes: {len(reg.get('active_models', {}))}")
    print("-" * 70)
    for m in models:
        m_id = m.get("model_id")
        status = m.get("status")
        scope = f"{m.get('organism')} + {m.get('antibiotic')}"
        mets = m.get("validation_metrics", {})
        acc = mets.get("accuracy", "N/A")
        f1 = mets.get("f1", "N/A")
        print(f"[{status.upper()}] {m_id:<28} | {scope:<32} | Acc={acc} | F1={f1}")
    print("=" * 70)


def main():
    parser = argparse.ArgumentParser(description="AMR Multi-Organism / Multi-Antibiotic Training Pipeline")
    parser.add_argument("--discover", action="store_true", help="Run candidate discovery and print report")
    parser.add_argument("--train-all", action="store_true", help="Train all eligible candidate combinations")
    parser.add_argument("--organism", type=str, default=None, help="Filter target organism")
    parser.add_argument("--antibiotic", type=str, default=None, help="Filter target antibiotic")
    parser.add_argument("--min-isolates", type=int, default=100, help="Minimum total isolates threshold")
    parser.add_argument("--min-minority", type=int, default=20, help="Minimum minority class threshold")
    parser.add_argument("--data-file", type=str, default=None, help="Path to local JSON dataset file")
    parser.add_argument("--status", action="store_true", help="Print model registry status")
    args = parser.parse_args()

    raw_records = None
    if args.data_file and Path(args.data_file).exists():
        with open(args.data_file, "r", encoding="utf-8") as f:
            raw_records = json.load(f)
        print(f"Loaded {len(raw_records)} isolate records from {args.data_file}")

    if args.status or (not args.discover and not args.train_all and not args.organism and not args.antibiotic):
        print_registry_status()
        if not args.discover and not args.train_all:
            return

    candidates = run_discovery_report(
        raw_records=raw_records,
        min_isolates=args.min_isolates,
        min_minority=args.min_minority
    )

    if args.train_all or args.organism or args.antibiotic:
        run_training_pipeline(
            candidates=candidates,
            raw_records=raw_records,
            target_organism=args.organism,
            target_antibiotic=args.antibiotic
        )
        print_registry_status()


if __name__ == "__main__":
    main()

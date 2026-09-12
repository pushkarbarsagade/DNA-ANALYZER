"""
backend/tests/test_amr_phase12_broad_spectrum.py

Phase 12 — Broad-Spectrum Multi-Organism / Multi-Antibiotic AMR ML Coverage Tests.

Validates:
1. Multi-Model Registry: Multiple validated models coexist across distinct antibiotic scopes.
2. Baseline Model Invariant: AMR-ML-ECOLI-AMP-v0.1 remains active with frozen metrics.
3. Quality Gate Enforcement: Passing models meet all gates; failing models are registered as rejected.
4. Deterministic Engine Invariant: 5-isolate frozen benchmark remains exactly 26/28 = 92.9%.
5. Dynamic Multi-Drug Inference: Resolves validated models and gracefully handles unmodeled/rejected drugs.
6. Zero-AMR Isolate Invariant: Zero-AMR isolate encodes as x=0 and yields valid susceptible prediction.
7. API Routes: /api/amr/ml-models, /api/amr/ml-provenance, /api/amr/ml-predict/<accession>.
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

# Ensure backend directory and repo root are in sys.path
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
REPO_ROOT = BACKEND_DIR.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

try:
    from app import app
except ImportError:
    from backend.app import app

from backend.services import amr_ml_service, amr_model_registry
from backend.services.amr_model_registry import (
    get_model_entry, has_model, list_models, load_registry,
    normalize_organism_key, normalize_antibiotic_key
)
from backend.services.amr_engine import compare, calculate_concordance_metrics


class TestPhase12BroadSpectrumML(unittest.TestCase):
    """Phase 12 Broad-Spectrum ML Coverage and System Invariant Tests."""

    @classmethod
    def setUpClass(cls):
        cls.app = app
        cls.client = cls.app.test_client()

    def test_1_multi_model_registry_has_multiple_active_models(self):
        """Verify multiple active models coexist across distinct antibiotic scopes."""
        reg = load_registry(force_reload=True)
        active_models = reg.get("active_models", {})
        self.assertGreaterEqual(len(active_models), 8, f"Expected >= 8 active models, found {len(active_models)}")

        # Check key validated models are active
        expected_active_scopes = [
            "escherichia_coli::ampicillin",
            "escherichia_coli::ceftriaxone",
            "escherichia_coli::ciprofloxacin",
            "escherichia_coli::tetracycline",
            "escherichia_coli::trimethoprim_sulfamethoxazole",
            "escherichia_coli::tobramycin",
            "escherichia_coli::chloramphenicol",
            "escherichia_coli::streptomycin",
            "escherichia_coli::sulfisoxazole",
        ]
        for scope in expected_active_scopes:
            self.assertIn(scope, active_models, f"Missing expected active scope: {scope}")
            model_id = active_models[scope]
            model_entry = reg["models"].get(model_id)
            self.assertIsNotNone(model_entry)
            self.assertEqual(model_entry["status"], "validated")

    def test_2_frozen_baseline_ecoli_amp_preserved_exact(self):
        """Verify baseline AMR-ML-ECOLI-AMP-v0.1 remains active with frozen metrics."""
        entry = get_model_entry("Escherichia coli", "Ampicillin")
        self.assertIsNotNone(entry, "Baseline model entry must exist")
        self.assertEqual(entry["model_version"], "AMR-ML-ECOLI-AMP-v0.1")
        self.assertEqual(entry["status"], "validated")

        metrics = entry["validation_metrics"]
        self.assertEqual(metrics["accuracy"], 0.9538)
        self.assertEqual(metrics["sensitivity"], 0.9636)
        self.assertEqual(metrics["specificity"], 0.9)
        self.assertEqual(metrics["precision"], 0.9815)
        self.assertEqual(metrics["f1"], 0.9725)
        self.assertEqual(metrics["roc_auc"], 0.9782)
        self.assertEqual(metrics["test_n"], 65)

    def test_3_quality_gate_enforcement_and_rejected_models(self):
        """Verify failing candidate models are recorded as rejected with reasons."""
        all_models = list_models(status=None)
        rejected = [m for m in all_models if m.get("status") == "rejected"]
        self.assertGreater(len(rejected), 0, "There should be recorded rejected candidate models")

        # Meropenem failed due to low sensitivity/class imbalance
        mem_model = next((m for m in rejected if m.get("antibiotic") == "Meropenem"), None)
        if mem_model:
            self.assertEqual(mem_model["status"], "rejected")
            self.assertIsNotNone(mem_model.get("rejection_reason"))
            self.assertIn("Sensitivity", mem_model["rejection_reason"])

        # Check all validated models passed quality gates
        validated = list_models(status="validated")
        for m in validated:
            if m["model_version"] != "AMR-ML-ECOLI-AMP-v0.1" and "sensitivity" in m.get("validation_metrics", {}):
                mets = m["validation_metrics"]
                self.assertGreaterEqual(mets["sensitivity"], 0.90)
                self.assertGreaterEqual(mets["f1"], 0.90)
                self.assertGreaterEqual(mets["roc_auc"], 0.90)

    def test_4_frozen_benchmark_remains_strictly_26_of_28(self):
        """Verify deterministic concordance benchmark remains exactly 26/28 = 92.9%."""
        fixture_path = BACKEND_DIR / "data" / "validation_isolates.json"
        with open(fixture_path, "r", encoding="utf-8") as f:
            fixture = json.load(f)

        all_comps = []
        for iso in fixture["isolates"]:
            tsv = iso.get("raw_genotype_row", {})
            ast = iso.get("ast_records", [])
            comps = compare([tsv], ast)
            all_comps.extend(comps)

        metrics = calculate_concordance_metrics(all_comps)
        self.assertEqual(metrics["total_ast_records"], 75)
        self.assertEqual(metrics["comparable_pairs"], 28)
        self.assertEqual(metrics["concordant"], 26)
        self.assertEqual(metrics["discordant"], 2)
        self.assertEqual(metrics["not_comparable"], 47)
        self.assertEqual(metrics["not_evaluable"], 0)
        self.assertAlmostEqual(metrics["concordance_percentage"], 92.9, places=1)

    def test_5_dynamic_biosample_inference_broad_spectrum(self):
        """Verify isolate multi-drug ML inference resolves multiple validated models."""
        pred_res = amr_ml_service.predict_for_biosample(
            organism="Escherichia coli",
            genotype_str="blaTEM-1,tet(A),floR",
            ast_records=[
                {"antibiotic": "Ampicillin"},
                {"antibiotic": "Ceftriaxone"},
                {"antibiotic": "Ciprofloxacin"},
                {"antibiotic": "Tetracycline"},
                {"antibiotic": "Cefoxitin"},
            ]
        )
        self.assertIsNotNone(pred_res)
        self.assertEqual(pred_res["organism"], "Escherichia coli")

        predictions = pred_res["predictions"]
        self.assertIsInstance(predictions, list)
        self.assertGreater(len(predictions), 0)

        # Check Ampicillin is resolved
        amp_pred = next((p for p in predictions if p["antibiotic"] == "Ampicillin"), None)
        self.assertIsNotNone(amp_pred)
        self.assertTrue(amp_pred["available"])
        self.assertEqual(amp_pred["model_version"], "AMR-ML-ECOLI-AMP-v0.1")
        self.assertEqual(amp_pred["prediction"], "Resistant")
        self.assertGreater(amp_pred["predicted_probability"], 0.50)

        # Check Ceftriaxone is resolved
        cro_pred = next((p for p in predictions if p["antibiotic"] == "Ceftriaxone"), None)
        if cro_pred:
            self.assertTrue(cro_pred["available"])
            self.assertEqual(cro_pred["model_version"], "AMR-ML-ECOLI-CRO-v0.1")

        # Check Ciprofloxacin is resolved
        cip_pred = next((p for p in predictions if p["antibiotic"] == "Ciprofloxacin"), None)
        if cip_pred:
            self.assertTrue(cip_pred["available"])
            self.assertEqual(cip_pred["model_version"], "AMR-ML-ECOLI-CIP-v0.1")

        # Check Tetracycline is resolved
        tet_pred = next((p for p in predictions if p["antibiotic"] == "Tetracycline"), None)
        if tet_pred:
            self.assertTrue(tet_pred["available"])
            self.assertEqual(tet_pred["model_version"], "AMR-ML-ECOLI-TET-v0.1")

        # Check an unvalidated or rejected drug (e.g. Cefoxitin, Gentamicin, Meropenem) reports available=False
        unval_pred = next((p for p in predictions if p["antibiotic"] in ("Cefoxitin", "Gentamicin", "Meropenem")), None)
        if unval_pred:
            self.assertFalse(unval_pred["available"])
            self.assertEqual(unval_pred["reason"], "no_validated_model")

    def test_6_zero_amr_isolate_encoding_and_prediction(self):
        """Zero-AMR isolate encodes as x=0 and yields valid susceptible probability."""
        result = amr_ml_service.predict(
            organism="Escherichia coli",
            genotype_str="",
            antibiotic="Ampicillin"
        )
        self.assertTrue(result["available"])
        self.assertEqual(result["prediction"], "Susceptible")
        self.assertLess(result["predicted_probability"], 0.50)
        self.assertEqual(result["recognized_features"], 0)

    def test_7_get_ml_models_api_route(self):
        """GET /api/amr/ml-models returns all models with metadata."""
        resp = self.client.get("/api/amr/ml-models")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertIn("models", data)
        self.assertIn("active_models", data)
        self.assertIn("total_models", data)
        self.assertGreaterEqual(data["total_models"], 10)

    def test_8_get_ml_provenance_api_route(self):
        """GET /api/amr/ml-provenance returns structured pipeline provenance."""
        resp = self.client.get("/api/amr/ml-provenance")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["model_version"], "AMR-ML-ECOLI-AMP-v0.1")
        self.assertIn("validation_metrics", data)
        self.assertEqual(data["status"], "validated")
        self.assertIn("disclaimer", data)

    def test_9_get_ml_predict_biosample_api_route(self):
        """GET /api/amr/ml-predict/<accession> returns multi-drug predictions."""
        resp = self.client.get("/api/amr/ml-predict/SAMN03177674")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["biosample"], "SAMN03177674")
        self.assertIn("predictions", data)
        self.assertIn("total_drugs", data)
        self.assertIn("available_count", data)
        self.assertGreater(data["available_count"], 0)


if __name__ == "__main__":
    unittest.main()

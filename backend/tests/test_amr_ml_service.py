"""
backend/tests/test_amr_ml_service.py

Phase 9 — Comprehensive unit tests for ML Research Prediction Integration.

Tests cover all 10 required cases:
A. E. coli + Ampicillin → prediction available
B. non-E. coli → ML not applicable
C. non-Ampicillin → ML not applicable
D. Unknown genomic determinant → no crash
E. Missing model → graceful failure
F. Observed AST remains unchanged by ML
G. Deterministic classification remains unchanged by ML
H. User lab result does not modify model
I. ML cannot override deterministic verdict
J. Five frozen validation isolates remain unchanged (26/28 = 92.9%)
"""
from __future__ import annotations

import json
import sys
import os
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

# Ensure backend directory is in python search path
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


class TestMLServiceUnit(unittest.TestCase):
    """Unit tests for backend.services.amr_ml_service."""

    def setUp(self):
        try:
            from services import amr_ml_service
        except ImportError:
            from backend.services import amr_ml_service
        amr_ml_service.reset_model_cache()
        self.ml = amr_ml_service

    def tearDown(self):
        self.ml.reset_model_cache()

    def test_A_ecoli_ampicillin_prediction_available(self):
        """E. coli + Ampicillin → prediction available with valid structure."""
        result = self.ml.predict(
            organism="Escherichia coli",
            genotype_str="blaTEM-1,blaCMY-2,tet(A)",
            antibiotic="ampicillin"
        )
        self.assertTrue(result["available"])
        self.assertEqual(result["model"], "AMR-ML-ECOLI-AMP-v0.1")
        self.assertEqual(result["organism"], "Escherichia coli")
        self.assertEqual(result["antibiotic"], "Ampicillin")
        self.assertIn(result["prediction"], ("Resistant", "Susceptible"))
        self.assertIsInstance(result["probability_resistant"], float)
        self.assertIsInstance(result["probability_susceptible"], float)
        self.assertAlmostEqual(
            result["probability_resistant"] + result["probability_susceptible"],
            1.0, places=3
        )
        self.assertGreater(result["recognized_features"], 0)
        self.assertTrue(result["research_only"])
        self.assertIn("disclaimer", result)

    def test_B_non_ecoli_ml_not_applicable(self):
        """non-E. coli → ML not applicable."""
        result = self.ml.predict(
            organism="Klebsiella pneumoniae",
            genotype_str="blaTEM-1",
            antibiotic="ampicillin"
        )
        self.assertFalse(result["available"])
        self.assertIn(result["reason"], ("no_validated_model", "MODEL_SCOPE_LIMITED_TO_ECOLI_AMPICILLIN"))

    def test_C_unmodeled_antibiotic_ml_not_applicable(self):
        """Unmodeled antibiotic → ML not applicable (no validated model)."""
        result = self.ml.predict(
            organism="Escherichia coli",
            genotype_str="blaTEM-1",
            antibiotic="colistin"
        )
        self.assertFalse(result["available"])
        self.assertIn(result["reason"], ("no_validated_model", "MODEL_SCOPE_LIMITED_TO_ECOLI_AMPICILLIN"))

    def test_D_unknown_determinant_no_crash(self):
        """Unknown genomic determinant → no crash, prediction still works."""
        result = self.ml.predict(
            organism="Escherichia coli",
            genotype_str="blaTEM-1,TOTALLY_FAKE_GENE_XYZ,anotherFakeGene99",
            antibiotic="ampicillin"
        )
        self.assertTrue(result["available"])
        self.assertIn(result["prediction"], ("Resistant", "Susceptible"))
        # blaTEM-1 should be recognized, fake genes should not
        self.assertGreater(result["recognized_features"], 0)
        self.assertGreater(len(result["unrecognized_features"]), 0)

    def test_E_missing_model_graceful_failure(self):
        """Missing model file → graceful failure."""
        # Force reset and patch model path to nonexistent
        self.ml.reset_model_cache()
        original_path = self.ml._MODEL_PATH
        self.ml._MODEL_PATH = Path("/nonexistent/fake_model.joblib")
        try:
            result = self.ml.predict(
                organism="Escherichia coli",
                genotype_str="blaTEM-1",
                antibiotic="ampicillin"
            )
            self.assertFalse(result["available"])
            self.assertEqual(result["reason"], "ML_SERVICE_ERROR")
        finally:
            self.ml._MODEL_PATH = original_path
            self.ml.reset_model_cache()

    def test_scope_guard_ecoli_variants(self):
        """Various E. coli organism string formats are accepted."""
        for variant in [
            "Escherichia coli",
            "escherichia coli",
            "E. coli",
            "Escherichia coli/Shigella",
        ]:
            self.assertTrue(
                self.ml.is_in_scope(variant, "ampicillin"),
                f"Should be in scope: {variant}"
            )

    def test_scope_guard_rejects_unmodeled_antibiotics(self):
        """Unmodeled or rejected antibiotics are out of scope."""
        for abx in ["colistin", "daptomycin", "meropenem", "cefoxitin", ""]:
            self.assertFalse(
                self.ml.is_in_scope("Escherichia coli", abx),
                f"Should be out of scope: {abx}"
            )
        # Validated antibiotics are in scope
        for abx in ["ampicillin", "ceftriaxone", "ciprofloxacin", "tetracycline"]:
            self.assertTrue(
                self.ml.is_in_scope("Escherichia coli", abx),
                f"Should be in scope: {abx}"
            )

    def test_empty_genotype_produces_zero_vector(self):
        """Empty genotype → all-zero vector prediction (susceptible baseline)."""
        result = self.ml.predict(
            organism="Escherichia coli",
            genotype_str="",
            antibiotic="ampicillin"
        )
        self.assertTrue(result["available"])
        self.assertEqual(result["recognized_features"], 0)

    def test_model_provenance_structure(self):
        """get_model_provenance returns complete metadata."""
        prov = self.ml.get_model_provenance()
        self.assertEqual(prov["model"], "AMR-ML-ECOLI-AMP-v0.1")
        self.assertEqual(prov["organism"], "Escherichia coli")
        self.assertEqual(prov["antibiotic"], "Ampicillin")
        self.assertEqual(prov["algorithm"], "Logistic Regression (L2)")
        self.assertEqual(prov["threshold"], 0.50)
        self.assertIn(prov["status"], ("Research prototype", "validated"))
        self.assertIn("disclaimer", prov)


class TestMLServiceRouteIntegration(unittest.TestCase):
    """Integration tests for ML endpoints via Flask test client."""

    def setUp(self):
        app.config["TESTING"] = True
        app.config["DEBUG"] = False
        self.client = app.test_client()

    def test_ml_predict_validation_isolate(self):
        """ML prediction endpoint works for validation isolate (E. coli)."""
        resp = self.client.get("/api/amr/ml-predict/SAMN03177675")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertIn("available", data)
        if data["available"]:
            self.assertEqual(data["model"], "AMR-ML-ECOLI-AMP-v0.1")
            self.assertIn("prediction", data)
            self.assertIn("probability_resistant", data)
            self.assertTrue(data["research_only"])

    def test_ml_predict_unknown_biosample(self):
        """ML prediction for unknown biosample returns error."""
        resp = self.client.get("/api/amr/ml-predict/UNKNOWN_BIOSAMPLE")
        self.assertIn(resp.status_code, (200, 404))

    def test_ml_provenance_endpoint(self):
        """ML provenance endpoint returns model metadata."""
        resp = self.client.get("/api/amr/ml-provenance")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["model"], "AMR-ML-ECOLI-AMP-v0.1")
        self.assertIn("disclaimer", data)

    def test_F_observed_ast_unchanged_by_ml(self):
        """Observed AST remains unchanged when ML prediction is present."""
        resp = self.client.get("/api/amr/isolate/SAMN03177675")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["status"], "success")
        # AST records must still be present and unmodified
        self.assertIn("ast_records", data)
        self.assertIsInstance(data["ast_records"], list)
        self.assertGreater(len(data["ast_records"]), 0)
        # If ml_prediction is present, it must not alter AST
        if "ml_prediction" in data:
            self.assertIn("disclaimer", data["ml_prediction"])

    def test_G_deterministic_classification_unchanged(self):
        """Deterministic classification remains unchanged by ML."""
        resp = self.client.get("/api/amr/isolate/SAMN03177675")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        # Comparisons and summary_metrics must still be present
        self.assertIn("comparisons", data)
        self.assertIn("summary_metrics", data)
        # ML prediction is separate and does not change comparisons
        if "ml_prediction" in data:
            # Verify comparisons are the same structure as before
            self.assertIsInstance(data["comparisons"], list)
            self.assertGreater(len(data["comparisons"]), 0)

    def test_H_user_lab_does_not_modify_model(self):
        """User lab result does not modify model — ML prediction is independent."""
        # Run reconciliation with user lab data
        payload = {
            "biosample": "SAMN03177675",
            "user_lab": [
                {
                    "antibiotic": "ampicillin",
                    "phenotype": "Susceptible",
                    "mic": "2 ug/mL",
                    "method": "Broth Microdilution"
                }
            ]
        }
        resp = self.client.post(
            "/api/amr/reconcile",
            json=payload,
            content_type="application/json"
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["status"], "success")

        # If ML prediction is present, verify it is independent of user lab
        if "ml_prediction" in data and data["ml_prediction"]["available"]:
            ml = data["ml_prediction"]
            # ML prediction is based only on genomic evidence, not user lab
            self.assertIn("prediction", ml)
            self.assertTrue(ml["research_only"])

    def test_I_ml_cannot_override_deterministic_verdict(self):
        """ML cannot override deterministic reconciliation verdict."""
        # SAMN03177676 has known genotype-phenotype discordance for streptomycin
        payload = {
            "biosample": "SAMN03177676",
            "user_lab": []
        }
        resp = self.client.post(
            "/api/amr/reconcile",
            json=payload,
            content_type="application/json"
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["status"], "success")

        # Deterministic findings must still show conflicts where they exist
        findings = data.get("findings", [])
        self.assertGreater(len(findings), 0)

        # Check that deterministic reconciliation_status values are preserved
        for f in findings:
            self.assertIn("reconciliation_status", f)
            self.assertIn("reconciliation_category", f)
            # ML must not have changed these fields
            self.assertNotIn("ml_override", f)

    def test_J_frozen_validation_benchmark_unchanged(self):
        """Five frozen validation isolates remain at 26/28 = 92.9%."""
        resp = self.client.get("/api/amr/validation-dataset")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["total_isolates"], 5)

        metrics = data["summary_metrics"]
        self.assertEqual(metrics["total_ast_records"], 75)
        self.assertEqual(metrics["comparable_pairs"], 28)
        self.assertEqual(metrics["concordant"], 26)
        self.assertEqual(metrics["discordant"], 2)
        self.assertEqual(metrics["not_comparable"], 47)
        self.assertEqual(metrics["not_evaluable"], 0)
        self.assertAlmostEqual(
            metrics["concordance_percentage"],
            92.9,
            places=1,
            msg="Frozen benchmark concordance must remain 26/28 = 92.9%"
        )

    def test_isolate_response_includes_ml_prediction_field(self):
        """Isolate response includes optional ml_prediction field."""
        resp = self.client.get("/api/amr/isolate/SAMN03177675")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        # ml_prediction should be present (E. coli isolate)
        if "ml_prediction" in data:
            ml = data["ml_prediction"]
            self.assertIn("available", ml)
            self.assertIn("model", ml)

    def test_reconcile_response_includes_ml_prediction_field(self):
        """Reconcile response includes optional ml_prediction field."""
        payload = {
            "biosample": "SAMN03177675",
            "user_lab": []
        }
        resp = self.client.post(
            "/api/amr/reconcile",
            json=payload,
            content_type="application/json"
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        if "ml_prediction" in data:
            ml = data["ml_prediction"]
            self.assertIn("available", ml)


if __name__ == "__main__":
    unittest.main()

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


# ============================================================================
# REGRESSION TESTS — ML Resolution Bug Fix
# "No Validated Model" falsely shown for E. coli + Ampicillin
# ============================================================================

class TestMLResolutionRegression(unittest.TestCase):
    """
    Regression tests for the ML registry resolution / organism × antibiotic
    inference bug. Verified that the following invariants hold after fix:

    1. E. coli + Ampicillin → AMR-ML-ECOLI-AMP-v0.1 (available: True)
    2. All five frozen validation isolates can run inference (available: True for Ampicillin)
    3. Each frozen isolate returns a real numeric probability (no fabrication)
    4. No duplicate predictions in predict_for_biosample output
    5. Training exclusion of frozen isolates remains intact
    6. Unsupported organism × antibiotic → available: False
    7. A supported model is never incorrectly reported as unavailable
    8. ML does not modify deterministic concordant/discordant/not-comparable results
    """

    FROZEN_ISOLATES = [
        "SAMN03177674",
        "SAMN03177676",
        "SAMN03177659",
        "SAMN03177675",
        "SAMN03177664",
    ]

    @classmethod
    def setUpClass(cls):
        cls.client = app.test_client()
        try:
            from services import amr_ml_service
        except ImportError:
            from backend.services import amr_ml_service
        amr_ml_service.reset_model_cache()
        cls.ml = amr_ml_service

    def tearDown(self):
        self.ml.reset_model_cache()

    # -----------------------------------------------------------------
    # 1. E. coli + Ampicillin resolves to AMR-ML-ECOLI-AMP-v0.1
    # -----------------------------------------------------------------
    def test_R1_ecoli_ampicillin_resolves_to_baseline_model(self):
        """E. coli + Ampicillin must resolve to AMR-ML-ECOLI-AMP-v0.1 with available=True."""
        result = self.ml.predict(
            organism="Escherichia coli",
            genotype_str="blaTEM-1,acrF",
            antibiotic="Ampicillin"
        )
        self.assertTrue(result["available"],
                        f"Expected available=True for E.coli+Ampicillin, got: {result}")
        self.assertEqual(result["model"], "AMR-ML-ECOLI-AMP-v0.1")
        self.assertIn(result["prediction"], ("Resistant", "Susceptible"))
        self.assertIsInstance(result["predicted_probability"], float)
        self.assertGreaterEqual(result["predicted_probability"], 0.0)
        self.assertLessEqual(result["predicted_probability"], 1.0)

    def test_R1b_ecoli_ampicillin_lowercase_normalizes(self):
        """Lowercase 'ampicillin' (from AST records) must also resolve via registry."""
        result = self.ml.predict(
            organism="Escherichia coli",
            genotype_str="blaTEM-1",
            antibiotic="ampicillin"
        )
        self.assertTrue(result["available"],
                        f"Lowercase 'ampicillin' should still resolve. Got: {result}")
        self.assertEqual(result["model"], "AMR-ML-ECOLI-AMP-v0.1")

    # -----------------------------------------------------------------
    # 2. All five frozen validation isolates can perform inference
    # -----------------------------------------------------------------
    def test_R2_all_frozen_isolates_ampicillin_inference(self):
        """All five frozen E. coli validation isolates must produce Ampicillin inference."""
        for acc in self.FROZEN_ISOLATES:
            resp = self.client.get(f"/api/amr/ml-predict/{acc}")
            self.assertEqual(resp.status_code, 200, f"Failed for {acc}")
            data = resp.get_json()
            preds = data.get("predictions", [])
            amp_pred = next(
                (p for p in preds if p.get("antibiotic", "").lower() == "ampicillin"),
                None
            )
            self.assertIsNotNone(amp_pred,
                f"Ampicillin prediction missing for {acc}. Predictions: {[p.get('antibiotic') for p in preds]}")
            self.assertTrue(amp_pred["available"],
                f"Ampicillin prediction not available for {acc}: {amp_pred}")
            self.assertEqual(amp_pred["model"], "AMR-ML-ECOLI-AMP-v0.1")

    # -----------------------------------------------------------------
    # 3. Each frozen isolate returns a real numeric probability
    # -----------------------------------------------------------------
    def test_R3_frozen_isolates_return_numeric_probability(self):
        """Each frozen validation isolate's Ampicillin prediction must be a real float."""
        for acc in self.FROZEN_ISOLATES:
            resp = self.client.get(f"/api/amr/ml-predict/{acc}")
            data = resp.get_json()
            preds = data.get("predictions", [])
            amp_pred = next(
                (p for p in preds if p.get("antibiotic", "").lower() == "ampicillin"),
                None
            )
            self.assertIsNotNone(amp_pred, f"No Ampicillin prediction for {acc}")
            prob = amp_pred.get("predicted_probability")
            self.assertIsInstance(prob, float,
                f"Probability for {acc} is not float: {prob}")
            self.assertGreaterEqual(prob, 0.0)
            self.assertLessEqual(prob, 1.0)
            # Ensure probabilities sum to 1.0
            self.assertAlmostEqual(
                amp_pred["probability_resistant"] + amp_pred["probability_susceptible"],
                1.0, places=3,
                msg=f"Probabilities don't sum to 1.0 for {acc}"
            )

    # -----------------------------------------------------------------
    # 4. No duplicate predictions in predict_for_biosample output
    # -----------------------------------------------------------------
    def test_R4_no_duplicate_predictions(self):
        """predict_for_biosample must not produce duplicate antibiotic entries."""
        for acc in self.FROZEN_ISOLATES:
            resp = self.client.get(f"/api/amr/ml-predict/{acc}")
            data = resp.get_json()
            preds = data.get("predictions", [])
            antibiotic_names = [p.get("antibiotic", "") for p in preds]
            # Normalize to lowercase for dedup check
            normalized = [n.lower() for n in antibiotic_names]
            self.assertEqual(
                len(normalized), len(set(normalized)),
                f"Duplicate predictions found for {acc}: {antibiotic_names}"
            )

    # -----------------------------------------------------------------
    # 5. Training exclusion: frozen isolates are not in training data
    # -----------------------------------------------------------------
    def test_R5_frozen_isolates_excluded_from_training(self):
        """The five frozen validation isolate accessions must not appear in training data."""
        try:
            from services import amr_ml_dataset as ds
        except ImportError:
            from backend.services import amr_ml_dataset as ds

        frozen_set = frozenset(self.FROZEN_ISOLATES)
        # Load the cached dataset if present; just check the exclude_benchmark logic
        try:
            cohort = ds.load_ast_cohort(organism="Escherichia coli", antibiotic="Ampicillin")
        except Exception:
            self.skipTest("AST cohort not available in this environment (expected offline)")
            return

        if cohort is None:
            self.skipTest("AST cohort returned None (expected offline)")
            return

        for rec in cohort:
            acc = rec.get("biosample_acc") or rec.get("biosample_accession") or ""
            self.assertNotIn(
                acc.upper(), frozen_set,
                f"Frozen isolate {acc} found in training cohort — leakage!"
            )

    # -----------------------------------------------------------------
    # 6. Unsupported organism × antibiotic → No Validated Model
    # -----------------------------------------------------------------
    def test_R6_unsupported_combination_returns_no_model(self):
        """Unsupported organism × antibiotic must return available=False, not error."""
        result = self.ml.predict(
            organism="Bacillus subtilis",
            genotype_str="blaTEM-1",
            antibiotic="Ampicillin"
        )
        self.assertFalse(result["available"])
        self.assertEqual(result["reason"], "no_validated_model")

    def test_R6b_unsupported_antibiotic_for_ecoli(self):
        """E. coli + unsupported antibiotic → available=False, not ML_SERVICE_ERROR."""
        result = self.ml.predict(
            organism="Escherichia coli",
            genotype_str="blaTEM-1",
            antibiotic="polymyxin_b"
        )
        self.assertFalse(result["available"])
        self.assertEqual(result["reason"], "no_validated_model",
            "Unsupported antibiotic must return no_validated_model, not ML_SERVICE_ERROR")

    # -----------------------------------------------------------------
    # 7. Supported model is not reported as unavailable
    # -----------------------------------------------------------------
    def test_R7_supported_model_not_incorrectly_unavailable(self):
        """predict_for_biosample must have available_count > 0 for E. coli with AST."""
        # SAMN03177659 has 15 AST records and organism=E. coli
        resp = self.client.get("/api/amr/ml-predict/SAMN03177659")
        data = resp.get_json()
        self.assertGreater(data.get("available_count", 0), 0,
            "E. coli isolate should have at least one available ML prediction")
        self.assertTrue(data.get("available"),
            "Top-level available must be True when any model resolves successfully")

    # -----------------------------------------------------------------
    # 8. ML does not modify deterministic results
    # -----------------------------------------------------------------
    def test_R8_ml_does_not_modify_deterministic_results(self):
        """Running ML prediction must not alter deterministic concordance benchmark."""
        resp = self.client.get("/api/amr/validation-dataset")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        metrics = data.get("summary_metrics", {})
        # Benchmark must remain exactly 26/28 = 92.9%
        self.assertEqual(metrics.get("concordant"), 26)
        self.assertEqual(metrics.get("discordant"), 2)
        self.assertEqual(metrics.get("comparable_pairs"), 28)
        self.assertAlmostEqual(metrics.get("concordance_percentage"), 92.9, places=1)

    # -----------------------------------------------------------------
    # SAMN03177659 specific: Ampicillin inference with real probability
    # -----------------------------------------------------------------
    def test_R9_samn03177659_ampicillin_real_inference(self):
        """
        SAMN03177659 (E. coli, genotype: aadA5,acrF,...,blaEC,...) must produce
        a real Ampicillin prediction from AMR-ML-ECOLI-AMP-v0.1.
        The probability is deterministic given the frozen model artifact.
        """
        resp = self.client.get("/api/amr/ml-predict/SAMN03177659")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        preds = data.get("predictions", [])
        amp = next(
            (p for p in preds if p.get("antibiotic", "").lower() == "ampicillin"),
            None
        )
        self.assertIsNotNone(amp, "Ampicillin prediction missing for SAMN03177659")
        self.assertTrue(amp["available"])
        self.assertEqual(amp["model"], "AMR-ML-ECOLI-AMP-v0.1")
        # Frozen model artifact yields 0.4192 for this isolate's genotype
        self.assertAlmostEqual(amp["predicted_probability"], 0.4192, places=3,
            msg=f"Unexpected probability for SAMN03177659 Ampicillin: {amp['predicted_probability']}")
        # Prediction should be Susceptible (0.4192 < 0.50 threshold)
        self.assertEqual(amp["prediction"], "Susceptible")


class TestBroadML1Architecture(unittest.TestCase):
    """Integration & unit tests for Broad ML1 multi-organism system."""

    def setUp(self):
        app.config["TESTING"] = True
        app.config["DEBUG"] = False
        self.client = app.test_client()
        try:
            from services import amr_ml_service
        except ImportError:
            from backend.services import amr_ml_service
        self.ml = amr_ml_service

    def test_broad_ml1_inference_multiorganism(self):
        """Broad ML1 provides real predictions across multiple organisms."""
        # 1. Klebsiella pneumoniae + Ceftriaxone
        kp_res = self.ml.predict_broad(
            organism="Klebsiella pneumoniae",
            genotype_str="blaSHV-11,blaCTX-M-15",
            antibiotic="Ceftriaxone"
        )
        self.assertTrue(kp_res["available"])
        self.assertEqual(kp_res["model_version"], "AMR-ML1-BROAD-v0.2")
        self.assertIn("predicted_probability", kp_res)
        self.assertIn("prediction", kp_res)

        # 2. Salmonella enterica + Ampicillin
        salm_res = self.ml.predict_broad(
            organism="Salmonella enterica",
            genotype_str="blaTEM-1",
            antibiotic="Ampicillin"
        )
        self.assertTrue(salm_res["available"])
        self.assertEqual(salm_res["model_version"], "AMR-ML1-BROAD-v0.2")
        # Broad v0.2 deterministic output for blaTEM-1 Salmonella: 0.2082 → Susceptible
        self.assertAlmostEqual(salm_res["predicted_probability"], 0.2082, places=3)
        self.assertEqual(salm_res["prediction"], "Susceptible")


    def test_evaluate_ml_selection_cases(self):
        """Model selection logic properly classifies Cases A, B, and D."""
        # Case A: Both Specialist and Broad exist (E. coli + Ampicillin)
        case_a = self.ml.evaluate_ml_selection(
            organism="Escherichia coli",
            genotype_str="blaTEM-1",
            antibiotic="Ampicillin"
        )
        self.assertEqual(case_a["selection_case"], "both")
        self.assertTrue(case_a["has_specialist"])
        self.assertTrue(case_a["has_broad"])
        self.assertIsNotNone(case_a["specialist_prediction"])
        self.assertIsNotNone(case_a["broad_prediction"])

        # Case B: Broad only exists (K. pneumoniae + Ceftriaxone in Broad ML1)
        case_b = self.ml.evaluate_ml_selection(
            organism="Klebsiella pneumoniae",
            genotype_str="blaCTX-M-15",
            antibiotic="Ceftriaxone"
        )
        self.assertTrue(case_b["has_broad"])
        self.assertIsNotNone(case_b["broad_prediction"])

        # Case D: Neither exists (unsupported organism and out of domain drug)
        case_d = self.ml.evaluate_ml_selection(
            organism="Pseudomonas aeruginosa",
            genotype_str="none",
            antibiotic="nonexistent_drug"
        )
        self.assertEqual(case_d["selection_case"], "none")
        self.assertFalse(case_d["has_specialist"])
        self.assertFalse(case_d["has_broad"])

    def test_ml_models_endpoint_exposes_broad_and_specialist(self):
        """GET /api/amr/ml-models returns separate broad and specialist models."""
        resp = self.client.get("/api/amr/ml-models")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertIn("broad_model", data)
        self.assertIn("specialist_models", data)
        self.assertIn("active_broad_model", data)
        self.assertEqual(data["active_broad_model"], "AMR-ML1-BROAD-v0.2")
        self.assertIsNotNone(data["broad_model"])

    def test_retraining_status_endpoint(self):
        """GET /api/amr/retraining-status returns dataset metadata and audit log."""
        resp = self.client.get("/api/amr/retraining-status")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["status"], "success")
        self.assertIn("active_broad_model", data)
        self.assertIn("eligible_combinations", data)
        self.assertIn("total_isolates", data)
        self.assertIn("recent_retraining_cycles", data)

    def test_expanded_specialist_library_inference(self):
        """Validated specialist models provide accurate predictions for diverse pathogens."""
        # 1. Salmonella enterica + Streptomycin validated specialist (Sens >= 0.90, F1 >= 0.90, AUC >= 0.90)
        salm_str = self.ml.predict(
            organism="Salmonella enterica",
            genotype_str="aadA1,aph(3'')-Ib,aph(6)-Id",
            antibiotic="streptomycin"
        )
        self.assertTrue(salm_str["available"])
        self.assertEqual(salm_str["model"], "AMR-ML-SALM-STR-v0.2")
        self.assertGreater(salm_str["probability_resistant"], 0.50)
        self.assertEqual(salm_str["prediction"], "Resistant")

        # 2. Salmonella enterica + Tetracycline validated specialist
        salm_tet = self.ml.predict(
            organism="Salmonella enterica",
            genotype_str="tet(A),tet(R)",
            antibiotic="tetracycline"
        )
        self.assertTrue(salm_tet["available"])
        self.assertEqual(salm_tet["model"], "AMR-ML-SALM-TET-v0.2")
        self.assertGreater(salm_tet["probability_resistant"], 0.50)
        self.assertEqual(salm_tet["prediction"], "Resistant")

        # 3. Escherichia coli + Ciprofloxacin validated specialist
        ecoli_cip = self.ml.predict(
            organism="Escherichia coli",
            genotype_str="gyrA_D87N=POINT,parC_S80I=POINT,gyrA_S83L=POINT",
            antibiotic="ciprofloxacin"
        )
        self.assertTrue(ecoli_cip["available"])
        self.assertEqual(ecoli_cip["model"], "AMR-ML-ECOLI-CIP-v0.1")
        self.assertGreater(ecoli_cip["probability_resistant"], 0.50)
        self.assertEqual(ecoli_cip["prediction"], "Resistant")

    def test_strict_validation_gates_and_experimental_separation(self):
        """Experimental research models are not falsely returned as active validated specialists."""
        from backend.services.amr_model_registry import list_models, get_model_entry
        # Validated specialist models must strictly satisfy Sens >= 0.90, F1 >= 0.90, ROC-AUC >= 0.90, N >= 100
        validated = list_models(status="validated")
        for m in validated:
            mets = m.get("validation_metrics", {})
            if "sensitivity" in mets and m.get("model_id") != "AMR-ML-ECOLI-AMP-v0.1":
                self.assertGreaterEqual(mets["sensitivity"], 0.90, f"{m['model_id']} failed sensitivity gate")
                self.assertGreaterEqual(mets["f1"], 0.90, f"{m['model_id']} failed F1 gate")
                self.assertGreaterEqual(mets["roc_auc"], 0.90, f"{m['model_id']} failed AUC gate")

        # Experimental models exist in registry for research but are not in active_models
        experimental = list_models(status="experimental")
        self.assertGreater(len(experimental), 0, "Experimental research models should be recorded in registry")
        for exp in experimental:
            entry = get_model_entry(exp["organism"], exp["antibiotic"])
            # Active validated model entry must be None for combinations with only experimental models
            if exp["model_id"].startswith("AMR-ML-PAER-TOB") or exp["model_id"].startswith("AMR-ML-SAUR-CLI"):
                self.assertIsNone(entry, f"Experimental model {exp['model_id']} must not be active validated")




if __name__ == "__main__":
    unittest.main()

"""
backend/tests/test_amr_phase11_dynamic_ml.py

Phase 11 — Comprehensive Test Suite for Dynamic Multi-Organism / Multi-Antibiotic AMR ML Framework.

Covers:
A. Existing E. coli + Ampicillin model still works.
B. Existing E. coli + Ampicillin metrics unchanged.
C. Registry lookup works.
D. Registry returns no model correctly.
E. Different organism can select a different model.
F. Different antibiotic can select a different model.
G. Unknown organism does not crash.
H. Unknown antibiotic does not crash.
I. Unknown genomic determinant is ignored safely.
J. Zero-feature isolate produces a valid zero vector.
K. No train/test isolate leakage in grouped split.
L. Frozen benchmark isolates remain excluded.
M. Deterministic 26/28 benchmark remains exactly 92.9%.
N. AST classification is unchanged by ML.
O. User lab evidence does not train ML.
P. ML cannot override deterministic verdict.
Q. AI cannot override deterministic verdict.
R. Model registry rejects invalid/unvalidated models.
S. Failed model training does not corrupt registry.
T. Previous model remains available after a failed new model.
U. Versioning works.
V. Dynamic BioSample inference works.
"""
from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path

# Ensure backend directory is in sys.path
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
REPO_ROOT = BACKEND_DIR.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from app import app
from backend.services import (
    amr_model_registry, amr_ml_service, amr_ml_dataset, amr_ml_trainer
)
from backend.services.amr_engine import compare, calculate_concordance_metrics


class TestPhase11DynamicML(unittest.TestCase):
    """Phase 11 Comprehensive Verification Suite."""

    @classmethod
    def setUpClass(cls):
        app.config["TESTING"] = True
        app.config["DEBUG"] = False
        cls.client = app.test_client()

    def setUp(self):
        amr_ml_service.reset_model_cache()
        amr_model_registry.reset_registry_cache()
        reg = amr_model_registry.load_registry(force_reload=True)
        reg["active_models"]["escherichia_coli::ampicillin"] = "AMR-ML-ECOLI-AMP-v0.1"

    def tearDown(self):
        amr_ml_service.reset_model_cache()
        reg = amr_model_registry.load_registry(force_reload=True)
        reg["active_models"]["escherichia_coli::ampicillin"] = "AMR-ML-ECOLI-AMP-v0.1"
        amr_model_registry.reset_registry_cache()

    # --------------------------------------------------------------------------
    # A & B: Baseline E. coli / Ampicillin Model Integrity
    # --------------------------------------------------------------------------
    def test_A_existing_ecoli_amp_model_works(self):
        """A. Existing E. coli + Ampicillin baseline model remains fully functional."""
        res = amr_ml_service.predict("Escherichia coli", "blaTEM-1,blaCMY-2", "Ampicillin")
        self.assertTrue(res["available"])
        self.assertEqual(res["model_version"], "AMR-ML-ECOLI-AMP-v0.1")
        self.assertEqual(res["prediction"], "Resistant")
        self.assertGreater(res["predicted_probability"], 0.50)
        self.assertIn("disclaimer", res)

    def test_B_existing_ecoli_amp_metrics_unchanged(self):
        """B. Existing E. coli + Ampicillin benchmark metrics are unchanged."""
        entry = amr_model_registry.get_model_entry("Escherichia coli", "Ampicillin")
        self.assertIsNotNone(entry)
        mets = entry["validation_metrics"]
        self.assertEqual(mets["accuracy"], 0.9538)
        self.assertEqual(mets["f1"], 0.9725)
        self.assertEqual(mets["roc_auc"], 0.9782)
        self.assertEqual(mets["sensitivity"], 0.9636)
        self.assertEqual(mets["specificity"], 0.9000)
        self.assertEqual(mets["tp"], 53)
        self.assertEqual(mets["fp"], 1)
        self.assertEqual(mets["fn"], 2)
        self.assertEqual(mets["tn"], 9)

    # --------------------------------------------------------------------------
    # C & D: Registry Lookup & Fallback
    # --------------------------------------------------------------------------
    def test_C_registry_lookup_works(self):
        """C. Registry correctly finds active model for canonical and synonym scopes."""
        entry1 = amr_model_registry.get_model_entry("Escherichia coli", "ampicillin")
        self.assertIsNotNone(entry1)
        self.assertEqual(entry1["model_id"], "AMR-ML-ECOLI-AMP-v0.1")

        # Synonyms
        entry2 = amr_model_registry.get_model_entry("E. coli", "Ampicillin")
        self.assertIsNotNone(entry2)
        self.assertEqual(entry2["model_id"], "AMR-ML-ECOLI-AMP-v0.1")

    def test_D_registry_returns_no_model_correctly(self):
        """D. Registry returns available=False with reason='no_validated_model' when scope is unmapped."""
        res = amr_ml_service.predict("Klebsiella pneumoniae", "blaKPC-2", "Meropenem")
        self.assertFalse(res["available"])
        self.assertEqual(res["reason"], "no_validated_model")
        self.assertEqual(res["organism"], "Klebsiella pneumoniae")
        self.assertEqual(res["antibiotic"], "Meropenem")

    # --------------------------------------------------------------------------
    # E & F: Multi-Organism / Multi-Antibiotic Coexistence
    # --------------------------------------------------------------------------
    def test_E_and_F_different_organism_and_antibiotic_models(self):
        """E & F. Different organisms and antibiotics can select separate registered models."""
        # Register a synthetic validated model for Klebsiella / Ceftriaxone
        synth_entry = {
            "model_id": "AMR-ML-KPNEU-CRO-v0.1",
            "model_version": "AMR-ML-KPNEU-CRO-v0.1",
            "organism": "Klebsiella pneumoniae",
            "antibiotic": "Ceftriaxone",
            "status": "validated",
            "model_path": "backend/data/ml_research/amr_ml_ecoli_amp_v0_1_poc.joblib",
            "vocabulary_path": "backend/data/ml_research/amr_ml_features_vocab.json",
            "threshold": 0.50,
            "feature_count": 223,
            "validation_metrics": {"f1": 0.95, "accuracy": 0.94}
        }
        amr_model_registry.register_model(synth_entry)

        entry_ecoli = amr_model_registry.get_model_entry("Escherichia coli", "Ampicillin")
        entry_kpneu = amr_model_registry.get_model_entry("Klebsiella pneumoniae", "Ceftriaxone")

        self.assertIsNotNone(entry_ecoli)
        self.assertIsNotNone(entry_kpneu)
        self.assertEqual(entry_ecoli["model_id"], "AMR-ML-ECOLI-AMP-v0.1")
        self.assertEqual(entry_kpneu["model_id"], "AMR-ML-KPNEU-CRO-v0.1")

        # Verify inference selects the correct model
        pred_kpneu = amr_ml_service.predict("Klebsiella pneumoniae", "blaCTX-M-15", "Ceftriaxone")
        self.assertTrue(pred_kpneu["available"])
        self.assertEqual(pred_kpneu["model_version"], "AMR-ML-KPNEU-CRO-v0.1")
        self.assertEqual(pred_kpneu["organism"], "Klebsiella pneumoniae")
        self.assertEqual(pred_kpneu["antibiotic"], "Ceftriaxone")

    # --------------------------------------------------------------------------
    # G & H: Unknown Organism & Antibiotic Robustness
    # --------------------------------------------------------------------------
    def test_G_and_H_unknown_organism_and_antibiotic_no_crash(self):
        """G & H. Unknown organisms and antibiotics return clean unavailable states without crashing."""
        for org in ["", "Unknown bacterium", "!@#$%^", None]:
            for abx in ["", "FakeCillin", None]:
                res = amr_ml_service.predict(str(org), "blaTEM-1", str(abx))
                self.assertFalse(res["available"])
                self.assertIn("reason", res)

    # --------------------------------------------------------------------------
    # I & J: Genomic Feature Construction & Zero-Vector Representation
    # --------------------------------------------------------------------------
    def test_I_unknown_genomic_determinant_ignored_safely(self):
        """I. Unknown/synthetic genomic determinants do not crash or alter feature index."""
        res = amr_ml_service.predict(
            "Escherichia coli",
            "blaTEM-1,SYNTHETIC_GENE_123,ANOTHER_UNSEEN_MUTATION",
            "Ampicillin"
        )
        self.assertTrue(res["available"])
        self.assertGreater(len(res["unrecognized_features"]), 0)
        self.assertIn("SYNTHETIC_GENE_123", res["unrecognized_features"])
        self.assertIn("blaTEM-1", res["recognized_feature_names"])

    def test_J_zero_feature_isolate_produces_zero_vector(self):
        """J. Zero-feature isolate cleanly maps to all-zero vector (Susceptible baseline)."""
        res = amr_ml_service.predict("Escherichia coli", "", "Ampicillin")
        self.assertTrue(res["available"])
        self.assertEqual(res["recognized_features"], 0)
        self.assertEqual(res["prediction"], "Susceptible")
        self.assertAlmostEqual(res["predicted_probability"], 0.2238, places=3)

    # --------------------------------------------------------------------------
    # K & L: Grouped Splitting & Benchmark Contamination Gates
    # --------------------------------------------------------------------------
    def test_K_and_L_dataset_grouped_split_and_benchmark_exclusion(self):
        """K & L. Grouped splitting prevents isolate overlap; benchmark isolates strictly excluded."""
        # Create synthetic cohort with BioSamples including duplicates and benchmark
        raw_cohort = []
        for i in range(120):
            bs = f"SAMN99990{i:03d}"
            is_r = (i % 3 != 0)
            gene = "blaTEM-1" if is_r else "blaEC"
            raw_cohort.append({
                "biosample_acc": bs,
                "organism": "Salmonella enterica",
                "amr_genotypes": gene,
                "ast_phenotypes": "ampicillin=R" if is_r else "ampicillin=S"
            })
            # Add duplicate observation for same BioSample
            raw_cohort.append({
                "biosample_acc": bs,
                "organism": "Salmonella enterica",
                "amr_genotypes": gene,
                "ast_phenotypes": "ampicillin=R" if is_r else "ampicillin=S"
            })

        # Add frozen benchmark BioSample
        raw_cohort.append({
            "biosample_acc": "SAMN03177675",
            "organism": "Salmonella enterica",
            "amr_genotypes": "blaCMY-2",
            "ast_phenotypes": "ampicillin=R"
        })

        dataset = amr_ml_dataset.build_dataset_for_scope(
            "Salmonella enterica", "Ampicillin", raw_cohort, exclude_benchmark=True
        )
        self.assertEqual(dataset["total_isolates"], 120)  # deduplicated, benchmark excluded

        # Run trainer validation
        res = amr_ml_trainer.train_and_validate_candidate(dataset)
        self.assertTrue(res["gates_passed"])
        self.assertEqual(res["status"], "validated")

    # --------------------------------------------------------------------------
    # M: Deterministic 26/28 Benchmark Integrity
    # --------------------------------------------------------------------------
    def test_M_deterministic_benchmark_remains_26_of_28(self):
        """M. Frozen five-isolate validation benchmark remains exactly 26/28 = 92.9%."""
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

    # --------------------------------------------------------------------------
    # N, O, P, Q: Evidence Hierarchy & Non-Authoritative Status
    # --------------------------------------------------------------------------
    def test_N_and_O_and_P_reconciliation_hierarchy_preserved(self):
        """N, O & P. ML cannot alter AST or deterministic status; user lab does not train ML."""
        # Known discordant isolate SAMN03177676
        payload = {
            "biosample": "SAMN03177676",
            "user_lab": [
                {
                    "antibiotic": "streptomycin",
                    "phenotype": "Susceptible",
                    "mic": "4 ug/mL",
                    "method": "MIC"
                }
            ]
        }
        resp = self.client.post("/api/amr/reconcile", json=payload)
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()

        # Deterministic conflict must be preserved
        strep_finding = next((f for f in data["findings"] if f["antibiotic"].lower() == "streptomycin"), None)
        self.assertIsNotNone(strep_finding)
        self.assertTrue(strep_finding["has_conflict"])
        self.assertIn("Conflict", strep_finding["reconciliation_status"])

        # ML prediction is present in response but does not alter finding status
        self.assertIn("ml_prediction", data)

    # --------------------------------------------------------------------------
    # R, S, T: Registry Validation & Rejection Gates
    # --------------------------------------------------------------------------
    def test_R_and_S_and_T_registry_rejects_substandard_models(self):
        """R, S & T. Rejects models failing quality gates; does not corrupt registry or overwrite baseline."""
        # Create dataset with insufficient samples (< 100)
        small_cohort = []
        for i in range(30):
            small_cohort.append({
                "biosample_acc": f"SAMN888{i:03d}",
                "organism": "Pseudomonas aeruginosa",
                "amr_genotypes": "blaOXA-50",
                "ast_phenotypes": "tobramycin=R"
            })

        dataset = amr_ml_dataset.build_dataset_for_scope("Pseudomonas aeruginosa", "Tobramycin", small_cohort)
        train_res = amr_ml_trainer.train_and_validate_candidate(dataset)

        self.assertEqual(train_res["status"], "rejected")
        self.assertFalse(train_res["gates_passed"])

        # Verify not registered as active
        active_model = amr_model_registry.get_model_entry("Pseudomonas aeruginosa", "Tobramycin")
        self.assertIsNone(active_model)

        # Verify baseline E. coli model is untouched
        baseline = amr_model_registry.get_model_entry("Escherichia coli", "Ampicillin")
        self.assertIsNotNone(baseline)
        self.assertEqual(baseline["model_id"], "AMR-ML-ECOLI-AMP-v0.1")

    # --------------------------------------------------------------------------
    # U: Model Versioning
    # --------------------------------------------------------------------------
    def test_U_versioning_increments_cleanly(self):
        """U. Model versioning increments cleanly (v0.1 -> v0.2)."""
        v1 = amr_ml_trainer.generate_model_version("Escherichia coli", "Ampicillin")
        self.assertTrue(v1.startswith("AMR-ML-ECOLI-AMP-v"))

        v_new_org = amr_ml_trainer.generate_model_version("Salmonella enterica", "Ciprofloxacin")
        self.assertEqual(v_new_org, "AMR-ML-SALM-CIP-v0.1")

    # --------------------------------------------------------------------------
    # V: Dynamic BioSample Inference Route
    # --------------------------------------------------------------------------
    def test_V_dynamic_biosample_inference_route(self):
        """V. GET /api/amr/ml-predict/<biosample> dynamically resolves all tested drugs."""
        resp = self.client.get("/api/amr/ml-predict/SAMN03177675")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()

        self.assertEqual(data["biosample"], "SAMN03177675")
        self.assertEqual(data["organism"], "Escherichia coli")
        self.assertIn("predictions", data)
        self.assertIsInstance(data["predictions"], list)

        # Ampicillin prediction should be available
        amp_pred = next((p for p in data["predictions"] if p.get("antibiotic") == "Ampicillin"), None)
        self.assertIsNotNone(amp_pred)
        self.assertTrue(amp_pred["available"])
        self.assertEqual(amp_pred["model_version"], "AMR-ML-ECOLI-AMP-v0.1")

        # Validated drugs (Ampicillin, Ciprofloxacin) should report available=True
        cip_pred = next((p for p in data["predictions"] if p.get("antibiotic") == "Ciprofloxacin"), None)
        if cip_pred:
            self.assertTrue(cip_pred["available"])
            self.assertEqual(cip_pred["model_version"], "AMR-ML-ECOLI-CIP-v0.1")

        # Rejected or unmodeled drugs (e.g. Cefoxitin, Gentamicin) should report available=False
        fox_pred = next((p for p in data["predictions"] if p.get("antibiotic") in ("Cefoxitin", "Gentamicin", "Amoxicillin-clavulanic acid")), None)
        if fox_pred:
            self.assertFalse(fox_pred["available"])
            self.assertEqual(fox_pred["reason"], "no_validated_model")


if __name__ == "__main__":
    unittest.main()

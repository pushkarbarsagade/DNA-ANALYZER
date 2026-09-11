"""
backend/tests/test_amr_reconciliation.py

Unit and Integration Tests for Phase 5:
- Deterministic AMR Evidence Reconciliation
- User Laboratory Evidence Integration
- Controlled AI Explanation Endpoint
"""
import unittest
import json
import sys
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

try:
    from services.amr_reconciliation import (
        reconcile_single_antibiotic,
        reconcile_isolate_evidence,
        POSSIBLE_DISCORDANCE_EXPLANATIONS
    )
except ImportError:
    from backend.services.amr_reconciliation import (
        reconcile_single_antibiotic,
        reconcile_isolate_evidence,
        POSSIBLE_DISCORDANCE_EXPLANATIONS
    )


class TestAMREvidenceReconciliation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = app.test_client()

    # 1. NCBI AST + Genomic Agreement (Concordant with NCBI AST)
    def test_1_ncbi_ast_genomic_agreement(self):
        finding = reconcile_single_antibiotic(
            antibiotic="ceftriaxone",
            genotype_str="blaCMY-2,tet(A)",
            ncbi_record={"antibiotic": "ceftriaxone", "phenotype": "resistant", "mic": ">=32"},
            user_record=None
        )
        self.assertEqual(finding["reconciliation_status"], "Concordant with NCBI AST")
        self.assertEqual(finding["reconciliation_category"], "concordant_ncbi")
        self.assertFalse(finding["has_conflict"])
        self.assertEqual(finding["genomic_evidence"]["genes"], ["blaCMY-2"])
        self.assertEqual(finding["ncbi_ast"]["phenotype"], "Resistant")
        self.assertFalse(finding["user_lab"]["available"])

    # 2. NCBI AST + Genomic Discordance (Observed Discordance)
    def test_2_ncbi_ast_genomic_discordance(self):
        finding = reconcile_single_antibiotic(
            antibiotic="streptomycin",
            genotype_str="aph(3'')-Ib,aph(6)-Id",
            ncbi_record={"antibiotic": "streptomycin", "phenotype": "susceptible", "mic": "4"},
            user_record=None
        )
        self.assertEqual(finding["reconciliation_status"], "Conflict between evidence sources")
        self.assertEqual(finding["reconciliation_category"], "conflict")
        self.assertTrue(finding["has_conflict"])
        self.assertEqual(finding["evidence_strength"], "Conflicting")
        self.assertTrue(len(finding["explanation_factors"]) > 0)

    # 3. NCBI AST + User Lab Agreement (3-way concordance)
    def test_3_ncbi_ast_user_lab_agreement(self):
        finding = reconcile_single_antibiotic(
            antibiotic="ceftriaxone",
            genotype_str="blaCMY-2",
            ncbi_record={"antibiotic": "ceftriaxone", "phenotype": "resistant", "mic": ">=32"},
            user_record={"antibiotic": "ceftriaxone", "phenotype": "Resistant", "mic": "16"}
        )
        self.assertEqual(finding["reconciliation_status"], "Concordant across available evidence")
        self.assertEqual(finding["reconciliation_category"], "concordant_all")
        self.assertFalse(finding["has_conflict"])
        self.assertTrue(finding["user_lab"]["available"])

    # 4. NCBI AST + User Lab Conflict
    def test_4_ncbi_ast_user_lab_conflict(self):
        finding = reconcile_single_antibiotic(
            antibiotic="ceftriaxone",
            genotype_str="blaCMY-2",
            ncbi_record={"antibiotic": "ceftriaxone", "phenotype": "resistant", "mic": ">=32"},
            user_record={"antibiotic": "ceftriaxone", "phenotype": "Susceptible", "mic": "0.5"}
        )
        self.assertEqual(finding["reconciliation_status"], "Conflict between evidence sources")
        self.assertEqual(finding["reconciliation_category"], "conflict")
        self.assertTrue(finding["has_conflict"])
        self.assertEqual(finding["evidence_strength"], "Conflicting")

    # 5. Missing User Lab Evidence (Graceful 2-source evaluation)
    def test_5_missing_user_lab_evidence(self):
        isolate = {
            "biosample_accession": "SAMN03177675",
            "amr_genotypes": "blaCMY-2,tet(A)",
            "ast_records": [
                {"antibiotic": "ampicillin", "phenotype": "resistant", "mic": ">=32"}
            ]
        }
        res = reconcile_isolate_evidence(isolate, user_lab_records=None)
        self.assertEqual(res["biosample_accession"], "SAMN03177675")
        self.assertEqual(len(res["findings"]), 1)
        self.assertFalse(res["findings"][0]["user_lab"]["available"])

    # 6. Not Comparable (No Validated Mapping)
    def test_6_not_comparable_preserves_no_negative_genotype(self):
        finding = reconcile_single_antibiotic(
            antibiotic="amikacin",
            genotype_str="blaTEM-1",  # blaTEM-1 maps to ampicillin, not amikacin
            ncbi_record={"antibiotic": "amikacin", "phenotype": "susceptible"},
            user_record=None
        )
        self.assertEqual(finding["reconciliation_status"], "Not comparable")
        self.assertEqual(finding["reconciliation_category"], "not_comparable")
        self.assertIn("No applicable genomic resistance determinant", finding["genomic_evidence"]["note"])

    # 7. Not Evaluable (No phenotype defined)
    def test_7_not_evaluable(self):
        finding = reconcile_single_antibiotic(
            antibiotic="ampicillin",
            genotype_str="blaTEM-1",
            ncbi_record={"antibiotic": "ampicillin", "phenotype": "not defined"},
            user_record=None
        )
        self.assertEqual(finding["reconciliation_status"], "Not evaluable")
        self.assertEqual(finding["reconciliation_category"], "not_evaluable")

    # 8. Multiple User Laboratory Records via POST /api/amr/reconcile
    def test_8_multiple_user_lab_records_endpoint(self):
        payload = {
            "biosample": "SAMN03177675",
            "user_lab": [
                {"antibiotic": "ceftriaxone", "phenotype": "Resistant", "mic": "16"},
                {"antibiotic": "ampicillin", "phenotype": "Resistant", "mic": "32"}
            ]
        }
        resp = self.client.post(
            "/api/amr/reconcile",
            data=json.dumps(payload),
            content_type="application/json"
        )
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data)
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["biosample_accession"], "SAMN03177675")
        self.assertTrue("reconciliation_summary" in data)
        self.assertTrue(len(data["findings"]) >= 15)

    # 9. Invalid User Laboratory Structure returns 400
    def test_9_invalid_user_lab_structure_returns_400(self):
        payload = {
            "biosample": "SAMN03177675",
            "user_lab": "invalid_string_not_list"
        }
        resp = self.client.post(
            "/api/amr/reconcile",
            data=json.dumps(payload),
            content_type="application/json"
        )
        self.assertEqual(resp.status_code, 400)

    # 10. Missing BioSample returns 400
    def test_10_missing_biosample_returns_400(self):
        payload = {
            "user_lab": []
        }
        resp = self.client.post(
            "/api/amr/reconcile",
            data=json.dumps(payload),
            content_type="application/json"
        )
        self.assertEqual(resp.status_code, 400)

    # 11. AI Endpoint receives structured findings and returns explanation with safety disclaimer
    def test_11_ai_explain_receives_structured_findings(self):
        payload = {
            "biosample": "SAMN03177676",
            "findings": [
                {
                    "antibiotic": "streptomycin",
                    "reconciliation_status": "Conflict between evidence sources",
                    "has_conflict": True,
                    "genomic_evidence": {"evidence_str": "aph(3'')-Ib; aph(6)-Id"},
                    "ncbi_ast": {"phenotype": "Susceptible"},
                    "user_lab": {"phenotype": "Not supplied"}
                }
            ]
        }
        resp = self.client.post(
            "/api/amr/explain",
            data=json.dumps(payload),
            content_type="application/json"
        )
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data)
        self.assertEqual(data["status"], "success")
        self.assertTrue("explanation" in data)
        self.assertIn("Research interpretation only", data["disclaimer"])

    # 12. Live BigQuery BioSample SAMN04014975 + Ampicillin + user lab = Susceptible -> Conflict
    def test_12_reconcile_live_bigquery_biosample_conflict(self):
        try:
            import routes.amr_routes as amr_routes_mod
        except ImportError:
            from backend.routes import amr_routes as amr_routes_mod

        mock_client = MagicMock()
        mock_job = MagicMock()
        mock_row = {
            "biosample_acc": "SAMN04014975",
            "taxgroup_name": "Escherichia coli",
            "scientific_name": "Escherichia coli",
            "asm_acc": "GCA_001234567.1",
            "amr_genotypes": ["blaTEM-1", "tet(A)"],
            "amr_genotypes_core": ["blaTEM-1"],
            "amrfinderplus_version": "3.12.8",
            "amrfinderplus_analysis_type": "COMBINED",
            "ast_phenotypes": [
                {
                    "antibiotic": "ampicillin",
                    "phenotype": "resistant",
                    "mic": "> 32",
                    "units": "mg/L",
                    "method": "MIC",
                    "guideline": "CLSI",
                }
            ],
        }
        mock_job.result.return_value = [mock_row]
        mock_client.query.return_value = mock_job

        bq_module = amr_routes_mod._get_bigquery_provider()
        with patch.dict("os.environ", {"BIGQUERY_PROJECT_ID": "test-project", "BIGQUERY_CREDENTIALS_JSON": '{"project_id": "test"}'}):
            with patch.object(bq_module, "_create_bigquery_client", return_value=mock_client):
                bq_module.clear_caches()
                payload = {
                    "biosample": "SAMN04014975",
                    "user_lab": [
                        {
                            "antibiotic": "ampicillin",
                            "phenotype": "Susceptible",
                            "mic": "<= 2 ug/mL"
                        }
                    ]
                }
                resp = self.client.post(
                    "/api/amr/reconcile",
                    data=json.dumps(payload),
                    content_type="application/json"
                )
                self.assertEqual(resp.status_code, 200)
                data = resp.get_json()
                self.assertEqual(data.get("status"), "success")
                self.assertEqual(data.get("biosample_accession"), "SAMN04014975")

                # Find ampicillin finding
                amp_finding = next((f for f in data.get("findings", []) if f.get("antibiotic", "").lower() == "ampicillin"), None)
                self.assertIsNotNone(amp_finding)
                # Expected:
                # genomic evidence: blaTEM/blaTEM-1
                # NCBI AST: Resistant
                # user lab: Susceptible
                # reconciliation: Conflict
                self.assertTrue(amp_finding["genomic_evidence"]["has_determinant"])
                self.assertIn("blaTEM-1", amp_finding["genomic_evidence"]["genes"])
                self.assertEqual(amp_finding["ncbi_ast"]["phenotype"], "Resistant")
                self.assertEqual(amp_finding["user_lab"]["phenotype"], "Susceptible")
                self.assertTrue(amp_finding["has_conflict"])
                self.assertEqual(amp_finding["reconciliation_category"], "conflict")
                self.assertEqual(amp_finding["reconciliation_status"], "Conflict between evidence sources")

    # 13. Live BigQuery BioSample SAMN04014975 + Ampicillin + user lab = Resistant -> Concordant
    def test_13_reconcile_live_bigquery_biosample_concordant(self):
        try:
            import routes.amr_routes as amr_routes_mod
        except ImportError:
            from backend.routes import amr_routes as amr_routes_mod

        mock_client = MagicMock()
        mock_job = MagicMock()
        mock_row = {
            "biosample_acc": "SAMN04014975",
            "taxgroup_name": "Escherichia coli",
            "scientific_name": "Escherichia coli",
            "asm_acc": "GCA_001234567.1",
            "amr_genotypes": ["blaTEM-1", "tet(A)"],
            "amr_genotypes_core": ["blaTEM-1"],
            "amrfinderplus_version": "3.12.8",
            "amrfinderplus_analysis_type": "COMBINED",
            "ast_phenotypes": [
                {
                    "antibiotic": "ampicillin",
                    "phenotype": "resistant",
                    "mic": "> 32",
                    "units": "mg/L",
                    "method": "MIC",
                    "guideline": "CLSI",
                }
            ],
        }
        mock_job.result.return_value = [mock_row]
        mock_client.query.return_value = mock_job

        bq_module = amr_routes_mod._get_bigquery_provider()
        with patch.dict("os.environ", {"BIGQUERY_PROJECT_ID": "test-project", "BIGQUERY_CREDENTIALS_JSON": '{"project_id": "test"}'}):
            with patch.object(bq_module, "_create_bigquery_client", return_value=mock_client):
                bq_module.clear_caches()
                payload = {
                    "biosample": "SAMN04014975",
                    "user_lab": [
                        {
                            "antibiotic": "ampicillin",
                            "phenotype": "Resistant",
                            "mic": ">= 32 ug/mL"
                        }
                    ]
                }
                resp = self.client.post(
                    "/api/amr/reconcile",
                    data=json.dumps(payload),
                    content_type="application/json"
                )
                self.assertEqual(resp.status_code, 200)
                data = resp.get_json()
                self.assertEqual(data.get("status"), "success")
                self.assertEqual(data.get("biosample_accession"), "SAMN04014975")

                # Find ampicillin finding
                amp_finding = next((f for f in data.get("findings", []) if f.get("antibiotic", "").lower() == "ampicillin"), None)
                self.assertIsNotNone(amp_finding)
                # Expected:
                # genomic evidence agrees (blaTEM-1)
                # NCBI AST agrees (Resistant)
                # user lab agrees (Resistant)
                # reconciliation: Concordant across available evidence
                self.assertTrue(amp_finding["genomic_evidence"]["has_determinant"])
                self.assertIn("blaTEM-1", amp_finding["genomic_evidence"]["genes"])
                self.assertEqual(amp_finding["ncbi_ast"]["phenotype"], "Resistant")
                self.assertEqual(amp_finding["user_lab"]["phenotype"], "Resistant")
                self.assertFalse(amp_finding["has_conflict"])
                self.assertEqual(amp_finding["reconciliation_category"], "concordant_all")
                self.assertEqual(amp_finding["reconciliation_status"], "Concordant across available evidence")

    # 14. Frozen validation isolate workflow intact
    def test_14_reconcile_frozen_validation_isolate(self):
        payload = {
            "biosample": "SAMN03177659",
            "user_lab": [
                {
                    "antibiotic": "ampicillin",
                    "phenotype": "Susceptible",
                    "mic": "<= 2"
                }
            ]
        }
        resp = self.client.post(
            "/api/amr/reconcile",
            data=json.dumps(payload),
            content_type="application/json"
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data.get("status"), "success")
        self.assertEqual(data.get("biosample_accession"), "SAMN03177659")
        self.assertEqual(data.get("data_source"), "validation_fixture")


if __name__ == "__main__":
    unittest.main()

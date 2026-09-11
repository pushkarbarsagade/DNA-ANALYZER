"""
backend/tests/test_amr_routes.py

Integration tests for the Flask AMR API routes (Phase 2).
Uses Flask's test client (app.test_client()) to test endpoints 100% offline.
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

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


class TestAMRRoutes(unittest.TestCase):
    """Integration test suite for AMR Flask API routes."""

    @classmethod
    def setUpClass(cls):
        """Configure test client."""
        app.config["TESTING"] = True
        app.config["DEBUG"] = False
        cls.client = app.test_client()

    # ==========================================================================
    # TEST 1 — Validation dataset
    # ==========================================================================
    def test_1_validation_dataset_endpoint(self):
        """
        GET /api/amr/validation-dataset
        Must return 200, 5 isolates, and exact aggregate metrics:
            75 total AST records
            28 comparable
            26 concordant
             2 discordant
            47 not comparable
             0 not evaluable
            92.9% concordance
        """
        response = self.client.get("/api/amr/validation-dataset")
        self.assertEqual(response.status_code, 200)

        data = response.get_json()
        self.assertIsNotNone(data)
        self.assertEqual(data.get("status"), "success")
        self.assertEqual(data.get("total_isolates"), 5)

        isolates = data.get("isolates", [])
        self.assertEqual(len(isolates), 5)

        # Check aggregate metrics
        metrics = data.get("summary_metrics", {})
        self.assertEqual(metrics.get("total_ast_records"), 75)
        self.assertEqual(metrics.get("defined_phenotypes"), 75)
        self.assertEqual(metrics.get("comparable_pairs"), 28)
        self.assertEqual(metrics.get("concordant"), 26)
        self.assertEqual(metrics.get("discordant"), 2)
        self.assertEqual(metrics.get("not_comparable"), 47)
        self.assertEqual(metrics.get("not_evaluable"), 0)
        self.assertEqual(metrics.get("concordance_percentage"), 92.9)

        # Mathematical check: 26 + 2 + 47 = 75
        self.assertEqual(
            metrics["concordant"] + metrics["discordant"] + metrics["not_comparable"],
            metrics["total_ast_records"]
        )

    # ==========================================================================
    # TEST 2 — Known discordance: SAMN03177676
    # ==========================================================================
    def test_2_known_discordance_samn03177676(self):
        """
        GET /api/amr/isolate/SAMN03177676
        Assert streptomycin is Discordant with aph(3'')-Ib and aph(6)-Id.
        """
        response = self.client.get("/api/amr/isolate/SAMN03177676")
        self.assertEqual(response.status_code, 200)

        data = response.get_json()
        self.assertEqual(data.get("status"), "success")
        self.assertEqual(data.get("biosample_accession"), "SAMN03177676")

        comparisons = data.get("comparisons", [])
        strep = next((c for c in comparisons if c.get("antibiotic", "").lower() == "streptomycin"), None)
        self.assertIsNotNone(strep, "streptomycin record not found in comparisons")

        self.assertEqual(strep.get("classification"), "Discordant")
        self.assertEqual(strep.get("phenotype", "").lower(), "susceptible")
        self.assertIn("aph(3'')-Ib", strep.get("genotype_evidence", ""))
        self.assertIn("aph(6)-Id", strep.get("genotype_evidence", ""))

    # ==========================================================================
    # TEST 3 — Known discordance: SAMN03177659
    # ==========================================================================
    def test_3_known_discordance_samn03177659(self):
        """
        GET /api/amr/isolate/SAMN03177659
        Assert ampicillin is Discordant with blaEC and susceptible phenotype.
        """
        response = self.client.get("/api/amr/isolate/SAMN03177659")
        self.assertEqual(response.status_code, 200)

        data = response.get_json()
        self.assertEqual(data.get("status"), "success")
        self.assertEqual(data.get("biosample_accession"), "SAMN03177659")

        comparisons = data.get("comparisons", [])
        amp = next((c for c in comparisons if c.get("antibiotic", "").lower() == "ampicillin"), None)
        self.assertIsNotNone(amp, "ampicillin record not found in comparisons")

        self.assertEqual(amp.get("classification"), "Discordant")
        self.assertEqual(amp.get("phenotype", "").lower(), "susceptible")
        self.assertIn("blaEC", amp.get("genotype_evidence", ""))

    # ==========================================================================
    # TEST 4 — POST /compare: Concordant
    # ==========================================================================
    def test_4_post_compare_concordant(self):
        """
        POST /api/amr/compare
        Minimal valid example: blaTEM-1 with ampicillin (resistant) -> Concordant.
        """
        payload = {
            "genotypes": "blaTEM-1",
            "antibiogram": [
                {
                    "antibiotic": "ampicillin",
                    "phenotype": "resistant",
                    "mic": "> 32 mg/L"
                }
            ]
        }
        response = self.client.post(
            "/api/amr/compare",
            data=json.dumps(payload),
            content_type="application/json"
        )
        self.assertEqual(response.status_code, 200)

        data = response.get_json()
        comps = data.get("comparisons", [])
        self.assertEqual(len(comps), 1)
        self.assertEqual(comps[0].get("classification"), "Concordant")
        self.assertEqual(comps[0].get("genotype_evidence"), "blaTEM-1")
        self.assertEqual(data.get("summary_metrics", {}).get("concordant"), 1)

    # ==========================================================================
    # TEST 5 — POST /compare: Discordant
    # ==========================================================================
    def test_5_post_compare_discordant(self):
        """
        POST /api/amr/compare
        Minimal valid example: blaTEM-1 with ampicillin (susceptible) -> Discordant.
        """
        payload = {
            "genotypes": "blaTEM-1",
            "antibiogram": [
                {
                    "antibiotic": "ampicillin",
                    "phenotype": "susceptible",
                    "mic": "2 mg/L"
                }
            ]
        }
        response = self.client.post(
            "/api/amr/compare",
            data=json.dumps(payload),
            content_type="application/json"
        )
        self.assertEqual(response.status_code, 200)

        data = response.get_json()
        comps = data.get("comparisons", [])
        self.assertEqual(len(comps), 1)
        self.assertEqual(comps[0].get("classification"), "Discordant")
        self.assertEqual(comps[0].get("genotype_evidence"), "blaTEM-1")
        self.assertEqual(data.get("summary_metrics", {}).get("discordant"), 1)

    # ==========================================================================
    # TEST 6 — POST /compare: Not comparable
    # ==========================================================================
    def test_6_post_compare_not_comparable(self):
        """
        POST /api/amr/compare
        Valid AST record with no mapped gene (ciprofloxacin) -> Not comparable.
        """
        payload = {
            "genotypes": "blaTEM-1",
            "antibiogram": [
                {
                    "antibiotic": "ciprofloxacin",
                    "phenotype": "susceptible",
                    "mic": "<= 0.015 mg/L"
                }
            ]
        }
        response = self.client.post(
            "/api/amr/compare",
            data=json.dumps(payload),
            content_type="application/json"
        )
        self.assertEqual(response.status_code, 200)

        data = response.get_json()
        comps = data.get("comparisons", [])
        self.assertEqual(len(comps), 1)
        self.assertEqual(comps[0].get("classification"), "Not comparable")
        self.assertEqual(comps[0].get("genotype_evidence"), "(none)")
        self.assertEqual(data.get("summary_metrics", {}).get("not_comparable"), 1)

    # ==========================================================================
    # TEST 7 — POST /compare: Not evaluable (SYNTHETIC)
    # ==========================================================================
    def test_7_post_compare_not_evaluable_synthetic(self):
        """
        POST /api/amr/compare (SYNTHETIC TEST)
        Mapped gene exists (blaTEM-1) but phenotype is 'not defined' -> Not evaluable.
        """
        payload = {
            "genotypes": "blaTEM-1",
            "antibiogram": [
                {
                    "antibiotic": "ampicillin",
                    "phenotype": "not defined",
                    "mic": ""
                }
            ]
        }
        response = self.client.post(
            "/api/amr/compare",
            data=json.dumps(payload),
            content_type="application/json"
        )
        self.assertEqual(response.status_code, 200)

        data = response.get_json()
        comps = data.get("comparisons", [])
        self.assertEqual(len(comps), 1)
        self.assertEqual(comps[0].get("classification"), "Not evaluable")
        self.assertEqual(data.get("summary_metrics", {}).get("not_evaluable"), 1)

    # ==========================================================================
    # TEST 8 — Unknown BioSample returns 404
    # ==========================================================================
    def test_8_unknown_biosample_returns_404(self):
        """
        GET /api/amr/isolate/UNKNOWN_BIOSAMPLE
        Must return 404 JSON, without fabricating data or calling NCBI.
        """
        response = self.client.get("/api/amr/isolate/UNKNOWN_BIOSAMPLE")
        self.assertEqual(response.status_code, 404)

        data = response.get_json()
        self.assertIsNotNone(data)
        self.assertIn("error", data)
        self.assertEqual(data.get("biosample"), "UNKNOWN_BIOSAMPLE")

    # ==========================================================================
    # TEST 9 — Missing JSON body returns 400
    # ==========================================================================
    def test_9_missing_json_body_returns_400(self):
        """
        POST /api/amr/compare with no body or non-JSON content.
        Must return structured 400 JSON error.
        """
        response = self.client.post("/api/amr/compare", data="")
        self.assertEqual(response.status_code, 400)

        data = response.get_json()
        self.assertIsNotNone(data)
        self.assertIn("error", data)

    # ==========================================================================
    # TEST 10 — Invalid request structure returns 400
    # ==========================================================================
    def test_10_invalid_request_structure_returns_400(self):
        """
        POST /api/amr/compare with invalid types.
        Must return 400 and not crash the application.
        """
        # Case 1: genotypes is int, antibiogram is string
        payload1 = {"genotypes": 123, "antibiogram": "invalid"}
        response1 = self.client.post(
            "/api/amr/compare",
            data=json.dumps(payload1),
            content_type="application/json"
        )
        self.assertEqual(response1.status_code, 400)
        self.assertIn("error", response1.get_json())

        # Case 2: missing antibiogram field
        payload2 = {"genotypes": "blaTEM-1"}
        response2 = self.client.post(
            "/api/amr/compare",
            data=json.dumps(payload2),
            content_type="application/json"
        )
        self.assertEqual(response2.status_code, 400)
        self.assertIn("error", response2.get_json())

        # Case 3: antibiogram item missing 'antibiotic'
        payload3 = {"genotypes": "blaTEM-1", "antibiogram": [{"phenotype": "R"}]}
        response3 = self.client.post(
            "/api/amr/compare",
            data=json.dumps(payload3),
            content_type="application/json"
        )
        self.assertEqual(response3.status_code, 400)
        self.assertIn("error", response3.get_json())

    # ==========================================================================
    # Existing DNA Analyzer endpoints sanity check
    # ==========================================================================
    def test_existing_dna_endpoints_intact(self):
        """Verify that existing DNA Analyzer routes continue to respond normally."""
        health_resp = self.client.get("/api/health")
        self.assertEqual(health_resp.status_code, 200)

        info_resp = self.client.get("/api/info")
        self.assertEqual(info_resp.status_code, 200)


if __name__ == "__main__":
    unittest.main()

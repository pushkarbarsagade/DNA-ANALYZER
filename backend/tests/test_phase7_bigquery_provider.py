"""
backend/tests/test_phase7_bigquery_provider.py

Unit tests for the Phase 7 BigQuery Provider, multi-organism support,
scientific correctness (MIC-only -> Not Evaluable), and provider priority routing.
"""
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

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
    import routes.amr_routes as amr_routes_mod
except ImportError:
    import backend.routes.amr_routes as amr_routes_mod

try:
    import services.bigquery_provider as bq_prov_mod
except ImportError:
    import backend.services.bigquery_provider as bq_prov_mod

try:
    from services.amr_engine import calculate_concordance_metrics, compare
except ImportError:
    from backend.services.amr_engine import calculate_concordance_metrics, compare


class TestPhase7ScientificCorrectness(unittest.TestCase):
    """Test MIC-only and phenotype eligibility hierarchy (STEP 9, 10, 11)."""

    def test_mic_only_undefined_phenotype_is_not_evaluable(self):
        """MIC-only / undefined phenotype records must be classified as Not evaluable."""
        genotype_rows = [{"amr_genotypes": "blaEC; tet(A)"}]
        antibiogram_rows = [
            {
                "antibiotic": "ampicillin",
                "phenotype": "not defined",
                "mic": "> 32",
                "units": "mg/L",
                "method": "MIC",
                "guideline": "CLSI",
            },
            {
                "antibiotic": "tetracycline",
                "phenotype": "",
                "mic": "<= 4",
                "units": "ug/mL",
                "method": "MIC",
                "guideline": "CLSI",
            },
        ]
        comps = compare(genotype_rows, antibiogram_rows)
        self.assertEqual(len(comps), 2)
        for c in comps:
            self.assertEqual(c["classification"], "Not evaluable")
            self.assertEqual(c["comparison_status"], "Not evaluable")

    def test_undefined_phenotype_with_no_mapped_gene_is_not_evaluable(self):
        """Undefined phenotype with no mapped genotype must be Not evaluable, NOT Not comparable."""
        genotype_rows = [{"amr_genotypes": "sul1"}]
        antibiogram_rows = [
            {
                "antibiotic": "ciprofloxacin",  # No mapping for sul1 -> ciprofloxacin
                "phenotype": "not defined",
                "mic": "2",
                "units": "mg/L",
            }
        ]
        comps = compare(genotype_rows, antibiogram_rows)
        self.assertEqual(comps[0]["classification"], "Not evaluable")

    def test_explicit_sir_with_no_mapping_is_not_comparable(self):
        """Explicit S/I/R with no validated genotype mapping must be Not comparable."""
        genotype_rows = [{"amr_genotypes": "blaTEM-1"}]
        antibiogram_rows = [
            {
                "antibiotic": "ciprofloxacin",
                "phenotype": "susceptible",
                "mic": "<= 0.06",
                "units": "mg/L",
            }
        ]
        comps = compare(genotype_rows, antibiogram_rows)
        self.assertEqual(comps[0]["classification"], "Not comparable")

    def test_samn02138670_pattern_all_mic_undefined_yields_zero_comparable(self):
        """
        Simulate SAMN02138670: 9 AST records, all phenotype='not defined'.
        Result must be: 9 total AST, 0 eligible S/I/R, 9 Not evaluable, 0 comparable, concordance=None.
        """
        genotype_rows = [{"amr_genotypes": "blaTEM-1; blaCTX-M-15"}]
        antibiogram_rows = [
            {"antibiotic": f"abx_{i}", "phenotype": "not defined", "mic": f"{i*2}", "units": "mg/L"}
            for i in range(9)
        ]
        comps = compare(genotype_rows, antibiogram_rows)
        metrics = calculate_concordance_metrics(comps)

        self.assertEqual(metrics["total_ast_records"], 9)
        self.assertEqual(metrics["eligible_sir_records"], 0)
        self.assertEqual(metrics["not_evaluable"], 9)
        self.assertEqual(metrics["comparable_pairs"], 0)
        self.assertEqual(metrics["concordant"], 0)
        self.assertEqual(metrics["discordant"], 0)
        self.assertEqual(metrics["not_comparable"], 0)
        self.assertIsNone(metrics["concordance_percentage"])


class TestBigQueryProviderUnit(unittest.TestCase):
    """Unit tests for bigquery_provider helper functions and query parser."""

    def setUp(self):
        bq_prov_mod.clear_caches()

    def tearDown(self):
        bq_prov_mod.clear_caches()

    def test_accession_validation(self):
        """Test accession validation regex."""
        self.assertTrue(bq_prov_mod.validate_accession("SAMN03177675"))
        self.assertTrue(bq_prov_mod.validate_accession("SAMD01234567"))
        self.assertTrue(bq_prov_mod.validate_accession("SAMEA999999"))
        self.assertFalse(bq_prov_mod.validate_accession("INVALID_ACC"))
        self.assertFalse(bq_prov_mod.validate_accession(""))

    def test_unconfigured_bigquery_returns_truthful_state(self):
        """When BIGQUERY_PROJECT_ID is absent, query returns dynamic_provider_not_configured."""
        with patch.dict("os.environ", {}, clear=True):
            res = bq_prov_mod.query_biosample_bigquery("SAMN99999999")
            self.assertEqual(res.get("state"), "dynamic_provider_not_configured")
            self.assertIn("not configured", res.get("availability_message", "").lower())

    def test_successful_bigquery_mock_query_multi_organism(self):
        """Test BigQuery query parsing with a non-E.coli organism (Klebsiella pneumoniae)."""
        mock_client = MagicMock()
        mock_job = MagicMock()
        mock_row = {
            "biosample_acc": "SAMN08881234",
            "taxgroup_name": "Klebsiella pneumoniae",
            "scientific_name": "Klebsiella pneumoniae subsp. pneumoniae",
            "asm_acc": "GCA_008881234.1",
            "amr_genotypes": "blaKPC-2; blaSHV-11",
            "amr_genotypes_core": "blaKPC-2",
            "amrfinderplus_version": "3.12.8",
            "amrfinderplus_analysis_type": "COMBINED",
            "ast_phenotypes": [
                {
                    "antibiotic": "meropenem",
                    "phenotype": "resistant",
                    "mic": "16",
                    "units": "mg/L",
                    "method": "MIC",
                    "guideline": "CLSI",
                }
            ],
        }
        mock_job.result.return_value = [mock_row]
        mock_client.query.return_value = mock_job

        with patch.dict("os.environ", {"BIGQUERY_PROJECT_ID": "test-project", "BIGQUERY_CREDENTIALS_JSON": "{}"}):
            res = bq_prov_mod.query_biosample_bigquery("SAMN08881234", client=mock_client)

            self.assertEqual(res.get("state"), "ok")
            self.assertEqual(res.get("organism"), "Klebsiella pneumoniae subsp. pneumoniae")
            self.assertEqual(res.get("assembly_accession"), "GCA_008881234.1")
            self.assertEqual(res.get("amr_genotypes"), "blaKPC-2; blaSHV-11")
            self.assertEqual(len(res.get("ast_records", [])), 1)
            self.assertEqual(res.get("ast_records")[0]["antibiotic"], "meropenem")

    def test_bigquery_row_with_list_and_struct_values_regression(self):
        """
        Regression test for 'list' object has no attribute 'strip'.
        NCBI BigQuery returns amr_genotypes and amr_genotypes_core as ARRAY<STRING> (Python list)
        and ast_phenotypes as ARRAY<STRUCT> (list of dicts/Rows).
        """
        mock_client = MagicMock()
        mock_job = MagicMock()
        mock_row = {
            "biosample_acc": "SAMN04014975",
            "taxgroup_name": ["Escherichia coli"],
            "scientific_name": "Escherichia coli",
            "asm_acc": ["GCA_001234567.1"],
            "amr_genotypes": ["blaCTX-M-15", "blaTEM-1", "aph(3'')-Ib", "sul2"],
            "amr_genotypes_core": ["blaCTX-M-15", "blaTEM-1"],
            "amrfinderplus_version": ["3.12.8"],
            "amrfinderplus_analysis_type": "COMBINED",
            "ast_phenotypes": [
                {
                    "antibiotic": "ampicillin",
                    "phenotype": "resistant",
                    "mic": "> 32",
                    "units": "mg/L",
                    "method": "MIC",
                    "guideline": "CLSI",
                },
                {
                    "antibiotic": "ceftriaxone",
                    "phenotype": "resistant",
                    "mic": "16",
                    "units": "mg/L",
                    "method": "MIC",
                    "guideline": "CLSI",
                },
            ],
        }
        mock_job.result.return_value = [mock_row]
        mock_client.query.return_value = mock_job

        with patch.dict("os.environ", {"BIGQUERY_PROJECT_ID": "test-project", "BIGQUERY_CREDENTIALS_JSON": "{}"}):
            res = bq_prov_mod.query_biosample_bigquery("SAMN04014975", client=mock_client)

            self.assertEqual(res.get("state"), "ok")
            self.assertEqual(res.get("organism"), "Escherichia coli")
            self.assertEqual(res.get("assembly_accession"), "GCA_001234567.1")
            self.assertEqual(res.get("amr_genotypes"), "blaCTX-M-15, blaTEM-1, aph(3'')-Ib, sul2")
            self.assertEqual(res.get("AMR_genotypes_core"), "blaCTX-M-15, blaTEM-1")
            self.assertEqual(res.get("amrfinder_version"), "3.12.8")
            self.assertEqual(len(res.get("ast_records", [])), 2)
            self.assertEqual(res.get("ast_records")[0]["mic"], "> 32 mg/L")

    def test_bigquery_real_row_object_with_nested_types(self):
        """
        Verify that google.cloud.bigquery.Row objects containing lists and struct
        elements are parsed without error into strings and structured AST records.
        """
        try:
            from google.cloud.bigquery import Row
        except ImportError:
            self.skipTest("google-cloud-bigquery not installed")

        mock_client = MagicMock()
        mock_job = MagicMock()

        # Build actual BigQuery Row objects
        ast_row1 = Row(
            ("ampicillin", "resistant", "> 32", "mg/L", "MIC", "CLSI"),
            {"antibiotic": 0, "phenotype": 1, "mic": 2, "units": 3, "method": 4, "guideline": 5},
        )
        main_row = Row(
            (
                "SAMN04014975",
                "Escherichia coli",
                "Escherichia coli",
                "GCA_001234567.1",
                ["blaTEM-1", "tet(A)"],
                ["blaTEM-1"],
                "3.12.8",
                "COMBINED",
                [ast_row1],
            ),
            {
                "biosample_acc": 0,
                "taxgroup_name": 1,
                "scientific_name": 2,
                "asm_acc": 3,
                "amr_genotypes": 4,
                "amr_genotypes_core": 5,
                "amrfinderplus_version": 6,
                "amrfinderplus_analysis_type": 7,
                "ast_phenotypes": 8,
            },
        )

        mock_job.result.return_value = [main_row]
        mock_client.query.return_value = mock_job

        with patch.dict("os.environ", {"BIGQUERY_PROJECT_ID": "test-project", "BIGQUERY_CREDENTIALS_JSON": "{}"}):
            res = bq_prov_mod.query_biosample_bigquery("SAMN04014975", client=mock_client)

            self.assertEqual(res.get("state"), "ok")
            self.assertEqual(res.get("amr_genotypes"), "blaTEM-1, tet(A)")
            self.assertEqual(len(res.get("ast_records", [])), 1)
            self.assertEqual(res.get("ast_records")[0]["antibiotic"], "ampicillin")
            self.assertEqual(res.get("ast_records")[0]["phenotype"], "resistant")
            self.assertEqual(res.get("ast_records")[0]["mic"], "> 32 mg/L")


class TestBigQueryProviderRoutesIntegration(unittest.TestCase):
    """Integration tests for routes with BigQueryProvider and fallback semantics."""

    @classmethod
    def setUpClass(cls):
        cls.app = app
        cls.client = cls.app.test_client()

    def test_provider_status_endpoint(self):
        """GET /api/amr/provider-status returns structured diagnostics."""
        resp = self.client.get("/api/amr/provider-status")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data.get("status"), "ok")
        self.assertIn("bigquery_provider", data)
        self.assertIn("validation_fixture", data)

    def test_dynamic_lookup_unconfigured_returns_503_truthful(self):
        """Dynamic lookup with unconfigured BigQuery returns 503 dynamic_provider_not_configured."""
        with patch.dict("os.environ", {"ENABLE_LEGACY_FTP_FALLBACK": "0"}, clear=True):
            resp = self.client.get("/api/amr/isolate/SAMN99998888")
            self.assertEqual(resp.status_code, 503)
            data = resp.get_json()
            self.assertEqual(data.get("availability_state"), "dynamic_provider_not_configured")
            self.assertIn("BigQuery", data.get("error", ""))

    def test_samn04014975_live_shape_via_route(self):
        """
        End-to-end route test simulating SAMN04014975 with BigQuery array/repeated fields.
        Must return 200 success without 'list' object has no attribute 'strip'.
        """
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
                resp = self.client.get("/api/amr/isolate/SAMN04014975")
                self.assertEqual(resp.status_code, 200)
                data = resp.get_json()
                self.assertEqual(data.get("status"), "success")
                self.assertEqual(data.get("biosample_accession"), "SAMN04014975")
                self.assertEqual(data.get("amr_genotypes"), "blaTEM-1, tet(A)")
                self.assertEqual(len(data.get("comparisons", [])), 1)
                self.assertEqual(data.get("comparisons")[0]["classification"], "Concordant")


if __name__ == "__main__":
    unittest.main()

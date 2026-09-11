"""
backend/tests/test_ncbi_provider.py

Unit and regression tests for the NCBI Pathogen Detection provider (Phase 6).
All automated tests run 100% offline using mocks and local fixtures.
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
    import services.ncbi_provider as ncbi_prov_mod
except ImportError:
    import backend.services.ncbi_provider as ncbi_prov_mod


class TestNCBIProviderUnit(unittest.TestCase):
    """Unit tests for ncbi_provider helper functions."""

    def setUp(self):
        ncbi_prov_mod.clear_caches()

    def tearDown(self):
        ncbi_prov_mod.clear_caches()

    def test_accession_validation(self):
        """Test validate_accession pattern matching."""
        self.assertTrue(ncbi_prov_mod.validate_accession("SAMN03177675"))
        self.assertTrue(ncbi_prov_mod.validate_accession("samn03177675"))
        self.assertTrue(ncbi_prov_mod.validate_accession("SAMEA1234567"))
        self.assertTrue(ncbi_prov_mod.validate_accession("SAMD00012345"))

        # Invalid formats
        self.assertFalse(ncbi_prov_mod.validate_accession(""))
        self.assertFalse(ncbi_prov_mod.validate_accession("UNKNOWN_BIOSAMPLE"))
        self.assertFalse(ncbi_prov_mod.validate_accession("SAMN12"))  # too short (< 4 digits)
        self.assertFalse(ncbi_prov_mod.validate_accession("PRJNA12345"))
        self.assertFalse(ncbi_prov_mod.validate_accession("GCA_000797605.1"))
        self.assertFalse(ncbi_prov_mod.validate_accession("SAMN03177675<script>"))

    def test_has_required_columns(self):
        """Test schema validation by column names."""
        valid_cols = ["#label", "biosample_acc", "asm_acc", "scientific_name", "AMR_genotypes", "AST_phenotypes"]
        self.assertTrue(ncbi_prov_mod._has_required_columns(valid_cols))

        # Missing AMR_genotypes
        missing_amr = ["#label", "biosample_acc", "asm_acc", "scientific_name"]
        self.assertFalse(ncbi_prov_mod._has_required_columns(missing_amr))

        # Missing biosample_acc
        missing_bs = ["#label", "asm_acc", "scientific_name", "AMR_genotypes"]
        self.assertFalse(ncbi_prov_mod._has_required_columns(missing_bs))

    @patch.object(ncbi_prov_mod, "_get_release_listing")
    @patch.object(ncbi_prov_mod, "_inspect_tsv_header")
    def test_discover_compatible_release_by_column_name(self, mock_inspect, mock_listing):
        """
        Verify release discovery selects release by column name inspection,
        NOT by release number.
        """
        # Listing returns 2 releases: newer one has incompatible schema, older has compatible
        mock_listing.return_value = ["PDG000000004.9999", "PDG000000004.8888"]

        def inspect_side_effect(rel):
            if rel == "PDG000000004.8888":  # Newer in reverse iteration
                # Incompatible: missing AMR_genotypes
                return ["biosample_acc", "asm_acc", "scientific_name"]
            elif rel == "PDG000000004.9999":  # Older
                # Compatible: contains all required columns
                return ["biosample_acc", "asm_acc", "scientific_name", "AMR_genotypes", "AMR_genotypes_core"]
            return None

        mock_inspect.side_effect = inspect_side_effect

        result = ncbi_prov_mod.discover_compatible_release()
        self.assertEqual(result["pdg_release"], "PDG000000004.9999")
        self.assertIn("AMR_genotypes", result["columns"])

    @patch.object(ncbi_prov_mod, "discover_compatible_release")
    @patch.object(ncbi_prov_mod, "_lookup_tsv_row")
    @patch.object(ncbi_prov_mod, "_fetch_biosample_ast")
    def test_lookup_biosample_success(self, mock_ast, mock_tsv_row, mock_disc):
        """Test full successful lookup with AMR genotype and AST."""
        mock_disc.return_value = {
            "pdg_release": "PDG000000004.6298",
            "columns": ["biosample_acc", "asm_acc", "scientific_name", "AMR_genotypes"],
            "meta_url": "https://fake/url.tsv"
        }
        mock_tsv_row.return_value = {
            "biosample_acc": "SAMN01234567",
            "asm_acc": "GCA_001234567.1",
            "scientific_name": "Escherichia coli",
            "AMR_genotypes": "blaCMY-2,tet(A)",
            "amrfinder_version": "4.2.7"
        }
        mock_ast.return_value = (
            "Escherichia coli",
            [
                {
                    "antibiotic": "ampicillin",
                    "phenotype": "resistant",
                    "mic": "> 32",
                    "units": "mg/L",
                    "method": "MIC",
                    "guideline": "CLSI"
                }
            ]
        )

        res = ncbi_prov_mod.lookup_biosample("SAMN01234567")
        self.assertEqual(res["state"], "ok")
        self.assertEqual(res["biosample_accession"], "SAMN01234567")
        self.assertEqual(res["amr_genotypes"], "blaCMY-2,tet(A)")
        self.assertEqual(res["data_source"], "ncbi_pathogen_detection")
        self.assertEqual(res["pdg_release"], "PDG000000004.6298")
        self.assertEqual(len(res["ast_records"]), 1)

    @patch.object(ncbi_prov_mod, "discover_compatible_release")
    @patch.object(ncbi_prov_mod, "_lookup_tsv_row")
    def test_lookup_biosample_not_in_pathogen_detection(self, mock_tsv_row, mock_disc):
        """Test biosample not found in Pathogen Detection TSV."""
        mock_disc.return_value = {
            "pdg_release": "PDG000000004.6298",
            "columns": ["biosample_acc", "asm_acc", "scientific_name", "AMR_genotypes"],
            "meta_url": "https://fake/url.tsv"
        }
        mock_tsv_row.return_value = None

        res = ncbi_prov_mod.lookup_biosample("SAMN99999999")
        self.assertEqual(res["state"], "not_in_pathogen_detection")
        self.assertIn("not found in the NCBI Pathogen Detection", res["availability_message"])

    @patch.object(ncbi_prov_mod, "discover_compatible_release")
    @patch.object(ncbi_prov_mod, "_lookup_tsv_row")
    def test_lookup_biosample_no_amr_genotypes(self, mock_tsv_row, mock_disc):
        """Test isolate in TSV but AMR_genotypes column is empty."""
        mock_disc.return_value = {
            "pdg_release": "PDG000000004.6298",
            "columns": ["biosample_acc", "asm_acc", "scientific_name", "AMR_genotypes"],
            "meta_url": "https://fake/url.tsv"
        }
        mock_tsv_row.return_value = {
            "biosample_acc": "SAMN01234568",
            "asm_acc": "GCA_001234568.1",
            "scientific_name": "Escherichia coli",
            "AMR_genotypes": ""
        }

        res = ncbi_prov_mod.lookup_biosample("SAMN01234568")
        self.assertEqual(res["state"], "no_amr_genotype")
        self.assertIn("no AMR genotype data", res["availability_message"])

    @patch.object(ncbi_prov_mod, "discover_compatible_release")
    @patch.object(ncbi_prov_mod, "_lookup_tsv_row")
    @patch.object(ncbi_prov_mod, "_fetch_biosample_ast")
    def test_lookup_biosample_no_ast_data(self, mock_ast, mock_tsv_row, mock_disc):
        """Test isolate in TSV with AMR genotype but no AST records."""
        mock_disc.return_value = {
            "pdg_release": "PDG000000004.6298",
            "columns": ["biosample_acc", "asm_acc", "scientific_name", "AMR_genotypes"],
            "meta_url": "https://fake/url.tsv"
        }
        mock_tsv_row.return_value = {
            "biosample_acc": "SAMN01234569",
            "asm_acc": "GCA_001234569.1",
            "scientific_name": "Escherichia coli",
            "AMR_genotypes": "blaEC,mdtM"
        }
        mock_ast.return_value = ("Escherichia coli", [])  # Empty AST records

        res = ncbi_prov_mod.lookup_biosample("SAMN01234569")
        self.assertEqual(res["state"], "no_ast_data")
        self.assertIn("no eligible Antibiogram / AST phenotype records", res["availability_message"])


class TestAMRRoutesPhase6(unittest.TestCase):
    """API endpoint integration tests for Phase 6 dynamic BioSample lookup."""

    @classmethod
    def setUpClass(cls):
        cls.app = app
        cls.client = cls.app.test_client()

    def test_validation_isolate_uses_fixture_not_ncbi(self):
        """
        Verify all 5 validation isolates are served from the frozen fixture
        with exact frozen concordance results.
        """
        validation_targets = [
            ("SAMN03177674", 15, 5, 5, 0, 10, 0, 100.0),
            ("SAMN03177676", 15, 5, 4, 1, 10, 0, 80.0),
            ("SAMN03177659", 15, 5, 4, 1, 10, 0, 80.0),
            ("SAMN03177675", 15, 8, 8, 0, 7, 0, 100.0),
            ("SAMN03177664", 15, 5, 5, 0, 10, 0, 100.0),
        ]

        for acc, tot, comp, conc, disc, not_c, not_e, pct in validation_targets:
            resp = self.client.get(f"/api/amr/isolate/{acc}")
            self.assertEqual(resp.status_code, 200, f"Failed for {acc}")
            data = resp.get_json()
            self.assertEqual(data.get("data_source"), "validation_fixture")
            self.assertEqual(data.get("biosample_accession"), acc)
            metrics = data.get("summary_metrics", {})
            self.assertEqual(metrics.get("total_ast_records"), tot)
            self.assertEqual(metrics.get("comparable_pairs"), comp)
            self.assertEqual(metrics.get("concordant"), conc)
            self.assertEqual(metrics.get("discordant"), disc)
            self.assertEqual(metrics.get("not_comparable"), not_c)
            self.assertEqual(metrics.get("not_evaluable"), not_e)
            self.assertEqual(metrics.get("concordance_percentage"), pct)

    def test_malformed_accession_returns_400(self):
        """Malformed accession returns 400."""
        resp = self.client.get("/api/amr/isolate/SAMN!@#$%^")
        self.assertEqual(resp.status_code, 400)
        data = resp.get_json()
        self.assertIn("error", data)

    @patch.object(amr_routes_mod, "_get_ncbi_provider")
    def test_dynamic_isolate_success(self, mock_get_prov):
        """Dynamic non-validation isolate successfully evaluated."""
        mock_prov = MagicMock()
        mock_prov.validate_accession.return_value = True
        mock_prov.lookup_biosample.return_value = {
            "state": "ok",
            "biosample_accession": "SAMN09990001",
            "assembly_accession": "GCA_009990001.1",
            "organism": "Escherichia coli",
            "amr_genotypes": "blaEC,tet(A)",
            "raw_genotype_row": {"amr_genotypes": "blaEC,tet(A)"},
            "ast_records": [
                {"antibiotic": "tetracycline", "phenotype": "resistant", "mic": "64"},
                {"antibiotic": "ampicillin", "phenotype": "resistant", "mic": "32"},
                {"antibiotic": "ciprofloxacin", "phenotype": "susceptible", "mic": "0.06"}
            ],
            "pdg_release": "PDG000000004.6298",
            "amrfinder_version": "4.2.7"
        }
        mock_get_prov.return_value = mock_prov

        resp = self.client.get("/api/amr/isolate/SAMN09990001")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data.get("status"), "success")
        self.assertEqual(data.get("data_source"), "ncbi_pathogen_detection")
        self.assertEqual(data.get("pdg_release"), "PDG000000004.6298")
        self.assertEqual(data.get("biosample_accession"), "SAMN09990001")
        # Check that comparison engine was run
        comparisons = data.get("comparisons", [])
        self.assertEqual(len(comparisons), 3)
        metrics = data.get("summary_metrics", {})
        self.assertEqual(metrics.get("total_ast_records"), 3)

    @patch.object(amr_routes_mod, "_get_ncbi_provider")
    def test_dynamic_isolate_no_ast_data_returns_partial_200(self, mock_get_prov):
        """Isolate with AMR genotype but no AST returns 200 partial state."""
        mock_prov = MagicMock()
        mock_prov.validate_accession.return_value = True
        mock_prov.lookup_biosample.return_value = {
            "state": "no_ast_data",
            "biosample_accession": "SAMN09990002",
            "assembly_accession": "GCA_009990002.1",
            "organism": "Escherichia coli",
            "amr_genotypes": "blaTEM-1,sul1",
            "availability_message": "AMR genotype data available, but no AST phenotype data found.",
            "pdg_release": "PDG000000004.6298",
            "amrfinder_version": "4.2.7"
        }
        mock_get_prov.return_value = mock_prov

        resp = self.client.get("/api/amr/isolate/SAMN09990002")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data.get("status"), "partial")
        self.assertEqual(data.get("availability_state"), "no_ast_data")
        self.assertEqual(data.get("amr_genotypes"), "blaTEM-1,sul1")

    @patch.object(amr_routes_mod, "_get_ncbi_provider")
    def test_dynamic_isolate_no_amr_genotype_returns_partial_200(self, mock_get_prov):
        """Isolate with no AMR genotype data returns 200 partial state."""
        mock_prov = MagicMock()
        mock_prov.validate_accession.return_value = True
        mock_prov.lookup_biosample.return_value = {
            "state": "no_amr_genotype",
            "biosample_accession": "SAMN09990003",
            "assembly_accession": "GCA_009990003.1",
            "organism": "Escherichia coli",
            "amr_genotypes": "",
            "availability_message": "No AMR genotype data recorded for this isolate.",
            "pdg_release": "PDG000000004.6298"
        }
        mock_get_prov.return_value = mock_prov

        resp = self.client.get("/api/amr/isolate/SAMN09990003")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data.get("status"), "partial")
        self.assertEqual(data.get("availability_state"), "no_amr_genotype")

    @patch.object(amr_routes_mod, "_get_ncbi_provider")
    def test_dynamic_isolate_ncbi_unavailable_returns_503(self, mock_get_prov):
        """NCBI network/service failure returns 503."""
        mock_prov = MagicMock()
        mock_prov.validate_accession.return_value = True
        mock_prov.lookup_biosample.return_value = {
            "state": "ncbi_unavailable",
            "biosample_accession": "SAMN09990004",
            "availability_message": "NCBI service unreachable."
        }
        mock_get_prov.return_value = mock_prov

        resp = self.client.get("/api/amr/isolate/SAMN09990004")
        self.assertEqual(resp.status_code, 503)
        data = resp.get_json()
        self.assertEqual(data.get("availability_state"), "ncbi_unavailable")


if __name__ == "__main__":
    unittest.main()

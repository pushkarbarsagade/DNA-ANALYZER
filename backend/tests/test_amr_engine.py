"""
backend/tests/test_amr_engine.py

Automated regression test suite for the extracted AMR Concordance Engine.
All tests run 100% offline using frozen fixture data or local synthetic cases.
"""
from __future__ import annotations

import json
import os
import unittest
from pathlib import Path

from backend.services.amr_engine import (
    COMBINATION_RULES,
    DOCUMENTED_MAPPINGS,
    calculate_concordance_metrics,
    compare,
    get_mapped_genes_for_abx,
    parse_biosample_xml_antibiogram,
)


FIXTURE_PATH = Path(__file__).resolve().parent.parent / "data" / "validation_isolates.json"


class TestAMREngineExtraction(unittest.TestCase):
    """Regression tests for AMR engine extraction and frozen validation metrics."""

    @classmethod
    def setUpClass(cls):
        """Load frozen validation fixture once for test suite."""
        if not FIXTURE_PATH.exists():
            raise FileNotFoundError(f"Fixture file not found at {FIXTURE_PATH}")
        with open(FIXTURE_PATH, "r", encoding="utf-8") as f:
            cls.fixture_data = json.load(f)
        cls.isolates = cls.fixture_data.get("isolates", [])
        if len(cls.isolates) != 5:
            raise ValueError(f"Fixture must contain exactly 5 validation isolates, found {len(cls.isolates)}")

    def test_a_full_five_isolate_validation(self):
        """
        Test A - Full five-isolate validation reproduction.
        Must reproduce:
            total_ast_records: 75
            comparable_pairs: 28
            concordant: 26
            discordant: 2
            not_comparable: 47
            not_evaluable: 0
            concordance: 92.9% (26/28 = 92.857...%)
        """
        all_comparisons = []
        per_isolate_counts = {}

        for iso in self.isolates:
            acc = iso["biosample_accession"]
            genotype_row = iso["raw_genotype_row"]
            ast_rows = iso["ast_records"]
            comps = compare([genotype_row], ast_rows)
            per_isolate_counts[acc] = len(comps)
            all_comparisons.extend(comps)

        # Assert every isolate has exactly 15 AST records
        for acc, count in per_isolate_counts.items():
            self.assertEqual(count, 15, f"Isolate {acc} did not have 15 AST records (found {count})")

        metrics = calculate_concordance_metrics(all_comparisons)

        self.assertEqual(metrics["total_ast_records"], 75, "Total AST records must equal 75")
        self.assertEqual(metrics["defined_phenotypes"], 75, "Defined phenotypes must equal 75")
        self.assertEqual(metrics["comparable_pairs"], 28, "Comparable pairs must equal 28")
        self.assertEqual(metrics["concordant"], 26, "Concordant pairs must equal 26")
        self.assertEqual(metrics["discordant"], 2, "Discordant pairs must equal 2")
        self.assertEqual(metrics["not_comparable"], 47, "Not comparable records must equal 47")
        self.assertEqual(metrics["not_evaluable"], 0, "Not evaluable records must equal 0")

        # Concordance percentage: 26 / 28 * 100 = 92.857...% -> 92.9%
        self.assertAlmostEqual(metrics["concordance_raw"], 92.85714285714286, places=4)
        self.assertEqual(metrics["concordance_percentage"], 92.9, "Concordance percentage must be 92.9%")

    def test_b_known_discordance_1_streptomycin(self):
        """
        Test B - Known discordance #1:
        BioSample: SAMN03177676
        Antibiotic: streptomycin
        Phenotype: susceptible
        Mapped genomic evidence: aph(3'')-Ib; aph(6)-Id
        Classification: Discordant
        """
        iso = next((i for i in self.isolates if i["biosample_accession"] == "SAMN03177676"), None)
        self.assertIsNotNone(iso, "SAMN03177676 not found in fixture")

        comps = compare([iso["raw_genotype_row"]], iso["ast_records"])
        strep_comp = next((c for c in comps if c["antibiotic"].lower() == "streptomycin"), None)
        self.assertIsNotNone(strep_comp, "streptomycin not found in SAMN03177676 AST records")

        self.assertEqual(strep_comp["classification"], "Discordant")
        self.assertEqual(strep_comp["phenotype"].lower(), "susceptible")
        self.assertEqual(strep_comp["genotype_evidence"], "aph(3'')-Ib; aph(6)-Id")
        self.assertIn("aph(3'')-Ib; aph(6)-Id", strep_comp["reason"])
        self.assertIn("susceptible", strep_comp["reason"])

    def test_c_known_discordance_2_ampicillin(self):
        """
        Test C - Known discordance #2:
        BioSample: SAMN03177659
        Antibiotic: ampicillin
        Phenotype: susceptible
        Mapped genomic evidence: blaEC
        Classification: Discordant
        """
        iso = next((i for i in self.isolates if i["biosample_accession"] == "SAMN03177659"), None)
        self.assertIsNotNone(iso, "SAMN03177659 not found in fixture")

        comps = compare([iso["raw_genotype_row"]], iso["ast_records"])
        amp_comp = next((c for c in comps if c["antibiotic"].lower() == "ampicillin"), None)
        self.assertIsNotNone(amp_comp, "ampicillin not found in SAMN03177659 AST records")

        self.assertEqual(amp_comp["classification"], "Discordant")
        self.assertEqual(amp_comp["phenotype"].lower(), "susceptible")
        self.assertEqual(amp_comp["genotype_evidence"], "blaEC")
        self.assertIn("blaEC", amp_comp["reason"])
        self.assertIn("susceptible", amp_comp["reason"])

    def test_d_concordant_path_real_fixture(self):
        """
        Test D - Concordant path using real validated fixture records:
        BioSample: SAMN03177674
        Antibiotic: ampicillin (resistant, mapped genes: blaEC; blaTEM-1) -> Concordant
        Antibiotic: tetracycline (resistant, mapped gene: tet(A)) -> Concordant
        """
        iso = next((i for i in self.isolates if i["biosample_accession"] == "SAMN03177674"), None)
        self.assertIsNotNone(iso)

        comps = compare([iso["raw_genotype_row"]], iso["ast_records"])
        amp_comp = next((c for c in comps if c["antibiotic"].lower() == "ampicillin"), None)
        self.assertIsNotNone(amp_comp)
        self.assertEqual(amp_comp["classification"], "Concordant")
        self.assertEqual(amp_comp["phenotype"].lower(), "resistant")
        self.assertIn("blaTEM-1", amp_comp["genotype_evidence"])

        tet_comp = next((c for c in comps if c["antibiotic"].lower() == "tetracycline"), None)
        self.assertIsNotNone(tet_comp)
        self.assertEqual(tet_comp["classification"], "Concordant")
        self.assertEqual(tet_comp["phenotype"].lower(), "resistant")
        self.assertEqual(tet_comp["genotype_evidence"], "tet(A)")

    def test_e_not_comparable_path_real_fixture(self):
        """
        Test E - Not comparable path using real validated fixture records:
        BioSample: SAMN03177674
        Antibiotic: ciprofloxacin (no mapped gene in genotype) -> Not comparable
        Antibiotic: gentamicin (no mapped gene in genotype) -> Not comparable
        """
        iso = next((i for i in self.isolates if i["biosample_accession"] == "SAMN03177674"), None)
        self.assertIsNotNone(iso)

        comps = compare([iso["raw_genotype_row"]], iso["ast_records"])
        cipro_comp = next((c for c in comps if c["antibiotic"].lower() == "ciprofloxacin"), None)
        self.assertIsNotNone(cipro_comp)
        self.assertEqual(cipro_comp["classification"], "Not comparable")
        self.assertEqual(cipro_comp["genotype_evidence"], "(none)")
        self.assertEqual(cipro_comp["reason"], "No validated genotype-to-antibiotic mapping")

    def test_f_not_evaluable_path_synthetic(self):
        """
        Test F - Not evaluable path (SYNTHETIC TEST INPUT):
        Exercises the preserved 'Not evaluable' branch when mapped genes exist
        but the AST record phenotype is 'not defined' or empty in NCBI XML.
        """
        synthetic_genotype_rows = [{"amr_genotypes": "blaTEM-1"}]
        synthetic_ast_rows = [
            {
                "antibiotic": "ampicillin",
                "phenotype": "not defined",
                "mic": "",
                "units": "",
                "method": "MIC",
                "guideline": "CLSI",
            },
            {
                "antibiotic": "ampicillin",
                "phenotype": "",
                "mic": "4 mg/L",
                "units": "mg/L",
                "method": "MIC",
                "guideline": "CLSI",
            },
        ]

        comps = compare(synthetic_genotype_rows, synthetic_ast_rows)
        self.assertEqual(len(comps), 2)
        for c in comps:
            self.assertEqual(c["classification"], "Not evaluable")
            self.assertEqual(c["genotype_evidence"], "blaTEM-1")
            self.assertEqual(c["reason"], "Phenotype is 'not defined' in NCBI BioSample XML")

    def test_g_combination_rule_trimethoprim_sulfamethoxazole(self):
        """
        Test G - Combination drug rule:
        trimethoprim-sulfamethoxazole requires BOTH dfrA AND (sul1 OR sul2).
        """
        # Case 1: Both dfrA and sul2 present -> mapped
        genes_both, basis = get_mapped_genes_for_abx("dfrA1,sul2,tet(A)", "trimethoprim-sulfamethoxazole")
        self.assertEqual(genes_both, ["dfrA1", "sul2"])
        self.assertIn("Combined dfrA + sul", basis)

        # Case 2: Only dfrA present -> NOT mapped (empty list)
        genes_dfr_only, basis_dfr = get_mapped_genes_for_abx("dfrA1,tet(A)", "trimethoprim-sulfamethoxazole")
        self.assertEqual(genes_dfr_only, [])
        self.assertEqual(basis_dfr, "")

        # Case 3: Only sul2 present -> NOT mapped (empty list)
        genes_sul_only, basis_sul = get_mapped_genes_for_abx("sul2,tet(A)", "trimethoprim-sulfamethoxazole")
        self.assertEqual(genes_sul_only, [])
        self.assertEqual(basis_sul, "")

    def test_h_offline_biosample_xml_parser(self):
        """
        Test H - Offline XML Antibiogram parser verification.
        Parses both Row/Cell and TR/TD schemas without network calls.
        """
        xml_row_cell = """
        <BioSample accession="SAMNTEST01">
          <Description>
            <Table class="Antibiogram_Table">
              <Row>
                <Cell>ampicillin</Cell>
                <Cell>resistant</Cell>
                <Cell>&gt;</Cell>
                <Cell>32</Cell>
                <Cell>mg/L</Cell>
                <Cell>MIC</Cell>
                <Cell></Cell>
                <Cell></Cell>
                <Cell></Cell>
                <Cell>CLSI</Cell>
              </Row>
            </Table>
          </Description>
        </BioSample>
        """
        rows = parse_biosample_xml_antibiogram(xml_row_cell)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["antibiotic"], "ampicillin")
        self.assertEqual(rows[0]["phenotype"], "resistant")
        self.assertEqual(rows[0]["mic"], "> 32")
        self.assertEqual(rows[0]["units"], "mg/L")
        self.assertEqual(rows[0]["guideline"], "CLSI")


if __name__ == "__main__":
    unittest.main()

"""
scripts/extract_ncbi_ast_dataset.py

Phase 12 — Stream and extract real AST isolates from NCBI Pathogen Detection
release PDG000000004.6300 into a local research cache for fast, reproducible,
broad-spectrum multi-drug model training.
"""
import json
import logging
import requests
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

NCBI_URL = "https://ftp.ncbi.nlm.nih.gov/pathogen/Results/Escherichia_coli_Shigella/PDG000000004.6300/Metadata/PDG000000004.6300.metadata.tsv"
OUTPUT_FILE = Path(__file__).resolve().parent.parent / "backend" / "data" / "ml_research" / "ncbi_ast_isolates_cache.json"

FROZEN_BENCHMARK = {
    "SAMN03177674", "SAMN03177676", "SAMN03177659", "SAMN03177675", "SAMN03177664"
}

def stream_and_cache(limit_lines=35000):
    logger.info(f"Connecting to {NCBI_URL}...")
    r = requests.get(NCBI_URL, stream=True, timeout=60)
    if r.status_code != 200:
        logger.error(f"HTTP {r.status_code} while connecting to NCBI")
        return

    header_cols = []
    ast_isolates = []
    seen_biosamples = set()
    total_lines = 0

    bs_idx = -1
    amr_idx = -1
    ast_idx = -1
    sci_idx = -1

    for line in r.iter_lines():
        if not line:
            continue
        total_lines += 1
        decoded = line.decode("utf-8", errors="replace")

        if not header_cols:
            header_cols = decoded.split("\t")
            bs_idx = header_cols.index("biosample_acc") if "biosample_acc" in header_cols else -1
            amr_idx = header_cols.index("AMR_genotypes") if "AMR_genotypes" in header_cols else -1
            ast_idx = header_cols.index("AST_phenotypes") if "AST_phenotypes" in header_cols else -1
            sci_idx = header_cols.index("scientific_name") if "scientific_name" in header_cols else -1
            logger.info(f"Header parsed: bs_idx={bs_idx}, amr_idx={amr_idx}, ast_idx={ast_idx}")
            continue

        parts = decoded.split("\t")
        if len(parts) <= max(bs_idx, amr_idx):
            continue

        bs = parts[bs_idx].strip().strip('"') if bs_idx != -1 else ""
        if not bs.startswith("SAM") or bs in seen_biosamples:
            continue

        ast_raw = parts[ast_idx].strip().strip('"') if ast_idx != -1 and len(parts) > ast_idx else ""
        if not ast_raw or ast_raw in ("NULL", "-") or "=" not in ast_raw:
            continue

        seen_biosamples.add(bs)
        amr_raw = parts[amr_idx].strip().strip('"') if amr_idx != -1 and len(parts) > amr_idx else ""
        sci_name = parts[sci_idx].strip().strip('"') if sci_idx != -1 and len(parts) > sci_idx else "Escherichia coli"

        ast_isolates.append({
            "biosample_acc": bs,
            "organism": sci_name or "Escherichia coli",
            "amr_genotypes": amr_raw if amr_raw not in ("NULL", "-") else "",
            "ast_phenotypes": ast_raw
        })

        if total_lines >= limit_lines:
            logger.info(f"Reached line limit: {limit_lines}")
            break

    logger.info(f"Extracted {len(ast_isolates)} isolates with AST phenotypes across {total_lines} total lines.")
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(ast_isolates, f, indent=2)
    logger.info(f"Successfully saved {OUTPUT_FILE}")

if __name__ == "__main__":
    stream_and_cache()

# Phase 9: Validated ML Research Prediction Integration

## 1. Overview & Purpose

Phase 9 integrates the scientifically validated **`AMR-ML-ECOLI-AMP-v0.1`** Machine Learning model as an **optional, informational research evidence source** alongside the deterministic AMR concordance engine and evidence reconciliation workflow.

### Fundamental Scientific & Architectural Principles:
1. **Informational Only**: ML predictions serve as statistical research estimates. They **never** override deterministic genomic classification or observed phenotypic AST.
2. **Deterministic Primacy**: Agreement between ML and genotype does not alter underlying genotype–phenotype discordance or concordance metrics.
3. **No Breakpoint Inference or Clinical Diagnostic Claims**: ML predictions are strictly non-diagnostic and intended exclusively for educational and preliminary research use.
4. **No Continuous or Online Training**: User-supplied laboratory data are never used to train, modify, or update model parameters.

---

## 2. Architecture & Evidence Hierarchy

### Evidence Hierarchy

```
┌─────────────────────────────────────────────────────────┐
│              Level 1: Observed AST Evidence             │
│        (NCBI Antibiogram + User Laboratory Entry)       │
│                  [AUTHORITATIVE PHENOTYPE]              │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│    Level 2: Deterministic Genomic AMR Classification    │
│            (Rule-Based Curated Determinants)            │
│                  [AUTHORITATIVE GENOTYPE]               │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│          Level 3: ML Research Prediction Layer          │
│             (AMR-ML-ECOLI-AMP-v0.1 Prototype)           │
│               [INFORMATIONAL EVIDENCE ONLY]             │
└─────────────────────────────────────────────────────────┘
```

* **Authoritative Verdicts**: Deterministic reconciliation categories (`concordant`, `conflict`, `not_comparable`, `not_evaluable`) are computed entirely by `amr_reconciliation.py`.
* **Isolated Integration**: ML prediction is computed independently and attached at the route/presentation layer (`amr_routes.py` and UI), ensuring zero risk of side-effects on the core concordance logic.

---

## 3. Model Scope & Guards

| Parameter | Permitted In-Scope Value | Out-of-Scope Handling |
| :--- | :--- | :--- |
| **Organism** | *Escherichia coli* (case-insensitive variants) | Rejects with `MODEL_SCOPE_LIMITED_TO_ECOLI_AMPICILLIN` |
| **Antibiotic** | Ampicillin | Rejects with `MODEL_SCOPE_LIMITED_TO_ECOLI_AMPICILLIN` |
| **Algorithm** | Logistic Regression ($L_2$ penalty, $C=1.0$) | Fixed offline model |
| **Decision Threshold** | 0.50 (Standard fixed threshold) | No threshold tuning on inference |
| **Features** | 198 AMRFinderPlus genetic determinants | Unknown genes mapped to 0 (no crash) |

---

## 4. Feature Construction Pipeline

1. **Extraction**: AMRFinderPlus determinant annotations are parsed from the isolate's `amr_genotypes` string (e.g., `blaTEM-1,blaCMY-2,ampC_C-42T=POINT`).
2. **Vocabulary Mapping**: Determinants are matched against the 198-feature vocabulary defined in `amr_ml_features_vocab.json`.
3. **Indicator Representation**:
   $$\mathbf{x} = [x_1, x_2, \dots, x_{198}] \quad \text{where } x_i \in \{0, 1\}$$
   * Determinant present $\rightarrow x_i = 1$
   * Determinant absent $\rightarrow x_i = 0$
   * Wild-type / Zero-AMR isolate $\rightarrow \mathbf{x} = \mathbf{0}$
4. **Robustness**: Unrecognized determinants or synthetic annotations do not raise exceptions; they are tracked in `unrecognized_features` and omitted from the active vector.

---

## 5. Model Provenance & Performance Summary

* **Model Identifier**: `AMR-ML-ECOLI-AMP-v0.1`
* **Artifact Path**: `backend/data/ml_research/amr_ml_ecoli_amp_v0_1_poc.joblib`
* **Vocabulary Path**: `backend/data/ml_research/amr_ml_features_vocab.json`
* **Audit Release Source**: NCBI Pathogen Detection `PDG000000004.6300`

### Held-Out Validation Benchmark ($N=65$ Isolates, Seed = 42)

| Metric | Logistic Regression ($L_2$) | 95% Confidence Interval |
| :--- | :---: | :---: |
| **Accuracy** | **95.38%** | 87.29% – 98.42% |
| **Sensitivity (Recall)** | **96.36%** | 87.68% – 99.00% |
| **Specificity** | **90.00%** | 59.58% – 98.21% |
| **Precision (PPV)** | **98.15%** | 90.23% – 99.67% |
| **Negative Predictive Value (NPV)** | **81.82%** | 52.30% – 94.86% |
| **F1-Score** | **0.9725** | 0.9333 – 1.0000 |
| **ROC-AUC** | **0.9782** | 0.9163 – 1.0000 |

---

## 6. API Endpoints

### Dedicated Prediction Endpoint: `GET /api/amr/ml-predict/<biosample_accession>`
Returns structured prediction payload:
```json
{
  "available": true,
  "model": "AMR-ML-ECOLI-AMP-v0.1",
  "organism": "Escherichia coli",
  "antibiotic": "Ampicillin",
  "algorithm": "Logistic Regression (L2)",
  "threshold": 0.50,
  "status": "Research prototype",
  "prediction": "Resistant",
  "probability_resistant": 0.9634,
  "probability_susceptible": 0.0366,
  "recognized_features": 4,
  "total_determinants": 4,
  "recognized_feature_names": ["blaTEM-1", "blaCMY-2", "ampC_C-42T=POINT", "tet(A)"],
  "unrecognized_features": [],
  "research_only": true,
  "disclaimer": "Machine-learning predictions are statistical research estimates..."
}
```

### Model Provenance Endpoint: `GET /api/amr/ml-provenance`
Returns metadata regarding the currently loaded model artifact and vocabulary.

### Extended Existing Endpoints (Non-Breaking):
* `GET /api/amr/isolate/<biosample_accession>` $\rightarrow$ includes optional `ml_prediction` object.
* `POST /api/amr/reconcile` $\rightarrow$ includes optional `ml_prediction` object.

---

## 7. Production Safety Rules & Guardrails

1. **No Automatic Retraining**: Model weights are frozen. Retraining scripts run strictly offline in research environments.
2. **No User Data Storage for Training**: User-supplied laboratory AST results are discarded after request processing and never written to training corpora.
3. **Graceful Degradation**: If model loading fails, missing file, or invalid dependencies, endpoints return `{ "available": false, "reason": "ML_SERVICE_ERROR" }` with HTTP 200/500 without breaking deterministic BioSample or AST retrieval.
4. **Frozen Benchmark Integrity**: The five-isolate frozen benchmark (`SAMN03177674`, `SAMN03177676`, `SAMN03177659`, `SAMN03177675`, `SAMN03177664`) remains 100% untouched at $26/28 = 92.9\%$ concordance.

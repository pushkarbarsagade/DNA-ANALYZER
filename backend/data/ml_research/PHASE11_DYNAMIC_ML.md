# Phase 11: Dynamic Multi-Organism / Multi-Antibiotic AMR Machine Learning Framework

## 1. Executive Overview & Architecture

Phase 11 transforms the single-model prototype (`AMR-ML-ECOLI-AMP-v0.1`) into a **Dynamic Multi-Organism / Multi-Antibiotic AMR Machine Learning Framework**. 

Rather than manually coding dedicated endpoints and services for each organism or drug, the platform utilizes an automated, registry-driven architecture:

```
                         NCBI BIGQUERY / DATASET
                                   │
                                   ▼
                         DATASET DISCOVERY
                       (amr_ml_dataset.py)
                                   │
                                   ▼
                   Organism × Antibiotic Combinations
                                   │
                                   ▼
                         QUALITY FILTERING
                  (S/R explicit, zero-vector x=0,
                  exclude 5 benchmark isolates)
                                   │
                                   ▼
                        AUTOMATED TRAINING
                       (amr_ml_trainer.py)
                    (Grouped Isolate Split 80/20,
                    L2 Logistic Regression baseline)
                                   │
                                   ▼
                         VALIDATION GATES
                  (Sensitivity ≥ 0.90, F1 ≥ 0.90,
                   ROC-AUC ≥ 0.90, 0 Isolate Leakage)
                                   │
                                   ▼
                      VALIDATED MODEL REGISTRY
                    (amr_model_registry.py)
                  (model_registry.json, versioned)
                                   │
                                   ▼
                         DYNAMIC INFERENCE
                       (amr_ml_service.py)
                  (Lazy loading, cached per scope)
                                   │
                                   ▼
                     EVIDENCE RECONCILIATION UI
                  (EvidenceReconciliation.jsx)
                 (Dynamic predictions per AST drug,
                     Visually subordinate card)
```

### Core Invariants:
1. **The system does not automatically learn from user laboratory submissions.** User-entered phenotypes are evaluated strictly for evidence reconciliation and never persist into ML training corpora.
2. **ML predictions are research-only and subordinate to observed AST and deterministic evidence.** ML predictions cannot alter deterministic concordance categories (`concordant`, `conflict`, `not_comparable`, `not_evaluable`) or observed laboratory phenotypes.
3. **Model availability depends on validated organism–antibiotic training datasets.** If no validated model exists for an organism–antibiotic pair, the platform explicitly reports `available: false` with reason `no_validated_model`. An unrelated model is **never** used as a fallback.
4. **Frozen Benchmark Integrity:** The five frozen benchmark isolates (`SAMN03177674`, `SAMN03177676`, `SAMN03177659`, `SAMN03177675`, `SAMN03177664`) remain 100% excluded from ML training and testing, and their deterministic concordance remains exactly **$26/28 = 92.9\%$**.

---

## 2. Dataset Discovery (`amr_ml_dataset.py`)

The dataset discovery service inspects NCBI Pathogen Detection data (either via Google BigQuery `ncbi-pathogen-detect.pdbrowser.isolates` or structured local snapshots) and identifies candidate (organism, antibiotic) combinations.

### Eligibility Filtering Rules:
- **Binary Phenotype Targeting:** Only explicit `Susceptible` (0) and `Resistant` (1) labels are accepted.
- **Strict Exclusion:** Intermediate (`I`), Not Defined (`ND`), non-standard annotations, and MIC-only values without clinical breakpoint interpretations are strictly excluded.
- **No Inferred Breakpoints:** Breakpoints are never inferred or computed from raw MIC numbers.
- **Isolate Deduplication:** Observations for the same BioSample accession are deduplicated.
- **Zero-Determinant Inclusion:** Isolates with 0 AMRFinderPlus calls are preserved as all-zero feature vectors ($\mathbf{x} = \mathbf{0}$) to prevent resistance selection bias.
- **Benchmark Exclusion:** All five frozen validation isolates are permanently excluded.

### Conservative Quality Thresholds:
- `MIN_TOTAL_ISOLATES = 100`
- `MIN_PER_CLASS = 20` (minority class sample size)

---

## 3. Automated Training Pipeline & Grouped Validation (`amr_ml_trainer.py`)

When an eligible candidate combination is trained:

1. **Grouped Isolate Splitting (`GroupShuffleSplit`):**
   - Partition: 80% training / 20% held-out test.
   - Grouping unit: `biosample_acc`.
   - Invariant: $\text{Train} \cap \text{Test} = \emptyset$ (zero isolate leakage).
2. **Feature Construction:**
   - The feature vocabulary is generated deterministically from the training set partition.
   - Matrices $\mathbf{X}_{\text{train}}$ and $\mathbf{X}_{\text{test}}$ are populated as binary indicators ($1$ if determinant present, $0$ otherwise).
3. **Model Fitting:**
   - Standard $L_2$-regularized Logistic Regression ($C=1.0$, fixed threshold $0.50$, random seed $42$).
4. **Independent Metric Evaluation:**
   - Accuracy, Sensitivity (Recall), Specificity, Precision (PPV), Negative Predictive Value (NPV), F1-Score, and ROC-AUC.
   - Very Major Error (VME / False Susceptible) and Major Error (ME / False Resistant).
   - 95% Confidence Intervals via Wilson score and bootstrap resampling.

---

## 4. Automated Validation Gates

A candidate model is registered as `validated` **only** if it satisfies all project validation gates:

| Gate | Criterion | Action on Failure |
| :--- | :---: | :--- |
| **Total Cohort Size** | $\ge 100$ isolates | Rejected (`insufficient_total_isolates`) |
| **Minority Class Size**| $\ge 20$ isolates | Rejected (`insufficient_minority_class`) |
| **Isolate Leakage** | $0$ overlapping BioSamples | Rejected (`isolate_leakage_detected`) |
| **Benchmark Leakage**| $0$ frozen benchmark isolates | Rejected (`benchmark_contamination`) |
| **Sensitivity** | $\ge 0.90$ ($90.0\%$) | Rejected (`sensitivity_below_gate`) |
| **F1-Score** | $\ge 0.90$ | Rejected (`f1_below_gate`) |
| **ROC-AUC** | $\ge 0.90$ | Rejected (`roc_auc_below_gate`) |

Rejected models are recorded in the registry with `status: "rejected"` and their specific failure reasons, but are **never exposed to user-facing inference routes**.

---

## 5. Model Registry & Versioning (`amr_model_registry.py`)

The Model Registry persists model metadata in `backend/data/ml_research/model_registry.json`.

### Registered Model Fields:
```json
{
  "model_id": "AMR-ML-ECOLI-AMP-v0.1",
  "model_version": "AMR-ML-ECOLI-AMP-v0.1",
  "organism": "Escherichia coli",
  "organism_key": "escherichia_coli",
  "antibiotic": "Ampicillin",
  "antibiotic_key": "ampicillin",
  "status": "validated",
  "model_path": "backend/data/ml_research/amr_ml_ecoli_amp_v0_1_poc.joblib",
  "vocabulary_path": "backend/data/ml_research/amr_ml_features_vocab.json",
  "algorithm": "Logistic Regression (L2)",
  "threshold": 0.50,
  "feature_count": 223,
  "n_isolates": 321,
  "susceptible_count": 72,
  "resistant_count": 249,
  "validation_metrics": {
    "accuracy": 0.9538,
    "sensitivity": 0.9636,
    "specificity": 0.9000,
    "f1": 0.9725,
    "roc_auc": 0.9782,
    "tp": 53, "fp": 1, "fn": 2, "tn": 9,
    "vme": 0.0364, "me": 0.1000, "test_n": 65
  },
  "training_release": "PDG000000004.6300",
  "research_only": true,
  "created_at": "2026-09-12T09:56:00Z"
}
```

### Versioning Policy:
- Model artifacts are versioned: `AMR-ML-<ORGANISM_CODE>-<ANTIBIOTIC_CODE>-v<MAJOR>.<MINOR>.joblib`.
- Older model artifacts are never overwritten.
- When an updated model is trained, it is compared against the active version. It is promoted **only** if it passes all validation gates and achieves an F1-score greater than or equal to the previous version.

---

## 6. Dynamic Inference & BioSample Integration (`amr_ml_service.py`)

When any BioSample is evaluated:

1. **Resolution:** The organism, AMRFinderPlus determinants, and AST antibiogram are retrieved via the BigQuery provider.
2. **Dynamic Matching:** For each antibiotic tested in the antibiogram, the service queries the Model Registry.
3. **Lazy Execution:** If a validated model exists, it is loaded once from disk and cached in memory. Feature vectors are constructed; unknown mutations safely map to 0 without shifting index positions.
4. **Structured Response:**
   ```json
   {
     "biosample": "SAMN03177675",
     "organism": "Escherichia coli",
     "total_drugs": 16,
     "available_count": 1,
     "predictions": [
       {
         "antibiotic": "Ampicillin",
         "available": true,
         "prediction": "Resistant",
         "predicted_probability": 0.9631,
         "probability_resistant": 0.9631,
         "probability_susceptible": 0.0369,
         "model_version": "AMR-ML-ECOLI-AMP-v0.1",
         "threshold": 0.50,
         "recognized_features": 3,
         "total_determinants": 3
       },
       {
         "antibiotic": "Ceftriaxone",
         "available": false,
         "reason": "no_validated_model"
       }
     ]
   }
   ```
5. **Terminology:** The probability is explicitly labeled **"Predicted Resistance Probability"**, never "confidence score" or "clinical certainty".

---

## 7. BigQuery Relationship & Cost Control

1. **Read Efficiency:** Normal user requests query BigQuery by BioSample accession with `LIMIT 1`, utilizing cached query results ($1$-hour TTL). User searches **never** trigger model training or full-table scans.
2. **Batch Training Queries:** Candidate discovery and dataset extraction use targeted aggregation and bounded sampling (`LIMIT 50000`), minimizing bytes processed.
3. **Graceful Offline Fallback:** If `BIGQUERY_PROJECT_ID` is unconfigured, the system returns structured diagnostics without crashing or inventing synthetic data.

---

## 8. Current Validated Models

| Model Version | Organism | Antibiotic | Samples ($N$) | Features | Accuracy | Sensitivity | Specificity | F1-Score | ROC-AUC | Status |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **AMR-ML-ECOLI-AMP-v0.1** | *Escherichia coli* | Ampicillin | 321 | 223 | **95.38%** | **96.36%** | **90.00%** | **0.9725** | **0.9782** | **Validated** (Active) |

*All other organism–antibiotic combinations currently report `available: false` (`no_validated_model`) until candidate models pass the validation gates.*

---

## 9. Future Scheduled Retraining Foundation

The command-line training pipeline (`scripts/train_amr_models.py`) provides a deterministic entry point suitable for periodic scheduling (e.g. monthly cron or Cloud Run Job). Because model versioning, disjoint isolate splitting, and validation gating are fully automated, new NCBI snapshots can be ingested safely with automated promotion only upon passing all quality gates.

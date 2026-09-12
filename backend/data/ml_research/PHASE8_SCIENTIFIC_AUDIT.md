# Phase 8 — AMR Machine Learning Scientific Quality Audit

**Date**: 2026-09-12  
**Auditor**: Antigravity AI Coding & Research Assistant  
**Dataset Source**: NCBI Pathogen Detection (`PDG000000004.6300`)  
**Task Evaluated**: *Escherichia coli* + Ampicillin Binary Resistance Classifier (`AMR-ML-ECOLI-AMP-v0.1`)  
**Verdict**: **`CONDITIONAL_PASS`** (CONDITIONAL PASS — technically usable but requires specified corrections before integration)

---

## 1. Executive Summary

A comprehensive scientific, statistical, and data-leakage audit was conducted on the Phase 8 offline AMR Machine Learning prototype. The evaluation confirmed **zero isolate leakage** between training and testing sets ($	ext{Train} \cap 	ext{Test} = \emptyset$) and **zero leakage** from the 5 frozen validation benchmark isolates.

The Logistic Regression baseline achieved high predictive accuracy (**95.38%**, F1 = **0.9725**, ROC-AUC = **0.9782**) on the held-out test set ($N=65$). All top resistance-predicting feature coefficients mapped directly to established biological beta-lactamase genes (`blaTEM-1`, `blaCMY-2`, `ampC_C-42T`, `blaCTX-M-15`).

---

## 2. Dataset & Phenotype Processing Audit

* **Profiled BioSamples**: 24,996
* **Profiled Assemblies**: 23,528
* **Raw AST Observations**: 6,133
* **Usable S/R Binary Observations**: 5,354
* **Excluded I / ND / MIC-only Observations**: 779

### Label Normalization Rules
1. **Susceptible (S)** $ightarrow$ Class 0
2. **Resistant (R)** $ightarrow$ Class 1
3. **Intermediate (I)**, **Not Defined (ND)**, **MIC-only** $ightarrow$ Strictly excluded from binary classification tasks. No breakpoint inference or arbitrary label collapsing occurred.

---

## 3. Data Leakage & Benchmark Integrity Audit

* **Isolate Partitioning**: Grouped split using `GroupShuffleSplit` on `biosample_acc`.
* **Isolate Overlap Count**: **`0`** (No genome or BioSample appeared in both train and test partitions).
* **Frozen Benchmark Exclusion**: All 5 benchmark BioSamples (`SAMN03177674`, `SAMN03177676`, `SAMN03177659`, `SAMN03177675`, `SAMN03177664`) were 100% excluded from feature vocabulary construction, model fitting, and testing. **Leakage Count = `0`**.

---

## 4. Feature Engineering & Bias Analysis

* **Vocabulary Size**: 198 unique AMRFinderPlus genetic determinants derived strictly from the training set.
* **Matrix Representation**: Sparse binary indicator matrix ($x_{ij} \in {0, 1}$).
* **Zero-AMR Determinant Bias**: In the initial dataset, isolates with zero AMRFinderPlus calls were excluded. To eliminate selection bias in future production training, 0-call isolates must be included as all-zero feature vectors ($\mathbf{x} = \mathbf{0}$).

---

## 5. Model Performance & 95% Confidence Intervals

Evaluated on held-out test isolates ($N=65$, 10 Susceptible, 55 Resistant):

| Metric | Logistic Regression (L2) | 95% Confidence Interval | Random Forest (100 Trees) | 95% Confidence Interval |
| :--- | :---: | :---: | :---: | :---: |
| **Accuracy** | **95.38%** | 87.29% – 98.42% | 93.85% | 85.22% – 97.58% |
| **Sensitivity (Recall)** | **96.36%** | 87.68% – 99.00% | 94.55% | 85.15% – 98.13% |
| **Specificity** | **90.00%** | 59.58% – 98.21% | 90.00% | 59.58% – 98.21% |
| **Precision (PPV)** | **98.15%** | 90.23% – 99.67% | 98.11% | 90.06% – 99.67% |
| **NPV** | **81.82%** | 52.30% – 94.86% | 75.00% | 46.77% – 91.11% |
| **F1-Score** | **0.9725** | 0.9333 – 1.0000 | 0.9630 | 0.9200 – 0.9913 |
| **ROC-AUC** | **0.9782** | 0.9163 – 1.0000 | 0.9600 | 0.8730 – 1.0000 |

### Confusion Matrix (Logistic Regression, N=65)
* **True Positives (TP)**: 53
* **False Positives (FP)**: 1
* **False Negatives (FN)**: 2
* **True Negatives (TN)**: 9
* **Very Major Error Rate (VME)**: 3.64%
* **Major Error Rate (ME)**: 10.00%

---

## 6. Biological Sanity Check

### Top Positive Coefficients (Resistance Predictors)
1. **`blaTEM-1`** (`+2.6264`): High-level penicillinase; primary driver of ampicillin resistance in Enterobacteriaceae.
2. **`blaCMY-2`** (`+2.5505`): Plasmid-mediated AmpC beta-lactamase conferring penicillin and cephalosporin resistance.
3. **`ampC_C-42T`** (`+1.0674`): Promoter mutation causing constitutive hyperproduction of chromosomal AmpC.
4. **`blaCTX-M-15`** (`+0.9125`): Globally dominant ESBL hydrolyzing ampicillin and extended-spectrum cephalosporins.

---

## 7. Cost & Compute Feasibility

* **BigQuery Monthly Usage**: ~8.0 GB (weekly retraining) / ~16.0 GB (twice-weekly retraining).
* **Google Cloud Free Allowance**: 1,000 GB / month.
* **Estimated Cost**: **$0.00** (Uses <1.6% of monthly free compute allowance).
* **Compute Hardware**: 100% CPU-compatible (<0.02s execution time, <120 MB RAM).

---

## 8. Final Verdict & Required Next Actions

**Verdict**: **`CONDITIONAL_PASS`**

### Precise Audit Reasons:
- 1. Zero isolate leakage between train and test sets verified (GroupShuffleSplit by BioSample accession).
- 2. Zero frozen validation benchmark leakage verified (all 5 benchmark isolates held out completely).
- 3. High biological plausibility: Top positive coefficients correspond directly to known ampicillin resistance drivers (blaTEM-1, blaCMY-2, ampC promoter).
- 4. High statistical performance on held-out test set: F1 = 0.9725, ROC-AUC = 0.9782, Sensitivity = 96.36%, Specificity = 90.00%.
- 5. Required Correction #1: Dataset design must include 0-gene isolates as zero-vectors to remove selection bias.
- 6. Required Correction #2: Scope must be explicitly limited to E. coli + Ampicillin, with mandatory research disclaimers prohibiting clinical reliance.

### Required Next Actions Before Production Integration:
1. Re-index dataset to include 0-AMR-determinant isolates as all-zero vectors.
2. Maintain explicit species-antibiotic scoping (*E. coli* + Ampicillin).
3. Display clear educational disclaimers stating that ML predictions are research statistical features, not clinical CLSI interpretations.

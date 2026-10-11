# Batch Normalization reproduction: fidelity report

## Executive verdict

**MNIST: partial quantitative reproduction, with matched architecture/data/update budget.** At 50,000 updates, BN has a paired accuracy gain of **0.29 ± 0.10 percentage points** across three fixed seeds. The source graph's last plotted points are approximately 97.23% without BN and 98.16% with BN (±0.3pp digitization allowance), implying about 0.93pp gain. The observed gain is smaller. Optimizer and initialization assumptions materially affect the trajectories; this is not an exact training-curve reproduction.

**ImageNet: declared real-data, small-scale proxy only, not a reproduction of ImageNet absolute accuracy.** All five recipes were independently trained for 60 epochs on real Imagenette images. The paper ordering is **BN-x30 > BN-x5 > BN-Baseline > Inception > BN-x5-Sigmoid**; proxy maximum-development ordering is **BN-x5 > BN-x30 > BN-x5-Sigmoid > BN-Baseline > Inception**. Adding BN alone changes held-out accuracy from **53.03% to 62.77%**, a paired gain of **9.73 ± 1.69pp**. The best maximum-development recipe is **BN-x5**, so the source's higher final BN-x30 accuracy is not recovered as the proxy mean ranking. The close x5/x30 estimates are not a statistically established ordering with only three seeds. The original 74.8% top-1, 7.82% top-5 error, 14× training-speedup and 4.82% ensemble test-error claims are **not reproduced or validated by this reduced task**.

## 1. Source interpretation and core contributions

Source: Ioffe & Szegedy (2015), [arXiv:1502.03167](https://arxiv.org/abs/1502.03167), cross-checked against the [published ICML paper](https://proceedings.mlr.press/v37/ioffe15.html). PDFs and extracted text are included in `sources/`.

Two corrections to the request: Figure 1a is a **784→100→100→100→10 sigmoid fully connected network, not convolutional LeNet**. Neither downloaded paper version labels “Table 1 column B”; the ImageNet target is interpreted as the **maximum single-crop accuracy column of Figure 3**. Every five-row value is reproduced in the comparison table as a reference, not as a measured result on our dataset. Figure 4 separately gives BN-Inception single-crop 25.2% top-1 error and 7.82% top-5 error.

Priority contributions are (1) differentiable per-feature normalization with learned gamma/beta; (2) unbiased running-variance inference; (3) BN before sigmoid/ReLU and channelwise batch/spatial statistics; (4) faster/higher-accuracy MNIST learning; and (5) higher-LR and reduced-regularization ImageNet recipes. Accuracy results alone do not identify the causal mechanism or establish that reducing internal covariate shift explains BN's benefit.

## 2. Scope, implementation and setup

**In scope:** independent PyTorch implementation, CPU-only float32, from-scratch weights, full real MNIST, all five single-network recipes on a declared downscaled ImageNet subset, three paired seeds, quantitative comparisons, complete logs/checkpoints/scripts. **Out of scope:** full 1,000-class ImageNet, original 13.6M-parameter network and distributed schedule, ensemble/multicrop/server submission, Figure 1b/c activation distributions, causal explanation. The detailed source-component→module→config→script mapping is in [`REPRODUCTION_PLAN.md`](../REPRODUCTION_PLAN.md).

| Setup | MNIST | ImageNet proxy |
|---|---|---|
| Data | Full canonical 60,000 train / 10,000 test | Real Imagenette v2 ten ImageNet classes |
| Input | Binary 28×28, raw/255>.5 | Center-cropped 48×48 RGB, normalization |
| Network | Paper's three 100-unit sigmoid layers | Three independent four-branch Inception modules, double 3×3 branch |
| Baseline parameters | 99,710 | 31,770 |
| Training | 50,000 updates, batch 60 = 50 passes | 60 epochs, batch 32,47 updates/epoch =2,820 updates |
| Optimizer | SGD lr 0.1,momentum 0.9 | SGD base lr 0.01,momentum 0.9; LR multipliers 1/5/30 |
| Regularization | No dropout/decay | Baseline dropout 0.4/LRN/L2 0.0005; modified no dropout/LRN,L2 ÷ 5 |
| Schedule | Constant LR | Exponential ×0.1 per 240 baseline epochs/per 40 modified epochs |
| Repeats | Seeds 17, 29, 43 | Same seeds, same fixed split |
| Evaluation | Fixed final-step test; interim test trace | Test selected and final checkpoints after training/dev-selection; repeated for verification |

Dataset split: 1,500 train / 500 development from disjoint official training images, 1,000 test from official validation images. Every class has 150/50/100 examples; paths and SHA256s are in `imagenette_manifest.json`, selection seed 2026. Archive SHA256:`64d0c4859f35a461889e0147755a999a48b49bf38a7e0f9bd27003f10db02fe5`. No synthetic data or pretrained models are used. The test is never used for tuning/checkpoint selection. Development maxima can nevertheless overestimate generalization; the held-out column is the stronger evidence. Seeds measure initialization/order variability on **one fixed data split**, not dataset-sampling uncertainty.

CPU runtime: Python 3.11.15, PyTorch 2.5.1+cpu, NumPy 2.4.6, Matplotlib 3.11.1. Resource quota 3 CPU cores/8GiB; up to 3 one-thread runs concurrently. Sum of measured run wall times is 51.3 minutes; parallel scheduling means this is not total elapsed job time. Full dependency snapshot:`environment_freeze.txt`.

## 3. MNIST Figure 1a

**Primary metric:** fixed 50k-update test accuracy, mean±sample SD over 3 seeds. Paper values are last visible plotted points, **not an exact published 50k table**. The baseline curve's last vector point is at ≈44.1k updates; BN's at ≈49.1k. No extrapolation to 50k is performed.

| Network | Paper last plotted test accuracy(%) | Reproduced 50k test accuracy(%) | Descriptive gap(pp) |
|---|---:|---:|---:|
| Without-BN | ≈97.23 (±0.3 digitization) | 97.36 ± 0.04 | +0.13 |
| With-BN | ≈98.16 (±0.3 digitization) | 97.65 ± 0.08 | -0.52 |

![Figure 1a reproduction with paper vector curves](figures/mnist_figure1.png)

For a same-update comparison, source polylines are interpolated **only inside their observed domain**:

| Network | Updates | Paper graph accuracy(%) | Reproduced mean±SD(%) | Gap(pp) |
|---|---:|---:|---:|---:|
| Without-BN | 10000 | ≈92.58 | 96.83 ± 0.03 | +4.26 |
| Without-BN | 20000 | ≈96.26 | 97.37 ± 0.08 | +1.11 |
| Without-BN | 30000 | ≈96.75 | 97.36 ± 0.06 | +0.61 |
| Without-BN | 40000 | ≈97.17 | 97.35 ± 0.07 | +0.18 |
| With-BN | 10000 | ≈96.57 | 97.19 ± 0.10 | +0.62 |
| With-BN | 20000 | ≈97.44 | 97.38 ± 0.20 | -0.06 |
| With-BN | 30000 | ≈97.82 | 97.66 ± 0.09 | -0.16 |
| With-BN | 40000 | ≈98.00 | 97.70 ± 0.09 | -0.31 |

Digitization is reproducible via `src/digitize_paper.py`: actual PDF vector paths are calibrated using 10k/50k and 70%/100% ticks; the original 0.65-point curve width corresponds to about ±0.24pp, conservatively rounded to ±0.3pp. This allowance is not statistical uncertainty. Source points/calibration/hash are retained in `sources/published_mnist_vectors.*`. There are no exact source MNIST numbers to compare beyond these graph estimates.

First observed fixed test threshold crossings, resolution 1,000 updates; seed order 17, 29, 43. Crossings are not interpolated and are not necessarily sustained:

| Network | Target | Updates per seed |
|---|---:|---|
| Without-BN | 90% | 1000, 1000, 1000 |
| Without-BN | 95% | 3000, 2000, 2000 |
| Without-BN | 97% | 13000, 9000, 14000 |
| With-BN | 90% | 1000, 1000, 1000 |
| With-BN | 95% | 3000, 3000, 3000 |
| With-BN | 97% | 6000, 8000, 8000 |

At 90%, first observed crossings are [1000, 1000, 1000] without BN and [1000, 1000, 1000] with BN; at 95%, they are [3000, 2000, 2000] versus [3000, 3000, 3000]. The original pronounced early-optimization speedup is therefore not established by the endpoint improvement alone.

Interpretation: compare the endpoint gain and matched-step rows, not just final accuracy. A baseline that learns substantially faster than the source baseline indicates a gap in the missing optimizer/initialization details even when final accuracy is close. No post-hoc test-based tuning was done.

## 4. ImageNet classification maximum-accuracy column: proxy comparison

Paper reference metric is maximum **1,000-class ImageNet validation** top-1 accuracy. Proxy primary analog is maximum **10-class development** accuracy; the development-selected checkpoint is evaluated on a separate held-out test. All percentages use single deterministic crops. **The signed gap column is numerically descriptive and NOT a meaningful same-benchmark accuracy difference.**

| Recipe | Paper ImageNet max top-1(%) | Proxy best-dev mean±SD(%) | Proxy selected-test mean±SD(%) | Proxy final-test mean±SD(%) | Dev minus paper(pp; NOT comparable) |
|---|---:|---:|---:|---:|---:|
| Inception | 72.2 | 56.00 ± 0.87 | 53.03 ± 1.42 | 53.30 ± 1.85 | -16.20 |
| BN-Baseline | 72.7 | 64.20 ± 1.91 | 62.77 ± 1.27 | 62.50 ± 0.66 | -8.50 |
| BN-x5 | 73.0 | 66.33 ± 1.55 | 65.07 ± 1.76 | 65.00 ± 1.85 | -6.67 |
| BN-x30 | 74.8 | 65.80 ± 0.92 | 64.97 ± 1.01 | 65.00 ± 1.15 | -9.00 |
| BN-x5-Sigmoid | 69.8 | 65.53 ± 1.90 | 63.60 ± 0.61 | 63.67 ± 0.49 | -4.27 |

![Real Imagenette proxy learning curves](figures/imagenette_training.png)

Paired held-out top-1 gains across the same seed and split:

| Comparison | Test accuracy gain(pp),mean±SD |
|---|---:|
| BN-Baseline vs Inception | 9.73 ± 1.69 |
| BN-x5 vs Inception | 12.03 ± 1.72 |
| BN-x30 vs Inception | 11.93 ± 0.55 |
| BN-x5-Sigmoid vs Inception | 10.57 ± 1.88 |

Steps-to-accuracy fidelity: the original 31M/13.3M/2.1M/2.7M values target 72.2% on 1,000 classes. Here each seed targets **its own proxy Inception maximum development accuracy**, so ratios assess a local training trend only. Evaluation interval is 47 updates; comparisons are noisy and based on first observed crossing. The same 72.2% on ten classes would not establish original training acceleration.

| Recipe | Paper steps to 72.2% ImageNet | Proxy updates to same-seed baseline-best(seed 17, 29, 43) | Proxy baseline/recipe update ratio,mean±SD |
|---|---:|---|---:|
| Inception | 31.0M | 2632, 2679, 2726 | 1.00 ± 0.00 |
| BN-Baseline | 13.3M | 1034, 1316, 705 | 2.82 ± 0.94 |
| BN-x5 | 2.1M | 517, 611, 611 | 4.65 ± 0.39 |
| BN-x30 | 2.7M | 611, 658, 987 | 3.71 ± 0.83 |
| BN-x5-Sigmoid | not reached | 1410, 1128, 1128 | 2.22 ± 0.31 |

Proxy top-5 is included in `aggregate_metrics.json` and `per_seed_metrics.csv`, but it is particularly non-comparable: chance top-5 is 50% for ten classes versus 0.5% for 1,000. Do not interpret proxy top-5 gains as replication of 7.82% single-crop or 4.82% ensemble error.

## 5. Fidelity assessment and deviations

| Claim/component | Fidelity status | Reason |
|---|---|---|
| BN equations, differentiability, affine transform | High implementation fidelity | Independent equations and optimized primitive agree numerically; forward/backward/gradcheck verified |
| Training biased variance / inference unbiased variance | High implementation fidelity | Moving statistics and batch-invariant inference tested |
| MNIST architecture,data,batch,update budget | High | Same dimensions/nonlinearity and full dataset; binary-threshold convention assumed |
| MNIST numerical trajectories/endpoints | Partial | Smaller gain and trajectory gaps; optimizer/init/std not published |
| Convolutional BN and double 3×3 Inception branches | Mechanism faithful | All proxy conv nonlinearities preceded by BN when enabled |
| ImageNet absolute accuracy or original ranking | Not established | Ten-class 48px subset, small architecture, changed optimizer scale and 60-epoch budget |
| Original 14× / 7% update budget headline | Not reproduced | No full distributed ImageNet experiment; proxy speed ratios have a different target |
| Sigmoid deep-network viability | Proxy evidence only | Its actual curve/results retained, not claimed original 69.8% parity |
| Ensemble/server top-5 error | Out of scope | No ensemble,144 crops or server access |
| Internal-covariate-shift causal explanation | Not tested | Predictive accuracy cannot resolve mechanism |

All assumptions were recorded before final runs in `REPRODUCTION_PLAN.md` and locked in `configs/reproduction.json`. Critical unreported details: MNIST optimizer/LR/momentum/Gaussian std, binary threshold, epsilon, moving-average coefficient; ImageNet exact momentum/L2/decay/initialization/augmentation. CPU deviations: synchronous single-model training instead of distributed asynchronous SGD; three-module standard 3×3 stem/maxpool proxy instead of paper's ten-module/separable 7×7 stem architecture. Modern Kaiming initialization for proxy convolutions (including sigmoid); normal std 0.01 classifier. Original baseline LR 0.0015 becomes 0.01, preserving 5×/30× ratios, not absolute rates. L2 excludes biases and BN affine parameters. Photometric distortion is simplified to brightness/contrast (0.7–1.3 baseline vs 0.9–1.1 modified) and crop/flip. All models use equally thorough full shuffling, so the source's extra 1 pp within-shard-shuffle improvement is not separately tested. Cache resizing changes augmentations and loses original high-resolution information. Sixty epochs is the complete declared proxy budget, not original training convergence.

Implementation uses PyTorch's `F.batch_norm` CPU kernel for throughput and independently implemented differentiable normalization equations for correctness testing; no official/model-reference repository is imported. Package/runtime initially lacked advertised PyTorch/pip; CPU dependencies were installed in the configured writable `.pypackages`, without a virtual environment. Installation attempts/errors and successful output are logged.

## 6. Per-seed results and reproducibility

| Dataset | Seed | Recipe | Primary accuracy(%) | Selected/final-MNIST test(%) | Selected epoch/step |
|---|---:|---|---:|---:|---:|
| MNIST | 17 | Without-BN | 97.40 | 97.40 | 50000 |
| MNIST | 29 | Without-BN | 97.33 | 97.33 | 50000 |
| MNIST | 43 | Without-BN | 97.35 | 97.35 | 50000 |
| MNIST | 17 | With-BN | 97.57 | 97.57 | 50000 |
| MNIST | 29 | With-BN | 97.65 | 97.65 | 50000 |
| MNIST | 43 | With-BN | 97.72 | 97.72 | 50000 |
| Imagenette_PROXY | 17 | Inception | 55.60 | 54.00 | 56 |
| Imagenette_PROXY | 29 | Inception | 57.00 | 51.40 | 57 |
| Imagenette_PROXY | 43 | Inception | 55.40 | 53.70 | 58 |
| Imagenette_PROXY | 17 | BN-Baseline | 63.20 | 61.80 | 59 |
| Imagenette_PROXY | 29 | BN-Baseline | 63.00 | 62.30 | 48 |
| Imagenette_PROXY | 43 | BN-Baseline | 66.40 | 64.20 | 55 |
| Imagenette_PROXY | 17 | BN-x5 | 64.60 | 64.10 | 39 |
| Imagenette_PROXY | 29 | BN-x5 | 67.60 | 64.00 | 54 |
| Imagenette_PROXY | 43 | BN-x5 | 66.80 | 67.10 | 42 |
| Imagenette_PROXY | 17 | BN-x30 | 64.80 | 65.90 | 35 |
| Imagenette_PROXY | 29 | BN-x30 | 66.00 | 63.90 | 39 |
| Imagenette_PROXY | 43 | BN-x30 | 66.60 | 65.10 | 39 |
| Imagenette_PROXY | 17 | BN-x5-Sigmoid | 63.60 | 62.90 | 43 |
| Imagenette_PROXY | 29 | BN-x5-Sigmoid | 67.40 | 64.00 | 60 |
| Imagenette_PROXY | 43 | BN-x5-Sigmoid | 65.60 | 63.90 | 60 |

Run from any working directory:

```bash
bash /home/novix/workspace/project/entrypoint.sh
# Fully retrain from scratch instead of reusing complete validated runs:
bash /home/novix/workspace/project/entrypoint.sh --force
```

The entrypoint installs/checks CPU dependencies, runs the numerical/data-integrity tests, fetches real datasets if absent, executes all training/evaluation, and regenerates tables/figures/report. Default reuse is transparent and guarded by a config+training-code+dataset-cache/provenance SHA256 fingerprint and expected output presence. `--force` executes all training again with fixed seeds. Training caches are not substituted for missing data; missing real sources cause a clear failure. Two independent full-budget executions, including a fresh entrypoint --force run, gave exactly equal endpoint accuracies/losses and checkpoint-selection epochs for all 21 runs; see repeatability.json. Identical runtime is expected to reproduce deterministic metrics; wall-clock times vary. Cross-version/platform bitwise reproducibility is not asserted.

Artifacts: `comparison.csv`, `per_seed_metrics.csv`, `mnist_matched_steps.csv`, `mean_training_curves.csv`, `threshold_steps.csv`, `aggregate_metrics.json`; raw 50k/60-epoch CSV traces and per-seed `summary.json`, `run_config.json`, `completion.json`, `train.log`; full selected and last-image-model checkpoint states; immutable split/source manifests; source PDFs/reference values; environment snapshot; 22 unit tests. Light/dark PNG/SVG figures and underlying CSV table views are provided; labels/line styles distinguish entities without relying only on color.
## 7. Recommended next steps

1. Obtain the original MNIST optimizer, Gaussian variance and binary-input convention from the authors; preregister a training-only/dev-only sensitivity study over these missing settings, without tuning on the final test curve.
2. Run the appendix architecture on a larger 1,000-class ImageNet subset at 224px, preserving all classes. Add data-scale/width/resolution ablations before claiming that the proxy trend transfers.
3. With sufficient compute/data access, use full ImageNet and the published absolute LR/distributed scheduling details; evaluate exact single-crop protocol. Only this can validate 74.8%/14× headline claims.
4. Add controlled one-change-at-a-time BN recipe ablations and higher-LR non-BN controls; the five bundled recipes do not independently identify each change's contribution.
5. Increase seeds and use several predeclared data splits for proxy uncertainty; three fixed-split seeds are useful diagnostics, not robust significance evidence.
6. Study training-time activation distributions/gradient behavior separately if testing internal-covariate-shift explanations is desired.

## References

- Ioffe, S. & Szegedy, C. (2015). *Batch Normalization: Accelerating Deep Network Training by Reducing Internal Covariate Shift*. ICML, PMLR 37:448–456. https://proceedings.mlr.press/v37/ioffe15.html ; https://arxiv.org/abs/1502.03167 .
- FastAI. *Imagenette*: real ten-class ImageNet subset. https://github.com/fastai/imagenette ; https://s3.amazonaws.com/fast-ai-imageclas/imagenette2-160.tgz .
- MNIST canonical IDX mirrors: https://storage.googleapis.com/cvdf-datasets/mnist/ and https://ossci-datasets.s3.amazonaws.com/mnist/ . Individual source checksums in `mnist_provenance.json`.

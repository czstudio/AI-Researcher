# autoresearch + mlx-sim absorption (2026-10-17)

## Sources

- `novix-science/autoresearch` `master` @ `29a5846ba40f25c24ce316c50fe99e376d1dff8f`
- Eight `origin/clawteam/autoresearch/gpu*-claude*` experiment branches,
  resolved in `NOVIX_OFFICIAL_OSS_LEDGER_20261017.md`.
- `novix-science/mlx-sim` @ `a7d4e2b84e36e1601438b08e7a1d6c973e95e16a`
- Both repositories declare MIT; neither carries a root LICENSE file at the
  sampled commits. No upstream source code is copied.

## Inspected evidence

- `program.md`: fixed time budget, baseline first, edit only train.py, log
  `results.tsv`, keep when val_bpb improves, reset/discard otherwise, kill at
  10 minutes, crash status.
- `prepare.py` / `train.py`: fixed evaluation, `val_bpb`, `peak_vram_mb`, 300 s
  budget.
- GPU branches: independent train.py deltas and branch experiment histories,
  treated as benchmark evidence only.
- mlx-sim: vectorized reset/step contract, Gymnasium spaces, domain
  randomization + sensor capabilities.

## Ported behavior

| Upstream capability | novix-open destination | Status |
|---|---|---|
| Baseline → candidate loop | `server/lib/autoresearch-lab.mjs` | ADAPTED |
| Lower-is-better metric and keep/discard | `AutoResearchLab.start` | ADAPTED |
| Crash row and timeout kill | row status `crash`, `ExperimentTimeoutError` | ADAPTED |
| Fixed budget / max experiment count | `timeBudgetMs`, `maxExperiments` | ADAPTED |
| `results.tsv` 5-column evidence | `RESULTS_HEADER` / `tsv()` | ADAPTED |
| Persisted run state | atomic JSON per run | ADAPTED |
| Timeout/abort handling | Promise race + AbortController | ADAPTED |
| Vectorized env contract metadata | `VECTORIZED_ENV_CONTRACT` + `/api/autoresearch/lab/contract` | ADAPTED |
| UI keep/discard/crash table | `app/src/components/AutoResearchLab.vue` | ADAPTED |

## Not ported

- Real GPU training harness, tokenizer/data shards, H100 cluster scheduling.
- The mlx-sim Metal renderer, physics solvers, sensor simulator, RL vector env
  runtime and viewer. These are benchmark/infrastructure surfaces outside a
  self-hosted web research workspace.
- Upstream code itself (license-file provenance gap remains; independent
  implementation only).

## Acceptance

```bash
node server/tests/parity-official-autoresearch.mjs
```

Test result: baseline/keep/discard/crash, exact TSV columns, persistence,
ownership, vectorized metadata and timeout crash all pass.

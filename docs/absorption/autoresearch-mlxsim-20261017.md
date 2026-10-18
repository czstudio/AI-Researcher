# autoresearch + mlx-sim absorption (2026-10-17)

## Sources and provenance

- `novix-science/autoresearch` `master` @ `29a5846ba40f25c24ce316c50fe99e376d1dff8f`
  ("Update README with 8-agent swarm experiment results"). MIT is declared in
  `README.md`; no root `LICENSE` file exists at this sampled commit. We copy no
  source code; the protocol is independently implemented.
- Eight benchmark branches, all independent `train.py` experiment histories:
  - `gpu0-claude` @ `b26299a8e12f09a92ed37ca024e738697566f01f`
  - `gpu1-claude` @ `ef8c91058bfa4780d840f8c9aff0ab221c28db7b`
  - `gpu2-claude` @ `9821791a0ad550ec94b507d724718cf5f7dc69db`
  - `gpu3-claude` @ `04c226ecbe55c824b683df7af1b41f00d6dd60d1`
  - `gpu4-claude-r2` @ `c5423865016b57b56a934905bbcde58ddccdd271`
  - `gpu5-claude-r2` @ `e84f578c5e070a807b707391f1fa14378e88b408`
  - `gpu6-claude-r2` @ `dd5acf27849eb7bbbab402ad2be3944ec312fabf`
  - `gpu7-claude-r2` @ `6f52c8eeadcc7100289981525498e6fecf5d20f5`
- `novix-science/mlx-sim` @ `a7d4e2b84e36e1601438b08e7a1d6c973e95e16a`
  (merge of `clawteam/mlx-sim/rigidbody1`). `pyproject.toml` declares
  `license = "MIT"`; no root `LICENSE` file exists at this sampled commit.
  Referenced evidence: `python/mlx_sim/envs/vec_env.py`,
  `python/mlx_sim/parallel/sync_runner.py`, `python/mlx_sim/distributed/coordinator.py`,
  `docs/api/environments.md`, `docs/benchmark_spec.md`.

## Inspected upstream behavior

- `program.md`: edit only `train.py`; fixed 300 s budget; first run is the
  baseline; lower `val_bpb` wins; keep an improving commit, otherwise reset;
  kill a run that exceeds 10 minutes; log crashes as `crash`. Canonical
  `results.tsv` columns are exactly `commit val_bpb memory_gb status description`.
- `prepare.py`: `TIME_BUDGET = 300`, fixed `MAX_SEQ_LEN`, fixed
  `evaluate_bpb()` evaluation. Dataset/tokenizer preparation is external.
- `train.py`: prints `val_bpb`, `training_seconds`, `peak_vram_mb` and related
  summary lines used to fill the TSV row.
- `results_summary.tsv` at master is a six-column *aggregate* (it adds an
  `agent` column and has one row per agent), not the per-experiment five-column
  TSV. Our implementation follows the `program.md` five-column protocol.
- mlx-sim `MlxSimVecEnv`: `reset(seed?, options?)` returns batched observations
  plus a list of infos; child env `i` receives `seed + i`; `step(actions)` takes
  `(num_envs, *action_shape)` and returns `obs, rewards, terminateds,
  truncateds, infos`; episode end auto-resets and exposes `final_observation`;
  `single_observation_space` and `single_action_space` alias the single spaces.
- mlx-sim distributed coordinator is an HTTP parameter-server pattern. It is
  evidence for shared-budget child-run orchestration shape only; this product
  does not run distributed RL workers.

## Ported capabilities

| Upstream capability | novix-open implementation | Status |
|---|---|---|
| Baseline first, then candidate experiments | `AutoResearchLab._executeSingle` | PORTED / ADAPTED |
| Fixed per-experiment budget and timeout kill | `timeBudgetMs`, `AbortController`, `Promise.race`, external-worker kill-on-abort | PORTED / ADAPTED |
| Lower `val_bpb` advances the best result | `run.bestMetric`, `run.bestSpec`, `run.bestCommit` | PORTED / ADAPTED |
| Keep / discard / crash rows | `_appendResult`, `run.counts` | PORTED / ADAPTED |
| Five-column `results.tsv` | `RESULTS_HEADER`, `toResultsTsv`, `rowToTsv` | PORTED / ADAPTED |
| `results.tsv` persisted after every row | `save()` + `atomicWriteFile` write-temp/fsync/rename in `_appendResult` | PORTED / ADAPTED |
| Run state persistence and reload consistency | `runs/*.json` plus `tsv/*.tsv`; `verify()` compares state and TSV hashes | PORTED / ADAPTED |
| Duplicate-run rejection | duplicate `requestId` -> code `4090`; duplicate start -> `4091`; cancel inactive -> `4092` | PORTED / ADAPTED |
| Isolated candidate workspace | `createIsolatedWorkspace()` creates a per-run temp directory under the OS temp root | PORTED / ADAPTED |
| Snapshot strategy | `fs.cpSync` of the source tree excluding `.git`, `node_modules`, `dist`, `data` | PORTED / ADAPTED |
| Optional git worktree strategy | detached `git worktree add --force`, cleanup with `git worktree remove` | PORTED / ADAPTED |
| Candidate edits only inside isolation | candidate `files` written under `<temp>/experiments/NNN/`; keep decision copies to `<temp>/best` | PORTED / ADAPTED |
| Temp-dir failure safety | creation failures remove the temp parent; cleanup only under the OS temp root | PORTED / ADAPTED |
| Batch / vectorized lab | `createBatch()`, independent child runs, shared wall-clock deadline, aggregate best/counts | ADAPTED / SIMULATED |
| Vectorized env contract metadata | `VECTORIZED_ENV_CONTRACT` and `/api/autoresearch/lab/contract` | CONTRACT ONLY |
| External evaluator adapter | `createCommandEvaluator()`, `evaluatorFromEnvironment()`, injected constructor evaluator | PORTED BOUNDARY |
| HTTP surface | create/list/get/start/cancel/verify/TSV JSON/TSV download/batch/contract routes | PORTED |

## Evaluator adapter contract

The default evaluator is `defaultEvaluator` in `server/lib/autoresearch-lab.mjs`.
It is deterministic, offline and explicitly marked `simulated: true`; it is not
GPU training and does not claim to reproduce upstream `val_bpb`.

A real evaluator must be supplied by the operator:

- `AutoResearchLab({ evaluator: async (spec, ctx) => ({ val_bpb, memory_gb }) })`
- `NOVIX_AUTORESEARCH_EVALUATOR=/absolute/path/to/module.mjs` (default export
  function or named `evaluate`)
- `NOVIX_AUTORESEARCH_EVALUATOR_CMD=/absolute/path/to/worker` with optional
  `NOVIX_AUTORESEARCH_EVALUATOR_ARGS` as a JSON string array.

The worker receives `NOVIX_AUTORESEARCH_SPEC`,
`NOVIX_AUTORESEARCH_WORKSPACE`, `NOVIX_AUTORESEARCH_RUN_ID` and
`NOVIX_AUTORESEARCH_BUDGET_MS` in its environment. It must emit JSON
`{"val_bpb": number, "memory_gb": number}` on stdout. The lab aborts the local
`AbortController` on timeout/cancel, and `createCommandEvaluator` kills the
child with `SIGKILL` on that signal. An injected in-process evaluator that
blocks the event loop cannot be preempted; use the command or module+worker
boundary for real training.

## GAP register closure

- GAP-019: lab decisions are persisted in run state; keep/discard workspace
  changes occur only in a per-run temp snapshot/worktree. Tests compare the
  fixture repo HEAD, `git status --porcelain` and `.git/index` hash before/after.
- GAP-020: each row triggers write-temp+fsync+rename of `results.tsv`; tests
  verify mid-run evidence, exact header, reload consistency, duplicate
  requestId/start rejection, timeout crash and abort.
- GAP-021: batch runs create N independent child runs with a shared deadline and
  aggregate best/keep/discard/crash. Both `simulatedVectorized: true` and
  `realMlxSimEngine: false` are returned; no Metal/MLX engine is executed.
- GAP-022: 8-agent / 8-GPU orchestration remains evidence only. No cluster
  scheduler is claimed.
- GAP-023: dataset/tokenizer preparation and real `val_bpb` remain external;
  the evaluator adapter is documented and tested with child-process workers.

## Not ported (explicit)

- Real PyTorch/CUDA training, H100 scheduling, HuggingFace shard download,
  tokenizer training and upstream `evaluate_bpb` execution.
- The eight-agent/ClawTeam branch/reset workflow as live git orchestration; we
  model the decision semantics in persisted state and isolated workspaces.
- mlx-sim Metal renderer, physics solvers, sensors, MJCF/URDF loader, viewer and
  real multiprocessing vector environments. Only the vectorized interface shape
  and aggregate-batch orchestration pattern are absorbed.
- Distributed RL coordinator/worker transport. It is reference evidence only.
- Upstream source files themselves; this remains an independent MIT-compatible
  protocol reimplementation.

## Honest limits

- The default offline evaluator returns simulated metrics. It cannot be used to
  claim real model improvement or reproduce the upstream 0.977 val_bpb result.
- `git worktree` isolation writes git administrative metadata under the source
  repository's `.git/worktrees` while the worktree exists; it does not modify the
  source index or working tree. Snapshot mode avoids even that metadata.
- A synchronous evaluator injected into the same Node process cannot be killed;
  timeout returns promptly and marks a crash, but the stray promise may continue
  if it ignores `ctx.signal`. Command workers are truly killed with SIGKILL.
- Batch "vectorization" is Node async concurrency over independent child runs,
  not GPU simd or mlx-sim multiprocessing. The API intentionally says so.
- `results.tsv` download is served as a stream by the host API; MIME detection
  for `.tsv` may fall back to `application/octet-stream` because the shared HTTP
  dispatcher has no `.tsv` MIME entry. The file content and filename are correct.

## Acceptance

```bash
node --check server/lib/autoresearch-lab.mjs
node --check server/routes/autoresearch-lab.mjs
node --check server/tests/parity-official-autoresearch.mjs
node server/tests/parity-official-autoresearch.mjs
npm --prefix app run build
```

Last local run: `SUMMARY parity_official_autoresearch checks=44 pass=44 fail=0`.
The test covers 44 named checks: protocol statuses, exact TSV schema, per-row
atomic evidence, reload/hash consistency, duplicate and ownership negatives,
timeout/abort, command/module evaluator boundaries, snapshot/git-worktree
isolation with no source repo mutation, simulated vectorized batch aggregation
with a shared budget, and HTTP route auth/traversal/download negatives.

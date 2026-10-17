# Novix Official OSS Absorption Ledger — 2026-10-17

**Audit owner:** `official-ledger`
**Audit snapshot:** 2026-10-17T06:33:05-07:00 (America/Los_Angeles)
**Worktree:** `/Users/cz/code/code/codex/idea2paper_product-dev-v4.0/work/novix-open`
**Branch:** `feat/full-parity-deep-reverse-20261017`
**Source root (read-only):** `/Users/cz/code/novix-science-org`
**Objective:** leave no official repository, special branch, or GPU experiment branch
unexamined and silently ignored. Every sampled ref below was resolved to an exact
commit, its full tree was enumerated with `git ls-tree`, and its licensing and key
implementation surfaces were inspected with `git show` / `git grep`.

> This document summarizes upstream behavior and records provenance. It intentionally
> does **not** copy upstream prompt bodies, long prose, source blocks, brand assets, or
> proprietary text. Short identifiers and table values are quoted only where needed for
> audit traceability.

---

## 1. Executive summary

### 1.1 Scope counts

| Measure | Count |
|---|---:|
| Repositories audited | 6 |
| Refs audited (6 base refs + 8 autoresearch GPU branches + 2 special branches) | **16** |
| Base-tree files (6 primary refs, no branch duplication) | **3,577** |
| Base-tree commits reachable from the 6 primary refs | **3,468** |
| Base-tree blob bytes | **58,608,774** (~55.9 MiB) |
| Union of all 16 audited refs (counts repeated per ref) | 4,663 file entries / 4,766 commits / 85,021,430 bytes (~81.1 MiB) |
| Special-branch-only commits | 1 (`agent-sandbox` `origin/novix`) + 484 (`ClawTeam-gstack` `origin/gstack-integration`) |
| Repos with a root `LICENSE` file | 4 of 6 |
| Repos with MIT/Apache declaration but no root license file | 2 (`autoresearch`, `mlx-sim`; declared MIT in README/pyproject) |

The file/commit counts above use the exact refs listed in section 2. File counts are
recursive `git ls-tree -r` entries; byte counts are the sum of blob sizes reported by
`git ls-tree -r -l` (git objects, not on-disk working-tree overhead).

### 1.2 License summary

| License | Repositories | Evidence |
|---|---|---|
| Apache-2.0 | `agent-sandbox`, `tailchat_by_chad` | Root `LICENSE` present in both; Tailchat package manifests also declare Apache-2.0 |
| MIT | `ClawTeam-gstack`, `OpenNova` | Root `LICENSE` present; MIT copyright lines retained |
| MIT (declared, no root license file) | `autoresearch`, `mlx-sim` | `autoresearch/README.md` License section; `mlx-sim/README.md` and `pyproject.toml` |
| Mixed subcomponent licenses | `tailchat_by_chad` apps | Root Apache-2.0; `apps/cli/LICENSE` MIT; `apps/github-app/LICENSE` ISC; `client/desktop/LICENSE` MIT (electron-react-boilerplate) |

License details, required notices, and the "not copied" inventory are in
`docs/absorption/LICENSES_AND_ATTRIBUTION_20261017.md`.

### 1.3 Disposition summary

The disposition vocabulary is deliberately strict:

- **PORTED** — upstream source code copied or mechanically translated and retained.
- **ADAPTED** — upstream behavior/contract reimplemented in novix-open, with attribution.
- **REFERENCE ONLY** — inspected for architecture/UX/evidence, no code produced.
- **OUT OF SCOPE** — intentionally not implemented in the product.

**Result: no upstream repository is vendored and no upstream source file is copied
verbatim.** The active absorption work is an independent Node/Vue reimplementation of
selected contracts. Dispositions therefore use **ADAPTED** for the small number of
behavioral surfaces selected for parity, **REFERENCE ONLY** for supporting evidence,
and **OUT OF SCOPE** for whole engines/infrastructure that do not belong in the web
product.

| Disposition | Refs |
|---|---|
| ADAPTED | `agent-sandbox@origin/novix`, `autoresearch@master`, `ClawTeam-gstack@origin/gstack-integration`, `OpenNova@main` |
| REFERENCE ONLY | `agent-sandbox@main`, all 8 `autoresearch` GPU branches, `ClawTeam-gstack@main`, `mlx-sim@main`, `tailchat_by_chad@master` |
| OUT OF SCOPE (engines/infrastructure within the above) | Kubernetes controller runtime, Metal physics engine, Docker sandbox daemon, full Tailchat IM/plugin runtime, GPU training harness |
| PORTED verbatim | none |

### 1.4 Audit conclusion

- All six repositories and all ten special/GPU branches were resolved to exact commits
  and their complete trees were enumerated.
- The useful product-relevant material is narrow: sandbox routing semantics, agent tool
  semantics, an experiment keep/discard/crash protocol, a vectorized-env contract, an
  eleven-role/seven-phase team sprint protocol, and chat/IM presentation patterns.
- The benchmark-only material (GPU training, Metal physics simulation, distributed RL,
  K8s control plane) is intentionally not rebuilt inside a zero-dependency Node web app.
- Two provenance gaps need closure before any source copying: `autoresearch` and
  `mlx-sim` declare MIT but do not ship a root `LICENSE` file at the sampled commits.
- Absorption implementations that were still in progress at this snapshot are called
  out explicitly in section 6 and in `ABSORPTION_GAP_REGISTER_20261017.md`.

---

## 2. Master matrix — one row per repository and special branch

Commit counts are `git rev-list --count <ref>`. File counts and bytes are from
`git ls-tree -r -l <ref>`. "Implementation status" is the state observed in the
novix-open worktree at the audit snapshot, not an aspiration.

| # | Ref | Exact commit | License | Commits | Files | Size (MiB) | Disposition | Implementation status at audit |
|---:|---|---|---|---:|---:|---:|---|---|
| 1 | `agent-sandbox` `main` | `1e1c435174c9fc1dae01f091d50cfa44ac01e315` | Apache-2.0 | 207 | 249 | 1.39 | REFERENCE ONLY | K8s provider/controller runtime not rebuilt; local sandbox behavior remains in `server/lib/sandbox.mjs` |
| 2 | `agent-sandbox` `origin/novix` (special) | `f64ec82164b514269220767a8f0fe2206a7fd788` | Apache-2.0 | 208 | 251 | 1.41 | **ADAPTED** | HTTP path-prefix/header routing and Location rewrite selected for `server/lib/sandbox-router.mjs`; destination was pending at snapshot |
| 3 | `autoresearch` `master` | `29a5846ba40f25c24ce316c50fe99e376d1dff8f` | MIT (declared; no root LICENSE) | 47 | 13 | 0.68 | **ADAPTED** | Protocol selected for `server/lib/autoresearch-lab.mjs` / routes / UI; implementation was in progress at snapshot |
| 4 | `autoresearch` `origin/clawteam/autoresearch/gpu0-claude` | `b26299a8e12f09a92ed37ca024e738697566f01f` | MIT (declared) | 56 | 10 | 0.73 | REFERENCE ONLY | Experiment evidence only; no branch-specific runtime |
| 5 | `autoresearch` `origin/clawteam/autoresearch/gpu1-claude` | `ef8c91058bfa4780d840f8c9aff0ab221c28db7b` | MIT (declared) | 52 | 10 | 0.73 | REFERENCE ONLY | Experiment evidence only; no branch-specific runtime |
| 6 | `autoresearch` `origin/clawteam/autoresearch/gpu2-claude` | `9821791a0ad550ec94b507d724718cf5f7dc69db` | MIT (declared) | 66 | 10 | 0.73 | REFERENCE ONLY | Experiment evidence only; no branch-specific runtime |
| 7 | `autoresearch` `origin/clawteam/autoresearch/gpu3-claude` | `04c226ecbe55c824b683df7af1b41f00d6dd60d1` | MIT (declared) | 58 | 10 | 0.73 | REFERENCE ONLY | Experiment evidence only; no branch-specific runtime |
| 8 | `autoresearch` `origin/clawteam/autoresearch/gpu4-claude-r2` | `c5423865016b57b56a934905bbcde58ddccdd271` | MIT (declared) | 39 | 10 | 0.73 | REFERENCE ONLY | Experiment evidence only; no branch-specific runtime |
| 9 | `autoresearch` `origin/clawteam/autoresearch/gpu5-claude-r2` | `e84f578c5e070a807b707391f1fa14378e88b408` | MIT (declared) | 45 | 10 | 0.73 | REFERENCE ONLY | Experiment evidence only; no branch-specific runtime |
| 10 | `autoresearch` `origin/clawteam/autoresearch/gpu6-claude-r2` | `dd5acf27849eb7bbbab402ad2be3944ec312fabf` | MIT (declared) | 42 | 10 | 0.73 | REFERENCE ONLY | Experiment evidence only; no branch-specific runtime |
| 11 | `autoresearch` `origin/clawteam/autoresearch/gpu7-claude-r2` | `6f52c8eeadcc7100289981525498e6fecf5d20f5` | MIT (declared) | 41 | 10 | 0.73 | REFERENCE ONLY | Experiment evidence only; no branch-specific runtime |
| 12 | `ClawTeam-gstack` `main` | `bc69bc0c5925a0740ad068d06dcd1f12a7aad151` | MIT | 207 | 182 | 10.60 | REFERENCE ONLY | Generic team primitives used as architecture reference; no Python runtime vendored |
| 13 | `ClawTeam-gstack` `origin/gstack-integration` (special) | `48c717f97cd2153f54db6d398828ca35bad58b6f` | MIT | 691 | 755 | 17.97 | **ADAPTED** | 11 roles / 7 phases / envelope / evidence gates selected for `server/lib/team-sprint.mjs`; implementation in progress at snapshot |
| 14 | `mlx-sim` `main` | `a7d4e2b84e36e1601438b08e7a1d6c973e95e16a` | MIT (declared; no root LICENSE) | 316 | 876 | 2.85 | REFERENCE ONLY (engine OUT OF SCOPE) | Vectorized-env metadata contract only; no Metal/physics implementation |
| 15 | `OpenNova` `main` | `c7a3f465da52f1fa10f74e4e24d065c4a7b89d5e` | MIT | 334 | 103 | 0.81 | **ADAPTED** | Tool semantics selected for `server/lib/open-nova-tools.mjs`; implementation pending at snapshot |
| 16 | `tailchat_by_chad` `master` | `591df5b895606e5fd2d166ca5b559d737c2ce32f` | Apache-2.0 (root; mixed app licenses) | 2,357 | 2,154 | 39.55 | REFERENCE ONLY | IM/chat presentation patterns only; no Tailchat source or plugin runtime vendored |

---

## 3. Repository findings and evidence

### 3.1 `agent-sandbox`

#### 3.1.1 `main` — `1e1c435`

- **Metadata:** 207 commits, 249 files, 1,460,689 bytes (1.39 MiB),
  commit date `2026-01-20T23:21:26+05:30`, subject
  "feat: add OpenTelemetry Tracing to Sandbox and SandboxClaim Controllers (#234)".
- **License:** Apache-2.0 at `LICENSE` (SHA-256
  `b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1`); no `NOTICE`
  file. Source headers identify "The Kubernetes Authors" and the upstream is
  `kubernetes-sigs/agent-sandbox`.
- **Capabilities observed:**
  - `Sandbox` CRD with stable identity, pod template, PVC templates, lifecycle
    (`shutdownTime`, `shutdownPolicy`), status conditions/service FQDN.
  - Core reconciler creating/updating Pods, Services, PVCs and lifecycle expiry.
  - Extensions: `SandboxTemplate` (including restricted network policy),
    `SandboxClaim` (template ref + lifecycle), `SandboxWarmPool` (desired/ready replicas).
  - Python client (`agentic_sandbox`) with claim creation, readiness wait, local
    port-forward tunnel mode, gateway mode, `run`/`write`/`read`, computer-use
    extension, and OpenTelemetry trace manager.
  - CRD manifests, RBAC, controller manifests, examples for Chrome, VS Code,
    JupyterLab, AIO, Python runtime, LangChain/ADK integration.
- **Files inspected (representative, full tree enumerated):**
  - `LICENSE`, `README.md`, `docs/development.md`, `docs/testing.md`
  - `api/v1alpha1/sandbox_types.go:97-198`, `controllers/sandbox_controller.go:1-100`
  - `extensions/api/v1alpha1/{sandboxclaim,sandboxtemplate,sandboxwarmpool}_types.go`
  - `extensions/controllers/{sandboxclaim,sandboxwarmpool}_controller*.go`
  - `clients/python/agentic-sandbox-client/agentic_sandbox/sandbox_client.py:67-467`
  - `clients/python/agentic-sandbox-client/agentic_sandbox/{trace_manager,extensions/computer_use}.py`
  - `clients/python/agentic-sandbox-client/sandbox-router/{README.md,sandbox_router.py}`
  - `k8s/crds/*.yaml`, `examples/README.md`, `examples/*/README.md` and manifests
- **Disposition:** **REFERENCE ONLY.** The Kubernetes control-plane architecture is
  intentionally not rebuilt. Only provider-interface concepts (local/docker/k8s target
  resolution) are relevant to the Node server.
- **Destination / evidence:** `server/lib/sandbox-router.mjs` (provider interface only,
  per absorption design); existing generic execution sandbox is
  `server/lib/sandbox.mjs`. Evidence: `agent-sandbox@1e1c435:controllers/sandbox_controller.go`,
  `agent-sandbox@1e1c435:api/v1alpha1/sandbox_types.go`,
  `agent-sandbox@1e1c435:clients/python/agentic-sandbox-client/agentic_sandbox/sandbox_client.py`.
- **Tests:** upstream has Go controller/extension tests and Python client tests; no
  K8s runtime was ported, so novix-open adds no controller test. Router/provider tests
  are expected in `server/tests/parity-official-sandbox.mjs` (pending at snapshot).

#### 3.1.2 `origin/novix` — `f64ec82` (special branch)

- **Metadata:** 208 commits, 251 files, 1,478,885 bytes (1.41 MiB),
  commit date `2026-01-21T17:23:56+08:00`, subject
  "feat: enhance sandbox router with WebSocket support and add websockets dependency".
- **Divergence from `main`:** 1 branch-only commit; 6 files changed
  (+484 / −18), all under `clients/python/agentic-sandbox-client/sandbox-router/`.
- **Capabilities observed:**
  - HTTP route `/<namespace>/<sandboxId>/<rest>`; namespace sanitization and
    `X-Sandbox-ID` / `X-Sandbox-Namespace` / `X-Sandbox-Port` header fallback.
  - Target resolution to `<sandbox-id>.<namespace>.svc.cluster.local:<port>`.
  - Streaming response proxy and 302 `Location` rewrite: an upstream absolute-path
    redirect is re-prefixed with the original `/<namespace>/<sandboxId>` prefix.
  - WebSocket proxy with subprotocol negotiation, forwarded non-hop-by-hop headers,
    `X-Forwarded-Host`, bidirectional frame forwarding, and close/error handling.
  - `/healthz`; path-prefix and WebSocket unit tests.
- **Files inspected:**
  - `sandbox_router.py:35-52` (`_parse_path_prefix`), `:47` (`/healthz`),
    `:53-149` (WebSocket proxy), `:192-249` (HTTP proxy + Location rewrite)
  - `tests/test_path_prefix_routing.py:1-114`
  - `tests/test_websocket_proxy.py:1-111`
  - `Dockerfile`, `requirements.in`, `requirements.txt`, `README.md`
- **Disposition:** **ADAPTED.** HTTP route parsing, header hygiene, target resolution,
  302 Location rewrite, and health semantics are the product-relevant surface.
  WebSocket transport is documented as a limitation because the Node server is
  zero-dependency at this point.
- **Destination:** `server/lib/sandbox-router.mjs`; acceptance coverage belongs in
  `server/tests/parity-official-sandbox.mjs`.
- **Tests:** upstream Python tests assert prefix target construction, Location rewrite,
  header fallback, header-overrides-path behavior, and WebSocket frame forwarding.
  Node equivalents are pending at this snapshot.

### 3.2 `autoresearch`

#### 3.2.1 `master` — `29a5846`

- **Metadata:** 47 commits, 13 files, 717,151 bytes (0.68 MiB),
  commit date `2026-03-15T17:30:18+08:00`, subject
  "Update README with 8-agent swarm experiment results".
- **License:** MIT declared at `README.md:116-118`; **no root `LICENSE` file** exists
  at this commit. Upstream lineage is karpathy/autoresearch.
- **Capabilities observed:**
  - Fixed-budget, single-GPU pretraining experiment protocol: first run establishes a
    baseline; each candidate modifies only `train.py`; run for a fixed 5-minute budget;
    lower `val_bpb` is better; keep if improved, discard if equal/worse, record crash
    if the run fails; kill runs that exceed the timeout.
  - `prepare.py` is immutable ground truth: `MAX_SEQ_LEN=2048`, `TIME_BUDGET=300`,
    fixed validation-token count, fixed `evaluate_bpb` path.
  - `train.py` contains the editable GPT/Muon+AdamW training loop and prints a
    `val_bpb` / `peak_vram_mb` summary.
  - `program.md` defines the autonomous experiment loop and TSV result schema
    (`commit`, `val_bpb`, `memory_gb`, `status`, `description`).
  - `results_summary.tsv` records the 8-agent swarm's best per-GPU results; README
    reports baseline 1.044 → final 0.977 val_bpb over ~2,430 experiments.
- **Files inspected:**
  - `README.md:1-118`, `README-old.md` (head), `program.md:1-110`
  - `prepare.py:30-32,344-354`, `train.py:26,525-640`
  - `results_summary.tsv:1-9`, `pyproject.toml`, `plot_progress.py`
  - `analysis.ipynb` (metadata/head), `progress.png` (asset/large binary), `uv.lock`
- **Disposition:** **ADAPTED.** The protocol is reimplemented as a deterministic,
  offline-capable lab loop; actual GPU training/evaluation is not ported.
- **Destination:** `server/lib/autoresearch-lab.mjs`,
  `server/routes/autoresearch-lab.mjs`, `app/src/components/AutoResearchLab.vue`,
  `server/tests/parity-official-autoresearch.mjs` (per absorption design; pending at
  snapshot).
- **Tests:** upstream has no CI test suite in the tree. The Node port should assert
  baseline→candidate keep/discard/crash, timeout kill, exact TSV columns, persistence,
  and batch/vectorized metadata.

#### 3.2.2 The eight `origin/clawteam/autoresearch/gpu*` branches

All eight branches are experiment lineages from the same 8-agent/8-H100 run. Their
trees contain 10 files each: `.gitignore`, `.python-version`, `README.md`,
`analysis.ipynb`, `prepare.py`, `program.md`, `progress.png`, `pyproject.toml`,
`train.py`, `uv.lock`. Relative to `master`, each branch deletes the swarm-summary
`README-old.md`, `plot_progress.py`, and `results_summary.tsv` and modifies `README.md`,
`progress.png`, and `train.py`. The branch-specific material is therefore **training
configuration changes only** — architecture, optimizer, initialization, schedule and
hyperparameter sweeps. No separate service, API, protocol, or tool surface exists on
these branches.

| Ref | Tip commit | Commits | Files | Bytes | Divergence vs `master` | Diff surface | Recorded master-snapshot result |
|---|---|---:|---:|---:|---|---|---|
| `gpu0-claude` | `b26299a8` | 56 | 10 | 761,317 | 16 behind / 25 ahead | `train.py` + 5 tree differences | 0.981976, keep, linear weight-decay schedule (avg of 3) |
| `gpu1-claude` | `ef8c9105` | 52 | 10 | 761,554 | 16 behind / 21 ahead | `train.py` + 5 tree differences | 0.986993, keep, RoPE base 12000 |
| `gpu2-claude` | `9821791a` | 66 | 10 | 761,876 | 16 behind / 35 ahead | `train.py` + 5 tree differences | 0.981396, keep, MLP Muon beta2 0.6 |
| `gpu3-claude` | `04c226ec` | 58 | 10 | 761,746 | 16 behind / 27 ahead | `train.py` + 5 tree differences | 0.980848, keep, embedding LR 0.55 + softmax scale 0.13 + WD 0.25 |
| `gpu4-claude-r2` | `c5423865` | 39 | 10 | 762,139 | 13 behind / 5 ahead | `train.py` + 5 tree differences | 0.976903, keep, Muon momentum end 0.93 |
| `gpu5-claude-r2` | `e84f578c` | 45 | 10 | 762,139 | 3 behind / 1 ahead | `train.py` + 5 tree differences | 0.976706, keep, matrix LR 0.028 + Muon beta2 0.83 |
| `gpu6-claude-r2` | `dd5acf27` | 42 | 10 | 762,139 | 13 behind / 8 ahead | `train.py` + 5 tree differences | 0.978940, keep, short window 480 |
| `gpu7-claude-r2` | `6f52c8ee` | 41 | 10 | 762,117 | 13 behind / 7 ahead | `train.py` + 5 tree differences | 0.977137, keep, wte init std 0.5 |

The "recorded master-snapshot result" is the row from `master:results_summary.tsv`
(9 lines including header). The branch tips may contain later experiments than that
snapshot; both the summary row and tip subject were inspected. Example tip subjects:
`WEIGHT_DECAY=0.05`, `Try EMBEDDING_LR=0.65 with RoPE base=12000`,
`MLP weight decay 0.7x`, `Try MUON_MOMENTUM_END=0.93`,
`Try scalar LR 0.22`, `Try lm_head init zeros`.

- **Disposition:** **REFERENCE ONLY.** These branches are benchmark evidence, not
  product features. The novix-open lab loop accepts candidate patch/config proposals
  but does not reproduce GPU experiments.
- **Destination:** `server/lib/autoresearch-lab.mjs` consumes the protocol and TSV
  schema; branch-specific hyperparameters are informative defaults/evidence only.
- **Tests:** static branch audit only; no branch-specific executable capability to test.

### 3.3 `ClawTeam-gstack`

#### 3.3.1 `main` — `bc69bc0`

- **Metadata:** 207 commits, 182 files, 11,119,625 bytes (10.60 MiB),
  commit date `2026-04-15T10:55:06Z`, subject "Fix lint import order in spawn adapters".
- **License:** MIT, `LICENSE` (SHA-256
  `804ee173a7f604efd7d4932d94f1c7fdbac7f2f2770aa3007ecc7670ea76fd35`,
  "Copyright (c) 2025 HKUDS"). `pyproject.toml` declares MIT and packages the
  `LICENSE` in the sdist.
- **Capabilities observed:**
  - Team manager/lifecycle, members, task board with dependencies/blocking/locking,
    mailbox messages and plan approval, snapshots, costs, routing.
  - MCP tool server (`team`, `task`, `mailbox`, `plan`, `board`, `workspace`, `cost`).
  - Harness phases (discuss/plan/execute/verify/ship), artifact store, human and
    all-tasks gates, roles, spawn adapters/backends (subprocess, tmux, wsh), P2P/file
    transports, CLI, project templates (`software-dev`, `research-paper`, `hedge-fund`,
    `strategy-room`, `code-review`, `harness-default`).
  - 38 upstream test files.
- **Files inspected:**
  - `README.md`, `README_CN.md`/`README_KR.md` (head), `pyproject.toml`
  - `clawteam/team/{models,manager,lifecycle,tasks,mailbox,plan,snapshot}.py`
  - `clawteam/mcp/server.py`, `clawteam/mcp/tools/*`
  - `clawteam/harness/{phases,orchestrator,roles,artifacts,prompts}.py`
  - `clawteam/spawn/*`, `clawteam/transport/*`, `clawteam/templates/*.toml`, `tests/`
  - `.agents/skills/frontend-design/LICENSE.txt` (Apache-2.0 subcomponent)
- **Disposition:** **REFERENCE ONLY.** Generic complexity is not vendored. The
  product uses the narrower gstack special-branch contract below.
- **Destination:** architecture reference for `server/lib/team-sprint.mjs`.
- **Tests:** upstream 38 test files; no Python runtime or test is imported into
  novix-open.

#### 3.3.2 `origin/gstack-integration` — `48c717f` (special branch)

- **Metadata:** 691 commits, 755 files, 18,838,744 bytes (17.97 MiB),
  commit date `2026-04-27T20:03:05+08:00`, subject "docs: added phase 13 PLAN context".
- **Divergence from `main`:** 484 branch-only commits, **627 changed files**
  (+162,760 / −867); 579 added, 42 modified, 6 deleted.
- **Capabilities observed:**
  - `clawteam/templates/gstack.toml`: 11-role specialist roster — `ceo`, `pm`,
    `eng-mgr`, `designer`, `dx-lead`, `engineer`, `reviewer`, `qa`, `security`,
    `shipper`, `sre`; 7 phases `think, plan, build, review, test, ship, reflect`;
    leader binding `ceo`; role model profiles; per-role memory directories;
    path-glob review routing to additional reviewers.
  - 15 role/review prompt files (662 lines total) with rubric-anchored persona
    contracts. Summarized: PM forcing questions; CEO scope modes; engineering-manager
    deliverables; designer rubric dimensions and AI-slop checks; DX evidence kinds;
    engineer non-stub diff evidence; reviewer investigation hypothesis limit; QA
    normal/qa-only modes; security OWASP/STRIDE confidence gate; shipper step enum;
    SRE operational signal enum.
  - `TurnEnvelope` and 11 persona subclasses, plus pydantic artifact schemas
    (`design_doc`, `plan_doc`, `test_report`, `review_report`, `ship_notes`, `retro`,
    `benchmark_report`, `canary_report`, `deploy_notes`, `codex_review`).
  - `PHASE_REQUIREMENTS`: each phase names its required artifact
    (`delegation.json`, `architecture-lock.md`, `diff.patch`, `review-report.md`,
    `test-report.json`, `ship-approval.md`, `retro.md`).
  - Sprint conductor/state machine, phase-completion watcher, QA/review loops,
    evidence gate, forced-progress gate, theater detector, cross-agent verification,
    freeze registry, smart review routing, ship approval gate, memory subsystem,
    attention digest/queue, browser/cookie adapters, and a large skill set
    (benchmark, browse, canary, codex, design consultation/HTML/shotgun, document
    release, investigate, land-and-deploy, learn, office-hours, setup, ship).
  - 193 test files and 280 `.planning/**` documents (93,264 lines) used as design
    evidence.
- **Files inspected:**
  - `clawteam/templates/gstack.toml:12-18,80+`
  - `clawteam/templates/gstack/envelope_personas.py:39-225`
  - `clawteam/templates/gstack/phase_contracts.py:9-60`
  - `clawteam/templates/gstack/prompts/{ceo,pm,eng-mgr,designer,dx-lead,engineer,reviewer,qa,security,shipper,sre,review/*}.md`
  - `clawteam/harness/{phases,evidence_gate,forced_progress_gate,theater_detector,phase_registry,gstack_review_router}.py`
  - `clawteam/sprint/{conductor,state,qa,review_phase,phase_completion_watcher}.py`
  - `clawteam/team/{envelope,models,tasks,mailbox,manager,routing_policy}.py`
  - `clawteam/plugins/gstack_sprint_plugin.py`, `clawteam/mcp/server.py`
  - `clawteam/templates/gstack/schemas/*.py`, `clawteam/templates/gstack/skills/**`
  - `tests/{test_turn_envelope,test_evidence_gate,test_gstack_*,test_sprint_*,integration/*}.py`
  - `.planning/codebase/ARCHITECTURE.md`, `.planning/PROJECT.md`,
    `.planning/milestones/**` (structure and representative phase summaries)
- **Disposition:** **ADAPTED.** The 11 roles, 7 phases, ceo-only phase advance,
  phase artifact requirements, envelope field validation, non-stub evidence gates,
  task board/mailbox, and chat message parts are reimplemented in zero-dependency
  Node/Vue. Python runtime, MCP transport, skill handlers, browser automation,
  memory store, and the `.planning` corpus are not copied.
- **Destination:** `server/lib/team-sprint.mjs`, `server/routes/team-sprint.mjs`,
  `app/src/pages/TeamPage.vue`, `app/src/components/team/**`,
  `server/tests/parity-official-team.mjs` (per absorption design; in progress at
  snapshot).
- **Tests:** upstream has 193 test files including end-to-end sprint and envelope
  tests. Node acceptance must cover 11 roles, non-ceo phase rejection, dependency/
  claim races, stub rejection, evidence re-run, mailbox isolation, chat part
  persistence, and reload.

### 3.4 `mlx-sim` — `a7d4e2b`

- **Metadata:** 316 commits, 876 files, 2,988,949 bytes (2.85 MiB),
  commit date `2026-03-21T23:21:46+08:00`, subject
  "Merge branch 'clawteam/mlx-sim/rigidbody1'".
- **License:** MIT declared at `README.md:3,127-129` and `pyproject.toml:10,16`;
  **no root `LICENSE` file** at this commit. Author metadata says
  "mlx-sim contributors"; repository URL is `github.com/mlx-sim/mlx-sim`.
- **Capabilities observed:**
  - Apple-Silicon/Metal robotics simulator: rigid-body dynamics, GJK/EPA collision,
    articulated bodies (Featherstone ABA/RNEA), URDF/MJCF loading, sensor pipeline
    (IMU/camera/depth), domain randomization, C++/Metal renderer, pybind11 bindings.
  - Gymnasium environments (`MlxSimEnv`, Reach, Balance), auto-registration,
    vectorized `MlxSimVecEnv` using per-env multiprocessing with auto-reset and
    `final_observation`/`final_info`.
  - Distributed RL coordinator/worker HTTP parameter-server pattern; benchmark
    specification with M1–M6 and AS1–AS5 metrics, Apple Silicon reference hardware,
    and Ant/Humanoid/Bin-Picking/Cart-Pole scenarios.
  - Seven contract documents (`physics_api`, `python_api`, `render_api`,
    `runtime_api`, `scene_model`, `sensor_api`, `swift_api`) and 128 test files.
- **Files inspected:**
  - `README.md:1-129`, `pyproject.toml`
  - `contracts/{python_api,runtime_api,physics_api,render_api,scene_model,sensor_api,swift_api}.md`
  - `python/mlx_sim/envs/{base_env,vec_env,domain_randomization,__init__}.py`
  - `python/mlx_sim/distributed/{coordinator,worker}.py`
  - `benchmarks/bench_vecenv.py`, `docs/benchmark_spec.md:1-130`
  - `docs/api/environments.md`, `tests/integration/test_{gym_env,vec_env,distributed}.py`
  - Full tree language census: 706 Python, 49 C++, 39 headers, 8 Objective-C++, 5 Metal.
- **Disposition:** **REFERENCE ONLY** for the simulator; the engine is **OUT OF SCOPE**.
  Only the vectorized reset/step contract and benchmark metadata are adapted into
  the AutoResearch lab as metadata.
- **Destination:** `server/lib/autoresearch-lab.mjs` batch/vectorized contract
  metadata; no physics, Metal, rendering, sensor, or distributed-RL implementation.
- **Tests:** upstream 128 test files; none imported. The Node port only needs
  contract-shape tests, not simulator correctness tests.

### 3.5 `OpenNova` — `c7a3f46`

- **Metadata:** 334 commits, 103 files, 846,709 bytes (0.81 MiB),
  commit date `2025-03-22T14:20:32+08:00`, subject
  "Merge pull request #859 from minbang930/fix/extracted-content-properties".
- **License:** MIT, `LICENSE` (SHA-256
  `79e3e521bf15d45421cdb731ed66ea66ff56c429e02a18a20e9f8958a3d1efcc`,
  "Copyright (c) 2025 manna_and_poem"). Upstream lineage is FoundationAgents/OpenManus;
  no per-file copyright headers and no root `NOTICE`.
- **Capabilities observed:**
  - Agent core: `BaseAgent` state/memory, ReAct agent, `ToolCallAgent` think/act loop,
    planning flow, browser agent, MCP, SWE agent, Manus composition.
  - Tools: PythonExecute (multiprocessing subprocess with timeout), BrowserUse
    (navigate/click/input/extract/tabs via browser-use), StrReplaceEditor
    (view/create/str_replace/insert/undo with local or sandbox file operators),
    FileSaver (workspace-root constrained), Bash/terminal, web search providers,
    planning, create-chat-completion, terminate.
  - Docker sandbox manager and async DockerizedTerminal with timeout, image ensure,
    idle cleanup, sandbox lifecycle.
  - LLM client/config/prompt modules, FastAPI MCP server, examples, 4 sandbox tests.
- **Files inspected:**
  - `README.md:1-100`, `LICENSE`, `requirements.txt`, `setup.py`
  - `app/agent/{base,react,toolcall,manus,planning,browser,mcp,swe}.py`
  - `app/tool/{python_execute,browser_use_tool,str_replace_editor,file_saver,terminate,bash,web_search}.py`
  - `app/sandbox/{client.py,core/manager.py,core/sandbox.py,core/terminal.py}`
  - `app/prompt/{manus,toolcall,browser,cot,swe}.py` (headings/role summary only)
  - `app/llm.py`, `app/schema.py`, `app/mcp/server.py`, `config/config.example.toml`
  - `tests/sandbox/*.py`
- **Disposition:** **ADAPTED.** Tool descriptors and result semantics are reimplemented
  as a zero-dependency tool catalog. Browser automation stays optional and honestly
  reports "not configured" when no Playwright/agent-browser executable is available.
  Docker daemon, full agent framework, prompts, and MCP runtime are not copied.
- **Destination:** `server/lib/open-nova-tools.mjs`, with tests in
  `server/tests/parity-official-sandbox.mjs` (pending at snapshot).
- **Tests:** upstream 4 sandbox tests. Node acceptance must cover descriptor shape,
  Python execute positive/negative/timeout, path traversal rejection, file saver
  workspace containment, str-replace edit semantics, browser not-configured state,
  and terminate result.

### 3.6 `tailchat_by_chad` — `591df5b8`

- **Metadata:** 2,357 commits, 2,154 files, 41,475,651 bytes (39.55 MiB),
  commit date `2026-02-04T15:55:14+08:00`, subject "style: mochat redesign".
- **License:** root Apache-2.0 (`LICENSE`, SHA-256
  `2657adff2e827c622c2791db290a98d274e38021a6c1700f4dd19593e719a697`);
  `package.json`, `server/package.json`, and `client/web/package.json` all declare
  Apache-2.0. Mixed app-level licenses: `apps/cli/LICENSE` MIT (MsgByte),
  `apps/github-app/LICENSE` ISC (moonrailgun), `client/desktop/LICENSE` MIT
  (electron-react-boilerplate). No root `NOTICE`.
- **Special commit analysis:** `591df5b8` is a single "MoChat redesign" commit over
  parent `5a21d630`: 292 changed paths (+42,222 / −22,045), 1 add, 48 modified,
  242 renames, 1 R066. The changed surface concentrates in:
  - web entry/login/register/guest screens and main shell/nav/sidebar;
  - chat message item/header, input box/addon/emotion, markdown/editor styles;
  - dark terminal/industrial design tokens (Oswald names, mono body text, orange
    accent, dark surfaces);
  - moving all server plugins out of `server/plugins/**` into
    `server/_disabled_plugins/**` (243 files), reducing active plugin directories
    to none;
  - one large `.pen` design artifact (`Moltchatnewdesign.pen`, 13,616 lines).
  The AI-assistant plugin is a chat-input toolbar popover that calls a remote
  ChatGPT relay for improve/shorten/lengthen/translate/summarize actions; it is
  reference material only and its remote endpoint is not wired into novix-open.
- **Capabilities observed (platform context):**
  - Full IM workspace: groups/DMs, message list with virtualized/normal variants,
    message quote/reaction/ack/highlight, file drop, mentions, plugin chat-input
    buttons, topic/thread panels, admin, bot/OpenAPI, desktop/mobile apps.
  - Chat message model includes content, author, group, converse, reactions,
    recall flag, and extensible `meta` payload.
  - Plugin architecture allows registering input buttons and message interpreters.
- **Files inspected:**
  - `README.md` (head), `LICENSE`, root/server/web `package.json`
  - `client/web/src/components/ChatBox/ChatMessageList/{Item,index,types,useChatMessageItemAction}.tsx`
  - `client/web/src/components/ChatBox/ChatInputBox/{index,Addon,BaseChatInputButton}.tsx`
  - `client/web/src/routes/{Entry,Main}/**` changed files
  - `client/web/src/plugin/common/reg.ts:184`
  - `client/web/plugins/com.msgbyte.ai-assistant/{manifest.json,src/index.tsx,src/popover.tsx,src/prompt.ts}`
  - `server/models/chat/message.ts`, `server/services/core/chat/{message,converse}.service.ts`
  - `server/_disabled_plugins/**` path census; `Moltchatnewdesign.pen` metadata
  - Git diff of the MoChat commit for the files above
- **Disposition:** **REFERENCE ONLY.** No Tailchat source, plugin code, design file,
  brand asset, or remote AI relay is copied. The Team workspace may borrow generic
  IM layout lessons (avatar grouping, message parts, input toolbar, approval cards)
  but implements them independently in Vue.
- **Destination:** `app/src/pages/TeamPage.vue` and `app/src/components/team/**`
  (per absorption design; pending at snapshot).
- **Tests:** upstream has its own Jest/Playwright suites; none imported. The Node/Vue
  team tests must validate the independent implementation.

---

## 4. Capability-to-destination matrix

| Capability | Source evidence | Disposition | novix-open destination | Status at snapshot |
|---|---|---|---|---|
| Sandbox path-prefix routing | `agent-sandbox@f64ec82:sandbox_router.py:35-52,192-249` | ADAPTED | `server/lib/sandbox-router.mjs` | pending |
| 302 `Location` prefix rewrite | `sandbox_router.py:247-249`; `tests/test_path_prefix_routing.py` | ADAPTED | `server/lib/sandbox-router.mjs` | pending |
| Header routing + header hygiene | `sandbox_router.py:55-134,198-236` | ADAPTED | `server/lib/sandbox-router.mjs` | pending |
| WebSocket proxy | `sandbox_router.py:53-149`; `tests/test_websocket_proxy.py` | REFERENCE ONLY (documented limitation) | `server/lib/sandbox-router.mjs` doc comment | gap |
| Provider interface local/docker/k8s | `agent-sandbox@1e1c435` controller/client architecture | ADAPTED (interface only) | `server/lib/sandbox-router.mjs` | pending |
| K8s CRDs/claim/template/warm pool | `agent-sandbox@1e1c435:extensions/**`, `k8s/**` | OUT OF SCOPE | none | intentionally absent |
| PythonExecute semantics | `OpenNova@c7a3f46:app/tool/python_execute.py:9-75` | ADAPTED | `server/lib/open-nova-tools.mjs` | pending |
| BrowserUse semantics | `app/tool/browser_use_tool.py:52-637` | ADAPTED (optional) | `server/lib/open-nova-tools.mjs` | pending |
| StrReplaceEditor | `app/tool/str_replace_editor.py:19-432` | ADAPTED | `server/lib/open-nova-tools.mjs` | pending |
| FileSaver workspace containment | `app/tool/file_saver.py:9-67` | ADAPTED | `server/lib/open-nova-tools.mjs` | pending |
| Terminate result | `app/tool/terminate.py:8-25` | ADAPTED | `server/lib/open-nova-tools.mjs` | pending |
| Docker sandbox daemon | `app/sandbox/core/{manager,sandbox,terminal}.py` | OUT OF SCOPE | none (generic `server/lib/sandbox.mjs` retained) | intentionally absent |
| Fixed 5-minute experiment budget | `autoresearch@29a5846:prepare.py:31`, `program.md:23` | ADAPTED | `server/lib/autoresearch-lab.mjs` | in progress |
| Baseline / keep / discard / crash | `program.md:90-110`, `results_summary.tsv` | ADAPTED | `server/lib/autoresearch-lab.mjs` | in progress |
| TSV columns | `program.md:66-77` | ADAPTED | `server/lib/autoresearch-lab.mjs` | in progress |
| Real GPU training/eval | `train.py`, `prepare.py`, `pyproject.toml` | OUT OF SCOPE (benchmark-only) | none | intentionally absent |
| 8-agent/8-GPU execution | 8 GPU branches; `README.md:1-60` | OUT OF SCOPE (benchmark-only) | evidence metadata only | intentionally absent |
| Vectorized env contract | `mlx-sim@a7d4e2b:python/mlx_sim/envs/vec_env.py`, `docs/benchmark_spec.md` | ADAPTED (metadata) | `server/lib/autoresearch-lab.mjs` | in progress |
| Metal physics/render/sensor engine | `src/**`, `contracts/**` | OUT OF SCOPE | none | intentionally absent |
| 11 gstack roles | `ClawTeam-gstack@48c717f:clawteam/templates/gstack.toml`, `gstack_sprint_plugin.py:127-140` | ADAPTED | `server/lib/team-sprint.mjs` | in progress |
| 7 sprint phases + ceo gate | `gstack.toml:12-18`, `sprint/conductor.py:232-499` | ADAPTED | `server/lib/team-sprint.mjs` | in progress |
| Phase artifact requirements | `templates/gstack/phase_contracts.py:9-17` | ADAPTED | `server/lib/team-sprint.mjs` | in progress |
| TurnEnvelope + persona fields | `team/envelope.py:32-60`, `envelope_personas.py:39-225` | ADAPTED | `server/lib/team-sprint.mjs` | in progress |
| Evidence/stub gates | `harness/evidence_gate.py:141-200`, `phase_contracts.py` | ADAPTED | `server/lib/team-sprint.mjs` | in progress |
| Task board + mailbox | `team/{models,tasks,mailbox}.py` | ADAPTED | `server/lib/team-sprint.mjs` | in progress |
| Chat text/reasoning/tool parts | `tailchat@591df5b8` message/plugin UI patterns | REFERENCE ONLY | `app/src/components/team/**` | pending |
| Python MCP server / skills / memory / browser | `clawteam/mcp/**`, `templates/gstack/skills/**`, `memory/**` | OUT OF SCOPE (v1) | none | intentionally absent |
| Full Tailchat IM/plugin server | `server/**`, `client/**`, `apps/**` | OUT OF SCOPE | none | intentionally absent |

---

## 5. Evidence and reproduction

### 5.1 Commands used for every ref

```bash
cd /Users/cz/code/novix-science-org/<repo>
git rev-parse <ref>
git rev-list --count <ref>
git ls-tree -r --name-only <ref> | wc -l
git ls-tree -r -l <ref> | awk '{s+=$4} END {print s}'
git show -s --format='%H%n%an <%ae>%n%cI%n%s' <ref>
git ls-tree -r --name-only <ref> | grep -iE '(^|/)(LICENSE|LICENCE|COPYING|NOTICE)(\.|/|$)'
```

### 5.2 Special-branch diff commands

```bash
git -C /Users/cz/code/novix-science-org/agent-sandbox \
  diff --stat 1e1c435 origin/novix
git -C /Users/cz/code/novix-science-org/ClawTeam-gstack \
  diff --stat bc69bc0 origin/gstack-integration
git -C /Users/cz/code/novix-science-org/autoresearch \
  diff --stat master origin/clawteam/autoresearch/gpu0-claude
```

### 5.3 Acceptance commands for absorbed destinations

These are the intended acceptance gates once sibling absorption work lands:

```bash
cd /Users/cz/code/codex/idea2paper_product-dev-v4.0/work/novix-open
node --check server/lib/sandbox-router.mjs
node --check server/lib/open-nova-tools.mjs
node --check server/lib/autoresearch-lab.mjs
node --check server/lib/team-sprint.mjs
node server/tests/parity-official-sandbox.mjs
node server/tests/parity-official-autoresearch.mjs
node server/tests/parity-official-team.mjs
node --test server/tests/*.mjs            # full server suite, authoritative once integrated
npm --prefix app run build                # frontend build check
```

At the audit snapshot, the absorption destination files and tests were not all
committed. The gap register tracks the delta.

---

## 6. Implementation status at audit snapshot (honesty check)

The audit was performed while sibling absorption tasks were still running. The
following observations are recorded so the ledger does not overclaim:

- `server/lib/sandbox.mjs` already exists as a generic Docker/local execution sandbox;
  it is not the agent-sandbox router and does not implement path-prefix HTTP routing.
- `server/lib/autoresearch-lab.mjs` and `server/lib/team-sprint.mjs` existed only as
  uncommitted, in-progress files at the snapshot. Their presence indicates active
  absorption but is not evidence of a completed contract.
- `server/lib/sandbox-router.mjs`, `server/lib/open-nova-tools.mjs`,
  `server/routes/autoresearch-lab.mjs`, `server/routes/team-sprint.mjs`,
  `app/src/components/AutoResearchLab.vue`, `app/src/pages/TeamPage.vue`, and the
  three `parity-official-*` tests were absent at the snapshot.
- No upstream source file was found copied into novix-open during this audit.
- The final integration (route wiring, page wiring, tests, build) is owned by the
  lead and the three absorption owners, not by this ledger task.

Any future ledger refresh should either remove these caveats or update the status
columns and the gap register in the same commit.

---

## 7. Coverage and limitations

- **Full coverage:** exact refs resolved; full recursive trees enumerated; all
  special/GPU branch diffs compared against their base; license files and manifests
  read; key product-relevant source files inspected.
- **Not line-by-line read:** large binary assets (`progress.png`, `.pen` design file),
  dependency lockfiles (`uv.lock`, `pnpm-lock.yaml`), generated code, the full
  `.planning/**` corpus, Tailchat's 2,154-file monorepo, and every one of mlx-sim's
  876 files. These were enumerated by path/size and sampled where relevant. No
  capability finding in this ledger depends on an unexamined binary asset.
- **No upstream prompt text copied:** prompt and rubric files were summarized at the
  level of role, phase, field, gate, and purpose. Short identifiers (`ceo`, `qa-only`,
  `val_bpb`, `keep`/`discard`/`crash`) are used because they are contract keys.
- **No brand assets copied:** logos, screenshots, UI imagery, and MoChat design files
  were not imported into novix-open.

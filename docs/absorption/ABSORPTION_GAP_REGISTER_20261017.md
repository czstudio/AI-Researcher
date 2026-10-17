# Absorption Gap Register — 2026-10-17

**Audit owner:** `official-ledger`
**Snapshot:** 2026-10-17T06:33:05-07:00 (America/Los_Angeles)
**Companion ledger:** `docs/absorption/NOVIX_OFFICIAL_OSS_LEDGER_20261017.md`
**Companion licenses:** `docs/absorption/LICENSES_AND_ATTRIBUTION_20261017.md`

This register records everything that was **not** absorbed, only partially absorbed, or
still unverified at the audit snapshot. It is intentionally pessimistic: a capability
is only "closed" when the destination file is committed, wired, and covered by a
passing acceptance test. Being reviewed or planned does not close a gap.

---

## 1. Severity definitions

| Severity | Meaning | Release impact |
|---|---|---|
| **P0** | Security/data-loss/legal blocker | Must fix before any release or deployment |
| **P1** | Core product capability missing or unintegrated | Must fix before claiming parity for the affected mode |
| **P2** | Capability is partial, optional, degraded, or has an honest fallback | Can ship with documented limitation; schedule next |
| **P3** | Benchmark-only, infrastructure-only, or intentionally out of scope | No product release blocker; keep documented |

**Owner roles:** `official-sandbox`, `official-autoresearch`, `official-team`, `lead`,
`legal/repo-owner`. These are team role names, not individual people.

---

## 2. Summary

| Severity | Count | Product-relevant | Benchmark-only / out-of-scope |
|---|---:|---:|---:|
| P0 | 0 | 0 | 0 |
| P1 | 6 | 4 | 2 |
| P2 | 19 | 16 | 3 |
| P3 | 14 | 1 | 13 |
| **Total** | **39** | **21** | **18** |

The P1 set is dominated by "not yet integrated/tested", not by missing knowledge:
the source audits, destination designs, and acceptance criteria exist, but the sibling
absorption tasks had not fully landed at the audit snapshot. The two non-product P1s are
the missing root `LICENSE` files for `autoresearch` and `mlx-sim` (legal provenance)
and the real-GPU training harness (benchmark-only). The license gap is non-blocking
while no code is copied and becomes blocking the moment code is copied.

---

## 3. Register

### 3.1 Integration and acceptance

| ID | Severity | Capability / gap | Source | Product-relevant? | Reason / current state | Owner | Acceptance / next action |
|---|---|---|---|---|---|---|---|
| GAP-001 | P1 | Sandbox router + OpenNova tool catalog not committed/wired at snapshot | `agent-sandbox@origin/novix`, `OpenNova@main` | Yes | `server/lib/sandbox-router.mjs` and `server/lib/open-nova-tools.mjs` absent; no route registration; existing `server/lib/sandbox.mjs` is unrelated generic execution sandbox | `official-sandbox`, `lead` | Commit both modules plus `server/tests/parity-official-sandbox.mjs`; run `node --check` and the parity test; wire routes if the lead exposes them |
| GAP-002 | P1 | AutoResearch lab not committed/wired at snapshot | `autoresearch@master`, `mlx-sim@main` | Yes | Only an uncommitted partial `server/lib/autoresearch-lab.mjs` existed; routes, UI, tests absent | `official-autoresearch`, `lead` | Commit lab, routes, `AutoResearchLab.vue`, parity test; assert keep/discard/crash, timeout, TSV columns, persistence, vectorized metadata |
| GAP-003 | P1 | Team sprint engine not committed/wired at snapshot | `ClawTeam-gstack@origin/gstack-integration` | Yes | Only an uncommitted partial `server/lib/team-sprint.mjs` existed; routes, TeamPage, tests absent | `official-team`, `lead` | Commit engine, routes, TeamPage/components, parity test; assert 11 roles, 7 phases, ceo-only advance, dependency/claim races, stub rejection, mailbox isolation, chat parts, reload |
| GAP-004 | P1 | No end-to-end proof that official features are reachable from the product UI/API | all absorbed refs | Yes | Modules may pass unit tests yet never be registered in the real route table or router | `lead` | Add at least one integration smoke per mode: sandbox route → local provider; lab create/start/results; team create/spawn/phase/chat |
| GAP-005 | P1 | Missing root `LICENSE` files for two declared-MIT sources | `autoresearch@29a5846`, `mlx-sim@a7d4e2b` | No (legal/provenance) | Both declare MIT in README/metadata but ship no full license text; current absorption is independent, so no copy obligation has been triggered | `legal/repo-owner` | Obtain license text/copyright holder; record in `LICENSES_AND_ATTRIBUTION_20261017.md`; do not copy code from either repo until resolved |
| GAP-006 | P2 | No committed full-suite/build verification for the official absorption surface | novix-open | Yes | The ledger is an audit artifact; it cannot substitute for CI evidence | `lead` | Run `node --test server/tests/*.mjs` and `npm --prefix app run build`; record pass/fail in the parity matrix or a follow-up evidence doc |
| GAP-007 | P2 | Official absorption tests are Node scripts, not yet part of a single CI target | novix-open | Yes | `parity-official-*.mjs` were not present; project test conventions vary | `lead` | Add all three scripts to the existing test command; fail CI on non-zero exit |

### 3.2 `agent-sandbox` gaps

| ID | Severity | Capability / gap | Source | Product-relevant? | Reason / current state | Owner | Acceptance / next action |
|---|---|---|---|---|---|---|---|
| GAP-008 | P2 | WebSocket upgrade proxy not implemented in the zero-dependency Node router | `agent-sandbox@f64ec82:sandbox_router.py:53-149`; `tests/test_websocket_proxy.py` | Yes | Node server has no WebSocket dependency; the source supports subprotocol negotiation, header forwarding, and bidirectional frames. Destination must document this limitation or add a vetted dependency/proxy | `official-sandbox`, `lead` | If implemented: test upgrade, frame forwarding, close semantics, subprotocol, header hygiene, traversal rejection. If deferred: expose honest 501/426 response and document in UI |
| GAP-009 | P2 | K8s/Docker provider adapters are interfaces only; local provider is the real path | `agent-sandbox@1e1c435:controllers/**`, Python client | Yes (scale/ops) | Rebuilding Kubernetes control-plane behavior is out of scope; Docker/K8s target resolution must fail honestly rather than pretend to work | `official-sandbox` | Provider interface tests: local isolation, unknown provider rejection, timeout/abort, traversal rejection; document that K8s requires an external router |
| GAP-010 | P2 | Sandbox path-prefix security and timeout cases not yet covered by committed tests | `sandbox_router.py`; `test_path_prefix_routing.py` | Yes | Traversal, encoded separators, host-header injection, absolute/relative Location, and abort behavior are security-sensitive | `official-sandbox` | Test `..`, `%2e%2e`, encoded slash, `//evil`, malformed namespace, oversized path, upstream timeout; verify header hygiene |
| GAP-011 | P3 | Kubernetes CRDs/controllers/templates/claims/warm pools not ported | `api/**`, `controllers/**`, `extensions/**`, `k8s/**` | No (infrastructure) | A Node web app cannot replace a cluster control plane; requiring K8s would make self-hosting heavier | `lead` | Keep as documented integration option; no code action unless a K8s deployment target is funded |
| GAP-012 | P3 | Python client gateway/tunnel modes and OpenTelemetry trace manager not ported | `clients/python/**` | No (infrastructure) | They depend on Kubernetes, port-forward, and OTel; not needed for the local product path | `lead` | Reference only; no acceptance test required |

### 3.3 `OpenNova` gaps

| ID | Severity | Capability / gap | Source | Product-relevant? | Reason / current state | Owner | Acceptance / next action |
|---|---|---|---|---|---|---|---|
| GAP-013 | P2 | BrowserUse requires an optional browser executable and is not configured by default | `OpenNova@c7a3f46:app/tool/browser_use_tool.py:52-637` | Yes | A zero-dependency server cannot bundle Playwright/Chromium/browser-use. The correct v1 behavior is an honest "not configured" result, not a fake success | `official-sandbox` | Test descriptor shape, missing-executable result, and no hang; document install path for operators |
| GAP-014 | P2 | PythonExecute isolation level differs from upstream | `app/tool/python_execute.py:9-75` | Yes (security) | Upstream uses a multiprocessing child with a short timeout but still shares the host Python environment. A Node implementation must not claim container isolation unless Docker is actually used | `official-sandbox` | Positive/negative/timeout tests; verify cwd isolation; document host-execution risk; default to Docker when available |
| GAP-015 | P2 | StrReplaceEditor undo/edit semantics may be subset | `app/tool/str_replace_editor.py:19-432` | Yes | Full upstream tool has view/create/str_replace/insert/undo, line ranges, truncation, and local/sandbox operators. A zero-dep v1 should explicitly support a documented subset | `official-sandbox` | Tests for create, exact-one-match replace, insert, view range, truncation, traversal rejection; document missing undo if absent |
| GAP-016 | P3 | Full ReAct/planning/MCP/SWE agent framework not ported | `app/agent/**`, `app/flow/**`, `app/mcp/**` | Partly | Existing novix-open agent loop is the product agent; duplicating OpenNova's framework would create two competing runtimes | `lead` | No port; only tool catalog adapter. Revisit if planning flow parity becomes a product requirement |
| GAP-017 | P3 | Docker sandbox manager/terminal not ported | `app/sandbox/core/{manager,sandbox,terminal}.py` | No (infrastructure) | Requires Docker SDK/daemon and a long-lived sandbox lifecycle; existing `server/lib/sandbox.mjs` covers optional Docker-backed execution | `lead` | Keep generic sandbox; no Docker sandbox daemon unless multi-tenant isolation is funded |

### 3.4 `autoresearch` / `mlx-sim` gaps

| ID | Severity | Capability / gap | Source | Product-relevant? | Reason / current state | Owner | Acceptance / next action |
|---|---|---|---|---|---|---|---|
| GAP-018 | P1 | Real GPU training/evaluation not ported | `autoresearch@29a5846:train.py`, `prepare.py` | No (benchmark-only) | Requires PyTorch/CUDA, HuggingFace data shards, tokenizer, GPU time. The product v1 uses a deterministic offline evaluator so the protocol is testable | `official-autoresearch` | Keep deterministic evaluator as default; expose an injectable evaluator boundary for real training. Do not claim GPU training works |
| GAP-019 | P2 | Lab loop may not reproduce git commit/reset/branch semantics | `autoresearch/program.md:90-110` | Partly | Upstream advances/resets a real git branch; a web lab should model keep/discard in persisted state and avoid mutating the product repo. Must be explicit | `official-autoresearch` | Test that keep/discard never mutates the novix-open git index; persist candidate commit ID and status; document that real git branch strategies require an isolated worktree |
| GAP-020 | P2 | Timeout kill and TSV atomicity not yet proven | `program.md:108-110`; `results_summary.tsv` schema | Yes | Long-running evaluators must be abortable; concurrent writes must not corrupt `results.tsv` | `official-autoresearch` | Tests: abort signal, process kill, timeout status, exact header, append/reload consistency, duplicate run rejection |
| GAP-021 | P2 | Vectorized batch contract is metadata only | `mlx-sim@a7d4e2b:python/mlx_sim/envs/vec_env.py`, `docs/benchmark_spec.md` | No (benchmark-only) | The lab advertises batch/vectorized contract metadata but does not run N parallel physics environments | `official-autoresearch` | Test metadata shape and honest "simulated" marker; do not imply real vectorized simulation |
| GAP-022 | P3 | 8-agent/8-GPU orchestration not ported | 8 `origin/clawteam/autoresearch/gpu*` branches; `README.md` | No (benchmark-only) | Multi-GPU/multi-agent scheduling is cluster infrastructure, not a web-app feature | `lead` | Evidence only; no acceptance test |
| GAP-023 | P3 | Dataset/tokenizer preparation and real `val_bpb` evaluation not ported | `prepare.py` | No (benchmark-only) | Requires external data/tokenizer cache and torch; would make the default test path network/GPU-dependent | `official-autoresearch` | Keep offline evaluator; document real evaluator adapter as optional |
| GAP-024 | P3 | Metal physics/rendering/sensor/URDF/MJCF engine not ported | `mlx-sim/src/**`, `python/mlx_sim/**`, `contracts/**` | No (benchmark-only) | Wrong platform and wrong product layer; rebuilding it would be a different product | `lead` | Explicitly out of scope; keep contract reference only |
| GAP-025 | P3 | mlx-sim distributed coordinator/worker not ported | `python/mlx_sim/distributed/**` | No (benchmark-only) | HTTP parameter-server pattern is unrelated to Novix product flow | `lead` | Reference only |

### 3.5 `ClawTeam-gstack` gaps

| ID | Severity | Capability / gap | Source | Product-relevant? | Reason / current state | Owner | Acceptance / next action |
|---|---|---|---|---|---|---|---|
| GAP-026 | P2 | Full 15-prompt rubric content not reproduced | `ClawTeam-gstack@48c717f:clawteam/templates/gstack/prompts/**` | Yes | Prompts are long and partly proprietary in tone; the docs intentionally summarize role/field/gate behavior. The product may need richer role guidance later | `official-team` | Keep summarized contracts; if user-facing prompts are added, write original Novix prompts and cite the rubric concepts, not the text |
| GAP-027 | P2 | Review routing and design/shotgun/browser/canary/ship skills not ported | `clawteam/harness/gstack_review_router.py`; `templates/gstack/skills/**` | Yes | These are advanced workflow automations; v1 team workspace covers the core sprint board/evidence gate only | `official-team` | Implement in priority order: review routing, ship approval, canary/benchmark evidence. Each needs a test and an honest UI state |
| GAP-028 | P2 | Memory subsystem, attention queue, forced-progress gate, theater detector not ported | `clawteam/memory/**`, `clawteam/attention/**`, `harness/{forced_progress_gate,theater_detector}.py` | Yes | These prevent agent theatre/drift and support long-running teams; v1 may rely on explicit human gates | `official-team` | At minimum test a non-stub evidence gate and phase blocking; document missing auto-nudge/theater detection |
| GAP-029 | P2 | Evidence schemas may be a subset | `templates/gstack/schemas/*.py` (10 schemas); `phase_contracts.py` | Yes | v1 needs delegation, architecture-lock, diff, review, test, ship-approval, retro. Optional design/plan/benchmark/canary/codex/deploy schemas may be absent | `official-team` | Test required phase artifacts; document optional schema support; reject unknown artifact types honestly |
| GAP-030 | P2 | Agent chat text/reasoning/tool parts and approval UI not yet proven | `tailchat@591df5b8` UI patterns; ClawTeam message model | Yes | TeamPage and components were absent at snapshot; parts/approval controls need persistence and reload tests | `official-team`, `lead` | Test chat part persistence across reload, mailbox isolation, approval/intervention control, and empty/offline state |
| GAP-031 | P3 | MCP server, CLI, tmux/wsh spawning, P2P/file transports not ported | `clawteam/mcp/**`, `clawteam/cli/**`, `clawteam/spawn/**`, `clawteam/transport/**` | No (integration infrastructure) | Web app should not spawn arbitrary CLI agents or expose MCP by default; security and deployment cost are high | `lead` | Keep out of v1; document optional external worker architecture |
| GAP-032 | P3 | Python runtime and upstream tests not imported | `clawteam/**`, `tests/**` | No | Independent Node implementation; importing the Python runtime would violate the zero-dependency goal | `lead` | No action |

### 3.6 `tailchat_by_chad` gaps

| ID | Severity | Capability / gap | Source | Product-relevant? | Reason / current state | Owner | Acceptance / next action |
|---|---|---|---|---|---|---|---|
| GAP-033 | P2 | Tailchat-style message parts/approval surfaces not yet implemented | `tailchat@591df5b8:client/web/src/components/ChatBox/**`, `server/models/chat/message.ts` | Yes | Source is a large production IM; only generic presentation patterns are reference material. The actual TeamPage/chat components were pending at snapshot | `official-team`, `lead` | Implement independent chat thread with text/reasoning/tool parts and approval cards; test persistence and reload |
| GAP-034 | P3 | Full IM server/plugin system/desktop/mobile/admin/bot/OpenAPI not ported | `server/**`, `client/**`, `apps/**`, `packages/**` | No | Vendor lock-in, 2,154 files, many transitive dependencies, mixed sub-licenses, and a different product scope | `lead` | Reference only; do not vendor |
| GAP-035 | P3 | Remote ChatGPT relay used by the AI-assistant plugin not ported | `com.msgbyte.ai-assistant/src/popover.tsx` | No (security/privacy) | The upstream plugin posts to a third-party relay; unsuitable as a default and contrary to the self-hosted posture | `lead` | If desired, add a configurable first-party LLM action with explicit user consent; never silence-copy |
| GAP-036 | P3 | Topics/threads/reactions/file drop/desktop/mobile surfaces not ported | `client/web/src/components/ChatBox/**`, `server/**` | No | Out of scope for the team workspace v1 | `lead` | Reference only |

### 3.7 License / notice gaps

| ID | Severity | Capability / gap | Source | Product-relevant? | Reason / current state | Owner | Acceptance / next action |
|---|---|---|---|---|---|---|---|
| GAP-037 | P2 | No per-file provenance headers in future copied modules | all official refs | No (legal hygiene) | Current absorption is independent; if source is copied, file-level provenance is required for Apache-2.0/MIT compliance | `lead`, all absorption owners | Add file header on first copied source: upstream repo, commit, license, copyright, changes |
| GAP-038 | P2 | `NOTICE.md` must be kept in sync with future copies | all official refs | No (legal hygiene) | Root `NOTICE.md` was updated with reference attribution at this snapshot, but it is only accurate for an independent implementation | `lead` | Any future copy updates `NOTICE.md` and `LICENSES_AND_ATTRIBUTION_20261017.md` in the same commit |
| GAP-039 | P3 | Tailchat subcomponent licenses not inherited | `tailchat_by_chad` app licenses | No | MIT (CLI), ISC (GitHub app), MIT (desktop boilerplate) apply only if those subcomponents are copied; they are not | `lead` | No action while not copied |

> Note: the IDs above are intentionally stable. A later refresh should mark items
> `CLOSED` with a commit/test reference rather than renumbering them.

---

## 4. Prioritized remediation plan

### Before claiming official-OSS parity (P1)

1. **Land and wire GAP-001/002/003.** Commit the three absorption modules, route
   registrars, UI components, and parity tests. The lead must verify route registration
   in the real API surface.
2. **Close GAP-004.** Add end-to-end smoke tests that exercise each official mode
   through the same entry point a user uses.
3. **Close GAP-005.** Obtain `autoresearch` and `mlx-sim` license texts or have the
   repo owner explicitly confirm the MIT grant for the sampled commits.

### Next engineering cycle (P2)

1. WebSocket limitation decision (GAP-008): implement with a vetted dependency or
   return an honest, documented unsupported response.
2. Harden sandbox/provider tests (GAP-009/010) and PythonExecute/tool safety
   (GAP-013/014/015).
3. Prove lab timeout/atomic TSV semantics and no-git-mutation behavior
   (GAP-019/020).
4. Harden team evidence gates, chat parts, and approval persistence
   (GAP-026/027/028/029/030/033).
5. Add provenance headers and notice sync process (GAP-037/038).

### Keep out of scope unless product requirements change (P3)

- Kubernetes control plane, CRDs, warm pools, claims/templates.
- GPU training/evaluation, 8-agent/GPU orchestration, dataset prep.
- Metal physics/rendering/sensors/distributed RL.
- MCP/CLI/tmux/P2P agent spawning.
- Full Tailchat IM/plugin/desktop/mobile runtime and its remote AI relay.

---

## 5. Honest product statement

At the audit snapshot the repository can claim:

- the official repositories, special branches, and GPU branches were audited;
- licenses and provenance were recorded;
- the selected behaviors are designed as independent reimplementations;
- benchmark-only and infrastructure-only surfaces are explicitly documented as
  out of scope.

It **cannot yet claim** that all absorbed modules are committed, integrated, and
covered by end-to-end tests. That is the purpose of the P1 register above.

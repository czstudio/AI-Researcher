# Deep absorption round 2 — 2026-10-17

Follow-up to `OFFICIAL_ABSORPTION_CLOSEOUT_20261017.md`. This round closes the
remaining product-relevant P2 gaps in `ABSORPTION_GAP_REGISTER_20261017.md`.

## Newly closed

| Gap | Capability | Destination | Evidence |
|---|---|---|---|
| GAP-008 | Raw WebSocket upgrade tunnel, path-prefix target, header hygiene, close propagation | `server/lib/sandbox-router.mjs` | sandbox parity 76/76 |
| GAP-009/010 | Local/Docker/K8s target providers; encoded traversal, slash, host and size hardening | `server/lib/sandbox-router.mjs` | sandbox parity 76/76 |
| GAP-013 | BrowserUse external argv-safe adapter + timeout | `server/lib/open-nova-tools.mjs` | sandbox parity 76/76 |
| GAP-014 | PythonExecute optional Docker isolation and honest host fallback | `server/lib/open-nova-tools.mjs` | sandbox parity 76/76 |
| GAP-015 | StrReplaceEditor view/create/insert/replace/view-range/truncation | `server/lib/open-nova-tools.mjs` | sandbox parity 76/76 |
| GAP-019/020 | Isolated temp workspace / optional git worktree, no repo mutation, atomic on-disk `results.tsv`, duplicate/abort gates | `server/lib/autoresearch-lab.mjs` | autoresearch parity 44/44 |
| GAP-021 | Explicit simulated-vectorized batch runs with shared budget and aggregate | `server/lib/autoresearch-lab.mjs` | autoresearch parity 44/44 |
| GAP-027 | Globstar review router, mandatory reviewer floor, ship approval gate | `server/lib/team-sprint.mjs` | team parity 81/81 |
| GAP-028 | Team memory JSONL/search/decay, attention queue/digest/auto-accept, forced-progress/theater detector | `server/lib/team-sprint.mjs` | team parity 81/81 |
| GAP-029 | Design/plan/review/test/codex/benchmark/canary/deploy/ship schemas | `server/lib/team-sprint.mjs` | team parity 81/81 |
| GAP-030/033 | Chat approval parts, attention answers, TeamPage review/ship/attention/memory controls | `server/routes/team-sprint.mjs`, `app/src/pages/TeamPage.vue` | team parity + Playwright UI |
| GAP-004/006/007 | End-to-end official extension smoke and one test command target | `server/tests/parity-official-integration.mjs`, `ops/test-all.mjs` | integration 13/13 |

## Remaining limits (intentional)

- No Kubernetes control plane, CRD/PVC/WarmPool/RBAC reconciliation.
- Local/Docker providers do not host WebSockets; remote target/K8s target proxying is implemented, local WebSocket is an explicit 501.
- No bundled browser runtime; BrowserUse requires `BROWSER_AUTOMATION_CMD`.
- No bundled H100/GPU training harness; evaluator is injectable/command-backed but default metrics are simulated.
- No bundled Metal physics engine for mlx-sim.
- No Tailchat plugin/IM runtime; only agent-native message parts and approval surfaces were adapted.
- Agent role identity is request-field enforced, not cryptographically bound per-agent credentials.

## Current verification

- `node server/tests/parity-official-sandbox.mjs` — rows=76 pass=76 fail=0
- `node server/tests/parity-official-autoresearch.mjs` — checks=44 pass=44 fail=0
- `node server/tests/parity-official-team.mjs` — checks=81 pass=81 fail=0
- `node server/tests/parity-official-integration.mjs` — rows=13 pass=13 fail=0
- `node server/tests/parity-backend-http.mjs` — 75/75
- `node ops/smoke.mjs` — 22/22
- `cd app && npm run build` — 65 modules, success

# Official OSS absorption closeout — 2026-10-17

This is the post-implementation closeout for the audit snapshot in
`NOVIX_OFFICIAL_OSS_LEDGER_20261017.md` and the gaps in
`ABSORPTION_GAP_REGISTER_20261017.md`.

## Landed destinations

| Capability | Source refs | Destination | Test |
|---|---|---|---|
| Sandbox path-prefix/Location routing, local provider lifecycle | `agent-sandbox@f64ec82`, `agent-sandbox@1e1c435` | `server/lib/sandbox-router.mjs`, `/api/sandbox/*` | `node server/tests/parity-official-sandbox.mjs` |
| OpenNova tool semantics: PythonExecute, BrowserUse, StrReplaceEditor, FileSaver, Terminate | `OpenNova@c7a3f46` | `server/lib/open-nova-tools.mjs`, merged into `server/lib/agent-loop.mjs` | same sandbox parity test |
| AutoResearch baseline/keep/discard/crash, fixed budget, `results.tsv` | `autoresearch@29a5846` + 8 GPU branches as evidence | `server/lib/autoresearch-lab.mjs`, `/api/autoresearch/lab/*`, Auto Experiment UI | `node server/tests/parity-official-autoresearch.mjs` |
| Vectorized env contract metadata | `mlx-sim@a7d4e2b` | lab contract endpoint and module constant | same autoresearch parity test |
| 11 roles, 7 phases, ceo-only advance, dependencies, mailbox, TurnEnvelope, evidence gate | `ClawTeam-gstack@48c717f` | `server/lib/team-sprint.mjs`, `/api/team/*`, `/team` UI | `node server/tests/parity-official-team.mjs` |
| Agent-native text/reasoning/tool chat parts | `tailchat_by_chad@591df5b8` reference only | team message API and TeamPage chat thread | same team parity test |

## Verification snapshot

- `node server/tests/parity-official-autoresearch.mjs` — 8 passing checks.
- `node server/tests/parity-official-team.mjs` — 17 passing checks.
- `node server/tests/parity-official-sandbox.mjs` — 15 passing checks.
- `node server/tests/parity-backend-http.mjs` — 75/75.
- `node ops/smoke.mjs` — 22/22.
- `cd app && npm run build` — 65 modules, success.
- Playwright smoke: `/team` created a sprint, claimed/completed a ceo task,
  submitted evidence, and advanced think→plan; `/autoexperiment` started a lab
  run and rendered the keep/discard/crash table with no page errors.

## Deliberately not ported

- Full Kubernetes agent-sandbox control plane and WebSocket proxy runtime.
- Docker sandbox daemon internals from OpenNova.
- Real GPU training/autoresearch execution and Metal physics engine from mlx-sim.
- Full Tailchat/MoChat IM server, plugin ecosystem and design assets.
- Upstream proprietary prompts, brand assets and datasets.

The Node implementation is independent and records attribution in
`LICENSES_AND_ATTRIBUTION_20261017.md` and `NOTICE.md`.

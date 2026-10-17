# Third-Party Notices

## Upstream kernel

This project bundles the open-source `AI-Researcher` framework (HKUDS / MIT).
The upstream code is preserved under the original paths:

- `research_agent/`
- `paper_agent/`
- `web_ai_researcher.py`
- `main_ai_researcher.py`
- `global_state.py`
- `docker/`
- `benchmark_collection/`
- `assets/`

Original repository: https://github.com/HKUDS/AI-Researcher

## Product surface replication

The web application layer (`app/`, `server/`, `contracts/`) is an independent
implementation written from a structural reverse-engineering specification
(routes, API contracts, mode registry, SSE protocol, data shapes, measured
design tokens). No brand assets, copy, prompts or third-party code from the
hosted product are included.

## Open-source dependencies

The UI build depends on:

- Vue 3 (MIT)
- Vite (MIT)
- @vitejs/plugin-vue (MIT)

The Node server has zero npm dependencies.

## Fonts

- Inter (OFL 1.1)
- Source Serif 4 (OFL 1.1)

## Official Novix OSS review sources

The following novix-science repositories and branches were audited during the
2026-10-17 parity pass. Selected behavioral contracts are independently
reimplemented in this project; no upstream source files, prompts, brand assets,
or datasets are vendored unless explicitly stated in
`docs/absorption/LICENSES_AND_ATTRIBUTION_20261017.md`.

- **agent-sandbox** (Kubernetes Authors, Apache-2.0) —
  https://github.com/novix-science/agent-sandbox
  - `main` @ `1e1c435174c9fc1dae01f091d50cfa44ac01e315`
  - `origin/novix` @ `f64ec82164b514269220767a8f0fe2206a7fd788`
  - Sandbox path-prefix/header routing and 302 Location-rewrite behavior are
    adapted as an independent Node implementation. No Go/Python source is copied.
- **autoresearch** (MIT declared; no root LICENSE file at sampled commits) —
  https://github.com/novix-science/autoresearch
  - `master` @ `29a5846ba40f25c24ce316c50fe99e376d1dff8f`
  - Eight `origin/clawteam/autoresearch/gpu*-claude*` experiment branches were
    reviewed as benchmark evidence. The keep/discard/crash protocol is
    independently implemented. No training code, data, or results are copied.
- **ClawTeam-gstack** (HKUDS, MIT) —
  https://github.com/novix-science/ClawTeam-gstack
  - `main` @ `bc69bc0c5925a0740ad068d06dcd1f12a7aad151`
  - `origin/gstack-integration` @ `48c717f97cd2153f54db6d398828ca35bad58b6f`
  - The 11-role/7-phase gstack sprint protocol is adapted as an independent Node
    implementation. Upstream prompt text and Python runtime are not copied.
- **mlx-sim** (MIT declared; no root LICENSE file at sampled commit) —
  https://github.com/novix-science/mlx-sim
  - `main` @ `a7d4e2b84e36e1601438b08e7a1d6c973e95e16a`
  - Only vectorized-environment contract metadata is referenced. No Metal,
    physics, rendering, or sensor code is copied.
- **OpenNova** (manna_and_poem, MIT) —
  https://github.com/novix-science/OpenNova
  - `main` @ `c7a3f465da52f1fa10f74e4e24d065c4a7b89d5e`
  - Tool descriptor/executor semantics are adapted as an independent Node
    implementation. No Python agent framework or sandbox daemon is copied.
- **tailchat_by_chad** (MsgByte / Chad Shi, Apache-2.0; mixed app sub-licenses) —
  https://github.com/novix-science/tailchat_by_chad
  - `master` @ `591df5b895606e5fd2d166ca5b559d737c2ce32f`
  - Reviewed as IM/chat presentation reference only. No source, plugin code,
    CSS, images, design files, or remote AI relay is copied.

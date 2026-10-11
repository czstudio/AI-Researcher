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

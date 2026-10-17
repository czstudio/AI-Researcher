# ClawTeam-gstack + MoChat absorption (2026-10-17)

## Sources

- `novix-science/ClawTeam-gstack` `main` @ `bc69bc0c5925a0740ad068d06dcd1f12a7aad151`
- Special branch `origin/gstack-integration` @ `48c717f97cd2153f54db6d398828ca35bad58b6f`
- `novix-science/tailchat_by_chad` @ `591df5b895606e5fd2d166ca5b559d737c2ce32f`
- Licenses: ClawTeam-gstack MIT (HKUDS); Tailchat root Apache-2.0 (mixed app
  sub-licenses, none copied).

## Inspected evidence

- gstack branch: 11 role prompts, 7-phase sprint, ceo-only phase advance,
  TurnEnvelope persona schemas, artifact schemas, EvidenceGate, task board,
  mailbox, lifecycle and review router; 627 files / 162,760 insertions.
- Main ClawTeam: team manager, mailbox, task store, routing policy, workspace
  manager, MCP server, spawn adapters, templates.
- MoChat: agent-native IM layout, message text/reasoning/tool parts, approval
  and intervention surfaces. Used as interaction reference only.

## Ported behavior

| Upstream capability | novix-open destination | Status |
|---|---|---|
| 11 roles | `ROLE_DEFINITIONS` in `server/lib/team-sprint.mjs` | ADAPTED |
| 7 phases | `PHASES`, `advancePhase` | ADAPTED |
| ceo-only phase authority | `TEAM_ONLY_CEO_ADVANCES` gate | ADAPTED |
| Sequential phase + evidence gate | `phaseEvidence` / `advancePhase` | ADAPTED |
| Task board dependencies/claim ownership | `createTask`, `claimTask`, `completeTask` | ADAPTED |
| Agent mailbox | `sendMail`, `listMail` | ADAPTED |
| TurnEnvelope role fields + stub rejection | `validateTurnEnvelope` | ADAPTED |
| Artifact/evidence non-stub schemas | `validateArtifact` | ADAPTED |
| Evidence command re-run | `verifyTestArtifact` (env-gated) | PARTIAL |
| text/reasoning/tool chat parts | `postChat`, TeamPage thread | ADAPTED |
| Team UI rails/roster/board/evidence/chat | `app/src/pages/TeamPage.vue` | ADAPTED |
| `/api/team/*` surface | `server/routes/team-sprint.mjs` | ADAPTED |

## Not ported

- Full gstack review-router, skill dispatcher, memory backfill, attention and
  phase-6 learning runtime.
- Python CLI, spawn backends, tmux/wsh/P2P transport, MCP server.
- Tailchat plugin runtime, IM server, design files, images and CSS.

## Acceptance

```bash
node server/tests/parity-official-team.mjs
```

Test result: roles/phases, dependency blocking, role ownership, ceo-only
advance, evidence gate, mailbox isolation, chat parts, TurnEnvelope stub
rejection and persistence all pass.

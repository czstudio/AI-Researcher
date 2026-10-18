// Zero-network parity suite for the absorbed ClawTeam-gstack sprint engine.
// Run: node server/tests/parity-official-team.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  TeamSprintStore, ROLES, PHASES, validateTurnEnvelope, matchGlob,
  GstackReviewRouter, validateArtifactSchema, validateExtendedArtifact,
  evaluateShipApproval, memoryDecay, rankMemoryEntry, attentionAgeBucket,
  buildAttentionDigest, NO_PROGRESS_THRESHOLD, TeamSprintError,
} from '../lib/team-sprint.mjs';

let checks = 0;
let failed = 0;
function pass(name, fn) {
  try { fn(); checks += 1; console.log('PASS', name); }
  catch (err) { failed += 1; checks += 1; console.error('FAIL', name, '::', err.message); process.exitCode = 1; }
}
function rejects(name, fn, pattern) {
  pass(name, () => assert.throws(fn, pattern));
}
function words(prefix, count = 14) { return Array.from({ length: count }, (_, i) => prefix + '-' + i).join(' '); }
function doc(...sections) { return sections.map((s) => '## ' + s + '\n' + words('Detailed evidence for ' + s, 12)).join('\n\n'); }
const SHA = 'abcdef1234567';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novix-team-deep-'));
const store = new TeamSprintStore({ rootDir: root });
let team = store.create({ ownerId: 'user-1', name: 'Deep sprint', goal: 'Deliver a review-routed, evidence-gated feature.' });

pass('01 eleven canonical roles', () => { assert.equal(ROLES.length, 11); assert.deepEqual(ROLES, ['ceo','pm','eng-mgr','designer','dx-lead','engineer','reviewer','qa','security','shipper','sre']); });
pass('02 seven canonical phases', () => assert.deepEqual(PHASES, ['think','plan','build','review','test','ship','reflect']));
pass('03 fresh team starts in think with all eleven roster rows', () => { assert.equal(team.phase, 'think'); assert.equal(team.roles.length, 11); });
pass('04 spawn all roles keeps unique roster', () => { for (const role of ROLES) store.spawn(team.id, role); const active = store.load(team.id).roles.filter((r) => r.status === 'active'); assert.equal(active.length, 11); });
rejects('05 unknown role rejected', () => store.spawn(team.id, 'intruder'), /unknown role/);
pass('06 globstar components rule matches nested file', () => assert.equal(matchGlob('src/components/ui/Button.tsx', 'src/components/**/*.tsx'), true));
pass('07 globstar auth prefix matches', () => assert.equal(matchGlob('src/auth/login.ts', 'src/auth/**'), true));
pass('08 globstar anywhere crypto matches', () => assert.equal(matchGlob('lib/crypto/hash.ts', '**/crypto/**'), true));
pass('09 globstar non-match rejected', () => assert.equal(matchGlob('docs/readme.md', 'src/auth/**'), false));
pass('10 review router mandatory reviewer floor', () => assert.deepEqual(new GstackReviewRouter().match(['README.md']).reviewers, ['reviewer']));
pass('11 review router accumulates css + auth reviewers', () => assert.deepEqual(new GstackReviewRouter().match(['src/auth/a.ts','site/main.css']).reviewers, ['designer','reviewer','security']));
pass('12 review route persists queue', () => { const r = store.routeReview(team.id, { diffPaths: ['src/auth/a.ts','app/api/route.mjs'] }); assert.deepEqual(r.reviewers, ['dx-lead','reviewer','security']); assert.equal(store.listReviews(team.id).length, 1); });

pass('13 valid engineer envelope accepted', () => { const e = validateTurnEnvelope('engineer', { persona: 'engineer', stepLabel: 'build:1', done: true, engineerDiffSummary: 'Implemented persisted task board with dependency checks' }); assert.equal(e.engineerDiffSummary.length > 20, true); });
rejects('14 engineer envelope rejects stub summary', () => validateTurnEnvelope('engineer', { persona: 'engineer', stepLabel: 'build:1', done: true, engineerDiffSummary: 'TODO write this later' }), /stub/);
rejects('15 ceo envelope rejects invalid mode', () => validateTurnEnvelope('ceo', { persona: 'ceo', stepLabel: 'think:1', done: true, ceoMode: 'defer' }), /ceoMode/);
rejects('16 envelope rejects non-boolean done', () => validateTurnEnvelope('qa', { persona: 'qa', stepLabel: 'test:1', done: 'yes', qaMode: 'qa' }), /done must be boolean/);
pass('17 pm envelope validates question index', () => assert.equal(validateTurnEnvelope('pm', { persona: 'pm', stepLabel: 'think:1/6', done: false, pmQuestionIndex: 3 }).pmQuestionIndex, 3));
const designContent = doc('problem','users','constraints','rationale','pm-verdict');
const designPayload = { problemStatement: words('Founders need evidence-backed release gates', 18), users: words('Staff engineers and research leads', 10), constraints: words('Self-hosted no external network dependencies', 10), rationale: words('Structured evidence reduces theater and stale approvals', 18), pmVerdict: 'proceed', forcingQuestionsAddressed: [1,2,3,4,5,6] };
pass('18 design-doc schema accepts complete evidence', () => assert.equal(validateArtifactSchema('design-doc', designPayload, designContent).artifactType, 'design-doc'));
rejects('19 design-doc rejects incomplete section evidence', () => validateArtifactSchema('design-doc', designPayload, '## problem\nshort'), /too short|missing|stub/);
const planContent = doc('architecture-lock','tasks','edge-cases','test-plan');
const planPayload = { architectureLock: words('Locked event-sourced state with append-only memory', 16), tasks: [{ description: 'Implement persisted task board with dependency checks', ownerRole: 'engineer' }], edgeCases: ['claim race','stale artifact','duplicate turn'], testPlan: words('Run parity suite covering gateway role and persistence', 16), planOwner: 'eng-mgr' };
pass('20 plan-doc schema accepts task/edge/test plan', () => assert.equal(validateArtifactSchema('plan-doc', planPayload, planContent).artifactType, 'plan-doc'));
pass('21 codex-review schema validates mode and verdict', () => assert.equal(validateExtendedArtifact('codex-review', { mode: 'review', target: 'team-sprint.mjs', verdict: 'pass' }, doc('summary')).artifactType, 'codex-review'));

pass('22 benchmark-report schema validates timings', () => assert.equal(validateExtendedArtifact('benchmark-report', { benchmarkStatus: 'clean', ttfbMs: 120, domLoadedMs: 480, measuredWith: 'curl' }, doc('benchmark')).artifactType, 'benchmark-report'));
pass('23 canary-report schema validates counters', () => assert.equal(validateExtendedArtifact('canary-report', { canaryStatus: 'clean', windowSeconds: 300, http2xxCount: 98, http5xxCount: 0, avgResponseMs: 130 }, doc('canary')).artifactType, 'canary-report'));
pass('24 deploy-notes schema validates provider and commit', () => assert.equal(validateExtendedArtifact('deploy-notes', { deployStatus: 'succeeded', deployUrl: 'https://example.test', provider: 'custom', commitSha: SHA, deployedAt: new Date().toISOString() }, doc('deploy')).artifactType, 'deploy-notes'));
const reviewPayload = { reviewSha: SHA, verdict: 'approved', findings: ['No blocking issues found in the evidence path'], reviewerPersona: 'reviewer' };
const reviewContent = doc('findings');
pass('25 review-report schema validates approved sha', () => assert.equal(validateArtifactSchema('review-report', reviewPayload, reviewContent).artifactType, 'review-report'));
const testPayload = { testCommand: 'node --version', passed: 2, failed: 0, outputExcerpt: 'v22 test suite executed with two passing checks', qaMode: 'qa' };
const testContent = doc('results');
pass('26 test-report schema validates green counts', () => assert.equal(validateArtifactSchema('test-report', testPayload, testContent).artifactType, 'test-report'));
rejects('27 test-report rejects negative counts', () => validateArtifactSchema('test-report', { ...testPayload, passed: -1 }, testContent), /non-negative/);
pass('28 ship-notes schema validates deploy and ship step', () => assert.equal(validateArtifactSchema('ship-notes', { deployUrl: 'https://example.test', shipStep: 'deploy', notes: words('Release verified by the on-call operator', 8) }, doc('ship')).artifactType, 'ship-notes'));

const thinkTask = store.createTask(team.id, { subject: 'Delegate think-phase work', ownerRole: 'ceo', createdBy: 'ceo' });
const buildTask = store.createTask(team.id, { subject: 'Implement the feature', ownerRole: 'engineer', dependsOn: [thinkTask.id], createdBy: 'ceo' });
rejects('29 dependency blocks claim before completion', () => store.claimTask(team.id, buildTask.id, 'engineer'), /dependency incomplete/);
rejects('30 task owner mismatch rejected', () => store.claimTask(team.id, thinkTask.id, 'engineer'), /owned by another role/);
store.claimTask(team.id, thinkTask.id, 'ceo');
pass('31 task completion records substantive evidence', () => { const t = store.completeTask(team.id, thinkTask.id, 'ceo', 'Delegated scope to pm engineer qa and wrote acceptance checks'); assert.equal(t.status, 'completed'); });
const claimedBuild = store.claimTask(team.id, buildTask.id, 'engineer');
pass('32 dependent task claim succeeds after dependency completion', () => assert.equal(claimedBuild.status, 'in_progress'));
rejects('33 second claim cannot overwrite active claim', () => store.claimTask(team.id, buildTask.id, 'engineer'), /not pending/);
const raceTask = store.createTask(team.id, { subject: 'Independent review task', ownerRole: 'reviewer', createdBy: 'ceo' });
const store2 = new TeamSprintStore({ rootDir: root });
pass('34 cross-instance claim race has one winner', () => { store2.claimTask(team.id, raceTask.id, 'reviewer'); assert.throws(() => store.claimTask(team.id, raceTask.id, 'reviewer'), /not pending/); });
const qaTask = store.createTask(team.id, { subject: 'QA checks the new gate', ownerRole: 'qa', createdBy: 'ceo' });
store.claimTask(team.id, qaTask.id, 'qa');
rejects('35 generic theater evidence rejected', () => store.completeTask(team.id, qaTask.id, 'qa', 'done'), /generic/);

rejects('36 non-ceo phase advance rejected', () => store.advancePhase(team.id, 'engineer', 'plan'), /only ceo/);
rejects('37 phase evidence gate rejects missing artifact', () => store.advancePhase(team.id, 'ceo', 'plan'), /evidence missing/);
pass('38 delegation schema accepted into persisted artifact', () => { const a = store.submitArtifact(team.id, { role: 'ceo', artifactType: 'delegation', filename: 'delegation.json', content: 'ceo delegates think phase to pm engineer qa reviewer with explicit acceptance evidence' }); assert.equal(a.filename, 'delegation.json'); });
rejects('39 wrong phase order rejected', () => store.advancePhase(team.id, 'ceo', 'build'), /next phase must be plan/);
pass('40 ceo advances think to plan after evidence', () => assert.equal(store.advancePhase(team.id, 'ceo', 'plan').phase, 'plan'));
pass('41 plan architecture-lock artifact accepted', () => store.submitArtifact(team.id, { role: 'eng-mgr', artifactType: 'architecture-lock', content: doc('architecture'), payload: { architectureLock: words('Event-sourced sprint state with append-only evidence logs', 14) } }));
pass('42 ceo advances plan to build', () => assert.equal(store.advancePhase(team.id, 'ceo', 'build').phase, 'build'));
pass('43 build diff artifact accepted', () => store.submitArtifact(team.id, { role: 'engineer', artifactType: 'diff', content: 'diff --git a/team.mjs b/team.mjs\n@@ -1 +1 @@\n-old\n+new persisted implementation\n', payload: { filesChanged: ['team.mjs'] } }));
pass('44 ceo advances build to review', () => assert.equal(store.advancePhase(team.id, 'ceo', 'review').phase, 'review'));
pass('45 approved review-report artifact accepted', () => store.submitArtifact(team.id, { role: 'reviewer', artifactType: 'review-report', content: reviewContent, payload: reviewPayload }));
pass('46 ceo advances review to test', () => assert.equal(store.advancePhase(team.id, 'ceo', 'test').phase, 'test'));
pass('47 green test-report artifact accepted', () => store.submitArtifact(team.id, { role: 'qa', artifactType: 'test-report', content: testContent, payload: testPayload }));

const preShip = store.shipApprovalStatus(team.id);
pass('48 ship gate sees approved review and green tests', () => { assert.equal(preShip.checks.find((c) => c.check === 'approved-review-report').passed, true); assert.equal(preShip.checks.find((c) => c.check === 'passing-test-report').passed, true); });
rejects('49 ship blocked without explicit ceo approval artifact', () => store.advancePhase(team.id, 'ceo', 'ship'), /ship approval gate blocked/);
rejects('50 only ceo may approve ship', () => store.approveShip(team.id, { role: 'engineer', shaAtApproval: SHA }), /only ceo/);
pass('51 ceo explicit ship approval writes sha-pinned artifact', () => { const a = store.approveShip(team.id, { role: 'ceo', shaAtApproval: SHA, note: 'Reviewed and approved release' }); assert.equal(a.payload.approvedBy, 'ceo'); assert.equal(store.shipApprovalStatus(team.id).passed, true); });
pass('52 ceo advances test to ship after approval gate', () => assert.equal(store.advancePhase(team.id, 'ceo', 'ship').phase, 'ship'));
pass('53 ceo advances ship to reflect', () => { const result = store.advancePhase(team.id, 'ceo', 'reflect'); assert.equal(result.phase, 'reflect'); assert.equal(result.status, 'completed'); });

pass('54 phase advances auto-write sprint-reflect memory', () => { const rows = store.listMemory(team.id, { scope: 'team' }); assert.equal(rows.some((r) => r.learnedFrom === 'sprint-reflect' && r.tags.includes('phase')), true); });
const mem = store.writeMemory(team.id, { author: 'human@cli', title: 'Use persisted evidence gates', body: 'Persisted evidence gates prevent stale approvals and theater.', tags: ['decision','retro'], evidence: 'docs/evidence.md:12', confidence: 0.9, learnedFrom: 'user' });
pass('55 team memory appends JSONL with provenance', () => { const file = path.join(root, team.id + '.memory.jsonl'); assert.equal(fs.existsSync(file), true); assert.equal(fs.readFileSync(file, 'utf8').includes(mem.id), true); });
pass('56 keyword memory search returns tagged entry', () => { const result = store.searchMemory(team.id, 'stale approvals', { scope: 'team' }); assert.equal(result.items.length >= 1, true); assert.equal(result.items[0].entry.id, mem.id); });
pass('57 cited user memory outranks self-inferred memory', () => { const weak = store.writeMemory(team.id, { author: 'agent@team', title: 'Weak inference about approvals', body: 'Maybe approvals could be stale.', tags: ['decision'], evidence: '', confidence: 0.2, learnedFrom: 'self-inferred' }); const a = rankMemoryEntry(store.listMemory(team.id, { scope: 'team', tag: 'decision' }).find((r) => r.id === mem.id)); const b = rankMemoryEntry(weak); assert.equal(a.score > b.score, true); });
pass('58 role-scoped memory isolates from team scope', () => { const roleMem = store.writeMemory(team.id, { author: 'pm@sprint', title: 'PM scope lesson', body: 'Role-local observations stay in the pm memory scope.', tags: ['pattern'], scope: 'role', role: 'pm', learnedFrom: 'artifact' }); assert.equal(store.listMemory(team.id, { scope: 'role', role: 'pm' }).some((r) => r.id === roleMem.id), true); assert.equal(store.listMemory(team.id, { scope: 'team' }).some((r) => r.id === roleMem.id), false); });
pass('59 memory prune tombstone suppresses entry', () => { store.pruneMemory(team.id, mem.id); assert.equal(store.listMemory(team.id, { scope: 'team' }).some((r) => r.id === mem.id), false); });
pass('60 tag TTL decay and ranking factors are exposed', () => { const old = { timestamp: new Date(Date.now() - 120 * 86400000).toISOString(), tags: ['pattern'], learnedFrom: 'artifact', evidence: 'x' }; assert.equal(memoryDecay(old), 0.2); const ranked = rankMemoryEntry(old); assert.equal(ranked.decay, 0.2); assert.equal(ranked.provenance, 1); });

const easy = store.addAttention(team.id, { title: 'Accept reversible doc tweak', urgency: 'low', blocking: false, tags: ['docs'], reversibility: 'easy' });
const hard = store.addAttention(team.id, { title: 'Rotate production credentials', urgency: 'critical', blocking: true, tags: ['security'], reversibility: 'hard' });
pass('61 attention priority ranks critical blocking above low', () => { const items = store.allAttention(team.id); assert.equal(items[0].id, hard.id); assert.equal(items[0].priorityScore > items.find((i) => i.id === easy.id).priorityScore, true); });
pass('62 attention age buckets use upstream boundaries', () => { assert.equal(attentionAgeBucket(0.5), '<1h'); assert.equal(attentionAgeBucket(1), '1-2h'); assert.equal(attentionAgeBucket(2), '2-8h'); assert.equal(attentionAgeBucket(8), '>8h'); });
pass('63 attention digest groups by sprint/tag/age', () => { const digest = store.attentionDigest(team.id).items; assert.equal(digest.length >= 2, true); assert.equal(digest[0].highestPriority >= digest[1].highestPriority, true); });
pass('64 auto-accept applies only easy reversible items with TTL', () => { const out = store.autoAcceptReversible(team.id, { ttlMinutes: 15 }); assert.equal(out.applied.includes(easy.id), true); assert.equal(out.skipped.includes(hard.id), true); const saved = store.load(team.id).attention.find((i) => i.id === easy.id); assert.equal(saved.autoAccepted, true); assert.equal(saved.expiresAt > saved.answeredAt, true); });
const approvalMsg = store.postChat(team.id, { role: 'engineer', parts: [{ type: 'approval', title: 'Allow schema migration', text: 'Migration is reversible behind a feature flag', blocking: true, reversibility: 'easy' }] });
pass('65 chat approval part derives an attention item', () => { const item = store.allAttention(team.id).find((i) => i.source === 'chat-approval'); assert.equal(Boolean(item), true); assert.equal(item.id.startsWith('approval:'), true); });
pass('66 answering derived approval updates chat part', () => { const item = store.allAttention(team.id).find((i) => i.source === 'chat-approval'); store.answerAttention(team.id, item.id, { decision: 'approved', answer: 'Approved by operator', actor: 'user-1' }); const saved = store.load(team.id); const part = saved.messages.find((m) => m.id === approvalMsg.id).parts[0]; assert.equal(part.status, 'approved'); assert.equal(store.allAttention(team.id).some((i) => i.source === 'chat-approval'), false); });
pass('67 digest builder is deterministic for empty input', () => assert.deepEqual(buildAttentionDigest([]), []));

pass('68 theater threshold constant is two turns', () => assert.equal(NO_PROGRESS_THRESHOLD, 2));
pass('69 first no-progress turn does not trigger', () => assert.equal(store.registerTurn(team.id, { role: 'pm', turnId: 'pm-t1' }).triggered, false));
pass('70 second no-progress turn triggers actionable attention', () => { const out = store.registerTurn(team.id, { role: 'pm', turnId: 'pm-t2' }); assert.equal(out.triggered, true); assert.equal(out.attention.tags.includes('theater'), true); });
pass('71 duplicate turn id is deduped', () => { const out = store.registerTurn(team.id, { role: 'pm', turnId: 'pm-t2' }); assert.equal(out.deduped, true); });
pass('72 artifact-byte progress resets only that role counter', () => { store.registerTurn(team.id, { role: 'pm', turnId: 'pm-t3', artifactBytes: 120 }); const pm = store.theaterStatus(team.id).roles.pm; const qa = store.theaterStatus(team.id).roles.qa; assert.equal(pm.noProgress, 0); assert.equal(qa.noProgress, 0); });
pass('73 same-byte follow-up increments only pm', () => { store.registerTurn(team.id, { role: 'pm', turnId: 'pm-t4', artifactBytes: 120 }); const status = store.theaterStatus(team.id); assert.equal(status.roles.pm.noProgress, 1); assert.equal(status.roles.qa.noProgress, 0); });
const chat = store.postChat(team.id, { role: 'engineer', parts: [{ type: 'text', text: 'Implementation complete' }, { type: 'reasoning', text: 'Checked dependency and claim transitions before writing.' }, { type: 'tool', toolName: 'node --check', input: 'team-sprint.mjs', output: 'ok', status: 'done' }] });
pass('74 chat persists text/reasoning/tool parts', () => { const saved = store.load(team.id).messages.find((m) => m.id === chat.id); assert.deepEqual(saved.parts.map((p) => p.type), ['text','reasoning','tool']); assert.equal(saved.parts[2].toolName, 'node --check'); });
rejects('75 invalid chat part type rejected', () => store.postChat(team.id, { role: 'engineer', parts: [{ type: 'audio', text: 'nope' }] }), /part type invalid/);

const reloaded = new TeamSprintStore({ rootDir: root }).load(team.id);
pass('76 persistence reload keeps completed sprint phase/status', () => { assert.equal(reloaded.phase, 'reflect'); assert.equal(reloaded.status, 'completed'); });
pass('77 persistence reload keeps task board evidence', () => { assert.equal(reloaded.tasks.find((t) => t.id === thinkTask.id).status, 'completed'); assert.equal(reloaded.tasks.find((t) => t.id === qaTask.id).status, 'in_progress'); });
pass('78 persistence reload keeps artifacts and review queue', () => { assert.equal(reloaded.artifacts.some((a) => a.artifactType === 'ship-approval'), true); assert.equal(reloaded.reviewQueue.length, 1); });
pass('79 persistence reload keeps chat parts and approvals', () => { assert.equal(reloaded.messages.some((m) => m.id === chat.id && m.parts.length === 3), true); assert.equal(reloaded.messages.some((m) => m.parts.some((p) => p.type === 'approval' && p.status === 'approved')), true); });
pass('80 memory JSONL survives a fresh store instance', () => { const fresh = new TeamSprintStore({ rootDir: root }); const rows = fresh.listMemory(team.id, { scope: 'team' }); assert.equal(rows.some((r) => r.tags.includes('phase')), true); });
pass('81 new route surface registers review/ship/memory/attention/progress endpoints', async () => {
  const { registerTeamRoutes } = await import('../routes/team-sprint.mjs');
  const routes = new Map();
  registerTeamRoutes((method, p, fn) => routes.set(method + ' ' + p, fn), { requireUser: () => ({ user: { id: 'user-1' }, denied: null }) });
  for (const key of ['POST /team/sprints/:id/review/route','GET /team/sprints/:id/ship/approval','POST /team/sprints/:id/ship/approve','POST /team/sprints/:id/memory','GET /team/sprints/:id/attention','GET /team/sprints/:id/attention/digest','POST /team/sprints/:id/progress/turn']) assert.equal(routes.has(key), true, key);
});

console.log('SUMMARY parity-official-team checks=' + checks + ' passed=' + (checks - failed) + ' failed=' + failed + ' network_calls=0');
if (failed === 0) console.log('ALL CHECKS PASSED');

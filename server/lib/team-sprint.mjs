// Self-hosted, zero-dependency multi-agent sprint engine.
// Contract shape follows ClawTeam-gstack's 11 gstack personas and 7-phase
// sprint (THINK -> PLAN -> BUILD -> REVIEW -> TEST -> SHIP -> REFLECT).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const ROLES = Object.freeze([
  'ceo', 'pm', 'eng-mgr', 'designer', 'dx-lead', 'engineer',
  'reviewer', 'qa', 'security', 'shipper', 'sre',
]);

export const PHASES = Object.freeze([
  'think', 'plan', 'build', 'review', 'test', 'ship', 'reflect',
]);

export const PHASE_REQUIREMENTS = Object.freeze({
  think: ['delegation.json'],
  plan: ['architecture-lock.md'],
  build: ['diff.patch'],
  review: ['review-report.md'],
  test: ['test-report.json'],
  ship: ['ship-approval.md'],
  reflect: ['retro.md'],
});

export const ARTIFACT_DEFAULT_NAMES = Object.freeze({
  delegation: 'delegation.json',
  'architecture-lock': 'architecture-lock.md',
  diff: 'diff.patch',
  'review-report': 'review-report.md',
  'test-report': 'test-report.json',
  'ship-approval': 'ship-approval.md',
  retro: 'retro.md',
  'design-doc': 'design-doc.md',
  'plan-doc': 'plan-doc.md',
  'ship-notes': 'ship-notes.md',
});

export const ROLE_DEFINITIONS = Object.freeze({
  ceo: { title: 'CEO / Phase Advancer', phaseAffinity: ['think', 'plan', 'reflect'], authority: 'Only ceo may advance the sprint phase.' },
  pm: { title: 'Product Manager', phaseAffinity: ['think', 'plan'], authority: 'Office-hours forcing questions and scope framing.' },
  'eng-mgr': { title: 'Engineering Manager', phaseAffinity: ['plan', 'reflect'], authority: 'Architecture lock, task decomposition, test plan, retro.' },
  designer: { title: 'Product Designer', phaseAffinity: ['plan', 'review'], authority: 'Design rubric and AI-slop review.' },
  'dx-lead': { title: 'Developer Experience Lead', phaseAffinity: ['plan', 'review'], authority: 'Persona, benchmark and friction evidence.' },
  engineer: { title: 'Engineer', phaseAffinity: ['build'], authority: 'Non-stub implementation diff and self-verification.' },
  reviewer: { title: 'Staff Reviewer', phaseAffinity: ['review'], authority: 'SHA-pinned review and hypothesis trace.' },
  qa: { title: 'QA Engineer', phaseAffinity: ['test'], authority: 'Executable test evidence, never a hand-written green claim.' },
  security: { title: 'Security Engineer', phaseAffinity: ['review'], authority: 'Threat model and confidence-gated escalations.' },
  shipper: { title: 'Release Shipper', phaseAffinity: ['ship'], authority: 'Ship notes, deploy URL and release verification.' },
  sre: { title: 'Site Reliability Engineer', phaseAffinity: ['ship', 'reflect'], authority: 'Canary, benchmark and operational signals.' },
});

export const ROLE_GUIDANCE = Object.freeze({
  ceo: { mandate: 'Decompose the goal, assign owners, make scope decisions and advance phases only when evidence is present.', forbidden: 'Do not write implementation code or advance on missing evidence.' },
  pm: { mandate: 'Ask the six forcing questions one at a time and record a proceed/reframe/kill verdict.', forbidden: 'Do not enumerate all six questions in one turn or substitute advice for evidence.' },
  'eng-mgr': { mandate: 'Lock architecture, data flow, edge cases and an observable test plan before build.', forbidden: 'Do not leave edge cases without a covering test or owner.' },
  designer: { mandate: 'Review information architecture, states, journey, AI-slop risk, design-system alignment and accessibility.', forbidden: 'Do not approve placeholder visuals or unexplained one-off styling.' },
  'dx-lead': { mandate: 'Measure time-to-hello-world, friction traces and persona learnability.', forbidden: 'Do not report developer experience without measured steps or observed friction.' },
  engineer: { mandate: 'Read before writing, make one atomic change, run tests and report a substantive diff summary.', forbidden: 'Do not ship WIP, stubs, unrelated bundled changes or unverified claims.' },
  reviewer: { mandate: 'Pin the review SHA, enumerate findings and issue an approved/rejected/needs-revision verdict.', forbidden: 'Do not approve a moving HEAD or hand-wave findings.' },
  qa: { mandate: 'Reproduce bugs, write a failing test, apply the minimal fix, then run the full suite.', forbidden: 'Do not claim green without executable output evidence.' },
  security: { mandate: 'Threat-model auth, ownership, input boundaries, secrets and agent tool abuse.', forbidden: 'Do not leave unresolved high-impact findings without an explicit gate.' },
  shipper: { mandate: 'Verify tests, review and CEO approval before shipping; record deploy URL and release notes.', forbidden: 'Do not deploy without an approved review and green test evidence.' },
  sre: { mandate: 'Measure canaries, benchmarks and operational signals after ship; flag regressions.', forbidden: 'Do not call a release clean without telemetry or benchmark evidence.' },
});

const STUB_MARKERS = [
  [/\bTBD\b/i, 'TBD'],
  [/\bTODO\b/, 'TODO'],
  [/\bxxx+\b/i, 'xxx'],
  [/\bplaceholder\b/i, 'placeholder'],
  [/Lorem ipsum/i, 'Lorem ipsum'],
];

const ENUMS = Object.freeze({
  ceoMode: ['expansion', 'selective', 'hold', 'reduction'],
  engMgrDeliverable: ['architecture-lock', 'data-flow', 'edge-case-matrix', 'test-plan', 'retro-breakdown'],
  dxLeadFrictionSource: ['persona', 'benchmark', 'friction-trace'],
  qaMode: ['qa', 'qa-only'],
  shipperStep: ['prep', 'pushing', 'pr-open', 'merged', 'deployed', 'verified'],
  sreSignal: ['nominal', 'degraded', 'regression', 'outage'],
  pmVerdict: ['proceed', 'reframe', 'kill'],
  reviewVerdict: ['approved', 'rejected', 'needs-revision', 'superseded'],
  shipStep: ['sync', 'test', 'audit', 'push', 'pr', 'merge', 'deploy', 'verify'],
});

export class TeamSprintError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = 'TeamSprintError';
    this.code = String(code);
    this.status = status;
    this.details = details;
  }
}
function id(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex'); }
function now() { return Date.now(); }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function oneLine(value, max = 200) {
  return String(value == null ? '' : value).split(String.fromCharCode(10)).join(' ').split(String.fromCharCode(13)).join(' ').trim().slice(0, max);
}
function assertText(value, label, min = 1, max = 20000) {
  const s = String(value == null ? '' : value).trim();
  if (s.length < min || s.length > max) throw new TeamSprintError('TEAM_INVALID', label + ' length invalid', 400);
  return s;
}
function hasStub(value) {
  if (value == null) return false;
  const s = String(value);
  for (const row of STUB_MARKERS) if (row[0].test(s)) return true;
  return false;
}
function roleValid(role) { return ROLES.includes(String(role || '')); }
function phaseIndex(phase) { return PHASES.indexOf(String(phase || '')); }
function assertNoStub(value, label) {
  if (typeof value === 'string' && hasStub(value)) throw new TeamSprintError('TEAM_STUB_REJECTED', label + ' contains stub marker', 422);
  return value;
}
export class TeamSprintStore {
  constructor(options = {}) {
    this.rootDir = options.rootDir || path.resolve(process.cwd(), 'data', 'team-sprints');
    this.allowTestExec = options.allowTestExec === true || process.env.TEAM_ALLOW_TEST_EXEC === '1';
    fs.mkdirSync(this.rootDir, { recursive: true });
  }
  pathFor(teamId) { return path.join(this.rootDir, String(teamId).replace(/[^A-Za-z0-9_-]/g, '') + '.json'); }
  save(team) {
    const file = this.pathFor(team.id);
    const tmp = file + '.' + process.pid + '.tmp';
    team.updatedAt = now();
    fs.writeFileSync(tmp, JSON.stringify(team, null, 2));
    fs.renameSync(tmp, file);
    return team;
  }
  load(teamId) {
    try { return JSON.parse(fs.readFileSync(this.pathFor(teamId), 'utf8')); } catch { return null; }
  }
  list(ownerId) {
    const out = [];
    for (const f of fs.readdirSync(this.rootDir)) {
      if (f.endsWith('.json') === false) continue;
      try {
        const t = JSON.parse(fs.readFileSync(path.join(this.rootDir, f), 'utf8'));
        if (ownerId == null || t.ownerId === String(ownerId)) out.push(t);
      } catch { }
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }
}
TeamSprintStore.prototype.create = function create(input = {}) {
  const team = {
    id: id('team'), ownerId: input.ownerId == null ? null : String(input.ownerId),
    name: assertText(input.name || 'Research sprint', 'name', 1, 120),
    goal: assertText(input.goal || 'Unspecified research goal', 'goal', 1, 4000),
    phase: 'think', status: 'active', roles: [], tasks: [], artifacts: [], messages: [], mailbox: [],
    createdAt: now(), updatedAt: now(),
  };
  for (const role of ROLES) team.roles.push({ name: role, status: 'idle', spawnedAt: null });
  return this.save(team);
};
TeamSprintStore.prototype.spawn = function spawn(teamId, role) {
  const team = this.load(teamId);
  if (team == null) throw new TeamSprintError('TEAM_NOT_FOUND', 'team not found', 404);
  if (roleValid(role) === false) throw new TeamSprintError('TEAM_ROLE_INVALID', 'unknown role', 400);
  const row = team.roles.find((r) => r.name === role);
  if (row == null) team.roles.push({ name: role, status: 'idle', spawnedAt: now() });
  else { row.status = 'active'; row.spawnedAt = now(); }
  return this.save(team);
};
TeamSprintStore.prototype.createTask = function createTask(teamId, input = {}) {
  const team = this.load(teamId);
  if (team == null) throw new TeamSprintError('TEAM_NOT_FOUND', 'team not found', 404);
  const ownerRole = String(input.ownerRole || '');
  if (roleValid(ownerRole) === false) throw new TeamSprintError('TEAM_ROLE_INVALID', 'ownerRole invalid', 400);
  const dependsOn = Array.isArray(input.dependsOn) ? input.dependsOn.map(String) : [];
  for (const dep of dependsOn) if (team.tasks.some((t) => t.id === dep) === false) throw new TeamSprintError('TEAM_DEP_MISSING', 'dependency not found', 400);
  const task = {
    id: id('task'), subject: assertText(input.subject, 'subject', 3, 240),
    description: assertText(input.description || input.subject, 'description', 3, 4000),
    ownerRole, dependsOn, status: 'pending', createdBy: String(input.createdBy || 'ceo'),
    createdAt: now(), claimedBy: null, completedAt: null, evidence: null,
  };
  team.tasks.push(task);
  this.save(team);
  return task;
};
TeamSprintStore.prototype.claimTask = function claimTask(teamId, taskId, role) {
  const team = this.load(teamId);
  if (team == null) throw new TeamSprintError('TEAM_NOT_FOUND', 'team not found', 404);
  if (roleValid(role) === false) throw new TeamSprintError('TEAM_ROLE_INVALID', 'role invalid', 400);
  const task = team.tasks.find((t) => t.id === taskId);
  if (task == null) throw new TeamSprintError('TEAM_TASK_NOT_FOUND', 'task not found', 404);
  if (task.ownerRole !== role) throw new TeamSprintError('TEAM_TASK_OWNER_MISMATCH', 'task owned by another role', 403);
  if (task.status !== 'pending') throw new TeamSprintError('TEAM_TASK_NOT_PENDING', 'task is not pending', 409);
  for (const dep of task.dependsOn) {
    const d = team.tasks.find((t) => t.id === dep);
    if (d == null || d.status !== 'completed') throw new TeamSprintError('TEAM_TASK_BLOCKED', 'dependency incomplete', 409);
  }
  task.status = 'in_progress'; task.claimedBy = role; task.claimedAt = now();
  this.save(team);
  return task;
};
TeamSprintStore.prototype.completeTask = function completeTask(teamId, taskId, role, evidence) {
  const team = this.load(teamId);
  if (team == null) throw new TeamSprintError('TEAM_NOT_FOUND', 'team not found', 404);
  const task = team.tasks.find((t) => t.id === taskId);
  if (task == null) throw new TeamSprintError('TEAM_TASK_NOT_FOUND', 'task not found', 404);
  if (task.claimedBy !== role) throw new TeamSprintError('TEAM_TASK_CLAIM_MISMATCH', 'task not claimed by role', 403);
  if (task.status !== 'in_progress') throw new TeamSprintError('TEAM_TASK_NOT_ACTIVE', 'task not in progress', 409);
  const proof = assertText(evidence, 'evidence', 3, 4000);
  assertNoStub(proof, 'evidence');
  task.status = 'completed'; task.completedAt = now(); task.evidence = proof;
  this.save(team);
  return task;
};
export function validateArtifact(artifactType, payload = {}, content = '') {
  const type = String(artifactType || '');
  assertNoStub(content, 'artifact content');
  if (type === 'test-report') {
    assertText(payload.testCommand, 'testCommand', 5, 1000);
    assertText(payload.outputExcerpt, 'outputExcerpt', 30, 4000);
    if (Number.isInteger(payload.passed) === false || payload.passed < 0) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'passed must be a non-negative integer', 422);
    if (Number.isInteger(payload.failed) === false || payload.failed < 0) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'failed must be a non-negative integer', 422);
  }
  if (type === 'review-report') {
    const sha = assertText(payload.reviewSha, 'reviewSha', 7, 40);
    if (/^[0-9a-f]+$/i.test(sha) === false) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'reviewSha must be hex', 422);
    if (ENUMS.reviewVerdict.includes(payload.verdict) === false) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'verdict invalid', 422);
    if (Array.isArray(payload.findings) === false || payload.findings.length < 1) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'findings required', 422);
  }
  if (type === 'ship-notes') {
    assertText(payload.deployUrl, 'deployUrl', 1, 1000);
    if (ENUMS.shipStep.includes(payload.shipStep) === false) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'shipStep invalid', 422);
    assertText(payload.notes, 'notes', 20, 4000);
  }
  return { payload: clone(payload), content: String(content || '') };
}
TeamSprintStore.prototype.submitArtifact = function submitArtifact(teamId, input = {}) {
  const team = this.load(teamId);
  if (team == null) throw new TeamSprintError('TEAM_NOT_FOUND', 'team not found', 404);
  if (roleValid(input.role) === false) throw new TeamSprintError('TEAM_ROLE_INVALID', 'role invalid', 400);
  const checked = validateArtifact(input.artifactType, input.payload || {}, input.content || '');
  const artifact = {
    id: id('artifact'), artifactType: String(input.artifactType), role: String(input.role),
    filename: oneLine(input.filename || ARTIFACT_DEFAULT_NAMES[input.artifactType] || 'artifact.txt', 160),
    payload: checked.payload, content: checked.content, createdAt: now(),
  };
  team.artifacts.push(artifact);
  this.save(team);
  return artifact;
};
export function nextPhase(phase) { const i = phaseIndex(phase); return i >= 0 && i < PHASES.length - 1 ? PHASES[i + 1] : null; }
export function phaseEvidence(team, phase) {
  const wanted = PHASE_REQUIREMENTS[phase] || [];
  return wanted.every((name) => (team.artifacts || []).some((a) => a.filename === name || a.artifactType === name.replace('.json', '').replace('.md', '').replace('.patch', '')));
}
TeamSprintStore.prototype.advancePhase = function advancePhase(teamId, role, toPhase) {
  const team = this.load(teamId);
  if (team == null) throw new TeamSprintError('TEAM_NOT_FOUND', 'team not found', 404);
  if (role !== 'ceo') throw new TeamSprintError('TEAM_ONLY_CEO_ADVANCES', 'actor is not authorized; only ceo can advance phases', 403);
  const expected = nextPhase(team.phase);
  if (expected == null) throw new TeamSprintError('TEAM_SPRINT_COMPLETE', 'sprint already at reflect', 409);
  if (toPhase !== expected) throw new TeamSprintError('TEAM_PHASE_ORDER', 'next phase must be ' + expected, 409);
  if (phaseEvidence(team, team.phase) === false) throw new TeamSprintError('TEAM_PHASE_EVIDENCE_MISSING', 'phase evidence missing for ' + team.phase, 422);
  const history = team.phaseHistory || [];
  history.push({ from: team.phase, to: toPhase, by: role, at: now() });
  team.phase = toPhase; team.phaseHistory = history;
  if (toPhase === 'reflect') team.status = 'completed';
  this.save(team);
  return team;
};
TeamSprintStore.prototype.sendMail = function sendMail(teamId, input = {}) {
  const team = this.load(teamId);
  if (team == null) throw new TeamSprintError('TEAM_NOT_FOUND', 'team not found', 404);
  if (roleValid(input.from) === false || roleValid(input.to) === false) throw new TeamSprintError('TEAM_ROLE_INVALID', 'mail role invalid', 400);
  const item = { id: id('mail'), from: input.from, to: input.to, body: assertText(input.body, 'body', 1, 8000), read: false, createdAt: now() };
  team.mailbox.push(item); this.save(team); return item;
};
TeamSprintStore.prototype.listMail = function listMail(teamId, role) {
  const team = this.load(teamId);
  if (team == null) throw new TeamSprintError('TEAM_NOT_FOUND', 'team not found', 404);
  return (team.mailbox || []).filter((m) => role == null || m.to === role);
};
TeamSprintStore.prototype.postChat = function postChat(teamId, input = {}) {
  const team = this.load(teamId);
  if (team == null) throw new TeamSprintError('TEAM_NOT_FOUND', 'team not found', 404);
  if (roleValid(input.role) === false) throw new TeamSprintError('TEAM_ROLE_INVALID', 'role invalid', 400);
  const parts = Array.isArray(input.parts) ? input.parts : [{ type: 'text', text: input.text || '' }];
  const normalized = [];
  for (const part of parts.slice(0, 80)) {
    const type = String(part && part.type || '');
    if (['text', 'reasoning', 'tool'].includes(type) === false) throw new TeamSprintError('TEAM_CHAT_PART_INVALID', 'part type invalid', 422);
    const row = { type, text: oneLine(part.text || part.content || '', 20000) };
    if (type === 'tool') { row.toolName = oneLine(part.toolName || '', 120); row.input = part.input || null; row.output = part.output || null; }
    normalized.push(row);
  }
  const message = { id: id('msg'), role: input.role, parts: normalized, createdAt: now() };
  team.messages.push(message); this.save(team); return message;
};
export function validateTurnEnvelope(role, input = {}) {
  if (roleValid(role) === false) throw new TeamSprintError('TEAM_ROLE_INVALID', 'role invalid', 400);
  if (input.persona !== role) throw new TeamSprintError('TEAM_ENVELOPE_INVALID', 'persona must equal role', 422);
  const stepLabel = assertText(input.stepLabel, 'stepLabel', 3, 80);
  if (typeof input.done === 'boolean' ? false : true) throw new TeamSprintError('TEAM_ENVELOPE_INVALID', 'done must be boolean', 422);
  const out = { persona: role, stepLabel, done: input.done };
  if (role === 'ceo') {
    if (ENUMS.ceoMode.includes(input.ceoMode) === false) throw new TeamSprintError('TEAM_ENVELOPE_INVALID', 'ceoMode invalid', 422);
    out.ceoMode = input.ceoMode;
  }
  if (role === 'pm') {
    if (Number.isInteger(input.pmQuestionIndex) === false || input.pmQuestionIndex < 1 || input.pmQuestionIndex > 6) throw new TeamSprintError('TEAM_ENVELOPE_INVALID', 'pmQuestionIndex invalid', 422);
    out.pmQuestionIndex = input.pmQuestionIndex;
  }
  if (role === 'eng-mgr') {
    if (ENUMS.engMgrDeliverable.includes(input.engMgrDeliverable) === false) throw new TeamSprintError('TEAM_ENVELOPE_INVALID', 'engMgrDeliverable invalid', 422);
    out.engMgrDeliverable = input.engMgrDeliverable;
  }
  if (role === 'designer') {
    if (Number.isInteger(input.designerRubricDimension) === false || input.designerRubricDimension < 1 || input.designerRubricDimension > 10) throw new TeamSprintError('TEAM_ENVELOPE_INVALID', 'designerRubricDimension invalid', 422);
    out.designerRubricDimension = input.designerRubricDimension;
  }
  if (role === 'dx-lead') {
    if (ENUMS.dxLeadFrictionSource.includes(input.dxLeadFrictionSource) === false) throw new TeamSprintError('TEAM_ENVELOPE_INVALID', 'dxLeadFrictionSource invalid', 422);
    out.dxLeadFrictionSource = input.dxLeadFrictionSource;
  }
  if (role === 'engineer') {
    const diff = assertText(input.engineerDiffSummary, 'engineerDiffSummary', 20, 4000);
    assertNoStub(diff, 'engineerDiffSummary'); out.engineerDiffSummary = diff;
  }
  if (role === 'reviewer') {
    const sha = assertText(input.reviewSha, 'reviewSha', 7, 40);
    if (/^[0-9a-f]+$/i.test(sha) === false) throw new TeamSprintError('TEAM_ENVELOPE_INVALID', 'reviewSha invalid', 422);
    if (ENUMS.reviewVerdict.includes(input.reviewVerdict) === false) throw new TeamSprintError('TEAM_ENVELOPE_INVALID', 'reviewVerdict invalid', 422);
    out.reviewSha = sha; out.reviewVerdict = input.reviewVerdict;
  }
  if (role === 'qa') {
    if (ENUMS.qaMode.includes(input.qaMode) === false) throw new TeamSprintError('TEAM_ENVELOPE_INVALID', 'qaMode invalid', 422);
    out.qaMode = input.qaMode;
  }
  if (role === 'shipper') {
    if (ENUMS.shipStep.includes(input.shipStep) === false) throw new TeamSprintError('TEAM_ENVELOPE_INVALID', 'shipStep invalid', 422);
    out.shipStep = input.shipStep;
  }
  if (role === 'sre') {
    if (ENUMS.sreSignal.includes(input.sreSignal) === false) throw new TeamSprintError('TEAM_ENVELOPE_INVALID', 'sreSignal invalid', 422);
    out.sreSignal = input.sreSignal;
  }
  out.createdAt = now();
  return out;
}
TeamSprintStore.prototype.verifyTestArtifact = function verifyTestArtifact(teamId, artifactId) {
  const team = this.load(teamId);
  if (team == null) throw new TeamSprintError('TEAM_NOT_FOUND', 'team not found', 404);
  const artifact = team.artifacts.find((a) => a.id === artifactId);
  if (artifact == null || artifact.artifactType !== 'test-report') throw new TeamSprintError('TEAM_ARTIFACT_NOT_FOUND', 'test artifact not found', 404);
  if (this.allowTestExec === false) return { verified: false, deferred: true, reason: 'TEAM_ALLOW_TEST_EXEC is disabled; capture command evidence manually' };
  const command = artifact.payload.testCommand;
  const out = spawnSync('/bin/zsh', ['-c', command], { encoding: 'utf8', timeout: 30000, cwd: process.cwd() });
  const okResult = out.status === 0 && artifact.payload.failed === 0;
  artifact.gate = { verified: okResult, exitCode: out.status, at: now(), stdout: oneLine(out.stdout, 4000), stderr: oneLine(out.stderr, 4000) };
  this.save(team);
  return artifact.gate;
};

// Deep-absorption extension (GAP-026..GAP-033).
export const REVIEW_FLOOR_ROLE = 'reviewer';
export const DEFAULT_REVIEW_RULES = Object.freeze([
  { pattern: 'src/components/**/*.tsx', reviewers: ['designer'], signal: 'ui' },
  { pattern: '**/*.css', reviewers: ['designer'], signal: 'ui' },
  { pattern: 'src/auth/**', reviewers: ['security'], signal: 'crypto' },
  { pattern: '**/crypto/**', reviewers: ['security'], signal: 'crypto' },
  { pattern: 'app/api/**', reviewers: ['dx-lead'], signal: 'api' },
  { pattern: 'package.json', reviewers: ['dx-lead'], signal: 'api' },
]);
export const MEMORY_LEARNED_FROM = Object.freeze(['user', 'artifact', 'self-inferred', 'sprint-reflect']);
export const MEMORY_TTL_DAYS = Object.freeze({ pattern: 90, preference: 36500, incident: 180, retro: 365, decision: 1825 });
export const ATTENTION_URGENCY = Object.freeze({ critical: 3, high: 2, normal: 1, low: 0 });
const CURRENT_SAVE = TeamSprintStore.prototype.save;
const CURRENT_LOAD = TeamSprintStore.prototype.load;
function ensureExtendedState(team) {
  if (team == null) return team;
  if (Array.isArray(team.phaseHistory) === false) team.phaseHistory = [];
  if (Array.isArray(team.attention) === false) team.attention = [];
  if (Array.isArray(team.reviewQueue) === false) team.reviewQueue = [];
  if (Array.isArray(team.reviewRules) === false) team.reviewRules = DEFAULT_REVIEW_RULES.map((r) => ({ ...r, reviewers: [...r.reviewers] }));
  if (team.progress == null || typeof team.progress === 'object' === false) team.progress = {};
  if (team.seenTurnIds == null || typeof team.seenTurnIds === 'object' === false) team.seenTurnIds = {};
  if (team.shipApproval == null || typeof team.shipApproval === 'object' === false) team.shipApproval = { approved: false };
  return team;
}
TeamSprintStore.prototype.save = function patchedSave(team) { ensureExtendedState(team); return CURRENT_SAVE.call(this, team); };
TeamSprintStore.prototype.load = function patchedLoad(teamId) { const team = CURRENT_LOAD.call(this, teamId); return ensureExtendedState(team); };

const REGEX_SPECIAL_CODES = new Set([46, 43, 94, 36, 123, 125, 40, 41, 124, 91, 93, 92]);
function segmentMatches(text, pattern) {
  let out = '^';
  for (const ch of String(pattern)) {
    if (ch === '*') out += '[^/]*';
    else if (ch === '?') out += '[^/]';
    else if (REGEX_SPECIAL_CODES.has(ch.charCodeAt(0))) out += String.fromCharCode(92) + ch;
    else out += ch;
  }
  return new RegExp(out + '$').test(String(text));
}
function pathMatches(text, pattern) { let out = '^'; for (const ch of String(pattern)) { if (ch === '*') out += '.*'; else if (ch === '?') out += '.'; else if (REGEX_SPECIAL_CODES.has(ch.charCodeAt(0))) out += String.fromCharCode(92) + ch; else out += ch; } return new RegExp(out + '$').test(String(text)); }
export function matchGlob(filePath, pattern) {
  const p = String(filePath || '').replace(/^\.\//, '');
  const g = String(pattern || '');
  if (g === '**') return true;
  if (g.includes('**') === false) return pathMatches(p, g);
  if (g.startsWith('**/')) {
    const suffix = g.slice(3);
    if (matchGlob(p, suffix)) return true;
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i += 1) if (matchGlob(parts.slice(i).join('/'), suffix)) return true;
    return false;
  }
  if (g.endsWith('/**')) {
    const prefix = g.slice(0, -3);
    if (matchGlob(p, prefix)) return true;
    return p.startsWith(prefix.replace(/\/+$/, '') + '/');
  }
  const marker = g.indexOf('/**/');
  if (marker >= 0) {
    const head = g.slice(0, marker);
    const tail = g.slice(marker + 4);
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i += 1) {
      if (pathMatches(parts.slice(0, i).join('/'), head) && matchGlob(parts.slice(i).join('/'), tail)) return true;
    }
    return false;
  }
  return pathMatches(p, g);
}
export class GstackReviewRouter {
  constructor(rules = DEFAULT_REVIEW_RULES) { this.rules = rules.map((r) => ({ pattern: String(r.pattern), reviewers: Array.isArray(r.reviewers) ? [...r.reviewers] : [], signal: r.signal || '' })); }
  match(diffPaths) {
    const matched = new Set([REVIEW_FLOOR_ROLE]);
    const matchedRules = [];
    for (const rule of this.rules) {
      let hit = false;
      for (const filePath of diffPaths || []) { if (matchGlob(filePath, rule.pattern)) { hit = true; break; } }
      if (hit) { matchedRules.push(rule); for (const role of rule.reviewers) if (roleValid(role)) matched.add(role); }
    }
    return { reviewers: [...matched].sort(), matchedRules };
  }
}

TeamSprintStore.prototype.routeReview = function routeReview(teamId, input = {}) {
  const team = this.load(teamId);
  if (team == null) throw new TeamSprintError('TEAM_NOT_FOUND', 'team not found', 404);
  const diffPaths = Array.isArray(input.diffPaths) ? input.diffPaths.map(String).slice(0, 500) : [];
  if (diffPaths.length === 0) throw new TeamSprintError('TEAM_REVIEW_PATHS_REQUIRED', 'diffPaths required', 400);
  const result = new GstackReviewRouter(team.reviewRules || DEFAULT_REVIEW_RULES).match(diffPaths);
  const entry = { id: id('review'), diffPaths, reviewers: result.reviewers, matchedRules: result.matchedRules, status: 'pending', createdAt: now() };
  team.reviewQueue.push(entry);
  this.save(team);
  return entry;
};
TeamSprintStore.prototype.listReviews = function listReviews(teamId) {
  const team = this.load(teamId);
  if (team == null) throw new TeamSprintError('TEAM_NOT_FOUND', 'team not found', 404);
  return clone(team.reviewQueue || []);
};
export function evaluateShipApproval(team) {
  const artifacts = team.artifacts || [];
  const review = [...artifacts].reverse().find((a) => a.artifactType === 'review-report');
  const test = [...artifacts].reverse().find((a) => a.artifactType === 'test-report');
  const approval = [...artifacts].reverse().find((a) => a.artifactType === 'ship-approval');
  const checks = [];
  const reviewOk = review != null && review.payload != null && review.payload.verdict === 'approved';
  checks.push({ check: 'approved-review-report', passed: reviewOk, detail: reviewOk ? 'approved review found' : 'missing approved review-report' });
  const testOk = test != null && Number.isInteger(test.payload?.passed) && test.payload.passed > 0 && test.payload?.failed === 0;
  checks.push({ check: 'passing-test-report', passed: testOk, detail: testOk ? 'test report has passed>0 and failed=0' : 'test report missing or not green' });
  const approvedByCeo = approval != null && approval.payload?.approvedBy === 'ceo';
  checks.push({ check: 'explicit-ceo-approval', passed: approvedByCeo, detail: approvedByCeo ? 'ceo signature present' : 'ship-approval missing ceo signature' });
  const reviewSha = review?.payload?.reviewSha || '';
  const approvalSha = approval?.payload?.shaAtApproval || '';
  const shaOk = reviewSha === '' || approvalSha === reviewSha;
  checks.push({ check: 'sha-pin-match', passed: shaOk, detail: shaOk ? 'approval matches review SHA' : 'review SHA moved after approval' });
  return { passed: checks.every((c) => c.passed), checks, reviewSha, approvalSha };
}
TeamSprintStore.prototype.approveShip = function approveShip(teamId, input = {}) {
  const team = this.load(teamId);
  if (team == null) throw new TeamSprintError('TEAM_NOT_FOUND', 'team not found', 404);
  if (input.role !== 'ceo') throw new TeamSprintError('TEAM_ONLY_CEO_SHIP_APPROVAL', 'only ceo may approve ship', 403);
  const review = [...(team.artifacts || [])].reverse().find((a) => a.artifactType === 'review-report');
  if (review == null || review.payload?.verdict !== 'approved') throw new TeamSprintError('TEAM_SHIP_REVIEW_REQUIRED', 'approved review-report required before ship approval', 422);
  const sha = assertText(input.shaAtApproval || review.payload.reviewSha, 'shaAtApproval', 7, 40);
  if (/^[0-9a-f]+$/i.test(sha) === false) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'shaAtApproval must be hex', 422);
  const payload = { approvedBy: 'ceo', approvedAt: new Date().toISOString(), shaAtApproval: sha, explicit: true, note: oneLine(input.note || 'Explicit ceo ship approval', 500) };
  const artifact = { id: id('artifact'), artifactType: 'ship-approval', role: 'ceo', filename: 'ship-approval.md', payload, content: '## approval\nExplicit ceo sign-off for release after approved review and green tests with a fixed SHA pin.', createdAt: now() };
  team.artifacts.push(artifact);
  team.shipApproval = { approved: true, approvedBy: 'ceo', approvedAt: payload.approvedAt, shaAtApproval: sha };
  this.save(team);
  return artifact;
};
TeamSprintStore.prototype.shipApprovalStatus = function shipApprovalStatus(teamId) {
  const team = this.load(teamId);
  if (team == null) throw new TeamSprintError('TEAM_NOT_FOUND', 'team not found', 404);
  return evaluateShipApproval(team);
};

const TAG_RE = /^[a-z0-9][a-z0-9:_-]*$/;
function memoryBucketPath(store, teamId) {
  const safe = String(teamId).replace(/[^A-Za-z0-9_-]/g, '');
  return path.join(store.rootDir, safe + '.memory.jsonl');
}
function memoryTtlDays(tags) {
  const list = Array.isArray(tags) ? tags : [];
  if (list.length === 0) return 90;
  return Math.max(...list.map((t) => MEMORY_TTL_DAYS[t] || 90));
}
export function memoryDecay(entry, atMs = Date.now()) {
  const t = Date.parse(entry.timestamp);
  if (Number.isFinite(t) === false) return 0.05;
  const days = (atMs - t) / 86400000;
  if (days < 0) return 1;
  const ttl = memoryTtlDays(entry.tags);
  if (days <= ttl) return 1;
  if (days <= 2 * ttl) return 0.2;
  return 0.05;
}
export function memoryRecency(timestamp, atMs = Date.now()) {
  const t = Date.parse(timestamp);
  if (Number.isFinite(t) === false) return 0.1;
  const days = Math.max(0, (atMs - t) / 86400000);
  return 1 / (1 + days / 30);
}
export function memoryProvenance(entry) {
  const hasEvidence = Boolean(entry.evidence);
  if (entry.learnedFrom === 'user') return hasEvidence ? 2 : 1.2;
  if (entry.learnedFrom === 'artifact') return hasEvidence ? 1 : 0.6;
  if (entry.learnedFrom === 'sprint-reflect') return 0.8;
  return 0.3;
}
export function rankMemoryEntry(entry, atMs = Date.now()) {
  const recency = memoryRecency(entry.timestamp, atMs);
  const provenance = memoryProvenance(entry);
  const decay = memoryDecay(entry, atMs);
  return { entry, score: recency * provenance * decay, recency, provenance, decay };
}
TeamSprintStore.prototype.writeMemory = function writeMemory(teamId, input = {}) {
  const team = this.load(teamId);
  if (team == null) throw new TeamSprintError('TEAM_NOT_FOUND', 'team not found', 404);
  const scope = input.scope === 'role' ? 'role' : 'team';
  if (scope === 'role' && roleValid(input.role) === false) throw new TeamSprintError('TEAM_MEMORY_ROLE_REQUIRED', 'role scope requires a valid role', 422);
  if (scope === 'team' && input.role) throw new TeamSprintError('TEAM_MEMORY_ROLE_FORBIDDEN', 'team scope forbids role', 422);
  const tags = Array.isArray(input.tags) ? input.tags.map(String) : [];
  for (const tag of tags) if (TAG_RE.test(tag) === false) throw new TeamSprintError('TEAM_MEMORY_TAG_INVALID', 'invalid tag: ' + tag, 422);
  const confidence = input.confidence == null ? 0.7 : Number(input.confidence);
  if (Number.isFinite(confidence) === false || confidence < 0 || confidence > 1) throw new TeamSprintError('TEAM_MEMORY_CONFIDENCE', 'confidence must be in [0,1]', 422);
  const learnedFrom = MEMORY_LEARNED_FROM.includes(input.learnedFrom) ? input.learnedFrom : 'artifact';
  const ts = new Date().toISOString();
  const entry = {
    id: 'mem-' + String(teamId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) + '-' + ts.slice(0, 10).replace(/-/g, '') + '-' + crypto.randomBytes(3).toString('hex'),
    author: assertText(input.author || 'system@team', 'author', 1, 200), sprintId: String(input.sprintId || teamId), phase: String(input.phase || team.phase || ''),
    timestamp: ts, title: assertText(input.title, 'title', 1, 300), body: oneLine(input.body || '', 20000), tags,
    evidence: oneLine(input.evidence || '', 1000), confidence, learnedFrom, scope, role: scope === 'role' ? input.role : null, op: 'write',
  };
  const file = memoryBucketPath(this, teamId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'a');
  try { fs.writeSync(fd, JSON.stringify(entry) + String.fromCharCode(10)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return entry;
};

TeamSprintStore.prototype.listMemory = function listMemory(teamId, options = {}) {
  const file = memoryBucketPath(this, teamId);
  if (fs.existsSync(file) === false) return [];
  const rows = [];
  for (const raw of fs.readFileSync(file, 'utf8').split(String.fromCharCode(10))) {
    if (raw.trim() === '') continue;
    try { rows.push(JSON.parse(raw)); } catch { }
  }
  const pruned = new Set(rows.filter((r) => r.op === 'prune').map((r) => r.id));
  return rows.filter((r) => r.op === 'write' && pruned.has(r.id) === false).filter((r) => {
    if (options.scope == null || options.scope === r.scope) {
      if (options.role == null || r.role === options.role) {
        if (options.tag == null || (r.tags || []).includes(options.tag)) return true;
      }
    }
    return false;
  });
};
TeamSprintStore.prototype.searchMemory = function searchMemory(teamId, query, options = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (q === '') return { query: q, items: [] };
  const now = options.nowMs == null ? Date.now() : Number(options.nowMs);
  const items = this.listMemory(teamId, options).map((entry) => {
    const hay = [entry.title, entry.body, (entry.tags || []).join(' ')].join(' ').toLowerCase();
    const hits = q.split(/\s+/).filter(Boolean).reduce((n, word) => n + (hay.includes(word) ? 1 : 0), 0);
    const ranked = rankMemoryEntry(entry, now);
    return { ...ranked, hits, score: ranked.score * (1 + hits * 0.05) };
  }).filter((row) => row.hits > 0).sort((a, b) => b.score - a.score);
  return { query: q, items };
};
TeamSprintStore.prototype.pruneMemory = function pruneMemory(teamId, memoryId, input = {}) {
  const team = this.load(teamId);
  if (team == null) throw new TeamSprintError('TEAM_NOT_FOUND', 'team not found', 404);
  const entry = { id: assertText(memoryId, 'memoryId', 1, 200), author: String(input.author || 'system@prune'), sprintId: teamId, phase: team.phase, timestamp: new Date().toISOString(), title: 'tombstone for ' + memoryId, body: '', tags: ['tombstone'], evidence: '', confidence: 1, learnedFrom: 'user', scope: input.scope === 'role' ? 'role' : 'team', role: input.scope === 'role' ? input.role : null, op: 'prune' };
  const file = memoryBucketPath(this, teamId);
  fs.appendFileSync(file, JSON.stringify(entry) + String.fromCharCode(10));
  return entry;
};
TeamSprintStore.prototype.writePhaseMemory = function writePhaseMemory(teamId, fromPhase, toPhase, role) {
  return this.writeMemory(teamId, {
    author: role + '@team', sprintId: teamId, phase: fromPhase,
    title: 'Phase ' + fromPhase + ' completed and advanced to ' + toPhase,
    body: 'Evidence gate passed before ceo advanced the sprint from ' + fromPhase + ' to ' + toPhase + '.',
    tags: ['retro', 'phase'], evidence: 'phase-history:' + fromPhase, confidence: 0.8, learnedFrom: 'sprint-reflect', scope: 'team',
  });
};

export function attentionAgeBucket(ageHours) {
  if (ageHours < 1) return '<1h';
  if (ageHours < 2) return '1-2h';
  if (ageHours < 8) return '2-8h';
  return '>8h';
}
export function computeAttentionPriority(item, atMs = Date.now()) {
  const urgency = Number.isInteger(item.urgency) ? item.urgency : (ATTENTION_URGENCY[item.urgencyLabel] == null ? 1 : ATTENTION_URGENCY[item.urgencyLabel]);
  const ageHours = Math.max(0, (atMs - Number(item.createdAt || atMs)) / 3600000);
  const tags = Array.isArray(item.tags) ? item.tags : [];
  return urgency * 10 + (item.blocking ? 5 : 0) + ageHours + tags.length * 0.1;
}
export function buildAttentionDigest(items) {
  const clusters = new Map();
  for (const item of items) {
    const tag = (item.tags || [])[0] || 'untagged';
    const key = [item.sprintId || '', tag, attentionAgeBucket(item.ageHours)].join('|');
    if (clusters.has(key) === false) clusters.set(key, []);
    clusters.get(key).push(item);
  }
  const out = [];
  for (const group of clusters.values()) {
    const top = group.reduce((a, b) => (a.priorityScore >= b.priorityScore ? a : b));
    const reversibility = { easy: 0, medium: 0, hard: 0 };
    for (const item of group) if (reversibility[item.reversibility] != null) reversibility[item.reversibility] += 1;
    out.push({ sprintId: top.sprintId || '', tag: (top.tags || [])[0] || 'untagged', ageBucket: attentionAgeBucket(top.ageHours), count: group.length, highestPriority: top.priorityScore, representativeTitle: top.title, reversibility });
  }
  return out.sort((a, b) => b.highestPriority - a.highestPriority);
}
TeamSprintStore.prototype.addAttention = function addAttention(teamId, input = {}) {
  const team = this.load(teamId);
  if (team == null) throw new TeamSprintError('TEAM_NOT_FOUND', 'team not found', 404);
  const urgencyLabel = Object.prototype.hasOwnProperty.call(ATTENTION_URGENCY, input.urgency) ? input.urgency : 'normal';
  const item = { id: id('attn'), sprintId: teamId, title: assertText(input.title, 'title', 3, 300), body: oneLine(input.body || '', 4000), urgencyLabel, urgency: ATTENTION_URGENCY[urgencyLabel], blocking: input.blocking === true, tags: Array.isArray(input.tags) ? input.tags.map(String).slice(0, 16) : [], reversibility: ['easy', 'medium', 'hard'].includes(input.reversibility) ? input.reversibility : 'medium', status: 'open', source: String(input.source || 'manual'), createdAt: now(), answeredAt: null, answer: null, autoAccepted: false, ttlMinutes: Number.isInteger(input.ttlMinutes) ? input.ttlMinutes : 15 };
  team.attention.push(item);
  this.save(team);
  return clone(item);
};

TeamSprintStore.prototype.allAttention = function allAttention(teamId, options = {}) {
  const team = this.load(teamId);
  if (team == null) throw new TeamSprintError('TEAM_NOT_FOUND', 'team not found', 404);
  const atMs = options.nowMs == null ? Date.now() : Number(options.nowMs);
  const raw = (team.attention || []).filter((i) => options.includeAnswered ? true : i.status === 'open').map((i) => ({ ...clone(i), synthetic: false }));
  for (const message of team.messages || []) {
    for (let index = 0; index < (message.parts || []).length; index += 1) {
      const part = message.parts[index];
      if (part.type === 'approval' && part.status === 'pending') {
        raw.push({ id: 'approval:' + message.id + ':' + index, sprintId: teamId, title: part.title || 'Approval required', body: part.text || '', urgencyLabel: part.blocking ? 'high' : 'normal', urgency: part.blocking ? 2 : 1, blocking: Boolean(part.blocking), tags: ['approval'], reversibility: part.reversibility || 'medium', status: 'open', source: 'chat-approval', createdAt: message.createdAt, synthetic: true });
      }
    }
  }
  return raw.map((item) => {
    const ageHours = Math.max(0, (atMs - Number(item.createdAt || atMs)) / 3600000);
    return { ...item, ageHours, ageBucket: attentionAgeBucket(ageHours), priorityScore: computeAttentionPriority(item, atMs) };
  }).sort((a, b) => b.priorityScore - a.priorityScore);
};
TeamSprintStore.prototype.attentionDigest = function attentionDigest(teamId, options = {}) {
  return { items: buildAttentionDigest(this.allAttention(teamId, options)), generatedAt: now() };
};
TeamSprintStore.prototype.answerAttention = function answerAttention(teamId, attentionId, input = {}) {
  const team = this.load(teamId);
  if (team == null) throw new TeamSprintError('TEAM_NOT_FOUND', 'team not found', 404);
  const answer = assertText(input.answer || input.decision || 'acknowledged', 'answer', 1, 4000);
  if (String(attentionId).startsWith('approval:')) {
    const parts = String(attentionId).split(':');
    const message = (team.messages || []).find((m) => m.id === parts[1]);
    const part = message == null ? null : message.parts[Number(parts[2])];
    if (part == null || part.type === 'approval' === false) throw new TeamSprintError('TEAM_ATTENTION_NOT_FOUND', 'approval item not found', 404);
    part.status = input.decision === 'rejected' ? 'rejected' : 'approved';
    part.resolvedAt = now(); part.resolvedBy = String(input.actor || 'user'); part.answer = answer;
    this.save(team);
    return clone(part);
  }
  const item = team.attention.find((i) => i.id === attentionId);
  if (item == null) throw new TeamSprintError('TEAM_ATTENTION_NOT_FOUND', 'attention item not found', 404);
  item.status = 'answered'; item.answeredAt = now(); item.answer = answer; item.answeredBy = String(input.actor || 'user');
  this.save(team);
  return clone(item);
};

TeamSprintStore.prototype.autoAcceptReversible = function autoAcceptReversible(teamId, input = {}) {
  const team = this.load(teamId);
  if (team == null) throw new TeamSprintError('TEAM_NOT_FOUND', 'team not found', 404);
  const ttlMinutes = Number.isInteger(input.ttlMinutes) && input.ttlMinutes > 0 ? input.ttlMinutes : 15;
  const applied = [];
  const skipped = [];
  for (const item of team.attention) {
    if (item.status === 'open' && item.reversibility === 'easy') {
      item.status = 'answered'; item.answeredAt = now(); item.answeredBy = 'auto-accept'; item.answer = 'auto-accepted default option'; item.autoAccepted = true; item.ttlMinutes = ttlMinutes; item.expiresAt = now() + ttlMinutes * 60000;
      applied.push(item.id);
    } else if (item.status === 'open') skipped.push(item.id);
  }
  this.save(team);
  return { applied, skipped, ttlMinutes };
};
export const NO_PROGRESS_THRESHOLD = 2;
const THEATER_EVIDENCE_RE = /^(done|ok|completed|looks good|no changes|n\/a|none)$/i;
export function assertSubstantiveEvidence(text) {
  const raw = String(text == null ? '' : text).trim();
  if (THEATER_EVIDENCE_RE.test(raw) || hasStub(raw)) throw new TeamSprintError('TEAM_THEATER_EVIDENCE', 'generic or stubbed evidence rejected', 422);
  return assertText(raw, 'evidence', 12, 4000);
}
TeamSprintStore.prototype.registerTurn = function registerTurn(teamId, input = {}) {
  const team = this.load(teamId);
  if (team == null) throw new TeamSprintError('TEAM_NOT_FOUND', 'team not found', 404);
  if (roleValid(input.role) === false) throw new TeamSprintError('TEAM_ROLE_INVALID', 'role invalid', 400);
  const role = String(input.role);
  const turnId = String(input.turnId || '');
  if (turnId !== '') {
    const seen = Array.isArray(team.seenTurnIds[role]) ? team.seenTurnIds[role] : [];
    if (seen.includes(turnId)) return { deduped: true, triggered: false, reason: 'duplicate turn id' };
    seen.push(turnId); team.seenTurnIds[role] = seen.slice(-500);
  }
  const key = role;
  const current = team.progress[key] || { noProgress: 0, artifactBytes: 0, turns: 0, lastProgressAt: now(), triggered: false };
  current.turns += 1;
  const bytes = Math.max(0, Number(input.artifactBytes || 0));
  const progressed = input.taskCompleted === true || bytes > Number(current.artifactBytes || 0);
  if (progressed) { current.noProgress = 0; current.triggered = false; current.lastProgressAt = now(); current.artifactBytes = Math.max(current.artifactBytes || 0, bytes); }
  else current.noProgress = (current.noProgress || 0) + 1;
  team.progress[key] = current;
  let attention = null;
  if (current.noProgress >= NO_PROGRESS_THRESHOLD && current.triggered === false) {
    current.triggered = true;
    attention = { id: id('attn'), sprintId: teamId, title: role + ' has ' + current.noProgress + ' consecutive no-progress turns', body: 'The role emitted turns without a task completion or artifact-byte gain. Choose keep waiting, restart agent, or abort sprint.', urgencyLabel: 'high', urgency: 2, blocking: true, tags: ['theater', role], reversibility: 'hard', status: 'open', source: 'theater', createdAt: now(), answeredAt: null, answer: null, autoAccepted: false, ttlMinutes: 15 };
    team.attention.push(attention);
  }
  this.save(team);
  return { role, noProgress: current.noProgress, triggered: attention != null, attention: attention == null ? null : clone(attention) };
};
TeamSprintStore.prototype.theaterStatus = function theaterStatus(teamId) {
  const team = this.load(teamId);
  if (team == null) throw new TeamSprintError('TEAM_NOT_FOUND', 'team not found', 404);
  const roles = {};
  for (const role of ROLES) roles[role] = team.progress[role] || { noProgress: 0, artifactBytes: 0, turns: 0, triggered: false };
  return { threshold: NO_PROGRESS_THRESHOLD, roles };
};

export const ARTIFACT_SCHEMAS = Object.freeze({
  delegation: { sections: [], minBody: 20 },
  'architecture-lock': { sections: ['architecture'], minBody: 100 },
  diff: { sections: [], minBody: 20 },
  'review-report': { sections: ['findings'], minBody: 100 },
  'test-report': { sections: ['results'], minBody: 100 },
  'ship-approval': { sections: ['approval'], minBody: 100 },
  retro: { sections: ['retro'], minBody: 100 },
  'design-doc': { sections: ['problem', 'users', 'constraints', 'rationale', 'pm-verdict'], minBody: 100 },
  'plan-doc': { sections: ['architecture-lock', 'tasks', 'edge-cases', 'test-plan'], minBody: 100 },
  'codex-review': { sections: ['summary'], minBody: 40 },
  'benchmark-report': { sections: ['benchmark'], minBody: 40 },
  'canary-report': { sections: ['canary'], minBody: 40 },
  'deploy-notes': { sections: ['deploy'], minBody: 40 },
  'ship-notes': { sections: ['ship'], minBody: 40 },
});
function payloadValue(payload, ...keys) {
  for (const key of keys) if (Object.prototype.hasOwnProperty.call(payload, key)) return payload[key];
  return undefined;
}
function sectionText(content, name) {
  const lines = String(content || '').split(String.fromCharCode(10));
  let body = '';
  let active = false;
  for (const line of lines) {
    if (line.trim() === '## ' + name) { active = true; continue; }
    if (active && line.startsWith('## ')) break;
    if (active) body += line + String.fromCharCode(10);
  }
  return body.trim();
}
function validateSectionBodies(type, content) {
  const spec = ARTIFACT_SCHEMAS[type];
  if (spec == null) throw new TeamSprintError('TEAM_ARTIFACT_UNKNOWN', 'unknown artifact type: ' + type, 422);
  if (hasStub(content)) throw new TeamSprintError('TEAM_STUB_REJECTED', 'artifact content contains stub marker', 422);
  if (Buffer.byteLength(String(content || ''), 'utf8') < spec.minBody) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', type + ' body is too short', 422);
  for (const section of spec.sections) {
    const body = sectionText(content, section);
    if (body === '') throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'required section ## ' + section + ' missing', 422);
    if (Buffer.byteLength(body, 'utf8') <= 100) throw new TeamSprintError('TEAM_ARTIFACT_STUB', 'section ## ' + section + ' is a stub', 422);
  }
}

export function validateArtifactSchema(artifactType, payload = {}, content = '') {
  const type = String(artifactType || '');
  validateSectionBodies(type, content);
  const v = (...keys) => payloadValue(payload, ...keys);
  if (type === 'design-doc') {
    assertText(v('problemStatement', 'problem_statement'), 'problemStatement', 120, 8000);
    assertText(v('users'), 'users', 50, 4000);
    assertText(v('constraints'), 'constraints', 50, 4000);
    assertText(v('rationale'), 'rationale', 120, 8000);
    if (ENUMS.pmVerdict.includes(v('pmVerdict', 'pm_verdict')) === false) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'pmVerdict invalid', 422);
    const questions = v('forcingQuestionsAddressed', 'forcing_questions_addressed');
    if (Array.isArray(questions) === false || questions.length !== 6) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'forcingQuestionsAddressed must have exactly 6 items', 422);
  }
  if (type === 'plan-doc') {
    assertText(v('architectureLock', 'architecture_lock'), 'architectureLock', 120, 8000);
    const tasks = v('tasks');
    if (Array.isArray(tasks) === false || tasks.length < 1) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'tasks required', 422);
    for (const task of tasks) { assertText(task.description, 'task.description', 20, 2000); assertText(task.ownerRole || task.owner_role, 'task.ownerRole', 2, 40); }
    if (Array.isArray(v('edgeCases', 'edge_cases')) === false || v('edgeCases', 'edge_cases').length < 3) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'edgeCases requires at least 3 entries', 422);
    assertText(v('testPlan', 'test_plan'), 'testPlan', 80, 8000);
    assertText(v('planOwner', 'plan_owner'), 'planOwner', 2, 80);
  }
  if (type === 'review-report') {
    const sha = assertText(v('reviewSha', 'review_sha'), 'reviewSha', 7, 40);
    if (/^[0-9a-f]+$/i.test(sha) === false) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'reviewSha must be hex', 422);
    if (ENUMS.reviewVerdict.includes(v('verdict')) === false) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'review verdict invalid', 422);
    const findings = v('findings');
    if (Array.isArray(findings) === false || findings.length < 1) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'findings required', 422);
    assertText(v('reviewerPersona', 'reviewer_persona'), 'reviewerPersona', 2, 80);
  }
  if (type === 'test-report') {
    assertText(v('testCommand', 'test_command'), 'testCommand', 5, 1000);
    assertText(v('outputExcerpt', 'output_excerpt'), 'outputExcerpt', 30, 8000);
    const passed = v('passed'); const failed = v('failed');
    if (Number.isInteger(passed) === false || passed < 0) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'passed must be a non-negative integer', 422);
    if (Number.isInteger(failed) === false || failed < 0) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'failed must be a non-negative integer', 422);
    if (ENUMS.qaMode.includes(v('qaMode', 'qa_mode') || 'qa') === false) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'qaMode invalid', 422);
  }
  if (type === 'ship-notes') {
    assertText(v('deployUrl', 'deploy_url'), 'deployUrl', 1, 1000);
    if (ENUMS.shipStep.includes(v('shipStep', 'ship_step')) === false) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'shipStep invalid', 422);
    assertText(v('notes'), 'notes', 20, 4000);
  }
  if (type === 'ship-approval') {
    if (v('approvedBy', 'approved_by') !== 'ceo') throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'approvedBy must be ceo', 422);
    assertText(v('approvedAt', 'approved_at'), 'approvedAt', 8, 80);
    const sha = assertText(v('shaAtApproval', 'sha_at_approval'), 'shaAtApproval', 7, 40);
    if (/^[0-9a-f]+$/i.test(sha) === false) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'shaAtApproval must be hex', 422);
  }
  if (type === 'retro') {
    const personas = v('personas');
    if (Array.isArray(personas) === false || personas.length < 2) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'retro requires at least 2 personas', 422);
    if (Array.isArray(v('whatWorked', 'what_worked')) === false || v('whatWorked', 'what_worked').length < 1) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'whatWorked required', 422);
    if (Array.isArray(v('keyLessons', 'key_lessons')) === false || v('keyLessons', 'key_lessons').length < 1) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'keyLessons required', 422);
  }
  return { artifactType: type, payload: clone(payload), content: String(content || '') };
}

export function validateExtendedArtifact(artifactType, payload = {}, content = '') {
  const checked = validateArtifactSchema(artifactType, payload, content);
  const type = checked.artifactType;
  const p = checked.payload;
  const v = (...keys) => payloadValue(p, ...keys);
  if (type === 'architecture-lock') assertText(v('architectureLock', 'architecture_lock'), 'architectureLock', 80, 8000);
  if (type === 'diff') {
    if (Array.isArray(v('filesChanged', 'files_changed')) === false || v('filesChanged', 'files_changed').length < 1) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'filesChanged required', 422);
    const body = String(content);
    if (body.includes('@@') === false && body.includes('diff --git') === false) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'diff body must contain a real diff hunk', 422);
  }
  if (type === 'codex-review') {
    if (['review', 'adversarial', 'consultation'].includes(v('mode')) === false) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'codex mode invalid', 422);
    assertText(v('target'), 'target', 1, 500);
    if (['pass', 'fail', 'n/a'].includes(v('verdict') || 'n/a') === false) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'codex verdict invalid', 422);
  }
  if (type === 'benchmark-report') {
    if (['clean', 'regression'].includes(v('benchmarkStatus', 'benchmark_status')) === false) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'benchmarkStatus invalid', 422);
    const ttfb = Number(v('ttfbMs', 'ttfb_ms')); const dom = Number(v('domLoadedMs', 'dom_loaded_ms'));
    if (Number.isFinite(ttfb) === false || ttfb < 0 || Number.isFinite(dom) === false || dom < 0) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'benchmark timings invalid', 422);
    if (['lighthouse', 'curl'].includes(v('measuredWith', 'measured_with') || 'lighthouse') === false) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'measuredWith invalid', 422);
  }
  if (type === 'canary-report') {
    if (['clean', 'regression'].includes(v('canaryStatus', 'canary_status')) === false) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'canaryStatus invalid', 422);
    const windowSeconds = v('windowSeconds', 'window_seconds'); const count2 = v('http2xxCount', 'http_2xx_count'); const count5 = v('http5xxCount', 'http_5xx_count'); const avg = Number(v('avgResponseMs', 'avg_response_ms'));
    if (Number.isInteger(windowSeconds) === false || windowSeconds < 1 || Number.isInteger(count2) === false || count2 < 0 || Number.isInteger(count5) === false || count5 < 0 || Number.isFinite(avg) === false || avg < 0) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'canary counters invalid', 422);
  }
  if (type === 'deploy-notes') {
    if (['succeeded', 'failed', 'pending'].includes(v('deployStatus', 'deploy_status')) === false) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'deployStatus invalid', 422);
    assertText(v('deployUrl', 'deploy_url'), 'deployUrl', 1, 1000);
    if (['vercel', 'netlify', 'fly', 'custom'].includes(v('provider')) === false) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'provider invalid', 422);
    const sha = assertText(v('commitSha', 'commit_sha'), 'commitSha', 7, 40);
    if (/^[0-9a-f]+$/i.test(sha) === false) throw new TeamSprintError('TEAM_ARTIFACT_INVALID', 'commitSha must be hex', 422);
  }
  return checked;
}

const CURRENT_SUBMIT = TeamSprintStore.prototype.submitArtifact;
const CURRENT_COMPLETE = TeamSprintStore.prototype.completeTask;
const CURRENT_ADVANCE = TeamSprintStore.prototype.advancePhase;
TeamSprintStore.prototype.completeTask = function completeTaskEnhanced(teamId, taskId, role, evidence) {
  assertSubstantiveEvidence(evidence);
  const task = CURRENT_COMPLETE.call(this, teamId, taskId, role, evidence);
  this.registerTurn(teamId, { role, turnId: 'task-complete:' + taskId, taskCompleted: true });
  return task;
};
TeamSprintStore.prototype.submitArtifact = function submitArtifactEnhanced(teamId, input = {}) {
  const team = this.load(teamId);
  if (team == null) throw new TeamSprintError('TEAM_NOT_FOUND', 'team not found', 404);
  if (roleValid(input.role) === false) throw new TeamSprintError('TEAM_ROLE_INVALID', 'role invalid', 400);
  const type = String(input.artifactType || '');
  const checked = validateExtendedArtifact(type, input.payload || {}, input.content || '');
  const artifact = { id: id('artifact'), artifactType: type, role: String(input.role), filename: oneLine(input.filename || ARTIFACT_DEFAULT_NAMES[type] || 'artifact.txt', 160), payload: checked.payload, content: checked.content, createdAt: now() };
  team.artifacts.push(artifact);
  this.save(team);
  return artifact;
};
TeamSprintStore.prototype.advancePhase = function advancePhaseEnhanced(teamId, role, toPhase) {
  const team = this.load(teamId);
  if (team == null) throw new TeamSprintError('TEAM_NOT_FOUND', 'team not found', 404);
  if (role !== 'ceo') throw new TeamSprintError('TEAM_ONLY_CEO_ADVANCES', 'actor is not authorized; only ceo can advance phases', 403);
  if (team.phase === 'test' && toPhase === 'ship') {
    const gate = evaluateShipApproval(team);
    if (gate.passed === false) throw new TeamSprintError('TEAM_SHIP_APPROVAL_REQUIRED', 'ship approval gate blocked: ' + gate.checks.filter((c) => c.passed === false).map((c) => c.detail).join('; '), 422);
  }
  const updated = CURRENT_ADVANCE.call(this, teamId, role, toPhase);
  this.writePhaseMemory(teamId, team.phase, toPhase, role);
  return updated;
};

const CURRENT_CHAT = TeamSprintStore.prototype.postChat;
TeamSprintStore.prototype.postChat = function postChatEnhanced(teamId, input = {}) {
  const team = this.load(teamId);
  if (team == null) throw new TeamSprintError('TEAM_NOT_FOUND', 'team not found', 404);
  if (roleValid(input.role) === false) throw new TeamSprintError('TEAM_ROLE_INVALID', 'role invalid', 400);
  const parts = Array.isArray(input.parts) ? input.parts : [{ type: 'text', text: input.text || '' }];
  const normalized = [];
  for (const part of parts.slice(0, 80)) {
    const type = String(part && part.type || '');
    if (['text', 'reasoning', 'tool', 'approval'].includes(type) === false) throw new TeamSprintError('TEAM_CHAT_PART_INVALID', 'part type invalid', 422);
    if (type === 'text' || type === 'reasoning') {
      normalized.push({ type, text: assertText(part.text || part.content || '', type + ' text', 1, 20000) });
    } else if (type === 'tool') {
      normalized.push({ type, toolName: assertText(part.toolName || '', 'toolName', 1, 120), input: part.input == null ? null : part.input, output: part.output == null ? null : part.output, status: String(part.status || 'done') });
    } else {
      normalized.push({ type, title: assertText(part.title || 'Approval required', 'approval title', 3, 300), text: oneLine(part.text || '', 4000), status: 'pending', blocking: part.blocking === true, reversibility: ['easy', 'medium', 'hard'].includes(part.reversibility) ? part.reversibility : 'medium', approvalId: oneLine(part.approvalId || id('approval'), 80) });
    }
  }
  if (normalized.length === 0) throw new TeamSprintError('TEAM_CHAT_PART_INVALID', 'at least one part required', 422);
  const message = { id: id('msg'), role: input.role, parts: normalized, createdAt: now() };
  team.messages.push(message);
  this.save(team);
  return message;
};

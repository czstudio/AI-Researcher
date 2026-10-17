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

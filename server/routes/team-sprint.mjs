// HTTP surface for the absorbed ClawTeam-gstack sprint engine.
import path from 'node:path';
import { ok, fail } from '../lib/util.mjs';
import { TeamSprintStore, TeamSprintError, ROLES, PHASES, ROLE_DEFINITIONS, validateTurnEnvelope } from '../lib/team-sprint.mjs';

const rootDir = path.join(process.env.NOVIX_DATA_DIR || path.resolve(process.cwd(), 'data'), 'team-sprints');
const store = new TeamSprintStore({ rootDir });
function asFail(err) {
  if (err instanceof TeamSprintError) return fail(err.code, err.message);
  return fail('5000', err.message || String(err));
}
function own(team, user) { return team != null && (team.ownerId == null || team.ownerId === String(user.id)); }
export function registerTeamRoutes(route, helpers = {}) {
  const auth = (req, p) => helpers.requireUser ? helpers.requireUser(req, p) : { user: { id: 'local' }, anon: false };
  route('GET', '/team/roles', async () => ok({ roles: ROLES, phases: PHASES, definitions: ROLE_DEFINITIONS }));
  route('POST', '/team/sprints', async (req, res, p, body) => {
    const a = auth(req, p); if (a.denied) return a.denied;
    try { return ok(store.create({ ...body, ownerId: a.user.id })); } catch (err) { return asFail(err); }
  });
  route('GET', '/team/sprints', async (req, res, p) => {
    const a = auth(req, p); if (a.denied) return a.denied;
    return ok({ items: store.list(a.user.id) });
  });
  route('GET', '/team/sprints/:id', async (req, res, p) => {
    const a = auth(req, p); if (a.denied) return a.denied;
    const team = store.load(p.id);
    if (own(team, a.user) === false) return fail('5200', 'team not owned by caller');
    return ok(team);
  });
  route('POST', '/team/sprints/:id/spawn', async (req, res, p, body) => {
    const a = auth(req, p); if (a.denied) return a.denied;
    const team = store.load(p.id);
    if (own(team, a.user) === false) return fail('5200', 'team not owned by caller');
    try { return ok(store.spawn(p.id, body.role)); } catch (err) { return asFail(err); }
  });
  route('POST', '/team/sprints/:id/tasks', async (req, res, p, body) => {
    const a = auth(req, p); if (a.denied) return a.denied;
    const team = store.load(p.id);
    if (own(team, a.user) === false) return fail('5200', 'team not owned by caller');
    try { return ok(store.createTask(p.id, body)); } catch (err) { return asFail(err); }
  });
  route('POST', '/team/sprints/:id/tasks/:taskId/claim', async (req, res, p, body) => {
    const a = auth(req, p); if (a.denied) return a.denied;
    const team = store.load(p.id);
    if (own(team, a.user) === false) return fail('5200', 'team not owned by caller');
    try { return ok(store.claimTask(p.id, p.taskId, body.role)); } catch (err) { return asFail(err); }
  });
  route('POST', '/team/sprints/:id/tasks/:taskId/complete', async (req, res, p, body) => {
    const a = auth(req, p); if (a.denied) return a.denied;
    const team = store.load(p.id);
    if (own(team, a.user) === false) return fail('5200', 'team not owned by caller');
    try { return ok(store.completeTask(p.id, p.taskId, body.role, body.evidence)); } catch (err) { return asFail(err); }
  });
  route('POST', '/team/sprints/:id/phase/advance', async (req, res, p, body) => {
    const a = auth(req, p); if (a.denied) return a.denied;
    const team = store.load(p.id);
    if (own(team, a.user) === false) return fail('5200', 'team not owned by caller');
    try { return ok(store.advancePhase(p.id, body.role, body.toPhase)); } catch (err) { return asFail(err); }
  });
  route('POST', '/team/sprints/:id/artifacts', async (req, res, p, body) => {
    const a = auth(req, p); if (a.denied) return a.denied;
    const team = store.load(p.id);
    if (own(team, a.user) === false) return fail('5200', 'team not owned by caller');
    try { return ok(store.submitArtifact(p.id, body)); } catch (err) { return asFail(err); }
  });
  route('POST', '/team/sprints/:id/artifacts/:artifactId/verify', async (req, res, p) => {
    const a = auth(req, p); if (a.denied) return a.denied;
    const team = store.load(p.id);
    if (own(team, a.user) === false) return fail('5200', 'team not owned by caller');
    try { return ok(store.verifyTestArtifact(p.id, p.artifactId)); } catch (err) { return asFail(err); }
  });
  route('POST', '/team/sprints/:id/mail', async (req, res, p, body) => {
    const a = auth(req, p); if (a.denied) return a.denied;
    const team = store.load(p.id);
    if (own(team, a.user) === false) return fail('5200', 'team not owned by caller');
    try { return ok(store.sendMail(p.id, body)); } catch (err) { return asFail(err); }
  });
  route('GET', '/team/sprints/:id/mail', async (req, res, p) => {
    const a = auth(req, p); if (a.denied) return a.denied;
    const team = store.load(p.id);
    if (own(team, a.user) === false) return fail('5200', 'team not owned by caller');
    return ok({ items: store.listMail(p.id, p.role || null) });
  });
  route('POST', '/team/sprints/:id/messages', async (req, res, p, body) => {
    const a = auth(req, p); if (a.denied) return a.denied;
    const team = store.load(p.id);
    if (own(team, a.user) === false) return fail('5200', 'team not owned by caller');
    try { return ok(store.postChat(p.id, body)); } catch (err) { return asFail(err); }
  });
  route('POST', '/team/envelopes/validate', async (req, res, p, body) => {
    const a = auth(req, p); if (a.denied) return a.denied;
    try { return ok(validateTurnEnvelope(body.role, body.envelope || body)); } catch (err) { return asFail(err); }
  });
  registerExtendedTeamRoutes(route, helpers, store, own, asFail, auth);
}

function registerExtendedTeamRoutes(route, helpers, store, own, asFail, auth) {
  const guard = (req, p) => {
    const a = auth(req, p);
    if (a.denied) return { denied: a.denied };
    const team = store.load(p.id);
    if (own(team, a.user) === false) return { denied: fail('5200', 'team not owned by caller') };
    return { a, team };
  };
  route('GET', '/team/sprints/:id/review', async (req, res, p) => {
    const g = guard(req, p); if (g.denied) return g.denied;
    return ok({ items: store.listReviews(p.id) });
  });
  route('POST', '/team/sprints/:id/review/route', async (req, res, p, body) => {
    const g = guard(req, p); if (g.denied) return g.denied;
    try { return ok(store.routeReview(p.id, body)); } catch (err) { return asFail(err); }
  });
  route('GET', '/team/sprints/:id/ship/approval', async (req, res, p) => {
    const g = guard(req, p); if (g.denied) return g.denied;
    try { return ok(store.shipApprovalStatus(p.id)); } catch (err) { return asFail(err); }
  });
  route('POST', '/team/sprints/:id/ship/approve', async (req, res, p, body) => {
    const g = guard(req, p); if (g.denied) return g.denied;
    try { return ok(store.approveShip(p.id, body)); } catch (err) { return asFail(err); }
  });
  route('POST', '/team/sprints/:id/memory', async (req, res, p, body) => {
    const g = guard(req, p); if (g.denied) return g.denied;
    try { return ok(store.writeMemory(p.id, body)); } catch (err) { return asFail(err); }
  });
  route('GET', '/team/sprints/:id/memory', async (req, res, p) => {
    const g = guard(req, p); if (g.denied) return g.denied;
    try {
      if (p.q) return ok(store.searchMemory(p.id, p.q, { scope: p.scope || 'team', role: p.role || null }));
      return ok({ items: store.listMemory(p.id, { scope: p.scope || 'team', role: p.role || null }) });
    } catch (err) { return asFail(err); }
  });
  route('POST', '/team/sprints/:id/memory/prune', async (req, res, p, body) => {
    const g = guard(req, p); if (g.denied) return g.denied;
    try { return ok(store.pruneMemory(p.id, body.memoryId, body)); } catch (err) { return asFail(err); }
  });
  route('GET', '/team/sprints/:id/attention', async (req, res, p) => {
    const g = guard(req, p); if (g.denied) return g.denied;
    try { return ok({ items: store.allAttention(p.id, { includeAnswered: p.includeAnswered === 'true' }) }); } catch (err) { return asFail(err); }
  });
  route('GET', '/team/sprints/:id/attention/digest', async (req, res, p) => {
    const g = guard(req, p); if (g.denied) return g.denied;
    try { return ok(store.attentionDigest(p.id)); } catch (err) { return asFail(err); }
  });
  route('POST', '/team/sprints/:id/attention/auto-accept', async (req, res, p, body) => {
    const g = guard(req, p); if (g.denied) return g.denied;
    try { return ok(store.autoAcceptReversible(p.id, body)); } catch (err) { return asFail(err); }
  });
  route('POST', '/team/sprints/:id/attention/:attentionId/answer', async (req, res, p, body) => {
    const g = guard(req, p); if (g.denied) return g.denied;
    try { return ok(store.answerAttention(p.id, p.attentionId, body)); } catch (err) { return asFail(err); }
  });
  route('POST', '/team/sprints/:id/progress/turn', async (req, res, p, body) => {
    const g = guard(req, p); if (g.denied) return g.denied;
    try { return ok(store.registerTurn(p.id, body)); } catch (err) { return asFail(err); }
  });
  route('GET', '/team/sprints/:id/theater', async (req, res, p) => {
    const g = guard(req, p); if (g.denied) return g.denied;
    try { return ok(store.theaterStatus(p.id)); } catch (err) { return asFail(err); }
  });
}

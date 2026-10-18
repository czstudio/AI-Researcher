// HTTP surface for the absorbed AutoResearch lab. Routes are registered into
// the existing api.mjs route table by the lead. Persistence is on disk under
// NOVIX_DATA_DIR/autoresearch; the lab creates per-run temp workspaces.
import fs from 'node:fs';
import path from 'node:path';
import { AutoResearchLab, LabValidationError, RESULTS_COLUMNS, VECTORIZED_ENV_CONTRACT, EVALUATOR_ENV_VARS } from '../lib/autoresearch-lab.mjs';
import { ok, fail } from '../lib/util.mjs';

const DEFAULT_ROOT = path.join(process.env.NOVIX_DATA_DIR || path.resolve(process.cwd(), 'data'), 'autoresearch');

function errorResult(err) {
  const code = err instanceof LabValidationError ? err.code : '5000';
  return fail(code, err && err.message ? err.message : String(err));
}

function ownerOf(run, user) {
  return run != null && user != null && String(run.ownerId) === String(user.id);
}

export function registerAutoresearchRoutes(route, helpers = {}) {
  const lab = helpers.lab || new AutoResearchLab({ rootDir: helpers.rootDir || DEFAULT_ROOT });
  const auth = (req, p) => {
    if (typeof helpers.requireUser === 'function') return helpers.requireUser(req, p);
    return { user: null, denied: fail('401', 'authentication required') };
  };
  const safeLoad = (id) => {
    try { return lab.load(id); } catch (err) { throw err; }
  };
  const owned = (req, p) => {
    const a = auth(req, p);
    if (a.denied) return { denied: a.denied };
    if (a.user == null) return { denied: fail('401', 'authentication required') };
    let run;
    try { run = safeLoad(p.id); } catch (err) { return { denied: errorResult(err) }; }
    if (run == null) return { denied: fail('5001', 'run not found') };
    if (ownerOf(run, a.user) === false) return { denied: fail('5200', 'run not owned by caller') };
    return { user: a.user, run, denied: null };
  };

  route('GET', '/autoresearch/lab/contract', async () => ok({
    resultsColumns: RESULTS_COLUMNS,
    statuses: ['keep', 'discard', 'crash'],
    evaluator: {
      default: 'deterministic-simulated offline evaluator',
      realGpuTraining: false,
      injectable: true,
      envVars: EVALUATOR_ENV_VARS,
      contract: 'external evaluator receives spec + ctx.signal/ctx.workspaceDir and returns {val_bpb, memory_gb}',
    },
    workspace: { isolation: 'per-run temp workspace; snapshot or optional git worktree; main repo index never mutated', cleanup: true },
    batch: { simulatedVectorized: true, realMlxSimEngine: false, independentChildRuns: true },
    vectorized: VECTORIZED_ENV_CONTRACT,
  }));

  route('POST', '/autoresearch/lab/runs', async (req, res, p) => {
    const a = auth(req, p);
    if (a.denied) return a.denied;
    if (a.user == null) return fail('401', 'authentication required');
    try {
      const input = Object.assign({}, p, { ownerId: a.user.id, workspace: { mode: 'empty' } });
      return ok(lab.create(input));
    } catch (err) { return errorResult(err); }
  });

  route('POST', '/autoresearch/lab/batches', async (req, res, p) => {
    const a = auth(req, p);
    if (a.denied) return a.denied;
    if (a.user == null) return fail('401', 'authentication required');
    try {
      const input = Object.assign({}, p, { ownerId: a.user.id, workspace: { mode: 'empty' } });
      return ok(lab.createBatch(input));
    } catch (err) { return errorResult(err); }
  });

  route('GET', '/autoresearch/lab/runs', async (req, res, p) => {
    const a = auth(req, p);
    if (a.denied) return a.denied;
    if (a.user == null) return fail('401', 'authentication required');
    try { return ok({ items: lab.list(a.user.id) }); } catch (err) { return errorResult(err); }
  });

  route('GET', '/autoresearch/lab/runs/:id', async (req, res, p) => {
    const o = owned(req, p);
    if (o.denied) return o.denied;
    return ok(o.run);
  });

  route('POST', '/autoresearch/lab/runs/:id/start', async (req, res, p) => {
    const o = owned(req, p);
    if (o.denied) return o.denied;
    if (o.run.status !== 'queued') return fail('4091', 'duplicate start rejected: run already started or settled');
    lab.start(o.run.id, o.user.id).catch(() => {});
    return ok(lab.load(o.run.id));
  });

  route('POST', '/autoresearch/lab/runs/:id/cancel', async (req, res, p) => {
    const o = owned(req, p);
    if (o.denied) return o.denied;
    try { return ok(lab.cancel(o.run.id, o.user.id)); } catch (err) { return errorResult(err); }
  });

  route('GET', '/autoresearch/lab/runs/:id/verify', async (req, res, p) => {
    const o = owned(req, p);
    if (o.denied) return o.denied;
    try { return ok(lab.verify(o.run.id)); } catch (err) { return errorResult(err); }
  });

  route('GET', '/autoresearch/lab/runs/:id/results.tsv', async (req, res, p) => {
    const o = owned(req, p);
    if (o.denied) return o.denied;
    try {
      const abs = lab.tsvPath(o.run.id);
      if (fs.existsSync(abs) === false) return fail('5001', 'results.tsv missing');
      if (p.download === '1' || p.download === 'true' || p.format === 'download') {
        return { __streamFile: abs, name: o.run.id + '.results.tsv', contentType: 'text/tab-separated-values; charset=utf-8' };
      }
      return ok({ filename: o.run.id + '.results.tsv', tsv: fs.readFileSync(abs, 'utf8'), verify: lab.verify(o.run.id) });
    } catch (err) { return errorResult(err); }
  });
}

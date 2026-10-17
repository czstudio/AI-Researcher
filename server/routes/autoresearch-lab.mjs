// HTTP surface for the absorbed AutoResearch lab.
import path from 'node:path';
import { AutoResearchLab, LabValidationError, VECTORIZED_ENV_CONTRACT } from '../lib/autoresearch-lab.mjs';
import { ok, fail } from '../lib/util.mjs';

const rootDir = path.join(process.env.NOVIX_DATA_DIR || path.resolve(process.cwd(), 'data'), 'autoresearch');
const lab = new AutoResearchLab({ rootDir });

function resultOrError(fn) {
  try { return fn(); } catch (err) {
    const code = err instanceof LabValidationError ? err.code : '5000';
    return fail(code, err.message || String(err));
  }
}
export function registerAutoresearchRoutes(route, helpers = {}) {
  const auth = (req, p) => helpers.requireUser ? helpers.requireUser(req, p) : { user: { id: 'local' }, anon: false };
  route('GET', '/autoresearch/lab/contract', async () => ok({
    resultsColumns: ['commit', 'val_bpb', 'memory_gb', 'status', 'description'],
    statuses: ['keep', 'discard', 'crash'],
    vectorized: VECTORIZED_ENV_CONTRACT,
    evaluator: 'deterministic offline simulator by default; injectable production evaluator',
  }));
  route('POST', '/autoresearch/lab/runs', async (req, res, p, body) => {
    const a = auth(req, p); if (a.denied) return a.denied;
    return resultOrError(() => ok(lab.create({ ...body, ...p, ownerId: a.user.id })));
  });
  route('GET', '/autoresearch/lab/runs', async (req, res, p) => {
    const a = auth(req, p); if (a.denied) return a.denied;
    return resultOrError(() => ok({ items: lab.list(a.user.id) }));
  });
  route('GET', '/autoresearch/lab/runs/:id', async (req, res, p) => {
    const a = auth(req, p); if (a.denied) return a.denied;
    const run = lab.load(p.id);
    if (run == null) return fail('5001', 'run not found');
    if (run.ownerId !== String(a.user.id)) return fail('5200', 'run not owned by caller');
    return ok(run);
  });
  route('POST', '/autoresearch/lab/runs/:id/start', async (req, res, p) => {
    const a = auth(req, p); if (a.denied) return a.denied;
    try {
      const run = lab.load(p.id);
      if (run == null) return fail('5001', 'run not found');
      if (run.ownerId !== String(a.user.id)) return fail('5200', 'run not owned by caller');
      lab.start(p.id, a.user.id).catch(() => {});
      return ok(lab.load(p.id));
    } catch (err) { return fail('5000', err.message || String(err)); }
  });
  route('POST', '/autoresearch/lab/runs/:id/cancel', async (req, res, p) => {
    const a = auth(req, p); if (a.denied) return a.denied;
    return resultOrError(() => ok(lab.cancel(p.id, a.user.id)));
  });
  route('GET', '/autoresearch/lab/runs/:id/results.tsv', async (req, res, p) => {
    const a = auth(req, p); if (a.denied) return a.denied;
    const run = lab.load(p.id);
    if (run == null) return fail('5001', 'run not found');
    if (run.ownerId !== String(a.user.id)) return fail('5200', 'run not owned by caller');
    return ok({ filename: 'results.tsv', tsv: lab.tsv(run) });
  });
}

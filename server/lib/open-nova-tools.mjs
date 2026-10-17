// OpenNova/OpenManus tool semantics adapted to novix-open.
// Source: novix-science/OpenNova @ c7a3f46 (MIT, (c) 2025 manna_and_poem).
// Independent Node implementation; no Python framework or tool source is copied.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
export class ToolError extends Error {
  constructor(code, message) { super(message); this.name = 'ToolError'; this.code = String(code); }
}
function safeJoin(root, rel) {
  const base = path.resolve(root || '.');
  const abs = path.resolve(base, String(rel || '.').replace(/^[/\\]+/, ''));
  if (abs !== base && abs.startsWith(base + path.sep) === false) throw new ToolError('TOOL_PATH_TRAVERSAL', 'path escapes workspace');
  return abs;
}
function capped(value, n = 8000) { return String(value == null ? '' : value).slice(0, n); }
export const OPEN_NOVA_TOOL_DESCRIPTORS = Object.freeze([
  { type: 'function', function: { name: 'PythonExecute', description: 'Execute Python in the session sandbox and return stdout/stderr.', parameters: { type: 'object', properties: { code: { type: 'string' }, timeout_ms: { type: 'integer' } }, required: ['code'] } } },
  { type: 'function', function: { name: 'BrowserUse', description: 'Drive an optional browser automation backend; honest not-configured state when unavailable.', parameters: { type: 'object', properties: { action: { type: 'string' }, url: { type: 'string' }, selector: { type: 'string' }, text: { type: 'string' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'StrReplaceEditor', description: 'Replace exactly one occurrence of old_string in a workspace file.', parameters: { type: 'object', properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['path', 'old_string', 'new_string'] } } },
  { type: 'function', function: { name: 'FileSaver', description: 'Write a workspace file with explicit path and content.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'Terminate', description: 'Signal that the current agent run is complete.', parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: [] } } },
]);
function runPython(code, ctx = {}) {
  const cwd = path.resolve(ctx.workspaceDir || process.cwd());
  const timeoutMs = Math.min(Math.max(Number(ctx.timeoutMs) || 30000, 100), 120000);
  return new Promise((resolve) => {
    const child = spawn('python3', ['-I', '-c', String(code || '')], { cwd, detached: true, env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: cwd, PYTHONIOENCODING: 'utf-8' } });
    let output = '';
    let killed = false;
    const stop = () => { if (killed) return; killed = true; try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { } } };
    const timer = setTimeout(stop, timeoutMs);
    child.stdout.on('data', (d) => { if (output.length < 8000) output += String(d); });
    child.stderr.on('data', (d) => { if (output.length < 8000) output += String(d); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ exitCode: code, signal: signal || null, output: capped(output), timedOut: killed && signal === 'SIGKILL' }); });
  });
}
export async function executeOpenNovaTool(name, args = {}, ctx = {}) {
  const tool = String(name || '');
  const root = path.resolve(ctx.workspaceDir || process.cwd());
  if (tool === 'PythonExecute') return runPython(args.code, { ...ctx, timeoutMs: args.timeout_ms });
  if (tool === 'Terminate') return { terminated: true, reason: capped(args.reason, 500) };
  if (tool === 'BrowserUse') {
    const command = process.env.BROWSER_AUTOMATION_CMD || '';
    if (command === '') return { ok: false, status: 'not_configured', error: 'Set BROWSER_AUTOMATION_CMD to an agent-browser/Playwright CLI to enable browser control.' };
    return { ok: false, status: 'configured_but_not_invoked', note: 'BrowserUse is an optional external adapter; run it through the configured CLI in a production deployment.' };
  }
  if (tool === 'StrReplaceEditor') {
    const abs = safeJoin(root, args.path);
    const oldText = String(args.old_string == null ? '' : args.old_string);
    const newText = String(args.new_string == null ? '' : args.new_string);
    if (oldText === '') throw new ToolError('TOOL_INVALID', 'old_string required');
    const before = fs.readFileSync(abs, 'utf8');
    const first = before.indexOf(oldText);
    if (first < 0) throw new ToolError('TOOL_REPLACE_NOT_FOUND', 'old_string not found');
    if (before.indexOf(oldText, first + oldText.length) >= 0) throw new ToolError('TOOL_REPLACE_AMBIGUOUS', 'old_string occurs more than once');
    fs.writeFileSync(abs, before.slice(0, first) + newText + before.slice(first + oldText.length));
    return { path: args.path, replaced: true };
  }
  if (tool === 'FileSaver') {
    const abs = safeJoin(root, args.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, String(args.content == null ? '' : args.content));
    return { path: args.path, bytes: Buffer.byteLength(String(args.content || '')) };
  }
  throw new ToolError('TOOL_UNKNOWN', 'unknown tool: ' + tool);
}
export function mergeOpenNovaTools(existing = []) {
  const names = new Set(existing.map((t) => t && t.function && t.function.name));
  return existing.concat(OPEN_NOVA_TOOL_DESCRIPTORS.filter((t) => names.has(t.function.name) === false));
}

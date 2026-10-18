// OpenNova/OpenManus tool semantics adapted to novix-open.
// Source: novix-science/OpenNova @ c7a3f46 (MIT, (c) 2025 manna_and_poem).
// Independent Node implementation; no Python framework or tool source is copied.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export class ToolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ToolError';
    this.code = String(code);
  }
}

export const MAX_RESPONSE_LEN = 16000;
export const SNIPPET_LINES = 4;
export const TRUNCATED_MESSAGE = '<response clipped><NOTE>To save on context only part of this file has been shown to you. ' +
  'You should retry this tool after you have used StrReplaceEditor view with a view_range to inspect specific line ranges.</NOTE>';

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const MAX_PROCESS_OUTPUT = 64000;

function safeJoin(root, rel) {
  const base = path.resolve(root || '.');
  const raw = String(rel == null ? '' : rel);
  if (raw === '' || CONTROL_CHARS.test(raw)) throw new ToolError('TOOL_PATH_INVALID', 'path required and must not contain control characters');
  const abs = path.resolve(base, raw.replace(/^[/\\]+/, ''));
  if (abs !== base && abs.startsWith(base + path.sep) === false) {
    throw new ToolError('TOOL_PATH_TRAVERSAL', 'path escapes workspace');
  }
  return abs;
}

function capped(value, n = 8000) {
  return String(value == null ? '' : value).slice(0, n);
}

export function maybeTruncate(content, truncateAfter = MAX_RESPONSE_LEN) {
  const text = String(content == null ? '' : content);
  if (truncateAfter === null || truncateAfter === undefined || truncateAfter === 0 || text.length <= truncateAfter) return text;
  return text.slice(0, truncateAfter) + TRUNCATED_MESSAGE;
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new ToolError('TOOL_INVALID', label + ' required');
  return value;
}

export function splitCommandLine(input) {
  const text = String(input == null ? '' : input);
  const out = [];
  let current = '';
  let quote = null;
  let escaped = false;
  let tokenStarted = false;
  for (const ch of text) {
    if (escaped) {
      current += ch;
      escaped = false;
      tokenStarted = true;
      continue;
    }
    if (ch === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
      tokenStarted = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (tokenStarted) {
        out.push(current);
        current = '';
        tokenStarted = false;
      }
      continue;
    }
    current += ch;
    tokenStarted = true;
  }
  if (escaped) current += '\\';
  if (quote !== null) throw new ToolError('TOOL_COMMAND_INVALID', 'unterminated quote in command');
  if (tokenStarted) out.push(current);
  if (out.length === 0 || out[0] === '') throw new ToolError('TOOL_COMMAND_INVALID', 'command is empty');
  return out;
}

function runProcess(command, args, options = {}) {
  const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || 30000, 100), 120000);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: options.env || process.env,
      });
    } catch (error) {
      resolve({ exitCode: null, signal: null, output: '', error: error.message, timedOut: false, unavailable: true });
      return;
    }
    let output = '';
    let killed = false;
    let settled = false;
    const collect = (chunk) => {
      if (output.length < MAX_PROCESS_OUTPUT) output += String(chunk);
    };
    const stop = () => {
      if (killed) return;
      killed = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { } }
    };
    const timer = setTimeout(stop, timeoutMs);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, output: capped(output, MAX_PROCESS_OUTPUT) });
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('error', (error) => finish({ exitCode: null, signal: null, error: error.message, timedOut: false, unavailable: true }));
    child.on('close', (code, signal) => finish({ exitCode: code, signal: signal || null, timedOut: killed && signal === 'SIGKILL' }));
  });
}

function processWorkspace(workspaceDir) {
  return path.resolve(workspaceDir || process.cwd());
}

function pythonDockerConfig(ctx) {
  const image = ctx.dockerImage || process.env.NOVIX_PYTHON_DOCKER_IMAGE || process.env.PYTHON_EXECUTE_DOCKER_IMAGE || '';
  const flag = String(ctx.docker || process.env.NOVIX_PYTHON_DOCKER || process.env.PYTHON_EXECUTE_DOCKER || '').toLowerCase();
  const enabled = image !== '' || ['1', 'true', 'yes', 'on'].includes(flag);
  return { enabled, image: image || 'python:3.12-alpine', dockerCmd: ctx.dockerCmd || process.env.DOCKER_CMD || 'docker' };
}

export async function runPython(code, ctx = {}) {
  const source = requireString(code, 'code');
  const cwd = processWorkspace(ctx.workspaceDir);
  const timeoutValue = ctx.timeoutMs ?? ctx.timeout_ms ?? 30000;
  const timeoutMs = Math.min(Math.max(Number(timeoutValue) || 30000, 100), 120000);
  const docker = pythonDockerConfig(ctx);
  let result;
  if (docker.enabled) {
    result = await runProcess(docker.dockerCmd, [
      'run', '--rm', '--network', 'none', '-v', cwd + ':/workspace:rw', '-w', '/workspace',
      '--', docker.image, 'python3', '-I', '-c', source,
    ], {
      cwd,
      timeoutMs,
      env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: cwd, PYTHONIOENCODING: 'utf-8' },
    });
    if (result.unavailable === true) {
      return {
        exitCode: null,
        signal: null,
        output: 'PythonExecute docker isolation unavailable: ' + (result.error || docker.dockerCmd),
        timedOut: false,
        isolated: true,
        unavailable: true,
        success: false,
      };
    }
  } else {
    result = await runProcess(ctx.pythonCommand || process.env.PYTHON_CMD || 'python3', ['-I', '-c', source], {
      cwd,
      timeoutMs,
      env: { ...process.env, HOME: cwd, PYTHONIOENCODING: 'utf-8' },
    });
  }
  return {
    ...result,
    success: result.exitCode === 0 && result.timedOut !== true,
    isolated: docker.enabled,
    timeoutMs,
  };
}

const BROWSER_ACTIONS = new Set([
  'go_to_url', 'click_element', 'input_text', 'scroll_down', 'scroll_up',
  'scroll_to_text', 'send_keys', 'get_dropdown_options', 'select_dropdown_option',
  'go_back', 'web_search', 'wait', 'extract_content', 'switch_tab', 'open_tab',
  'close_tab', 'refresh', 'open', 'navigate',
]);

function validateBrowserAction(args) {
  const action = requireString(args.action, 'action');
  if (BROWSER_ACTIONS.has(action) === false) throw new ToolError('TOOL_BROWSER_ACTION_INVALID', 'unsupported browser action: ' + action);
  const url = args.url;
  if (url !== undefined && url !== null && String(url) !== '') {
    let parsed;
    try { parsed = new URL(String(url)); } catch { throw new ToolError('TOOL_BROWSER_URL_INVALID', 'invalid browser URL'); }
    if (['http:', 'https:'].includes(parsed.protocol) === false) {
      throw new ToolError('TOOL_BROWSER_URL_INVALID', 'browser URL must use http or https');
    }
  }
  return action;
}

export async function runBrowserUse(args = {}, ctx = {}) {
  const commandText = ctx.command || process.env.BROWSER_AUTOMATION_CMD || '';
  if (String(commandText).trim() === '') {
    return {
      ok: false,
      status: 'not_configured',
      error: 'Set BROWSER_AUTOMATION_CMD to a browser automation CLI to enable browser control.',
    };
  }
  const action = validateBrowserAction(args);
  const argv = splitCommandLine(commandText);
  const cwd = processWorkspace(ctx.workspaceDir);
  const timeoutValue = args.timeout_ms ?? ctx.timeoutMs ?? 30000;
  const timeoutMs = Math.min(Math.max(Number(timeoutValue) || 30000, 100), 120000);
  const payload = { ...args };
  const result = await runProcess(argv[0], argv.slice(1).concat([
    '--tool', 'BrowserUse', '--action', action, '--payload', JSON.stringify(payload),
  ]), {
    cwd,
    timeoutMs,
    env: { ...process.env, HOME: cwd, BROWSER_AUTOMATION_WORKSPACE: cwd },
  });
  if (result.unavailable === true) {
    return { ok: false, status: 'unavailable', error: result.error || 'browser automation command unavailable', exitCode: null, output: '' };
  }
  if (result.timedOut === true) {
    return { ok: false, status: 'timeout', error: 'browser automation command timed out', exitCode: result.exitCode, signal: result.signal, output: result.output, timeoutMs };
  }
  let parsed = null;
  const trimmed = String(result.output || '').trim();
  if (trimmed !== '') {
    try { parsed = JSON.parse(trimmed); } catch { parsed = null; }
  }
  return {
    ok: result.exitCode === 0,
    status: result.exitCode === 0 ? 'ok' : 'failed',
    action,
    exitCode: result.exitCode,
    signal: result.signal,
    output: result.output,
    result: parsed,
    argv: argv.slice(1).concat(['--tool', 'BrowserUse', '--action', action, '--payload', JSON.stringify(payload)]),
  };
}

function numberedOutput(content, descriptor, initLine = 1) {
  const text = String(content == null ? '' : content);
  const body = text.split('\n').map((line, index) => String(index + initLine).padStart(6, ' ') + '\t' + line).join('\n');
  return "Here's the result of running `cat -n` on " + descriptor + ':\n' + body;
}

function listDirectory(rootAbs, displayRoot = '.') {
  const found = [];
  const walk = (dir, depth) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(rootAbs, abs).split(path.sep).join('/');
      found.push(rel + (entry.isDirectory() ? '/' : ''));
      if (entry.isDirectory() && depth < 2) walk(abs, depth + 1);
    }
  };
  walk(rootAbs, 1);
  return found;
}

export function runStrReplaceEditor(args = {}, ctx = {}) {
  const root = processWorkspace(ctx.workspaceDir);
  const command = String(args.command || (args.old_str !== undefined || args.old_string !== undefined ? 'str_replace' : 'view'));
  const abs = safeJoin(root, args.path);
  const displayPath = String(args.path || '');
  if (command === 'view') {
    if (fs.existsSync(abs) === false) throw new ToolError('TOOL_FILE_NOT_FOUND', 'path does not exist: ' + displayPath);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      if (args.view_range !== undefined) throw new ToolError('TOOL_INVALID', 'view_range is not allowed for directories');
      const entries = listDirectory(abs, displayPath);
      const text = "Here's the files and directories up to 2 levels deep in " + displayPath + ', excluding hidden items:\n' + entries.join('\n') + '\n';
      const output = maybeTruncate(text);
      return { command, path: displayPath, isDirectory: true, entries, output, truncated: output.length < text.length };
    }
    const content = fs.readFileSync(abs, 'utf8');
    const fileLines = content.split('\n');
    let selected = content;
    let initLine = 1;
    if (args.view_range !== undefined) {
      const range = args.view_range;
      if (Array.isArray(range) === false || range.length !== 2 || range.some((item) => Number.isInteger(item) === false)) {
        throw new ToolError('TOOL_VIEW_RANGE_INVALID', 'view_range must be an array of two integers');
      }
      const [first, last] = range;
      if (first < 1 || first > fileLines.length) {
        throw new ToolError('TOOL_VIEW_RANGE_INVALID', 'view_range first line is outside file: ' + JSON.stringify([1, fileLines.length]));
      }
      if (last !== -1 && last > fileLines.length) {
        throw new ToolError('TOOL_VIEW_RANGE_INVALID', 'view_range last line is outside file: ' + JSON.stringify([1, fileLines.length]));
      }
      if (last !== -1 && last < first) throw new ToolError('TOOL_VIEW_RANGE_INVALID', 'view_range second line precedes first line');
      selected = fileLines.slice(first - 1, last === -1 ? undefined : last).join('\n');
      initLine = first;
    }
    const limited = maybeTruncate(selected);
    const output = numberedOutput(limited, displayPath, initLine);
    return { command, path: displayPath, isDirectory: false, initLine, output, truncated: limited.length < selected.length };
  }
  if (command === 'create') {
    if (typeof args.file_text !== 'string') throw new ToolError('TOOL_INVALID', 'file_text is required for create');
    if (fs.existsSync(abs)) throw new ToolError('TOOL_FILE_EXISTS', 'file already exists: ' + displayPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, args.file_text);
    return { command, path: displayPath, created: true, bytes: Buffer.byteLength(args.file_text), output: 'File created successfully at: ' + displayPath };
  }
  if (command === 'str_replace') {
    const oldStr = args.old_str ?? args.old_string;
    const newStr = args.new_str ?? args.new_string ?? '';
    if (typeof oldStr !== 'string' || oldStr.length === 0) throw new ToolError('TOOL_INVALID', 'old_str required');
    if (typeof newStr !== 'string') throw new ToolError('TOOL_INVALID', 'new_str must be a string');
    const before = fs.readFileSync(abs, 'utf8');
    const first = before.indexOf(oldStr);
    if (first < 0) throw new ToolError('TOOL_REPLACE_NOT_FOUND', 'old_str not found: ' + displayPath);
    if (before.indexOf(oldStr, first + oldStr.length) >= 0) {
      throw new ToolError('TOOL_REPLACE_AMBIGUOUS', 'old_str occurs more than once in ' + displayPath);
    }
    const after = before.slice(0, first) + newStr + before.slice(first + oldStr.length);
    fs.writeFileSync(abs, after);
    const startLine = before.slice(0, first).split('\n').length;
    const snippetLines = after.split('\n').slice(Math.max(0, startLine - SNIPPET_LINES - 1), startLine + SNIPPET_LINES + newStr.split('\n').length);
    const snippet = numberedOutput(snippetLines.join('\n'), 'a snippet of ' + displayPath, Math.max(1, startLine - SNIPPET_LINES));
    return { command, path: displayPath, replaced: true, output: 'The file ' + displayPath + ' has been edited. ' + snippet };
  }
  if (command === 'insert') {
    if (Number.isInteger(args.insert_line) === false) throw new ToolError('TOOL_INVALID', 'insert_line is required for insert');
    if (typeof args.new_str !== 'string') throw new ToolError('TOOL_INVALID', 'new_str is required for insert');
    const before = fs.readFileSync(abs, 'utf8');
    const lines = before.split('\n');
    const insertLine = args.insert_line;
    if (insertLine < 0 || insertLine > lines.length) {
      throw new ToolError('TOOL_INSERT_LINE_INVALID', 'insert_line must be within [0, ' + lines.length + ']');
    }
    const inserted = args.new_str.split('\n');
    const merged = lines.slice(0, insertLine).concat(inserted, lines.slice(insertLine)).join('\n');
    fs.writeFileSync(abs, merged);
    const snippetLines = lines.slice(Math.max(0, insertLine - SNIPPET_LINES), insertLine)
      .concat(inserted, lines.slice(insertLine, insertLine + SNIPPET_LINES));
    const snippet = numberedOutput(snippetLines.join('\n'), 'a snippet of the edited file', Math.max(1, insertLine - SNIPPET_LINES + 1));
    return { command, path: displayPath, inserted: true, insertLine, output: 'The file ' + displayPath + ' has been edited. ' + snippet };
  }
  if (command === 'undo_edit') {
    throw new ToolError('TOOL_UNDO_UNSUPPORTED', 'undo_edit is intentionally unsupported: StrReplaceEditor does not retain in-process file history');
  }
  throw new ToolError('TOOL_EDITOR_COMMAND_INVALID', 'unknown StrReplaceEditor command: ' + command);
}

export function runFileSaver(args = {}, ctx = {}) {
  const root = processWorkspace(ctx.workspaceDir);
  const target = args.path ?? args.file_path;
  if (typeof target !== 'string' || target.trim() === '') throw new ToolError('TOOL_INVALID', 'path or file_path required');
  if (typeof args.content !== 'string') throw new ToolError('TOOL_INVALID', 'content required');
  const mode = args.mode === undefined ? 'w' : String(args.mode);
  if (mode !== 'w' && mode !== 'a') throw new ToolError('TOOL_FILE_MODE_INVALID', 'mode must be w or a');
  const abs = safeJoin(root, target);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, args.content, { flag: mode });
  return { path: target, bytes: Buffer.byteLength(args.content), mode, output: 'Content successfully saved to ' + target };
}

export const OPEN_NOVA_TOOL_DESCRIPTORS = Object.freeze([
  {
    type: 'function',
    function: {
      name: 'PythonExecute',
      description: 'Execute Python in the session sandbox and return stdout/stderr. Optional Docker isolation is enabled with NOVIX_PYTHON_DOCKER_IMAGE (or PYTHON_EXECUTE_DOCKER_IMAGE).',
      parameters: { type: 'object', properties: { code: { type: 'string' }, timeout_ms: { type: 'integer' } }, required: ['code'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'BrowserUse',
      description: 'Drive a configured external browser automation CLI (BROWSER_AUTOMATION_CMD) using argv-safe execution.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['go_to_url', 'click_element', 'input_text', 'scroll_down', 'scroll_up', 'scroll_to_text', 'send_keys', 'get_dropdown_options', 'select_dropdown_option', 'go_back', 'web_search', 'wait', 'extract_content', 'switch_tab', 'open_tab', 'close_tab', 'refresh'],
          },
          url: { type: 'string' },
          index: { type: 'integer' },
          text: { type: 'string' },
          scroll_amount: { type: 'integer' },
          tab_id: { type: 'integer' },
          query: { type: 'string' },
          goal: { type: 'string' },
          keys: { type: 'string' },
          seconds: { type: 'integer' },
          timeout_ms: { type: 'integer' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'StrReplaceEditor',
      description: 'View, create, insert into, or replace exactly one occurrence in a workspace file. undo_edit is intentionally unsupported.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', enum: ['view', 'create', 'insert', 'str_replace', 'undo_edit'] },
          path: { type: 'string' },
          file_text: { type: 'string' },
          old_str: { type: 'string' },
          new_str: { type: 'string' },
          insert_line: { type: 'integer' },
          view_range: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 },
        },
        required: ['command', 'path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'FileSaver',
      description: 'Write or append a workspace file with explicit path and content.',
      parameters: { type: 'object', properties: { path: { type: 'string' }, file_path: { type: 'string' }, content: { type: 'string' }, mode: { type: 'string', enum: ['w', 'a'] } }, required: ['content'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Terminate',
      description: 'Signal that the current agent run is complete.',
      parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: [] },
    },
  },
]);

export async function executeOpenNovaTool(name, args = {}, ctx = {}) {
  const tool = String(name || '');
  if (tool === 'PythonExecute') {
    let timeoutMs = args.timeout_ms;
    if (timeoutMs === undefined && Number.isFinite(Number(args.timeout))) timeoutMs = Number(args.timeout) * 1000;
    return runPython(args.code, { ...ctx, timeoutMs });
  }
  if (tool === 'Terminate') return { terminated: true, reason: capped(args.reason, 500) };
  if (tool === 'BrowserUse') return runBrowserUse(args, ctx);
  if (tool === 'StrReplaceEditor') return runStrReplaceEditor(args, ctx);
  if (tool === 'FileSaver') return runFileSaver(args, ctx);
  throw new ToolError('TOOL_UNKNOWN', 'unknown tool: ' + tool);
}

export function mergeOpenNovaTools(existing = []) {
  const names = new Set(existing.map((t) => t && t.function && t.function.name));
  return existing.concat(OPEN_NOVA_TOOL_DESCRIPTORS.filter((t) => names.has(t.function.name) === false));
}

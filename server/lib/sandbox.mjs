// Code execution sandbox.
// Priority: docker (isolated) -> local subprocess with a hard timeout.
// Set SANDBACK=docker|local to force one. Never set SANDBOX=host-unsafe in public deploys.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const MODE = process.env.SANDBOX || 'auto';
const IMAGE = process.env.SANDBOX_IMAGE || 'python:3.11-slim';
const TIMEOUT_MS = Number(process.env.SANDBOX_TIMEOUT_MS || 120000);

function hasDocker() {
  if (MODE === 'local') return false;
  try {
    const r = require('node:child_process').spawnSync('docker', ['version'], { stdio: 'ignore' });
    return r.status === 0;
  } catch {
    return false;
  }
}

let dockerAvailable = null;

/**
 * Run python source inside `cwd`. Returns { exitCode, stdout, stderr, durationMs }.
 */
export function runPython({ cwd, code, args = [], env = {}, timeoutMs = TIMEOUT_MS }) {
  if (dockerAvailable === null) dockerAvailable = hasDocker();
  const file = path.join(cwd, 'sandbox_run.py');
  fs.writeFileSync(file, code);
  if (dockerAvailable) {
    return runInDocker({ cwd, args: ['sandbox_run.py', ...args], env, timeoutMs });
  }
  return runLocal({ cwd, args: ['sandbox_run.py', ...args], env, timeoutMs });
}

export function runCommand({ cwd, cmd, args = [], env = {}, timeoutMs = TIMEOUT_MS }) {
  if (dockerAvailable === null) dockerAvailable = hasDocker();
  if (dockerAvailable) return runInDocker({ cwd, args: [cmd, ...args], env, timeoutMs });
  return runLocal({ cwd, args: [cmd, ...args], env, timeoutMs });
}

function runLocal({ cwd, args, env, timeoutMs }) {
  const started = Date.now();
  return new Promise((resolve) => {
    const py = process.env.PYTHON_BIN || 'python3';
    const child = spawn(py, args, {
      cwd,
      env: { ...process.env, ...env, PYTHONIOENCODING: 'utf-8', PYTHONHASHSEED: '7' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ exitCode: 127, stdout, stderr: String(e.message), durationMs: Date.now() - started, backend: 'local' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout, stderr, durationMs: Date.now() - started, backend: 'local' });
    });
  });
}

function runInDocker({ cwd, args, env, timeoutMs }) {
  const started = Date.now();
  const dockerArgs = [
    'run',
    '--rm',
    '--network=none',
    '--memory=1g',
    '--cpus=1',
    '-v',
    `${os.tmpdir()}:/tmp:ro`,
    '-v',
    `${cwd}:/workspace`,
    '-w',
    '/workspace',
  ];
  for (const [k, v] of Object.entries(env)) dockerArgs.push('-e', `${k}=${v}`);
  dockerArgs.push(IMAGE, ...args);
  return new Promise((resolve) => {
    const child = spawn('docker', dockerArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', () => {
      clearTimeout(timer);
      dockerAvailable = false;
      resolve({ exitCode: 127, stdout, stderr: 'docker unavailable', durationMs: Date.now() - started, backend: 'docker' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout, stderr, durationMs: Date.now() - started, backend: 'docker' });
    });
  });
}

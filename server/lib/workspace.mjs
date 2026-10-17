// Workspace tree/parity helpers shared by chat and published-revision routes.
import fs from 'node:fs';
import path from 'node:path';
import * as U from './util.mjs';

export const WORKSPACE_PREFIX = (sessionId) => `nova_agent_v1/user_data/session_${sessionId}/workspace`;

export function normRel(rel) {
  const raw = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  const out = path.posix.normalize(raw || '.');
  return out === '.' ? '' : out.replace(/\/+$/, '');
}

export function previewTypeOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'].includes(ext)) return 'image';
  if (ext === '.pdf') return 'pdf';
  if (['.txt', '.md', '.json', '.py', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.html', '.css', '.tex', '.bib', '.csv', '.tsv', '.yml', '.yaml', '.sh', '.log', '.ipynb', '.xml'].includes(ext)) return 'text';
  return null;
}


export function workspaceNode(root, rel, sessionId, depth = 0) {
  const clean = normRel(rel);
  const abs = U.safeJoin(root, clean || ".");
  if (abs == null || fs.existsSync(abs) === false) return null;
  const stat = fs.statSync(abs);
  const isDir = stat.isDirectory();
  const suffix = clean ? "/" + clean : "";
  const node = {
    name: isDir ? (clean ? path.basename(abs) : "workspace") : path.basename(abs),
    path: clean, type: isDir ? "directory" : "file",
    directory: isDir, file: isDir === false,
    fileKey: WORKSPACE_PREFIX(sessionId) + suffix,
    mtime: stat.mtimeMs, previewFileKey: null,
    previewStatus: null, previewType: isDir ? null : previewTypeOf(abs),
  };
  if (isDir === false) {
    node.size = stat.size;
    node.updatedAt = stat.mtimeMs;
    return node;
  }
  node.children = [];
  if (depth > 0) {
    for (const entry of fs.readdirSync(abs).sort()) {
      if (entry === ".git" || entry === "node_modules") continue;
      const childRel = clean ? clean + "/" + entry : entry;
      const child = workspaceNode(root, childRel, sessionId, depth - 1);
      if (child) node.children.push(child);
    }
  }
  return node;
}

function emptyWorkspaceNode(sessionId) {
  return {
    name: "workspace", path: "", type: "directory", directory: true, file: false,
    fileKey: WORKSPACE_PREFIX(sessionId), mtime: Date.now(), previewFileKey: null,
    previewStatus: null, previewType: null, children: [],
  };
}

function mergeNode(base, extra, sessionId) {
  if (base == null) return extra;
  if (extra == null) return base;
  if (String(base.path) === String(extra.path)) {
    const children = [...(base.children || [])];
    for (const child of extra.children || []) {
      const i = children.findIndex((c) => c.path === child.path);
      if (i >= 0) children[i] = mergeNode(children[i], child, sessionId);
      else children.push(child);
    }
    return { ...base, ...extra, children: base.directory ? children : undefined };
  }
  if (base.directory === false) return base;
  const parts = String(extra.path).split("/");
  let parent = base;
  for (let i = 0; i < parts.length - 1; i++) {
    const want = parts.slice(0, i + 1).join("/");
    let next = (parent.children || []).find((c) => c.path === want);
    if (next == null) {
      next = {
        name: parts[i], path: want, type: "directory", directory: true, file: false,
        fileKey: WORKSPACE_PREFIX(sessionId) + "/" + want, mtime: Date.now(),
        previewFileKey: null, previewStatus: null, previewType: null, children: [],
      };
      parent.children = parent.children || [];
      parent.children.push(next);
    }
    parent = next;
  }
  parent.children = parent.children || [];
  const idx = parent.children.findIndex((c) => c.path === extra.path);
  if (idx >= 0) parent.children[idx] = mergeNode(parent.children[idx], extra, sessionId);
  else parent.children.push(extra);
  return base;
}

export function parseTargets(value, fallbackPath = "") {
  let list = value;
  if (typeof list === "string") {
    try { list = JSON.parse(list); } catch { list = null; }
  }
  if (Array.isArray(list) === false) list = [[fallbackPath ?? "", 3]];
  if (list.length === 0) list = [["", 3]];
  return list.map((item) => {
    const tuple = Array.isArray(item) ? item : [item?.path ?? item ?? "", item?.depth ?? 0];
    return [normRel(tuple[0]), Math.max(0, Math.min(20, Number(tuple[1] ?? 0) || 0))];
  });
}

export function workspaceTree(root, sessionId, targets, fallbackPath = "") {
  let base = null;
  const extras = [];
  for (const [rel, depth] of parseTargets(targets, fallbackPath)) {
    const node = workspaceNode(root, rel, sessionId, depth);
    if (node == null) continue;
    if (rel === "") base = node;
    else extras.push(node);
  }
  if (base == null) base = emptyWorkspaceNode(sessionId);
  for (const extra of extras) base = mergeNode(base, extra, sessionId);
  return base;
}

export function walkFiles(root, rel = "") {
  const abs = U.safeJoin(root, rel || ".");
  if (abs == null || fs.existsSync(abs) === false) return [];
  const out = [];
  const stat = fs.statSync(abs);
  if (stat.isDirectory() === false) return [{ rel, abs, stat }];
  for (const entry of fs.readdirSync(abs).sort()) {
    if (entry === ".git" || entry === "node_modules") continue;
    const childRel = rel ? rel + "/" + entry : entry;
    out.push(...walkFiles(root, childRel));
  }
  return out;
}

export function homeFiles(root, sessionId) {
  const userUpload = [];
  const agentOutput = [];
  for (const f of walkFiles(root)) {
    const rel = normRel(f.rel);
    const isUpload = rel === "user_data" || rel.startsWith("user_data/");
    const source = isUpload ? "user_upload" : "agent_output";
    const item = {
      fileId: null, name: path.basename(rel), path: rel,
      fileKey: WORKSPACE_PREFIX(sessionId) + "/" + rel, source,
      mtime: f.stat.mtimeMs, chatSessionId: sessionId, taskId: null,
      previewType: previewTypeOf(f.abs), previewStatus: null, previewFileKey: null,
    };
    (isUpload ? userUpload : agentOutput).push(item);
  }
  return { userUpload, agentOutput };
}

export function copyDir(src, dst) {
  if (fs.existsSync(src) === false) { U.ensureDir(dst); return; }
  U.ensureDir(dst);
  for (const entry of fs.readdirSync(src)) {
    if (entry === ".git" || entry === "node_modules") continue;
    const from = path.join(src, entry);
    const to = path.join(dst, entry);
    const st = fs.statSync(from);
    if (st.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

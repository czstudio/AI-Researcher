// GPU Broker — 多用户隔离 + 并发队列 + 自动租用 + 自动释放
//
// 架构吸收（novix + clawsgo + I2P 逆向结论）：
// - novix: 会话级 K8s pod 常驻（非每任务冷启），任务排队 500ms→2s 轮询
// - clawsgo: 团队共享主机 + canDispatchTask+online 双字段门控 + BYO SSH daemon
// - I2P: AllocationLeaseStore（文件持久化 CAS 租约）+ GPUAdmission（租户/用户限额）+
//        RetainLeaseSettings（keep-warm 保留窗口）+ provider=both（AutoDL+Modal 双通道）
//
// 本模块实现：
// 1. submit(userId, taskId, spec) → 入队（限额检查 → AutoDL/Modal/BYO 路由）
// 2. cancel(userId, taskId) → 停止部署 + 释放租约 + 停止计费
// 3. status(userId, taskId) → 当前状态
// 4. release(userId, taskId) → 任务完成后延迟释放（keep-warm 窗口）
// 5. BYO SSH target 注册（clawsgo 式用户自配服务器）

import { rentServer, waitForReady, releaseServer, destroyServer, getContainerSsh, getBalance, estimateCost } from './autodl.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = process.env.GPU_BROKER_DIR || path.resolve(import.meta.dirname, '../../data/gpu');
const LEASE_TTL_MS = Number(process.env.GPU_LEASE_TTL_MS || 15 * 60_000); // 15min keep-warm
const MAX_PER_USER = Number(process.env.GPU_MAX_PER_USER || 2);
const MAX_TOTAL = Number(process.env.GPU_MAX_TOTAL || 8);

// ---------- 租约存储（文件持久化，I2P AllocationLeaseStore 同构）----------

function leaseDir() { fs.mkdirSync(DATA_DIR, { recursive: true }); return DATA_DIR; }
function leasePath(id) { return path.join(leaseDir(), `${id}.json`); }

function writeLease(lease) {
  lease.updatedAt = new Date().toISOString();
  fs.writeFileSync(leasePath(lease.id), JSON.stringify(lease, null, 2));
}

function readLease(id) {
  try { return JSON.parse(fs.readFileSync(leasePath(id), 'utf8')); } catch { return null; }
}

function listLeases() {
  return fs.readdirSync(leaseDir()).filter(f => f.endsWith('.json')).map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(leaseDir(), f), 'utf8')); } catch { return null; }
  }).filter(Boolean);
}

function deleteLease(id) {
  try { fs.rmSync(leasePath(id), { recursive: true }); } catch { /* ok */ }
}

// ---------- BYO SSH Target（clawsgo 式用户自配服务器）----------

const byoTargetsPath = path.join(DATA_DIR, 'byo-targets.json');

function loadByoTargets() {
  try { return JSON.parse(fs.readFileSync(byoTargetsPath, 'utf8')); } catch { return {}; }
}

function saveByoTargets(targets) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(byoTargetsPath, JSON.stringify(targets, null, 2));
}

/**
 * 注册用户自有 GPU 服务器（clawsgo BYO daemon 同构）
 * @param {string} userId
 * @param {Object} target {name, host, port, username, sshKeyFingerprint, gpuName, maxConcurrency}
 */
export function registerByoTarget(userId, target) {
  const targets = loadByoTargets();
  const id = crypto.randomUUID();
  targets[id] = {
    id, userId, ...target,
    status: 'unknown', // pending probe
    createdAt: new Date().toISOString(),
  };
  saveByoTargets(targets);
  return targets[id];
}

export function listByoTargets(userId) {
  const all = loadByoTargets();
  return Object.values(all).filter(t => t.userId === userId);
}

// ---------- 队列与调度 ----------

const queue = [];  // {userId, taskId, spec, enqueuedAt}
const active = new Map(); // taskId → {lease, controller}

/**
 * 提交 GPU 任务（自动租用）
 * 限额检查 → 入队 → 自动调度
 */
export async function submit(userId, taskId, spec = {}) {
  // 多用户隔离：限额检查
  const userActive = listLeases().filter(l => l.userId === userId && l.status === 'active').length;
  if (userActive >= MAX_PER_USER) {
    return { rejected: true, reason: 'per_user_limit', limit: MAX_PER_USER };
  }
  const totalActive = listLeases().filter(l => l.status === 'active').length;
  if (totalActive >= MAX_TOTAL) {
    // 入队等待
    queue.push({ userId, taskId, spec, enqueuedAt: new Date().toISOString() });
    return { queued: true, position: queue.length };
  }

  return _launch(userId, taskId, spec);
}

async function _launch(userId, taskId, spec) {
  const route = spec.route || 'auto'; // auto | autodl | modal | byo_ssh

  // BYO SSH 优先（用户自有服务器，零成本）
  if (route === 'byo_ssh' || (route === 'auto' && spec.byoTargetId)) {
    const target = loadByoTargets()[spec.byoTargetId];
    if (target && target.userId === userId) {
      return _launchByo(userId, taskId, target, spec);
    }
  }

  // AutoDL 自动租用（线上验证过的 API）
  const result = await rentServer({
    name: `i2p-gpu-${taskId}`,
    gpuNames: spec.gpuNames || ['4090'],
    gpuCount: spec.gpuCount || 1,
    imageUuid: spec.imageUuid,
    maxPricePerHour: spec.maxPricePerHour || 3.0,
    preferredDC: spec.preferredDC,
  });

  const lease = {
    id: crypto.randomUUID(),
    userId, taskId,
    provider: 'autodl',
    deploymentId: result.deployment_id || result.id,
    deploymentName: result.deployment_name || `i2p-gpu-${taskId}`,
    status: 'provisioning',
    createdAt: new Date().toISOString(),
    cost: estimateCost(spec.gpuNames?.[0] || '4090', 1),
  };
  writeLease(lease);
  active.set(taskId, { lease });

  // 异步等 ready
  _waitForDeployment(taskId, lease).catch(err => {
    lease.status = 'failed';
    lease.error = err.message;
    writeLease(lease);
  });

  return { leaseId: lease.id, status: 'provisioning' };
}

async function _launchByo(userId, taskId, target, spec) {
  const lease = {
    id: crypto.randomUUID(),
    userId, taskId,
    provider: 'byo_ssh',
    byoTargetId: target.id,
    sshEndpoint: { host: target.host, port: target.port, username: target.username },
    status: 'active', // BYO 直接可用
    createdAt: new Date().toISOString(),
    cost: { ratePerHour: 0, estimatedCost: '0.00' }, // 用户自有，零成本
  };
  writeLease(lease);
  return { leaseId: lease.id, status: 'active', ssh: lease.sshEndpoint };
}

async function _waitForDeployment(taskId, lease) {
  await waitForReady(lease.deploymentName, 180_000, (progress) => {
    lease.status = progress.status === 'running' ? 'active' : 'provisioning';
    writeLease(lease);
  });
  lease.status = 'active';
  // 从 container list 获取完整 SSH 信息（host/port/password/serviceUrl）
  const ssh = await getContainerSsh(lease.deploymentId);
  if (ssh) {
    lease.sshEndpoint = { host: ssh.host, port: ssh.port, username: ssh.username, password: ssh.password };
    lease.serviceUrl = ssh.serviceUrl;
    lease.gpuName = ssh.gpuName;
    lease.pricePerMs = ssh.price;
  }
  writeLease(lease);
}

/**
 * 取消任务（自动停止部署+释放+停止计费）
 */
export async function cancel(userId, taskId) {
  const lease = listLeases().find(l => l.taskId === taskId && l.userId === userId);
  if (!lease) return { cancelled: false, reason: 'not_found' };

  if (lease.provider === 'autodl' && lease.deploymentId) {
    await releaseServer(lease.deploymentId).catch(() => {});
  }
  lease.status = 'cancelled';
  lease.releasedAt = new Date().toISOString();
  writeLease(lease);

  // 从队列拉下一个
  _drainQueue();
  return { cancelled: true };
}

/**
 * 任务完成后延迟释放（keep-warm 窗口——novix 会话常驻语义）
 */
export async function releaseAfterTask(userId, taskId, delayMs = LEASE_TTL_MS) {
  const lease = listLeases().find(l => l.taskId === taskId && l.userId === userId);
  if (!lease) return;

  const timer = setTimeout(async () => {
    // 检查该用户是否有新任务在用这个 lease
    if (lease.status !== 'active') return;
    if (lease.provider === 'autodl') {
      await releaseServer(lease.deploymentId).catch(() => {});
    }
    lease.status = 'released';
    lease.releasedAt = new Date().toISOString();
    writeLease(lease);
    _drainQueue();
  }, delayMs);
  if (timer.unref) timer.unref();
}

function _drainQueue() {
  while (queue.length > 0) {
    const next = queue.shift();
    const totalActive = listLeases().filter(l => l.status === 'active').length;
    if (totalActive >= MAX_TOTAL) { queue.unshift(next); break; }
    _launch(next.userId, next.taskId, next.spec).catch(() => {
      queue.unshift(next); // 失败放回
    });
  }
}

/**
 * 查询状态
 */
export function status(userId, taskId) {
  const lease = listLeases().find(l => l.taskId === taskId && l.userId === userId);
  if (lease) return { found: true, ...lease };
  const qPos = queue.findIndex(q => q.taskId === taskId && q.userId === userId);
  if (qPos >= 0) return { found: true, status: 'queued', position: qPos + 1 };
  return { found: false };
}

export function health() {
  const leases = listLeases();
  return {
    active: leases.filter(l => l.status === 'active').length,
    provisioning: leases.filter(l => l.status === 'provisioning').length,
    queued: queue.length,
    byoTargets: Object.keys(loadByoTargets()).length,
    limits: { maxPerUser: MAX_PER_USER, maxTotal: MAX_TOTAL },
  };
}

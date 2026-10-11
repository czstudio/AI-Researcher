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
// 占用容量的状态：provisioning（已下租用单）、releasing（释放进行中，设备仍活）、
// release_failed（provider 可能仍在计费，不可确认清理时维持占用）。
// cancelled/failed/released 不占。
// 单进程幂等边界：占位租约在 provider 调用前同步落盘，同进程内并发/重放都被挡下；
// 跨进程 CAS 需要文件锁或原子 rename，本模块不做此承诺。
const OCCUPYING = new Set(['active', 'provisioning', 'releasing', 'release_failed']);

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
 * 幂等（含并发）→ 限额检查（active+provisioning 都占容量）→ 入队 → 自动调度
 */
export async function submit(userId, taskId, spec = {}) {
  // 幂等：同一 (user, task) 已占用（含 provisioning 占位）即去重，不重复租用
  const mine = listLeases().filter(l => l.userId === userId && l.taskId === taskId);
  const live = mine.find(l => OCCUPYING.has(l.status));
  if (live) {
    return { leaseId: live.id, status: live.status, deduped: true };
  }
  const queuedIdx = queue.findIndex(q => q.taskId === taskId && q.userId === userId);
  if (queuedIdx >= 0) {
    return { queued: true, position: queuedIdx + 1, deduped: true };
  }

  // 多用户隔离：限额检查（provisioning 占位同样计入容量）
  const userOccupying = listLeases().filter(l => l.userId === userId && OCCUPYING.has(l.status)).length;
  if (userOccupying >= MAX_PER_USER) {
    return { rejected: true, reason: 'per_user_limit', limit: MAX_PER_USER };
  }
  const totalOccupying = listLeases().filter(l => OCCUPYING.has(l.status)).length;
  if (totalOccupying >= MAX_TOTAL) {
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

  // 占位租约先于 provider 调用同步落盘：并发同任务重放在此窗口被幂等挡下
  const lease = {
    id: crypto.randomUUID(),
    userId, taskId,
    provider: 'autodl',
    status: 'provisioning',
    createdAt: new Date().toISOString(),
    cost: estimateCost(spec.gpuNames?.[0] || '4090', 1),
  };
  writeLease(lease);

  try {
    const result = await rentServer({
      name: `i2p-gpu-${taskId}`,
      gpuNames: spec.gpuNames || ['4090'],
      gpuCount: spec.gpuCount || 1,
      imageUuid: spec.imageUuid,
      maxPricePerHour: spec.maxPricePerHour || 3.0,
      preferredDC: spec.preferredDC,
    });
    // 官方 create 返回 deployment_uuid；未知形状/缺 UUID 失败关闭（不写无主租约）
    const uuid = result?.deployment_uuid || result?.deployment_id || result?.id;
    if (!uuid || typeof uuid !== 'string') {
      mutateLease(lease.id, (l) => {
        if (TERMINAL.has(l.status)) return;
        l.status = 'failed';
        l.error = 'provider create returned no deployment uuid (fail-closed)';
      });
      throw new Error('AutoDL create returned no deployment_uuid');
    }
    // 盘上读改写（rentServer 窗口内的取消不得被复活），并同步回填局部对象——
    // ready/SSH 路径绑定实际 create 返回的部署名/UUID，不得传 undefined
    const deploymentName = result.deployment_name || `i2p-gpu-${taskId}`;
    mutateLease(lease.id, (l) => {
      l.deploymentId = uuid;
      l.deploymentName = deploymentName;
    });
    lease.deploymentId = uuid;
    lease.deploymentName = deploymentName;
    // 取消发生在 rentServer 窗口：cancel 当时无 deploymentId 可停——补停自愈。
    // 补停失败 = release_failed（deployment 仍活、维持占用、如实失败），不得宣称 cancelled
    if (readLease(lease.id)?.status === 'cancelled') {
      const stopped = await releaseServer(uuid).catch(() => false);
      if (stopped === false) {
        mutateLease(lease.id, (l) => {
          l.status = 'release_failed';
          l.error = 'late-create stop failed (deployment still live)';
        });
        return { leaseId: lease.id, status: 'release_failed' };
      }
      return { leaseId: lease.id, status: 'cancelled' };
    }
  } catch (err) {
    // 租用失败释放容量（failed 不占容量）；盘上终态不被迟到异常覆盖
    mutateLease(lease.id, (l) => {
      if (TERMINAL.has(l.status)) return;
      l.status = 'failed';
      l.error = String(err?.message || err);
    });
    throw err;
  }
  active.set(taskId, { lease });

  // 异步等 ready；失败只标记非终态租约（取消/释放后的迟到异常不得覆盖终态）
  _waitForDeployment(taskId, lease).catch(err => {
    mutateLease(lease.id, (l) => {
      if (TERMINAL.has(l.status)) return;
      l.status = 'failed';
      l.error = err.message;
    });
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

// 同 (user,taskId) 可能存在被替代的旧租约（取消后重新提交=新 lease 新 id）：
// 一切按 taskId 的查找都优先取占用中的租约，否则取最新一条；
// 旧终态租约不得遮蔽当前租约。
function _latestLease(userId, taskId) {
  const leases = listLeases().filter(l => l.taskId === taskId && l.userId === userId);
  if (!leases.length) return null;
  const newestOf = (arr) => arr.reduce((best, l) =>
    (String(l.createdAt || '') > String(best.createdAt || '') ? l : best));
  const occupying = leases.filter(l => OCCUPYING.has(l.status));
  return newestOf(occupying.length ? occupying : leases);
}

// 终态集合：异步间隙后被取消/释放的租约，不得被更早路径的失败/收尾写覆盖。
const TERMINAL = new Set(['cancelled', 'released', 'release_failed', 'failed']);

// 盘上读-改-写：任何异步间隙后都不用陈旧内存对象写租约。
function mutateLease(id, mut) {
  const fresh = readLease(id);
  if (!fresh) return null;
  mut(fresh);
  writeLease(fresh);
  return fresh;
}

async function _waitForDeployment(taskId, lease) {
  // 取消判据只认盘上租约（单一真源）：取消后的 ready/SSH 回调不得复活租约
  const isCancelled = () => readLease(lease.id)?.status === 'cancelled';
  await waitForReady(lease.deploymentName, 180_000, (progress) => {
    if (isCancelled()) return;
    mutateLease(lease.id, (l) => { l.status = progress.status === 'running' ? 'active' : 'provisioning'; });
  });
  if (isCancelled()) return;
  mutateLease(lease.id, (l) => { l.status = 'active'; });
  // 从 container list 获取完整 SSH 信息（host/port/password/serviceUrl）
  const ssh = await getContainerSsh(lease.deploymentId);
  // SSH 读取期间可能被取消——写合并前再查盘上终态，不得复活
  if (isCancelled()) return;
  mutateLease(lease.id, (l) => {
    if (ssh) {
      l.sshEndpoint = { host: ssh.host, port: ssh.port, username: ssh.username, password: ssh.password };
      l.serviceUrl = ssh.serviceUrl;
      l.gpuName = ssh.gpuName;
      l.pricePerMs = ssh.price;
    }
  });
}

/**
 * 取消任务（自动停止部署+释放+停止计费）
 * provider 停止失败时如实上报，不假报 cancelled。
 */
export async function cancel(userId, taskId) {
  const lease = _latestLease(userId, taskId);
  if (!lease) return { cancelled: false, reason: 'not_found' };

  if (lease.provider === 'autodl' && lease.deploymentId) {
    const stopped = await releaseServer(lease.deploymentId).catch(() => false);
    if (stopped === false) {
      return { cancelled: false, reason: 'provider_stop_failed', leaseId: lease.id };
    }
  }
  mutateLease(lease.id, (l) => {
    l.status = 'cancelled';
    l.releasedAt = new Date().toISOString();
  });

  // 从队列拉下一个
  _drainQueue();
  return { cancelled: true };
}

/**
 * 任务完成后延迟释放（keep-warm 窗口——novix 会话常驻语义）
 */
export async function releaseAfterTask(userId, taskId, delayMs = LEASE_TTL_MS) {
  const lease = _latestLease(userId, taskId);
  if (!lease) return;

  const timer = setTimeout(async () => {
    // durable guard BEFORE await：arm 之后 lease 可能已被 cancel/released——
    // 按盘上 lease ID 读当前 status，已终态即 no-op（零 provider 调用、不覆盖终态）。
    const current = readLease(lease.id);
    if (!current || current.status !== 'active') return;
    // 同步 claim：duplicate timer / 并发路径看到 releasing 即止（单 stop 保证）
    current.status = 'releasing';
    writeLease(current);
    const stopped = current.provider === 'autodl'
      ? await releaseServer(current.deploymentId).catch(() => false)
      : true;
    // durable guard AFTER await：await 期间可能被 cancel 改写——旧对象不得覆盖终态
    const after = readLease(lease.id);
    if (!after || after.status !== 'releasing') return;
    if (stopped === false) {
      after.status = 'release_failed'; // 可恢复失败，不假释放（release_failed 维持占用）
    } else {
      after.status = 'released';
      after.releasedAt = new Date().toISOString();
    }
    writeLease(after);
    _drainQueue();
  }, delayMs);
  if (timer.unref) timer.unref();
}

function _drainQueue() {
  while (queue.length > 0) {
    const next = queue.shift();
    const totalOccupying = listLeases().filter(l => OCCUPYING.has(l.status)).length;
    if (totalOccupying >= MAX_TOTAL) { queue.unshift(next); break; }
    _launch(next.userId, next.taskId, next.spec).catch(() => {
      queue.unshift(next); // 失败放回
    });
  }
}

/**
 * 查询状态
 */
export function status(userId, taskId) {
  const lease = _latestLease(userId, taskId);
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

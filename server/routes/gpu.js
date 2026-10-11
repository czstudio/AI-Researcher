// GPU 租用 API 路由——自动租用/取消/状态/BYO 注册（clawsgo 式丝滑体验）
import * as broker from '../lib/gpu/broker.js';
import * as autodl from '../lib/gpu/autodl.js';

export function registerGpuRoutes(route, requireUser) {
  // GPU 付费资源边界：匿名（fingerprint-only）身份在 server 边界拒绝，先于 SDK/provider。
  // 只作用于 GPU 面——一般 CPU/聊天的匿名体验走全局 requireUser，不受影响。
  // （助手闭包在 registerGpuRoutes 内：requireUser 由 api.mjs 注入，模块顶层不可见。）
  function denyUnregistered(a) {
    if (a.denied) return a.denied;
    if (a.anon || a.user?.isAnonymous) {
      return { code: '403', message: 'GPU resources require a registered account', result: null };
    }
    return null;
  }

  function authed(req, p) {
    const a = requireUser(req, p);
    const denied = denyUnregistered(a);
    return denied ? { denied } : a;
  }

  // 任务归属链：db.tasks.chatSessionId → db.sessions.creatorUserId。
  // VM/测试环境用上下文注入的 db；真实运行时动态 import 现有 store（无第二状态源）。
  async function taskOwnedBy(userId, taskId) {
    let dbRef;
    if (typeof db !== 'undefined') dbRef = db;
    else { try { dbRef = await import('../store/db.mjs'); } catch { return false; } }
    if (!dbRef?.get) return false;
    const task = dbRef.get('tasks', taskId);
    if (!task || !task.chatSessionId) return false;
    const session = dbRef.get('sessions', task.chatSessionId);
    return !!session && String(session.creatorUserId) === String(userId);
  }

  // 自动租用 GPU 服务器
  route('POST', '/gpu/rent', async (req, res, p, body) => {
    const a = authed(req, p);
    if (a.denied) return a.denied;
    const { taskId, gpuNames, gpuCount, maxPricePerHour, route: gpuRoute, byoTargetId, imageUuid } = body;
    if (!taskId) return { code: '5001', message: 'taskId required' };
    // 归属门：foreign/missing task 在 broker/provider 调用前拒绝（零副作用）
    if (!(await taskOwnedBy(a.user.id, String(taskId)))) {
      return { code: '5200', message: 'task not found or not owned by user', result: null };
    }
    const result = await broker.submit(a.user.id, String(taskId), {
      gpuNames, gpuCount, maxPricePerHour, route: gpuRoute, byoTargetId, imageUuid,
    });
    return { code: '0', message: 'Success', result };
  });

  // 取消（自动停止部署+释放）
  route('POST', '/gpu/cancel/:taskId', async (req, res, p) => {
    const a = authed(req, p);
    if (a.denied) return a.denied;
    const result = await broker.cancel(a.user.id, p.taskId);
    return { code: '0', message: 'Success', result };
  });

  // 状态
  route('GET', '/gpu/status/:taskId', async (req, res, p) => {
    const a = authed(req, p);
    if (a.denied) return a.denied;
    return { code: '0', message: 'Success', result: broker.status(a.user.id, p.taskId) };
  });

  // 健康面
  route('GET', '/gpu/health', async (req, res) => {
    return { code: '0', message: 'Success', result: broker.health() };
  });

  // 余额：全局 vendor 钱包只给授权 operator（GPU_WALLET_OPERATOR_IDS）；
  // 普通注册用户返回既有个人预算，不透传平台账户余额。
  route('GET', '/gpu/balance', async (req, res, p) => {
    const a = authed(req, p);
    if (a.denied) return a.denied;
    const env = (typeof process !== 'undefined' && process.env) || {};
    const operators = String(env.GPU_WALLET_OPERATOR_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (operators.includes(String(a.user.id))) {
      const balance = await autodl.getBalance();
      return { code: '0', message: 'Success', result: { scope: 'platform', balance } };
    }
    return {
      code: '0', message: 'Success',
      result: { scope: 'user', userId: a.user.id, level: a.user.level || 'free', credits: a.user.credits ?? null },
    };
  });

  // BYO SSH 注册（clawsgo 式用户自配 GPU 服务器）
  route('POST', '/gpu/byo/register', async (req, res, p, body) => {
    const a = authed(req, p);
    if (a.denied) return a.denied;
    const { name, host, port, username, sshKeyFingerprint, gpuName, maxConcurrency } = body;
    if (!host || !port) return { code: '5001', message: 'host+port required' };
    const target = broker.registerByoTarget(a.user.id, {
      name: name || `byo-${host}:${port}`, host, port,
      username: username || 'root', sshKeyFingerprint, gpuName, maxConcurrency: maxConcurrency || 1,
    });
    return { code: '0', message: 'Success', result: target };
  });

  // BYO 列表
  route('GET', '/gpu/byo/list', async (req, res, p) => {
    const a = authed(req, p);
    if (a.denied) return a.denied;
    return { code: '0', message: 'Success', result: broker.listByoTargets(a.user.id) };
  });

  // 费用预估
  route('POST', '/gpu/estimate', async (req, res, p, body) => {
    const { gpuName, hours } = body;
    return { code: '0', message: 'Success', result: autodl.estimateCost(gpuName || '4090', hours || 1) };
  });
}

// GPU 租用 API 路由——自动租用/取消/状态/BYO 注册（clawsgo 式丝滑体验）
import * as broker from '../lib/gpu/broker.js';
import * as autodl from '../lib/gpu/autodl.js';

export function registerGpuRoutes(route, requireUser) {
  // 自动租用 GPU 服务器
  route('POST', '/gpu/rent', async (req, res, p, body, { user }) => {
    const a = requireUser(req, p);
    if (a.denied) return a.denied;
    const { taskId, gpuNames, gpuCount, maxPricePerHour, route: gpuRoute, byoTargetId, imageUuid } = body;
    if (!taskId) return { code: '5001', message: 'taskId required' };
    const result = await broker.submit(a.user.id, String(taskId), {
      gpuNames, gpuCount, maxPricePerHour, route: gpuRoute, byoTargetId, imageUuid,
    });
    return { code: '0', message: 'Success', result };
  });

  // 取消（自动停止部署+释放）
  route('POST', '/gpu/cancel/:taskId', async (req, res, p) => {
    const a = requireUser(req, p);
    if (a.denied) return a.denied;
    const result = await broker.cancel(a.user.id, p.taskId);
    return { code: '0', message: 'Success', result };
  });

  // 状态
  route('GET', '/gpu/status/:taskId', async (req, res, p) => {
    const a = requireUser(req, p);
    if (a.denied) return a.denied;
    return { code: '0', message: 'Success', result: broker.status(a.user.id, p.taskId) };
  });

  // 健康面
  route('GET', '/gpu/health', async (req, res) => {
    return { code: '0', message: 'Success', result: broker.health() };
  });

  // 余额（AutoDL 余额透传）
  route('GET', '/gpu/balance', async (req, res, p) => {
    const a = requireUser(req, p);
    if (a.denied) return a.denied;
    const balance = await autodl.getBalance();
    return { code: '0', message: 'Success', result: balance };
  });

  // BYO SSH 注册（clawsgo 式用户自配 GPU 服务器）
  route('POST', '/gpu/byo/register', async (req, res, p, body) => {
    const a = requireUser(req, p);
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
    const a = requireUser(req, p);
    if (a.denied) return a.denied;
    return { code: '0', message: 'Success', result: broker.listByoTargets(a.user.id) };
  });

  // 费用预估
  route('POST', '/gpu/estimate', async (req, res, p, body) => {
    const { gpuName, hours } = body;
    return { code: '0', message: 'Success', result: autodl.estimateCost(gpuName || '4090', hours || 1) };
  });
}

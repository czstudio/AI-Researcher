// AutoDL ESD GPU Provider — 自动租用/释放/状态/SSH 端口获取
//
// 架构来源（逆向 + I2P 已验证 API 合同）：
// - novix: GKE K8s 常驻 pod + T4 PCIe 直通 + 会话级 PV（/mnt/novix-k8s-workspace-root/session-<id>）
// - clawsgo: 团队共享云主机 + noVNC 桌面 + BYO SSH daemon 配对
// - I2P: AutoDL ESD api.autodl.com /api/v1/dev/* 合同（2026-08-28 设计合同已线上验证）
//
// 本模块实现「丝滑自动租用」：
// 1. submit() → 创建 deployment（自动选区/选卡/出价）
// 2. reconcile() → 轮询状态直到 running
// 3. sshEndpoint() → 拿 SSH host/port
// 4. cancel() → 停止部署（自动释放）
// 5. estimateCost() → 预估费用

const API_HOST = process.env.AUTODL_API_HOST || 'api.autodl.com';
const TOKEN = () => process.env.AUTODL_TOKEN || '';
const BASE = `https://${API_HOST}/api/v1/dev`;

// 线上验证过的 8 个可用区（I2P 设计合同 v4——排除永久零库存的 3 个区）
const ALLOWED_DC = ['westDC2', 'westDC3', 'beijingDC1', 'beijingDC2', 'beijingDC3', 'neimengDC3', 'foshanDC1', 'chongqingDC1'];

async function call(method, path, body = null) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Authorization': TOKEN(),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => ({ code: 'ParseError' }));
  return { status: res.status, code: json.code, data: json.data };
}

export async function getBalance() {
  const r = await call('POST', '/wallet/balance', {});
  return r.code === 'Success' ? r.data : null;
}

export async function listDeployments({ page = 1, pageSize = 20 } = {}) {
  const r = await call('POST', '/deployment/list', { page_index: page, page_size: pageSize });
  return r.code === 'Success' ? (r.data?.list ?? []) : [];
}

/**
 * 自动租用一台 GPU 服务器（clawsgo 式丝滑体验）
 * @param {Object} opts
 * @param {string} opts.name - 部署名（自动生成如 i2p-gpu-{taskId}）
 * @param {string[]} opts.gpuNames - 期望 GPU 型号 ['4090','3090']（按优先级）
 * @param {number} opts.gpuCount - GPU 数量（默认 1）
 * @param {string} opts.imageUuid - 容器镜像 UUID
 * @param {string} opts.command - 启动命令（bootstrap）
 * @param {number} opts.maxPricePerHour - 最高出价（元/小时）
 * @param {string[]} opts.preferredDC - 优先区域（默认自动选）
 */
export async function rentServer(opts = {}) {
  const {
    name = `i2p-gpu-${Date.now().toString(36)}`,
    gpuNames = ['RTX 4090'],
    gpuCount = 1,
    imageUuid = process.env.AUTODL_IMAGE_UUID || 'base-image-ec1e9vdbd3',
    command = 'sleep infinity',
    maxPricePerHour = 3.0,
    preferredDC = [],
  } = opts;

  // 区域优先级：用户偏好 → 默认顺序
  const dcList = preferredDC.length ? preferredDC : ALLOWED_DC.slice(0, 4);

  const body = {
    name,
    deployment_type: 'Container',
    reuse_container: false,
    container_template: {
      dc_list: dcList,
      gpu_name_set: gpuNames,
      gpu_num: gpuCount,
      cuda_v_from: 120,
      cuda_v_to: 128,
      cpu_num_from: 4,
      cpu_num_to: 16,
      memory_size_from: 8,
      memory_size_to: 64,
      cmd: command,
      price_from: Math.round(maxPricePerHour * 1000 * 0.5),
      price_to: Math.round(maxPricePerHour * 1000),
      image_uuid: imageUuid,
    },
  };

  const r = await call('POST', '/deployment', body);
  if (r.code !== 'Success') {
    throw new Error(`AutoDL rent failed: ${r.code}`);
  }
  return r.data;
}

/**
 * 轮询直到部署 ready（running/available）
 * @param {string} deploymentName
 * @param {number} timeoutMs - 默认 120s
 * @param {Function} onProgress - 进度回调
 */
export async function waitForReady(deploymentName, timeoutMs = 120_000, onProgress) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const list = await listDeployments({ pageSize: 100 });
    const dep = list.find((d) => d.name === deploymentName);
    if (!dep) { await sleep(3000); continue; }

    const status = mapStatus(dep.status);
    onProgress?.({ status, elapsed: Date.now() - start, raw: dep });

    if (status === 'running') return dep;
    if (status === 'failed' || status === 'error') {
      throw new Error(`AutoDL deployment failed: ${dep.status}`);
    }
    await sleep(5000);
  }
  throw new Error(`AutoDL deployment timeout after ${timeoutMs}ms`);
}

/**
 * 获取容器的 SSH 连接信息（host/port/password）
 * AutoDL ESD container info 字段返回完整 ssh_command + root_password
 */
export async function getContainerSsh(deploymentUuid) {
  const r = await call('POST', '/deployment/container/list', {
    deployment_uuid: deploymentUuid,
    page_index: 1, page_size: 1,
  });
  if (r.code !== 'Success') return null;
  const c = r.data?.list?.[0];
  if (!c) return null;
  const info = c.info || {};
  const sshCmd = info.ssh_command || '';
  const m = sshCmd.match(/ssh -p (\d+) (\S+)@(\S+)/);
  return {
    status: c.status,
    host: m ? m[3] : info.proxy_host,
    port: m ? Number(m[1]) : 22,
    username: m ? m[2] : 'root',
    password: info.root_password || null,
    serviceUrl: info.service_url || null,
    gpuName: c.gpu_name,
    price: c.price,
  };
}

/**
 * 兼容旧接口
 */
export function sshEndpoint(deployment) {
  return {
    host: deployment.ssh_host || deployment.container?.ssh_host,
    port: deployment.ssh_port || deployment.container?.ssh_port || 22,
    username: 'root',
  };
}

/**
 * 停止部署（自动释放资源+停止计费）
 * AutoDL: PUT /api/v1/dev/deployment/operate {"deployment_id": ..., "type": "STOP"}
 */
export async function releaseServer(deploymentId) {
  const r = await call('PUT', '/deployment/operate', {
    deployment_id: deploymentId,
    type: 'STOP',
  });
  return r.code === 'Success';
}

/**
 * 删除部署（彻底释放）
 */
export async function destroyServer(deploymentId) {
  const r = await call('DELETE', `/deployment`, { deployment_id: deploymentId });
  return r.code === 'Success';
}

/**
 * 预估费用
 * @param {string} gpuName - '4090'|'3090'|'v100-32g' 等
 * @param {number} hours - 使用时长
 */
export function estimateCost(gpuName, hours) {
  const RATES = {
    'RTX 4090': 1.98, 'RTX 3090': 0.98, 'v100-32g': 2.58, 'a100-80g': 5.98,
    '2080ti': 0.78, '3080ti': 1.28, 't4': 0.88,
  };
  const rate = RATES[gpuName] ?? 1.5;
  return { ratePerHour: rate, hours, estimatedCost: (rate * hours).toFixed(2) };
}

function mapStatus(raw) {
  const s = String(raw ?? '').toLowerCase();
  if (s.includes('running') || s.includes('available') || s.includes('ready')) return 'running';
  if (s.includes('creating') || s.includes('pending') || s.includes('scheduling')) return 'provisioning';
  if (s.includes('stop')) return 'stopped';
  return 'unknown';
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

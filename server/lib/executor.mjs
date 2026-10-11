// Runs a kernel for a task, persists the trajectory, and broadcasts live events.

import fs from 'node:fs';
import path from 'node:path';
import * as db from '../store/db.mjs';
import { kernelFor } from './kernels.mjs';
import { runAgentLoop } from './agent-loop.mjs';
import { resolveModel } from './llm.mjs';
import { publish } from './hub.mjs';
import { nowMs } from './util.mjs';

const running = new Set();
/** taskId → AbortController（cancel 路由调用 abortTask 真中止 agent 循环 + Bash 进程） */
const aborters = new Map();

export function abortTask(taskId) {
  const ac = aborters.get(String(taskId));
  if (!ac) return false;
  ac.abort();
  return true;
}
// 线上步 id 为全局数字自增（实测 15964924 量级）；本地以毫秒基种子近似
let stepSeq = (Date.now() % 1_000_000_000) * 1000;

/** 按线上格式落一条原始轨迹步：content={type:'trajectory',content:"[{role,...}])"}，数字 id，agent_name */
function pushTrajectory(task, message) {
  const step = {
    id: ++stepSeq,
    taskId: task.id,
    createAt: nowMs(),
    updateAt: nowMs(),
    content: JSON.stringify({ type: 'trajectory', content: JSON.stringify([message]) }),
  };
  task.steps = task.steps || [];
  task.steps.push(step);
  task.updatedAt = nowMs();
  db.put('tasks', task.id, task);
  return step;
}

function pushStep(task, role, content, extra) {
  const step = {
    id: `${task.id}-${String((task.steps?.length || 0) + 1).padStart(3, '0')}`,
    taskId: task.id,
    createAt: nowMs(),
    updateAt: nowMs(),
    content: JSON.stringify({
      type: 'trajectory',
      content: JSON.stringify([{ role, content, ...extra }]),
    }),
  };
  task.steps = task.steps || [];
  task.steps.push(step);
  task.updatedAt = nowMs();
  db.put('tasks', task.id, task);
  return step;
}

export async function runTask({ task, session, modeDef, body }) {
  if (running.has(task.id)) return;
  running.add(task.id);
  task.status = 'processing';
  task.updatedAt = nowMs();
  db.put('tasks', task.id, task);
  publish(session.id, { type: 'task', taskId: task.id, status: 'processing' });

  const ac = new AbortController();
  aborters.set(task.id, ac);

  const ctx = {
    query: body.query || '',
    queryContent: body.queryContent || body.query || '',
    controls: body.controls || [],
    model: body.modelOverride || modeDef?.defaultModel || null,
    workspaceDir: db.workspaceDir(session.id),
    task,
    session,
    signal: ac.signal,
  };

  const kernel = kernelFor(modeDef?.key, modeDef);
  let finalText = '';

  // ---- 真实自治循环（LLM 已配置时）：对齐线上 NovixWriterAgent 运行形态 ----
  const modelRes = resolveModel(body.modelOverride || modeDef?.defaultModel);
  if (modelRes.baseUrl && modelRes.apiKey) {
    const loopCtx = {
      taskRef: task,
      sessionRef: session,
      query: ctx.query,
      queryContent: ctx.queryContent,
      queryModel: ctx.model,
      model: body.modelOverride || modeDef?.defaultModel || null,
      modeKey: modeDef?.key,
      modeDef,
      controls: body.controls || [],
      workspaceDir: ctx.workspaceDir,
      signal: ctx.signal,
      enableGpu: task.enableGpu === true,
    };
    try {
      for await (const ev of runAgentLoop(loopCtx)) {
        if (ctx.signal?.aborted) break;
        if (ev.kind === 'trajectory') {
          pushTrajectory(task, ev.message);
        } else if (ev.kind === 'tool') {
          pushTrajectory(task, { role: 'tool', content: JSON.stringify({ tool: ev.name, output: ev.output }).slice(0, 4000) });
          publish(session.id, { type: 'tool', taskId: task.id, name: ev.name, output: ev.output });
        } else if (ev.kind === 'artifact') {
          publish(session.id, { type: 'artifact', taskId: task.id, path: ev.path, bytes: ev.bytes });
        } else if (ev.kind === 'delta') {
          finalText += ev.text;
          publish(session.id, { type: 'message', taskId: task.id, delta: ev.text });
        } else if (ev.kind === 'final') {
          finalText = ev.content || finalText;
        }
      }
      // 纠偏（独立验收 verify-04-terminal-race）：abort 已请求时不得覆盖 cancelled 终态
      if (ac.signal.aborted) {
        task.status = 'cancelled';
        task.finishedAt = nowMs();
        task.result = finalText || '(已取消)';
        pushTrajectory(task, { role: 'assistant', content: '(interrupted by cancel)', agent_name: modeDef?.agentName || 'NovixWriterAgent' });
        publish(session.id, { type: 'complete', taskId: task.id, cancelled: true });
      } else {
        task.status = 'finish';
        task.finishedAt = nowMs();
        task.result = finalText;
        pushTrajectory(task, { role: 'assistant', content: finalText, agent_name: modeDef?.agentName || 'NovixWriterAgent' });
        publish(session.id, { type: 'response', taskId: task.id, messages: [{ role: 'assistant', content: finalText }] });
      }
    } catch (err) {
      // 纠偏：abort 引发的异常不得写 error——同样归 cancelled
      if (ac.signal.aborted) {
        task.status = 'cancelled';
        task.finishedAt = nowMs();
        task.result = finalText || '(已取消)';
        pushTrajectory(task, { role: 'assistant', content: '(interrupted by cancel)' });
        publish(session.id, { type: 'complete', taskId: task.id, cancelled: true });
      } else {
        task.status = 'error';
        task.errorCode = '5000';
        task.finishedAt = nowMs();
        task.result = `后台任务执行失败: ${err?.message || err}`;
        pushTrajectory(task, { role: 'assistant', content: task.result });
        publish(session.id, { type: 'error', taskId: task.id, errorCode: '5000', message: task.result });
      }
    } finally {
      task.updatedAt = nowMs();
      db.put('tasks', task.id, task);
      publish(session.id, { type: 'complete', taskId: task.id });
      running.delete(task.id);
    aborters.delete(task.id);
    }
    return;
  }

  // ---- 回退：无 LLM 网关时走阶段脚本 ----
  try {
    pushStep(task, 'user', ctx.queryContent);
    for await (const ev of kernel(ctx)) {
      switch (ev.kind) {
        case 'plan':
          task.plan = ev.steps;
          db.put('tasks', task.id, task);
          publish(session.id, { type: 'plan', taskId: task.id, steps: ev.steps });
          break;
        case 'step':
          pushStep(task, 'assistant', `**${ev.name}** — ${ev.status}${ev.detail ? ` (${ev.detail})` : ''}`, { agent_name: modeDef?.agentName || 'NovixAgentMain' });
          publish(session.id, { type: 'step', taskId: task.id, name: ev.name, status: ev.status, detail: ev.detail || null });
          break;
        case 'tool':
          pushStep(task, 'tool', JSON.stringify({ tool: ev.name, input: ev.input, output: ev.output }));
          publish(session.id, { type: 'tool', taskId: task.id, name: ev.name, output: ev.output });
          break;
        case 'terminal':
          pushStep(task, 'assistant', `\`\`\`ansi\n${ev.text}\n\`\`\``, { agent_name: modeDef?.agentName || 'NovixAgentMain' });
          publish(session.id, { type: 'terminal', taskId: task.id, text: ev.text, exitCode: ev.exitCode });
          break;
        case 'artifact':
          pushStep(task, 'assistant', `Artifact written: \`${ev.path}\` (${ev.bytes} bytes)`, { agent_name: modeDef?.agentName || 'NovixAgentMain' });
          publish(session.id, { type: 'artifact', taskId: task.id, path: ev.path, bytes: ev.bytes });
          break;
        case 'delta':
          finalText += ev.text;
          publish(session.id, { type: 'message', taskId: task.id, delta: ev.text });
          break;
        case 'final':
          finalText = ev.content || finalText;
          break;
        default:
          break;
      }
    }
    // 纠偏（verify-04-fallback-race）：fallback 分支同样不得在 abort 后覆盖 cancelled 终态
    if (ac.signal.aborted) {
      task.status = 'cancelled';
      task.finishedAt = nowMs();
      task.result = finalText || '(已取消)';
      pushStep(task, 'assistant', '(interrupted by cancel)', { agent_name: modeDef?.agentName || 'NovixAgentMain' });
      publish(session.id, { type: 'complete', taskId: task.id, cancelled: true });
    } else {
      task.status = 'finish';
      task.finishedAt = nowMs();
      task.result = finalText;
      pushStep(task, 'assistant', finalText, { agent_name: modeDef?.agentName || 'NovixAgentMain' });
      publish(session.id, {
        type: 'response',
        taskId: task.id,
        messages: [{ role: 'assistant', content: finalText }],
      });
    }
  } catch (err) {
    // 纠偏：fallback catch 同样归 cancelled（abort 引发的异常不得写 error）
    if (ac.signal.aborted) {
      task.status = 'cancelled';
      task.finishedAt = nowMs();
      task.result = finalText || '(已取消)';
      pushStep(task, 'assistant', '(interrupted by cancel)', { agent_name: modeDef?.agentName || 'NovixAgentMain' });
      publish(session.id, { type: 'complete', taskId: task.id, cancelled: true });
    } else {
      task.status = 'error';
      task.errorCode = '5000';
      task.finishedAt = nowMs();
      task.result = `后台任务执行失败: ${err?.message || err}`;
      pushStep(task, 'assistant', task.result);
      publish(session.id, { type: 'error', taskId: task.id, errorCode: '5000', message: task.result });
    }
  } finally {
    task.updatedAt = nowMs();
    db.put('tasks', task.id, task);
    publish(session.id, { type: 'complete', taskId: task.id });
    running.delete(task.id);
    aborters.delete(task.id);
  }
}

export function isRunning(taskId) {
  return running.has(taskId);
}

// Real-HTTP backend parity regression.
// Covers the added account/credit/notification/workspace/file/publish/fork/HMAC
// surface plus ownership negatives, target/depth trees and idempotency.
// Run: node server/tests/parity-backend-http.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const REPO = path.resolve(new URL('..', import.meta.url).pathname, '..');
const PORT = 8299 + Math.floor(Math.random() * 400);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'novix-parity-'));
const SECRET = 'parity-internal-secret';
const BASE = 'http://127.0.0.1:' + PORT;
let server = null;
const rows = [];
function expect(cond, name, detail = '') {
  rows.push({ name, pass: Boolean(cond), detail: String(detail) });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + ' :: ' + detail);
  if (cond === false) process.exitCode = 1;
}
async function api(method, apiPath, options = {}) {
  const headers = { accept: 'application/json' };
  if (options.token) headers.authorization = 'Bearer ' + options.token;
  if (options.fingerprint) headers.fingerprint = options.fingerprint;
  if (options.headers) Object.assign(headers, options.headers);
  let body = options.body;
  if (body !== undefined && options.rawBody == null) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch(BASE + '/api' + apiPath, { method, headers, body, signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}
function sign(raw) {
  return crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
}

async function main() {
  server = spawn(process.execPath, ['server/serve.mjs'], {
    cwd: REPO,
    env: { ...process.env, PORT_SITE: String(PORT), NOVIX_DATA_DIR: DATA, NOVIX_JWT_SECRET: 'parity-jwt', NOVIX_INTERNAL_TASK_SECRET: SECRET, SANDBOX: 'local' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  let up = false;
  for (let i = 0; i < 60 && up === false; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try { up = (await fetch(BASE + '/healthz')).ok; } catch {}
  }
  if (up === false) throw new Error('server did not start');
  expect(true, 'fresh-server-health', 'port=' + PORT);

  const suffix = Date.now();
  const owner = (await api('POST', '/user/emailSignUp', { body: { email: 'owner-' + suffix + '@t.test', password: 'pw-123456', name: 'Owner' } })).json.result;
  const other = (await api('POST', '/user/emailSignUp', { body: { email: 'other-' + suffix + '@t.test', password: 'pw-123456', name: 'Other' } })).json.result;
  expect(owner && owner.token && other && other.token, 'two-registered-users', 'tokens issued');

  const login = await api('POST', '/login', { body: { email: 'owner-' + suffix + '@t.test', password: 'pw-123456' } });
  expect(login.json && login.json.code === '0' && login.json.result.token, '/login alias', 'ok');
  const infoNoAuth = await api('GET', '/account/info');
  expect(infoNoAuth.json && infoNoAuth.json.code === '401', '/account/info auth negative', infoNoAuth.json && infoNoAuth.json.code);
  const info = await api('GET', '/account/info', { token: owner.token });
  expect(info.json && info.json.code === '0' && info.json.result.user.email === 'owner-' + suffix + '@t.test', '/account/info owner shape', info.json && info.json.result.user.id);

  const upgrade1 = await api('POST', '/account/upgrade', { token: owner.token, headers: { 'idempotency-key': 'acct-up-1' }, body: { level: 'pro' } });
  const upgrade2 = await api('POST', '/account/upgrade', { token: owner.token, headers: { 'idempotency-key': 'acct-up-1' }, body: { level: 'pro' } });
  expect(upgrade1.json && upgrade1.json.code === '0' && upgrade1.json.result.level === 'pro', '/account/upgrade', upgrade1.json && upgrade1.json.result.level);
  expect(upgrade2.json && upgrade2.json.result.idempotent === true, 'billing upgrade idempotency', upgrade2.json && upgrade2.json.result.idempotent);

  const billing = await api('GET', '/credit/billing-statements', { token: owner.token });
  const billingRows = billing.json && billing.json.result;
  expect(Array.isArray(billingRows) && billingRows.length === 1, '/credit/billing-statements array+persisted', Array.isArray(billingRows) ? billingRows.length : 'not-array');
  expect(billingRows[0] && billingRows[0].sku && billingRows[0].amount > 0 && billingRows[0].provider, 'billing row shape', billingRows[0] && billingRows[0].sku);

  const plans = await api('GET', '/credit/one-time-plans', { token: owner.token });
  expect(plans.json && plans.json.code === '0' && plans.json.result.buyOneGetOne === false && plans.json.result.groups === null, '/credit/one-time-plans', 'exact flags');
  expect(Array.isArray(plans.json.result.items) && plans.json.result.items.length > 0, 'one-time plans items', plans.json.result.items.length);

  const invite1 = await api('POST', '/credit/invite', { token: owner.token, body: {} });
  const invite2 = await api('POST', '/credit/invite', { token: owner.token, body: {} });
  const inv = invite1.json && invite1.json.result;
  expect(inv && inv.inviteId && inv.inviteCode, '/credit/invite', inv && inv.inviteCode);
  expect(invite2.json.result.inviteId === inv.inviteId, 'invite idempotent', invite2.json.result.inviteId);
  const listGet = await api('GET', '/credit/list', { token: owner.token });
  const listPost = await api('POST', '/credit/list', { token: owner.token, body: {} });
  expect(Array.isArray(listGet.json.result.inviteInfoList) && listGet.json.result.inviteInfoList.length === 1, '/credit/list GET', listGet.json.result.inviteInfoList.length);
  expect(Array.isArray(listPost.json.result.inviteInfoList) && listPost.json.result.inviteInfoList.length === 1, '/credit/list POST', listPost.json.result.inviteInfoList.length);

  const otherBefore = (await api('POST', '/user/getUserCreditInfo', { token: other.token })).json.result.remainingCredit;
  const join1 = await api('POST', '/credit/join?inviteId=' + encodeURIComponent(inv.inviteId), { token: other.token, body: {} });
  const join2 = await api('POST', '/credit/join?inviteId=' + encodeURIComponent(inv.inviteId), { token: other.token, body: {} });
  expect(join1.json.result.alreadyJoined === false && join1.json.result.credits === otherBefore + 30, 'credit/join awards once', join1.json.result.credits);
  expect(join2.json.result.alreadyJoined === true && join2.json.result.credits === otherBefore + 30, 'credit/join idempotent', join2.json.result.credits);

  const cancel = await api('POST', '/credit/cancel', { token: owner.token, body: {} });
  expect(cancel.json && cancel.json.result.subscriptionStatus === 'cancel_scheduled', '/credit/cancel', cancel.json.result.subscriptionStatus);

  const nlist = await api('GET', '/notification/list?page=1&pageSize=50', { token: owner.token });
  const nr = nlist.json && nlist.json.result;
  expect(nr && Array.isArray(nr.records) && nr.total >= 1 && nr.size === 50 && nr.current === 1, 'notification/list exact envelope', nr && nr.total);
  expect(nr.records[0] && nr.records[0].type && nr.records[0].name && typeof nr.records[0].createdAt === 'string', 'notification record shape', nr.records[0] && nr.records[0].name);
  const latest = await api('GET', '/notification/latest', { token: owner.token });
  expect(latest.json && Array.isArray(latest.json.result.ids) && latest.json.result.total >= 1, '/notification/latest', latest.json.result.total);

  const ack = await api('POST', '/user/ackOnboardingMilestone', { token: owner.token, body: { milestone: 'firstTask' } });
  const info2 = await api('POST', '/user/getUserCreditInfo', { token: owner.token });
  expect(ack.json && ack.json.result.firstTaskAcked === true, 'ackOnboardingMilestone', ack.json.result.firstTaskAcked);
  expect(info2.json.result.onboardingState.firstTaskAcked === true, 'onboarding persisted in credit info', 'true');

  const homeNoAuth = await api('POST', '/home/novix/workspace', { body: {} });
  expect(homeNoAuth.json && homeNoAuth.json.code === '401', '/home/novix/workspace auth negative', homeNoAuth.json && homeNoAuth.json.code);
  const home = await api('POST', '/home/novix/workspace', { token: owner.token, body: { targets: [['', 2]] } });
  expect(home.json && home.json.code === '0' && typeof home.json.result.workspaceTreeJson === 'string', '/home/novix/workspace', 'workspaceTreeJson string');

  const sts = await api('GET', '/oss/getSTSToken', { token: owner.token });
  expect(sts.json && sts.json.code === '0' && sts.json.result.credentials && sts.json.result.securityToken === null, '/oss/getSTSToken auth+shape', sts.json.result.provider);

  const sid = (await api('POST', '/chat_session/create', { token: owner.token, body: {} })).json.result.id;
  const root = path.join(DATA, 'workspaces', sid, 'workspace');
  fs.mkdirSync(path.join(root, 'writing_space', 'final'), { recursive: true });
  fs.mkdirSync(path.join(root, 'user_data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'writing_space', 'final', 'manuscript.tex'), '\\documentclass{article}\n');
  fs.writeFileSync(path.join(root, 'user_data', 'input.txt'), 'uploaded input\n');
  fs.writeFileSync(path.join(root, 'SUMMARY.md'), '# Summary\n');

  const foreignRename = await api('POST', '/chat_session/rename', { token: other.token, body: { chatSessionId: sid, title: 'hijack' } });
  expect(foreignRename.json && foreignRename.json.code === '5200', 'foreign rename denied', foreignRename.json && foreignRename.json.code);
  const foreignWorkspace = await api('GET', '/chat_session/workspace?chatSessionId=' + sid, { token: other.token });
  expect(foreignWorkspace.json && foreignWorkspace.json.code === '5200', 'foreign workspace denied', foreignWorkspace.json && foreignWorkspace.json.code);
  const foreignHomeFiles = await api('GET', '/chat_session/workspace/home_files?chatSessionId=' + sid, { token: other.token });
  expect(foreignHomeFiles.json && foreignHomeFiles.json.code === '5200', 'foreign home_files denied', foreignHomeFiles.json && foreignHomeFiles.json.code);
  const foreignPreview = await api('POST', '/chat_session/workspace/home_file_preview', { token: other.token, body: { chatSessionId: sid, path: 'SUMMARY.md' } });
  expect(foreignPreview.json && foreignPreview.json.code === '5200', 'foreign preview denied', foreignPreview.json && foreignPreview.json.code);

  const subtree = await api('POST', '/chat_session/workspace/subtree', { token: owner.token, body: { chatSessionId: sid, targets: [['', 1], ['writing_space/final/manuscript.tex', 0]] } });
  const parsed = JSON.parse(subtree.json.result.workspaceTreeJson);
  const writing = parsed.children.find((n) => n.name === 'writing_space');
  const finalDir = writing && writing.children.find((n) => n.name === 'final');
  const manuscript = finalDir && finalDir.children.find((n) => n.name === 'manuscript.tex');
  expect(typeof subtree.json.result.workspaceTreeJson === 'string', 'subtree returns JSON string', typeof subtree.json.result.workspaceTreeJson);
  expect(parsed.directory === true && parsed.file === false && parsed.fileKey && typeof parsed.mtime === 'number' && 'previewType' in parsed, 'tree node parity fields', parsed.fileKey);
  expect(manuscript && manuscript.file === true && manuscript.previewType === 'text', 'target/depth expansion', manuscript && manuscript.path);

  const hf = await api('GET', '/chat_session/workspace/home_files?chatSessionId=' + sid, { token: owner.token });
  const hfr = hf.json && hf.json.result;
  expect(hfr && Array.isArray(hfr.userUpload) && Array.isArray(hfr.agentOutput), 'home_files exact arrays', hfr && Object.keys(hfr).join(','));
  expect(hfr.userUpload.some((x) => x.name === 'input.txt' && x.source === 'user_upload'), 'home_files userUpload shape', hfr.userUpload.length);
  expect(hfr.agentOutput.some((x) => x.path === 'SUMMARY.md' && x.fileKey && x.chatSessionId === sid), 'home_files agentOutput shape', hfr.agentOutput.length);

  const preview = await api('POST', '/chat_session/workspace/home_file_preview', { token: owner.token, body: { chatSessionId: sid, path: 'SUMMARY.md' } });
  expect(preview.json && preview.json.result.content.includes('# Summary'), 'home_file_preview owner', preview.json.result.language);

  const batch = await api('POST', '/file/batch_temp_urls', { token: owner.token, body: { files: ['notes.txt'], chatSessionId: sid } });
  const fileId = batch.json.result.items[0].fileId;
  const form = new FormData();
  form.append('file', new Blob(['hello upload']), 'notes.txt');
  const uploadRes = await fetch(BASE + '/api/file/upload_stream?fileId=' + fileId + '&chatSessionId=' + encodeURIComponent(sid), { method: 'POST', headers: { authorization: 'Bearer ' + owner.token }, body: form });
  const upload = await uploadRes.json();
  expect(upload.code === '0' && upload.result.fileId === fileId, '/file/upload_stream owner', upload.result.size);
  const put = await api('POST', '/file/putToGcs', { token: owner.token, body: { chatSessionId: sid, fileName: 'gcs-note.md', contentBase64: Buffer.from('# GCS note').toString('base64'), encoding: 'base64' } });
  expect(put.json && put.json.code === '0' && put.json.result.fileKey, '/file/putToGcs', put.json.result.fileKey);

  const foreignTask = await api('POST', '/task/create_task', { token: other.token, body: { chatSessionId: sid, queryContent: 'foreign' } });
  expect(foreignTask.json && foreignTask.json.code === '5200', 'foreign create_task denied', foreignTask.json && foreignTask.json.code);
  const created = await api('POST', '/task/create_task', { token: owner.token, body: { chatSessionId: sid, agentName: 'Deep Search Agent', query: 'q', queryContent: 'q-content', enableGpu: true, enableBrainstorming: true, questionMode: 'discuss', modelOverride: 'custom-model', writeUpType: 'paper', tempUrl: 'https://example.test/tmp', fileIds: [fileId, put.json.result.fileId] } });
  const task = created.json && created.json.result;
  expect(task && task.agentName === 'Deep Search Agent' && task.queryContent === 'q-content', 'create_task accepted fields', task && task.agentName);
  expect(task.enableBrainstorming === true && task.questionMode === 'discuss' && task.modelOverride === 'custom-model', 'create_task brainstorming fields', task.questionMode);
  expect(task.enableGpu === false && task.tempUrl === 'https://example.test/tmp' && task.fileIds.length === 2, 'create_task gpu forced off with files + fileIds persisted', task.enableGpu);
  expect(task.writeUpType === 'paper' && task.createdBy === owner.user.id, 'create_task writeUpType/createdBy', task.writeUpType);

  const unsignedRaw = JSON.stringify({ chatSessionId: sid, queryContent: 'internal unsigned', query: 'internal unsigned' });
  const unsigned = await api('POST', '/task/create_internal_task_with_signature', { token: owner.token, body: unsignedRaw, rawBody: unsignedRaw, headers: { 'content-type': 'application/json' } });
  expect(unsigned.json && unsigned.json.code === '403', 'internal task missing HMAC rejected', unsigned.json && unsigned.json.code);
  const bad = await api('POST', '/task/create_internal_task_with_signature', { token: owner.token, body: unsignedRaw, rawBody: unsignedRaw, headers: { 'content-type': 'application/json', 'x-novix-signature': 'deadbeef' } });
  expect(bad.json && bad.json.code === '403', 'internal task bad HMAC rejected', bad.json && bad.json.code);
  const signedBody = JSON.stringify({ chatSessionId: sid, queryContent: 'internal signed', query: 'internal signed' });
  const signed = await api('POST', '/task/create_internal_task_with_signature', { token: owner.token, body: signedBody, rawBody: signedBody, headers: { 'content-type': 'application/json', 'x-novix-signature': sign(signedBody) } });
  expect(signed.json && signed.json.code === '0' && signed.json.result.queryContent === 'internal signed', 'internal task valid HMAC accepted', signed.json && signed.json.code);

  const anonFp = 'parityfp-' + suffix;
  const anonSid = (await api('POST', '/chat_session/create_anonymous', { fingerprint: anonFp, body: {} })).json.result.id;
  const bindBad = await api('POST', '/chat_session/bind_anonymous', { token: other.token, fingerprint: 'different-fp', body: { chatSessionId: anonSid } });
  expect(bindBad.json && bindBad.json.code === '5200', 'foreign bind_anonymous denied', bindBad.json && bindBad.json.code);
  const bindOk = await api('POST', '/chat_session/bind_anonymous', { token: other.token, fingerprint: anonFp, body: { chatSessionId: anonSid } });
  expect(bindOk.json && bindOk.json.code === '0' && bindOk.json.result.creatorUserId === other.user.id, 'matching anonymous bind succeeds', bindOk.json.result && bindOk.json.result.creatorUserId);

  const foreignShare = await api('POST', '/chat_session/share', { token: other.token, body: { chatSessionId: sid } });
  expect(foreignShare.json && foreignShare.json.code === '5200', 'foreign share denied', foreignShare.json && foreignShare.json.code);
  const share = await api('POST', '/chat_session/share', { token: owner.token, body: { chatSessionId: sid } });
  expect(share.json && share.json.code === '0' && share.json.result.share === true, 'owner share succeeds', share.json.result.url);

  const privatePut = await api('POST', '/file/putToGcs', { token: owner.token, body: { fileName: 'private.txt', content: 'private' } });
  const privateDownload = await api('GET', '/file/download?fileKey=' + encodeURIComponent(privatePut.json.result.fileId), { token: other.token });
  expect(privateDownload.json && privateDownload.json.code === '5200', 'foreign file download denied', privateDownload.json && privateDownload.json.code);
  const sharedTree = await api('POST', '/chat_session/workspace/subtree', { body: { chatSessionId: sid, targets: [['', 2]] } });
  expect(sharedTree.json && sharedTree.json.code === '0', 'shared subtree public read', sharedTree.json && sharedTree.json.code);
  const sharedFileKey = sharedTree.json.result.workspaceTreeJson.includes('SUMMARY.md') ? 'nova_agent_v1/user_data/session_' + sid + '/workspace/SUMMARY.md' : '';
  const sharedDownload = await fetch(BASE + '/api/file/download?fileKey=' + encodeURIComponent(sharedFileKey));
  expect(sharedDownload.status === 200 && (await sharedDownload.text()).includes('# Summary'), 'shared workspace file public download', sharedDownload.status);

  const publishDenied = await api('POST', '/published/item/publish', { token: other.token, body: { chatSessionId: sid } });
  expect(publishDenied.json && publishDenied.json.code === '5200', 'foreign publish denied', publishDenied.json && publishDenied.json.code);
  const publish = await api('POST', '/published/item/publish', { token: owner.token, body: { chatSessionId: sid } });
  const rev = publish.json && publish.json.result;
  expect(rev && rev.revisionId && rev.revisionNo === 1, '/published/item/publish revision persisted', rev && rev.revisionId);
  const access = await api('GET', '/published/item/publish/access', { token: owner.token });
  expect(access.json.result.canPublish === true && typeof access.json.result.message === 'string', 'publish/access exact shape', access.json.result.message);

  const pubSession = await api('GET', '/published/revision/' + rev.revisionId + '/session');
  expect(pubSession.json && pubSession.json.code === '0' && pubSession.json.result.revision.id === rev.revisionId, 'public revision session', pubSession.json && pubSession.json.code);
  const pubTask = await api('GET', '/published/revision/' + rev.revisionId + '/task?taskId=' + task.id);
  expect(pubTask.json && pubTask.json.code === '0' && pubTask.json.result.id === task.id, 'public revision task', pubTask.json && pubTask.json.code);
  const pubTree = await api('POST', '/published/revision/' + rev.revisionId + '/workspace/subtree', { body: { targets: [['', 3]] } });
  expect(pubTree.json && pubTree.json.code === '0' && typeof pubTree.json.result.workspaceTreeJson === 'string', 'public revision subtree', 'ok');
  const pubTreeParsed = JSON.parse(pubTree.json.result.workspaceTreeJson);
  expect(JSON.stringify(pubTreeParsed).includes('manuscript.tex'), 'revision snapshot includes workspace files', 'manuscript present');

  const fork = await api('POST', '/published/revision/' + rev.revisionId + '/fork', { token: other.token, body: {} });
  const forkSid = fork.json && fork.json.result && fork.json.result.sessionId;
  expect(fork.json && fork.json.code === '0' && forkSid && forkSid !== sid, 'revision fork returns new sessionId', forkSid);
  const forkedSession = await api('GET', '/chat_session/workspace?chatSessionId=' + forkSid, { token: other.token });
  expect(forkedSession.json.result.workspaceTreeJson.includes('manuscript.tex'), 'fork copied workspace', 'manuscript present');
  const forkRec = (await api('GET', '/chat_session/list', { token: other.token })).json.result.items.find((s) => s.id === forkSid);
  expect(forkRec && forkRec.forkedFromRevisionId === rev.revisionId && forkRec.forkedFromSessionId === sid, 'fork lineage persisted', forkRec && forkRec.forkedFromRevisionId);

  const triggerNoAuth = await api('POST', '/auto_ideaspark/trigger', { body: {} });
  expect(triggerNoAuth.json && triggerNoAuth.json.code === '401', 'auto_ideaspark/trigger auth negative', triggerNoAuth.json && triggerNoAuth.json.code);
  const trigger1 = await api('POST', '/auto_ideaspark/trigger', { token: owner.token, headers: { 'idempotency-key': 'mind-1' }, body: { reason: 'manual' } });
  const trigger2 = await api('POST', '/auto_ideaspark/trigger', { token: owner.token, headers: { 'idempotency-key': 'mind-1' }, body: { reason: 'manual' } });
  expect(trigger1.json.result.triggerId && trigger1.json.result.status === 'queued', 'auto_ideaspark/trigger', trigger1.json.result.triggerId);
  expect(trigger2.json.result.idempotent === true && trigger2.json.result.triggerId === trigger1.json.result.triggerId, 'auto trigger idempotent', trigger2.json.result.triggerId);
  const modify = await api('POST', '/auto_ideaspark/modify', { token: owner.token, body: { idea: { id: 'i1' } } });
  expect(modify.json.result.ok === true, 'auto_ideaspark/modify auth', 'ok');

  const like1 = await api('POST', '/likeTask', { token: owner.token, body: { taskId: task.id, like: true } });
  const like2 = await api('POST', '/likeTask', { token: owner.token, body: { taskId: task.id, like: true } });
  const feedback = await api('GET', '/getTaskFeedback?taskId=' + task.id, { token: owner.token });
  expect(like1.json.result.liked === true && like1.json.result.taskLikeCount === 1, 'likeTask persists user feedback', JSON.stringify(like1.json.result));
  expect(like2.json.result.taskLikeCount === 1, 'likeTask idempotent per user', JSON.stringify(like2.json.result));
  expect(feedback.json.result.taskLikeCount === 1 && feedback.json.result.taskLike === true && feedback.json.result.items[0].taskId === task.id, 'getTaskFeedback persisted counts', JSON.stringify(feedback.json.result));

  const foreignDelete = await api('POST', '/chat_session/delete', { token: other.token, body: { chatSessionId: sid } });
  expect(foreignDelete.json && foreignDelete.json.code === '5200', 'foreign delete denied', foreignDelete.json && foreignDelete.json.code);
  const rename = await api('POST', '/chat_session/rename', { token: owner.token, body: { chatSessionId: sid, title: 'Owner renamed' } });
  expect(rename.json.result.title === 'Owner renamed', 'owner rename succeeds', rename.json.result.title);

  const withdraw = await api('POST', '/published/item/withdraw', { token: owner.token, body: { chatSessionId: sid } });
  expect(withdraw.json && withdraw.json.result.withdrawn === true, '/published/item/withdraw', withdraw.json.result.revisionId);
  const withdrawn = await api('GET', '/published/revision/' + rev.revisionId + '/session');
  expect(withdrawn.json && withdrawn.json.code === '5001', 'withdrawn revision no longer public', withdrawn.json && withdrawn.json.code);
}

main().catch((e) => {
  console.error('HARNESS ERROR', e);
  process.exitCode = 1;
}).finally(() => {
  try { server?.kill('SIGTERM'); } catch {}
  setTimeout(() => {
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {}
    const pass = rows.filter((r) => r.pass).length;
    console.log('SUMMARY parity_backend rows=' + rows.length + ' pass=' + pass);
    process.exit(process.exitCode || 0);
  }, 300);
});

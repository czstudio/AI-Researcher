// test runner
import { spawnSync } from 'node:child_process';
const tests = [
  'server/tests/parity-backend-http.mjs',
  'server/tests/parity-official-sandbox.mjs',
  'server/tests/parity-official-autoresearch.mjs',
  'server/tests/parity-official-team.mjs',
  'server/tests/parity-official-integration.mjs',
  'ops/smoke.mjs',
];
let failed = 0;
for (const file of tests) {
  console.log(String.fromCharCode(10) + '== ' + file + ' ==');
  const r = spawnSync(process.execPath, [file], { stdio: 'inherit', env: { ...process.env, SMOKE_PORT: process.env.SMOKE_PORT || '8146' } });
  if (r.status === 0 ? false : true) failed++;
}
console.log(String.fromCharCode(10) + 'SUMMARY test_files=' + tests.length + ' failed=' + failed);
process.exit(failed ? 1 : 0);

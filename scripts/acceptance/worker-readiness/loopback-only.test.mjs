import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const guard = fileURLToPath(new URL('./loopback-only.cjs', import.meta.url));
function child(source) {
  const result = spawnSync(process.execPath, ['--require', guard, '-e', source], {
    env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
}
test('allows actual loopback TCP with normalized Node arguments', () => {
  child(`const net=require('node:net'); const s=net.createServer(c=>c.end());
    s.listen(0,'127.0.0.1',()=>{ const c=net.connect(s.address().port,'127.0.0.1');
    c.on('close',()=>s.close()); });`);
});
test('blocks non-loopback TCP before opening a socket', () => {
  child(`const assert=require('node:assert/strict'); const net=require('node:net');
    for(const host of ['api.oxy.so','203.0.113.1','169.254.170.2','::ffff:203.0.113.1'])
      assert.throws(()=>net.connect({host,port:443}),/NON_LOOPBACK_DENIED/);`);
});
test('blocks fetch transport egress without replacing fetch', () => {
  child(`fetch('https://api.oxy.so/health').then(()=>process.exit(1)).catch(e=>{
    require('node:assert/strict').match(e.cause.message,/NON_LOOPBACK_DENIED/); });`);
});

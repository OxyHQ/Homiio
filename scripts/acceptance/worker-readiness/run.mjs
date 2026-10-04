import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(resolve(root, 'packages/backend/package.json'));
const { Queue } = require('bullmq');
const postgres = require('postgres');
const output = resolve(process.argv[2] || '');
assert(process.argv[2], 'provide a new private output directory');
await mkdir(output, { mode: 0o700 }); // Refuse reuse, including a partial prior run.
const env = { PATH: process.env.PATH, HOME: output, LANG: 'C.UTF-8' };
const result = { source: '4d9e1ed843be0d22ec360933b76ccf63cb3c26ec', checks: {}, cleanup: {} };
const run = (cmd, args, extra = {}) => {
  const r = spawnSync(cmd, args, { env, encoding: 'utf8', timeout: 30_000, ...extra });
  if (r.status !== 0) throw new Error(`fixture command failed: ${cmd} (${r.status})`);
  return r.stdout.trim();
};
const freePort = async () => {
  const server = net.createServer();
  await new Promise((ok, no) => server.once('error', no).listen(0, '127.0.0.1', ok));
  const port = server.address().port;
  await new Promise(ok => server.close(ok));
  return port;
};
const pgBin = run('pg_config', ['--bindir']);
const pgPort = await freePort();
const redisPort = await freePort();
const pgDir = resolve(output, 'pg');
let pgStarted = false, redis, worker, sql, server;
const queues = [], requests = [];
let workerLog = '', redisLog = '', workerExit;
const until = async (condition, ms = 20_000) => {
  const stop = Date.now() + ms;
  while (!await condition()) {
    assert(Date.now() < stop, 'fixture observation deadline exceeded');
    await new Promise(ok => setTimeout(ok, 100));
  }
};
const stopChild = async child => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  try { await until(() => child.exitCode !== null || child.signalCode !== null, 10_000); }
  catch (error) { child.kill('SIGKILL'); await until(() => child.signalCode !== null, 5_000); throw error; }
};
try {
  run(`${pgBin}/initdb`, ['-D', pgDir, '-A', 'trust', '--no-locale']);
  run(`${pgBin}/pg_ctl`, ['-D', pgDir, '-l', resolve(output, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${pgPort} -k ${output}`, '-w', 'start']);
  pgStarted = true;
  const database = `homiio_worker_${randomUUID().replaceAll('-', '')}`;
  run(`${pgBin}/createdb`, ['-h', '127.0.0.1', '-p', String(pgPort), database]);
  const dbUrl = `postgresql://${process.env.USER}@127.0.0.1:${pgPort}/${database}`;
  sql = postgres(dbUrl);
  const tableCount = async () => Number((await sql`select count(*) n from pg_tables where schemaname='public'`)[0].n);
  assert.equal(await tableCount(), 0);
  redis = spawn('redis-server', ['--bind', '127.0.0.1', '--port', String(redisPort), '--save', '', '--appendonly', 'no', '--dir', output], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [redis.stdout, redis.stderr]) stream.on('data', x => { redisLog += x; });
  await until(() => redisLog.includes('Ready to accept connections'));
  const prefix = `homiio-fixture-${randomUUID()}`;
  for (const name of ['listing-discover', 'listing-fetch']) queues.push(new Queue(name, { connection: { host: '127.0.0.1', port: redisPort }, prefix }));
  server = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      assert.equal(req.method, 'POST');
      if (req.url === '/auth/service-token') {
        assert.deepEqual(body, { apiKey: 'fixture-activity-key', apiSecret: 'fixture-activity-secret' });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ data: { token: 'fixture-only-token', expiresIn: 300, appName: 'Fixture' } }));
      } else {
        assert(['/internal/activity', '/internal/activity/infrastructure'].includes(req.url));
        assert.equal(req.headers.authorization, 'Bearer fixture-only-token');
        requests.push({ path: req.url, body });
        res.end('{}');
      }
    } catch { res.statusCode = 400; res.end('{}'); requests.push({ rejected: true }); }
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const entry = resolve(root, 'packages/backend/dist/worker.js');
  result.workerSha256 = createHash('sha256').update(await readFile(entry)).digest('hex');
  worker = spawn(process.execPath, ['--require', resolve(root, 'scripts/acceptance/worker-readiness/loopback-only.cjs'), entry], { cwd: output, env: {
    ...env, NODE_ENV: 'test', DOTENV_CONFIG_PATH: '/dev/null', DATABASE_URL: dbUrl,
    REDIS_URL: `redis://127.0.0.1:${redisPort}`, LISTING_QUEUE_PREFIX: prefix,
    LISTING_DISCOVER_ON_BOOT: 'false', LISTING_DISCOVER_INTERVAL_HOURS: '0', LISTING_BROWSER_ENABLED: 'false',
    OXY_API_URL: `http://127.0.0.1:${server.address().port}`, AWS_REGION: 'us-west-2',
    OXY_ACTIVITY_API_KEY: 'fixture-activity-key', OXY_ACTIVITY_API_SECRET: 'fixture-activity-secret',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.on('exit', (code, signal) => { workerExit = { code, signal }; });
  for (const stream of [worker.stdout, worker.stderr]) stream.on('data', x => { workerLog += x; });
  await until(() => {
    assert(!workerExit, 'worker exited before readiness');
    return workerLog.includes('Listing worker connected to database') && workerLog.includes('Listing worker started on BullMQ');
  });
  await until(async () => (await Promise.all(queues.map(q => q.getWorkers()))).every(x => x.length === 1));
  result.checks.databaseAndTwoBullMqConsumers = true;
  await until(() => requests.some(x => x.path === '/internal/activity/infrastructure' && x.body.status === 'online' && !x.body.removed));
  result.checks.infrastructureHeartbeat = true;
  for (const q of queues) assert.equal(await q.count(), 0);
  assert.equal(await tableCount(), 0);
  assert(!workerLog.includes('LISTING_INGEST_OK'));
  assert(!requests.some(x => x.rejected));
  result.checks.noJobsOrDomainWrites = true;
  await stopChild(worker);
  assert.equal(workerExit.code, 0);
  assert(requests.some(x => x.path === '/internal/activity/infrastructure' && x.body.removed === true));
  await until(async () => (await Promise.all(queues.map(q => q.getWorkers()))).every(x => x.length === 0));
  result.checks.sigtermRetiresHeartbeatAndConsumers = true;
  result.pass = true;
} catch (error) {
  result.pass = false; result.failure = error.message;
} finally {
  for (const [key, action] of [
    ['worker', () => stopChild(worker)],
    ['queues', () => Promise.all(queues.map(q => q.close()))],
    ['postgresClient', () => sql?.end({ timeout: 2 })],
    ['http', () => server && new Promise(ok => server.close(ok))],
    ['redis', () => stopChild(redis)],
    ['postgres', () => pgStarted && run(`${pgBin}/pg_ctl`, ['-D', pgDir, '-m', 'fast', '-w', 'stop'])],
  ]) { try { await action(); result.cleanup[key] = true; } catch { result.cleanup[key] = false; result.pass = false; } }
  await writeFile(resolve(output, 'worker.log'), workerLog, { mode: 0o600 });
  await writeFile(resolve(output, 'redis.log'), redisLog, { mode: 0o600 });
  await writeFile(resolve(output, 'observations.json'), JSON.stringify(requests, null, 2), { mode: 0o600 });
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
}
console.log(JSON.stringify(result));
if (!result.pass) process.exitCode = 1;

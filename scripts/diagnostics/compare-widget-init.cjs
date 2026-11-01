const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const entries = ['BaseWidget', 'FeaturedPropertiesWidget', 'NeighbourSupportWidget', 'MissionWidget', 'SavedSearchesWidget', 'PropertyAlertWidget', 'NeighborhoodRatingWidget', 'RecentlyViewedWidget', 'PropertyPreviewWidget', 'PropertyBookingWidget', 'WidgetManager'];
const roots = ['base', 'candidate'];
const files = [...entries.map((name) => `${name}.tsx`), 'index.ts', 'screenIds.ts'];
if (process.argv[2] === 'instrument') {
  for (const root of roots) for (const file of files) {
    const target = path.join(root, 'packages/frontend/components/widgets', file);
    fs.appendFileSync(target, `\n;globalThis.__widgetInitOrder?.push(${JSON.stringify(file)});\n`);
  }
  console.log('Instrumented CI-local copies only');
  process.exit(0);
}
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
function sources(dir) {
  const result = new Set();
  function visit(map) {
    if (Array.isArray(map.sections)) for (const section of map.sections) {
      if (!section.map) throw new Error('Unresolved indexed source-map section');
      visit(section.map);
    }
    for (const name of map.sources ?? []) if (name.includes('/components/widgets/')) result.add(name.slice(name.indexOf('/components/widgets/') + 1));
  }
  const maps = walk(dir).filter((file) => file.endsWith('.js.map'));
  assert.ok(maps.length, `No source maps in ${dir}`);
  for (const file of maps) visit(JSON.parse(fs.readFileSync(file, 'utf8')));
  return result;
}
async function render(dir) {
  const root = path.resolve(dir);
  const errors = [];
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = path.resolve(root, `.${pathname}`);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) return res.writeHead(403).end();
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
    let body = fs.readFileSync(file);
    if (file.endsWith('.html')) {
      const hook = `<script>globalThis.__widgetInitOrder=[];window.addEventListener('error',()=>document.documentElement.dataset.widgetError='1',true);window.addEventListener('unhandledrejection',()=>document.documentElement.dataset.widgetError='1');window.addEventListener('load',()=>setTimeout(()=>{document.documentElement.dataset.widgetInit=globalThis.__widgetInitOrder.join('|');document.documentElement.dataset.widgetMounted=String(Boolean(document.getElementById('root')?.firstElementChild))},5000));</script>`;
      body = Buffer.from(body.toString().replace('<head>', `<head>${hook}`));
    }
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const chrome = process.env.CHROME_PATH;
    assert.ok(chrome, 'CHROME_PATH missing');
    const child = spawn(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost', '--virtual-time-budget=10000', '--dump-dom', `http://127.0.0.1:${server.address().port}/`]);
    let dom = '';
    child.stdout.on('data', (chunk) => { dom += chunk; });
    child.stderr.on('data', (chunk) => { if (errors.length < 8) errors.push(String(chunk)); });
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Chrome timed out')); }, 45000);
      child.on('error', reject);
      child.on('exit', (status) => { clearTimeout(timer); resolve(status); });
    });
    assert.equal(code, 0, errors.join(''));
    assert.ok(dom.includes('data-widget-mounted="true"'), 'App did not mount');
    assert.ok(!dom.includes('data-widget-error="1"'), 'Captured browser error');
    const match = dom.match(/data-widget-init="([^"]*)"/);
    assert.ok(match, 'No widget initialization record');
    return match[1].split('|').filter(Boolean);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
(async () => {
  const base = sources('base/packages/frontend/dist');
  const candidate = sources('candidate/packages/frontend/dist');
  const difference = (a,b) => [...a].filter((item) => !b.has(item)).sort();
  const removed = difference(base,candidate);
  const added = difference(candidate,base);
  console.log('Widget source map removed:', JSON.stringify(removed));
  console.log('Widget source map added:', JSON.stringify(added));
  assert.deepEqual(added, []);
  for (const item of removed) assert.ok(/\/widgets\/(index|screenIds)\.ts$/.test(item), `Unexpected removed source ${item}`);
  const baseOrder = await render('base/packages/frontend/dist');
  const candidateOrder = await render('candidate/packages/frontend/dist');
  const shared = (order) => order.filter((item) => entries.some((name) => item === `${name}.tsx`));
  console.log('Baseline widget initialization:', JSON.stringify(baseOrder));
  console.log('Candidate widget initialization:', JSON.stringify(candidateOrder));
  assert.equal(new Set(shared(baseOrder)).size, entries.length, 'Baseline did not initialize every shared widget');
  assert.deepEqual(shared(candidateOrder), shared(baseOrder), 'Shared widget initialization order changed');
  console.log('Source map and observed web initialization order agree for all shared widget modules');
})().catch((error) => { console.error(error); process.exitCode = 1; });

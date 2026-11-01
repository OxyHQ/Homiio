const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(process.argv[2]);
const chrome = process.env.CHROME_PATH;
if (!chrome) throw new Error('CHROME_PATH is required');
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(`${root}${path.sep}`) && file !== root) { res.writeHead(403).end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  let body = fs.readFileSync(file);
  if (file.endsWith('.html')) {
    const hook = `<script>
      window.addEventListener('error', e => { document.documentElement.dataset.smokeError = '1'; console.error('SMOKE_ERROR', e.message || e.target?.src || 'resource'); }, true);
      window.addEventListener('unhandledrejection', e => { document.documentElement.dataset.smokeError = '1'; console.error('SMOKE_REJECTION', String(e.reason)); });
      window.addEventListener('load', () => setTimeout(() => { document.documentElement.dataset.smokeMounted = String(Boolean(document.getElementById('root')?.firstElementChild)); }, 5000));
      ${process.env.SMOKE_FORCE_ERROR ? "setTimeout(() => { throw new Error('deliberate smoke error'); }, 0);" : ''}
    </script>`;
    body = Buffer.from(body.toString().replace('<head>', `<head>${hook}`));
  }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  res.end(body);
});
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const child = spawn(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost', '--virtual-time-budget=8000', '--dump-dom', `http://127.0.0.1:${port}/`]);
  let dom = '';
  child.stdout.on('data', chunk => { dom += chunk; });
  child.stderr.resume();
  child.on('exit', code => {
    try {
      assert.equal(code, 0);
      assert.ok(dom.includes('data-smoke-mounted="true"'), 'Expected app content inside the Expo root');
      assert.ok(!dom.includes('data-smoke-error="1"'), 'A JavaScript or resource error occurred');
      console.log('Headless production web bootstrap: root has content and no captured errors');
      server.close();
    } catch (error) {
      console.error(error.message);
      server.close(() => process.exit(1));
    }
  });
});

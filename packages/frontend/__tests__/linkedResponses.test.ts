/** @jest-environment ./test/http-environment.cjs */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OxyServices } from '@oxy.so/core';
import { createSindiLinkedFetch } from '../hooks/sindiLinkedFetch';

let mockOrigin = '';
jest.mock('@/config', () => ({ API_URL: mockOrigin }));
let server: Server;
let apiModule: typeof import('../utils/api');
const envelope = { success: true, message: 'kept', data: [{ id: 'home' }], deleted: ['old'], serverTime: 'fixture-time' };
const seen: { url?: string; bearer?: string; body: string; contentType?: string }[] = [];
beforeAll(async () => {
  Object.assign(globalThis, Reflect.get(globalThis, '__realHttp'));

  server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += String(chunk);
    seen.push({ url: req.url, bearer: req.headers.authorization, body, contentType: req.headers['content-type'] });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/sse') { res.writeHead(200); res.write('data: first\n\n'); return; }
    if (req.url === '/401' || (req.url === '/refresh' && req.headers.authorization === `Bearer ${token('old')}`)) {
      res.writeHead(401); res.end('{"error":"expired"}'); return;
    }
    if (req.url === '/consent') { res.writeHead(403); res.end('{"code":"SERVICE_ACTING_AS_UNAUTHORIZED"}'); return; }
    if (req.url === '/denied') { res.writeHead(403); res.end('{"error":"Forbidden","details":{"reason":"fixture"}}'); return; }
    if (req.url === '/html') { res.writeHead(404); res.end('<html>private proxy text</html>'); return; }
    res.end(JSON.stringify(envelope));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  mockOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  apiModule = jest.requireActual<typeof import('../utils/api')>('../utils/api');
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
it('retains the actual public envelope without reconstructing success or losing fields', async () => {
  const oxy = new OxyServices({ baseURL: mockOrigin });
  apiModule.bindApiToOxy(oxy);
  expect(await apiModule.api.get('/public', { params: { q: 'a & b' }, requireAuth: false })).toEqual({ data: envelope });
  expect(seen.at(-1)?.bearer).toBeUndefined();
  expect(new URL(seen.at(-1)?.url ?? '/', mockOrigin).searchParams.get('q')).toBe('a & b');
});

function token(nonce: string): string {
  return `e30.${Buffer.from(JSON.stringify({ userId: 'fixture-user', sessionId: 'fixture-session', nonce, exp: 2_000_000_000 })).toString('base64url')}.fixture`;
}
function signedFixture() {
  const oxy = new OxyServices({ baseURL: mockOrigin });
  oxy.session.setAccessToken(token('old'));
  const linked = oxy.createLinkedClient({ baseURL: mockOrigin });
  return { oxy, linked };
}
it('denies required API calls before transport and preserves structured and non-JSON statuses', async () => {
  const oxy = new OxyServices({ baseURL: mockOrigin }); apiModule.bindApiToOxy(oxy);
  const before = seen.length;
  await expect(apiModule.api.post('/private', {}, { requireAuth: true })).rejects.toThrow('active Oxy session');
  expect(seen).toHaveLength(before);
  await expect(apiModule.api.get('/denied')).rejects.toMatchObject({ status: 403, response: { error: 'Forbidden', details: { reason: 'fixture' } } });
  await expect(apiModule.api.get('/html')).rejects.toMatchObject({ status: 404, message: 'Request failed with status 404', response: null });
});
it('preserves API multipart bodies and their generated boundary', async () => {
  const oxy = new OxyServices({ baseURL: mockOrigin }); apiModule.bindApiToOxy(oxy);
  const form = new FormData(); form.append('file', new Blob(['fixture upload']), 'fixture.txt');
  expect(await apiModule.api.post('/upload', form)).toEqual({ data: envelope });
  expect(seen.at(-1)?.contentType).toMatch(/^multipart\/form-data; boundary=/);
  expect(seen.at(-1)?.body).toContain('fixture upload');
});
it('delegates a replayable Sindi request to SDK refresh once with intact JSON', async () => {
  const { oxy, linked } = signedFixture();
  try {
    const refresh = jest.fn(async () => token('new')); oxy.http.setAuthRefreshHandler(refresh);
    const transport = jest.fn((url: string, init: RequestInit) => fetch(url, init));
    const send = createSindiLinkedFetch(linked.client, transport); const before = seen.length;
    const response = await send(`${mockOrigin}/refresh`, { method: 'POST', body: '{"intent":"same"}', headers: { Authorization: 'Bearer forged' } });
    expect(response.bodyUsed).toBe(false); expect(await response.json()).toEqual(envelope);
    expect(seen.slice(before).map(({ body }) => body)).toEqual(['{"intent":"same"}', '{"intent":"same"}']);
    expect(seen.at(-1)?.bearer).toBe(`Bearer ${token('new')}`);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit', redirect: 'error' });
  } finally { linked.dispose(); }
});
it('forwards multipart through the chosen platform transport without retrying it', async () => {
  const { oxy, linked } = signedFixture();
  try {
    const refresh = jest.fn(async () => token('new')); oxy.http.setAuthRefreshHandler(refresh);
    const transport = jest.fn((url: string, init: RequestInit) => fetch(url, init));
    const send = createSindiLinkedFetch(linked.client, transport);
    const form = new FormData(); form.append('file', new Blob(['sindi document']), 'fixture.txt');
    const response = await send(`${mockOrigin}/401`, { method: 'POST', body: form, headers: { 'Content-Type': 'application/json' } });
    expect(response.status).toBe(401); await response.body?.cancel();
    expect(transport).toHaveBeenCalledTimes(1); expect(refresh).not.toHaveBeenCalled();
    expect(transport.mock.calls[0]?.[1]?.body).toBe(form);
    expect(seen.at(-1)?.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(seen.at(-1)?.body).toContain('sindi document');
  } finally { linked.dispose(); }
});
it('preserves consent classification, other error bodies, stream cancellation and same-origin denial', async () => {
  const { linked } = signedFixture();
  try {
    const send = createSindiLinkedFetch(linked.client, (url, init) => fetch(url, init));
    await expect(send(`${mockOrigin}/consent`)).rejects.toMatchObject({ code: 'SERVICE_ACTING_AS_UNAUTHORIZED' });
    const denied = await send(`${mockOrigin}/denied`); expect(denied.bodyUsed).toBe(false);
    expect(await denied.json()).toEqual({ error: 'Forbidden', details: { reason: 'fixture' } });
    const controller = new AbortController();
    const stream = await send(`${mockOrigin}/sse`, { signal: controller.signal });
    const pending = stream.text(); controller.abort(); await expect(pending).rejects.toThrow();
    const before = seen.length;
    await expect(send('http://localhost:1/foreign')).rejects.toThrow('configured API origin');
    expect(seen).toHaveLength(before);
  } finally { linked.dispose(); }
});
it('does not dispatch Sindi without a session', async () => {
  const oxy = new OxyServices({ baseURL: mockOrigin }); const linked = oxy.createLinkedClient({ baseURL: mockOrigin });
  try {
    const transport = jest.fn((url: string, init: RequestInit) => fetch(url, init));
    await expect(createSindiLinkedFetch(linked.client, transport)(`${mockOrigin}/private`)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(transport).not.toHaveBeenCalled();
  } finally { linked.dispose(); }
});

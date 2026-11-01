/** @jest-environment ./test/http-environment.cjs */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OxyServices } from '@oxy.so/core';

let mockOrigin = '';
jest.mock('@/config', () => ({ API_URL: mockOrigin }));
let server: Server;
let apiModule: typeof import('../utils/api');
let unavailable = false;
const envelope = {
  success: true,
  message: 'kept',
  data: [{ id: 'home' }],
  deleted: ['old'],
  serverTime: 'fixture-time',
};
const seen: { url?: string; bearer?: string; body: string; contentType?: string }[] = [];
beforeAll(async () => {
  Object.assign(globalThis, Reflect.get(globalThis, '__realHttp'));

  server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += String(chunk);
    seen.push({
      url: req.url,
      bearer: req.headers.authorization,
      body,
      contentType: req.headers['content-type'],
    });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/private-outage' && unavailable) {
      res.writeHead(503);
      res.end('{"error":"service_unavailable"}');
      return;
    }
    if (req.url === '/denied') {
      res.writeHead(403);
      res.end('{"error":"Forbidden","details":{"reason":"fixture"}}');
      return;
    }
    if (req.url === '/html') {
      res.writeHead(404);
      res.end('<html>private proxy text</html>');
      return;
    }
    res.end(JSON.stringify(envelope));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  mockOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  apiModule = jest.requireActual<typeof import('../utils/api')>('../utils/api');
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
it('retains the actual public envelope without reconstructing success or losing fields', async () => {
  const oxy = new OxyServices({ baseURL: mockOrigin });
  apiModule.bindApiToOxy(oxy);
  expect(
    await apiModule.api.get('/public', { params: { q: 'a & b' }, requireAuth: false }),
  ).toEqual({ data: envelope });
  expect(seen.at(-1)?.bearer).toBeUndefined();
  expect(new URL(seen.at(-1)?.url ?? '/', mockOrigin).searchParams.get('q')).toBe('a & b');
});

it('denies required API calls before transport and preserves structured and non-JSON statuses', async () => {
  const oxy = new OxyServices({ baseURL: mockOrigin });
  apiModule.bindApiToOxy(oxy);
  const before = seen.length;
  await expect(apiModule.api.post('/private', {}, { requireAuth: true })).rejects.toThrow(
    'active Oxy session',
  );
  expect(seen).toHaveLength(before);
  await expect(apiModule.api.get('/denied')).rejects.toMatchObject({
    status: 403,
    response: { error: 'Forbidden', details: { reason: 'fixture' } },
  });
  await expect(apiModule.api.get('/html')).rejects.toMatchObject({
    status: 404,
    message: 'Request failed with status 404',
    response: null,
  });
});
it('preserves API multipart bodies and their generated boundary', async () => {
  const oxy = new OxyServices({ baseURL: mockOrigin });
  apiModule.bindApiToOxy(oxy);
  const form = new FormData();
  form.append('file', new Blob(['fixture upload']), 'fixture.txt');
  expect(await apiModule.api.post('/upload', form)).toEqual({ data: envelope });
  expect(seen.at(-1)?.contentType).toMatch(/^multipart\/form-data; boundary=/);
  expect(seen.at(-1)?.body).toContain('fixture upload');
});

it('retains the same bearer when a protected request recovers from a 503', async () => {
  const oxy = new OxyServices({ baseURL: mockOrigin });
  const token = `h.${Buffer.from(JSON.stringify({ userId: 'fixture', sessionId: 'session-fixture', exp: 4102444800 })).toString('base64url')}.s`;
  oxy.session.setAccessToken(token);
  apiModule.bindApiToOxy(oxy);
  unavailable = true;
  try {
    await expect(apiModule.api.get('/private-outage', { requireAuth: true })).rejects.toMatchObject(
      {
        status: 503,
        response: { error: 'service_unavailable' },
      },
    );
    expect(oxy.session.accessToken).toBe(token);
    unavailable = false;
    expect(await apiModule.api.get('/private-outage', { requireAuth: true })).toEqual({
      data: envelope,
    });
    expect(seen.slice(-2).map((request) => request.bearer)).toEqual([
      `Bearer ${token}`,
      `Bearer ${token}`,
    ]);
  } finally {
    unavailable = false;
    oxy.dispose();
  }
});

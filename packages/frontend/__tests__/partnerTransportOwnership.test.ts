/** @jest-environment ./test/http-environment.cjs */
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OxyServices } from '@oxy.so/core';

let mockOrigin = '';
jest.mock('@/config', () => ({ API_URL: mockOrigin }));

const jwt = (userId: string, nonce = 'first') =>
  `h.${Buffer.from(JSON.stringify({ userId, sessionId: `session-${userId}`, exp: 4102444800, nonce })).toString('base64url')}.s`;
const payload = { success: true, data: { partner: { id: 'A' }, link: 'a', stats: {} } };
let server: Server;
let apiModule: typeof import('../utils/api');
let partnerApi: typeof import('../services/partnerApi').partnerApi;
let oxy: OxyServices;
let seen: string[] = [];
let hold: ((response: ServerResponse) => void) | null = null;

beforeAll(async () => {
  Object.assign(globalThis, Reflect.get(globalThis, '__realHttp'));
  server = createServer((req, res) => {
    seen.push(req.headers.authorization ?? '');
    res.setHeader('Content-Type', 'application/json');
    if (hold) hold(res);
    else res.end(JSON.stringify(payload));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  mockOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  apiModule = jest.requireActual<typeof import('../utils/api')>('../utils/api');
  partnerApi =
    jest.requireActual<typeof import('../services/partnerApi')>(
      '../services/partnerApi',
    ).partnerApi;
});
beforeEach(() => {
  seen = [];
  hold = null;
  oxy = new OxyServices({ baseURL: mockOrigin });
  oxy.session.setAccessToken(jwt('A'));
  apiModule.bindApiToOxy(oxy);
});
afterEach(() => oxy.dispose());
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const owner = () => ({ oxyServices: oxy, userId: 'A', epoch: oxy.http.getSessionEpoch() });

it('rejects a different bearer before sending a private partner read or join', async () => {
  const expected = owner();
  oxy.session.setAccessToken(jwt('B'));
  await expect(partnerApi.getMe(expected)).rejects.toThrow('The active account changed');
  await expect(partnerApi.join(expected)).rejects.toThrow('The active account changed');
  expect(seen).toEqual([]);
});

it('rejects an owner from a provider no longer bound to the API client', async () => {
  const expected = owner();
  const replacement = new OxyServices({ baseURL: mockOrigin });
  replacement.session.setAccessToken(jwt('A'));
  try {
    apiModule.bindApiToOxy(replacement);
    await expect(partnerApi.getMe(expected)).rejects.toThrow('The active account changed');
    expect(seen).toEqual([]);
  } finally {
    replacement.dispose();
  }
});

it.each([false, true])('rejects an A response after B and return to A: %s', async (aba) => {
  let started!: (response: ServerResponse) => void;
  const request = new Promise<ServerResponse>((resolve) => {
    started = resolve;
  });
  hold = started;
  const pending = partnerApi.getMe(owner());
  const rejected = expect(pending).rejects.toThrow();
  const response = await request;
  oxy.session.setAccessToken(jwt('B'));
  if (aba) oxy.session.setAccessToken(jwt('A', 'returned'));
  response.end(JSON.stringify(payload));
  await rejected;
  expect(seen).toEqual([`Bearer ${jwt('A')}`]);
});

it('allows a same-session bearer refresh to complete the read', async () => {
  let started!: (response: ServerResponse) => void;
  const request = new Promise<ServerResponse>((resolve) => {
    started = resolve;
  });
  hold = started;
  const pending = partnerApi.getMe(owner());
  const response = await request;
  oxy.session.setAccessToken(jwt('A', 'refreshed'));
  response.end(JSON.stringify(payload));
  await expect(pending).resolves.toEqual(payload.data);
  expect(seen).toEqual([`Bearer ${jwt('A')}`]);
});

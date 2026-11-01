/** @jest-environment ./test/http-environment.cjs */
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OxyServices } from '@oxy.so/core';

let mockOrigin = '';
jest.mock('@/config', () => ({ API_URL: mockOrigin }));
const token = (id: string) =>
  `h.${Buffer.from(JSON.stringify({ userId: id, sessionId: `session-${id}`, exp: 4102444800 })).toString('base64url')}.s`;
let server: Server;
let oxy: OxyServices;
let bind: typeof import('../utils/api').bindApiToOxy;
let service: typeof import('../services/roommateService').roommateService;
let seen: string[] = [];
let hold: ((response: ServerResponse) => void) | null = null;
let body: unknown;

beforeAll(async () => {
  Object.assign(globalThis, Reflect.get(globalThis, '__realHttp'));
  server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url} ${req.headers.authorization ?? ''}`);
    res.setHeader('Content-Type', 'application/json');
    if (hold) hold(res);
    else res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  mockOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ({ bindApiToOxy: bind } = jest.requireActual('../utils/api'));
  ({ roommateService: service } = jest.requireActual('../services/roommateService'));
});
beforeEach(() => {
  seen = [];
  hold = null;
  body = { success: true, data: { budget: { min: 1234 } }, hasRoommateMatching: true };
  oxy = new OxyServices({ baseURL: mockOrigin });
  oxy.session.setAccessToken(token('A'));
  bind(oxy);
});
afterEach(() => oxy.dispose());
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const owner = () => ({ oxyServices: oxy, userId: 'A', epoch: oxy.http.getSessionEpoch() });

it('uses the captured owner for preference and status reads and the save', async () => {
  const current = owner();
  await expect(service.getMyRoommatePreferences(undefined, undefined, current)).resolves.toEqual({
    budget: { min: 1234 },
  });
  await expect(service.getMyRoommateStatus(undefined, undefined, current)).resolves.toEqual({
    hasRoommateMatching: true,
  });
  await service.updateRoommatePreferences({ budget: { min: 1234, max: 2345 } }, true, current);
  expect(seen.map((value) => value.split(' Bearer ')[0])).toEqual([
    'GET /api/roommates/preferences',
    'GET /api/roommates/status',
    'PUT /api/roommates/preferences',
  ]);
  expect(seen.every((value) => value.endsWith(`Bearer ${token('A')}`))).toBe(true);
});

it('rejects all three operations after the bearer changes before sending', async () => {
  const current = owner();
  oxy.session.setAccessToken(token('B'));
  await expect(service.getMyRoommatePreferences(undefined, undefined, current)).rejects.toThrow();
  await expect(service.getMyRoommateStatus(undefined, undefined, current)).rejects.toThrow();
  await expect(
    service.updateRoommatePreferences({ budget: { min: 1, max: 2 } }, true, current),
  ).rejects.toThrow();
  expect(seen).toEqual([]);
});

it.each([false, true])('rejects a late preference response after B, ABA=%s', async (aba) => {
  let release!: (response: ServerResponse) => void;
  const started = new Promise<ServerResponse>((resolve) => {
    release = resolve;
  });
  hold = release;
  const pending = service.getMyRoommatePreferences(undefined, undefined, owner());
  const rejected = expect(pending).rejects.toThrow();
  const response = await started;
  oxy.session.setAccessToken(token('B'));
  if (aba) oxy.session.setAccessToken(token('A'));
  response.end(JSON.stringify({ success: true, data: { budget: { min: 1234 } } }));
  await rejected;
  expect(seen).toHaveLength(1);
});

it('rejects malformed owned reads rather than overwriting existing settings', async () => {
  body = { success: true };
  await expect(service.getMyRoommatePreferences(undefined, undefined, owner())).rejects.toThrow(
    'Invalid roommate preferences response',
  );
  await expect(service.getMyRoommateStatus(undefined, undefined, owner())).rejects.toThrow(
    'Invalid roommate status response',
  );
  body = { data: null };
  await expect(service.getMyRoommatePreferences(undefined, undefined, owner())).resolves.toBeNull();
});

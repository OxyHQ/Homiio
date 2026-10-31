/** @jest-environment ./test/http-environment.cjs */
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OxyServices } from '@oxy.so/core';

let mockOrigin = '';
jest.mock('@/config', () => ({ API_URL: mockOrigin }));
const jwt = (userId: string, nonce = 'first') =>
  `h.${Buffer.from(JSON.stringify({ userId, sessionId: `session-${userId}`, exp: 4102444800, nonce })).toString('base64url')}.s`;
let server: Server;
let apiModule: typeof import('../utils/api');
let saved: typeof import('../services/savedPropertyService').default;
let folders: typeof import('../services/savedPropertyFolderService').default;
let oxy: OxyServices;
let seen: string[] = [];
let hold: ((response: ServerResponse) => void) | null = null;
const payload = { success: true, data: [] };

beforeAll(async () => {
  Object.assign(globalThis, Reflect.get(globalThis, '__realHttp'));
  server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url} ${req.headers.authorization ?? ''}`);
    res.setHeader('Content-Type', 'application/json');
    if (hold) hold(res);
    else res.end(JSON.stringify(payload));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  mockOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  apiModule = jest.requireActual<typeof import('../utils/api')>('../utils/api');
  saved = jest.requireActual<typeof import('../services/savedPropertyService')>(
    '../services/savedPropertyService',
  ).default;
  folders = jest.requireActual<typeof import('../services/savedPropertyFolderService')>(
    '../services/savedPropertyFolderService',
  ).default;
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

it('rejects stale-owner saved reads and writes before they reach the server', async () => {
  const expected = owner();
  oxy.session.setAccessToken(jwt('B'));
  const operations = [
    saved.getSavedProperties(expected),
    saved.saveProperty(expected, 'home'),
    saved.unsaveProperty(expected, 'home'),
    saved.updateNotes(expected, 'home', 'notes'),
    folders.getSavedPropertyFolders(expected),
    folders.createSavedPropertyFolder(expected, { name: 'folder' }),
    folders.updateSavedPropertyFolder(expected, 'folder', { name: 'renamed' }),
    folders.deleteSavedPropertyFolder(expected, 'folder'),
  ];
  await Promise.all(
    operations.map((operation) => expect(operation).rejects.toThrow('The active account changed')),
  );
  expect(seen).toEqual([]);
});

it('permits matching-owner saved reads', async () => {
  await expect(saved.getSavedProperties(owner())).resolves.toMatchObject({ properties: [] });
  expect(seen).toEqual([`GET /api/profiles/me/saved-properties Bearer ${jwt('A')}`]);
});

it.each([false, true])('rejects a saved response after B and return to A: %s', async (aba) => {
  let started!: (response: ServerResponse) => void;
  const request = new Promise<ServerResponse>((resolve) => {
    started = resolve;
  });
  hold = started;
  const pending = saved.getSavedProperties(owner());
  const rejected = expect(pending).rejects.toThrow();
  const response = await request;
  oxy.session.setAccessToken(jwt('B'));
  if (aba) oxy.session.setAccessToken(jwt('A', 'returned'));
  response.end(JSON.stringify(payload));
  await rejected;
  expect(seen).toEqual([`GET /api/profiles/me/saved-properties Bearer ${jwt('A')}`]);
});

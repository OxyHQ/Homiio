/** @jest-environment ./test/http-environment.cjs */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { StrictMode } from 'react';
import { renderHook } from '@testing-library/react-native';
import { OxyServices } from '@oxy.so/core';
import { useSindiAuthenticatedFetch } from '../hooks/useSindiAuthenticatedFetch';

let mockOrigin = '';
let mockOxy: OxyServices;
let mockSession = 'A';
jest.mock('@/config', () => ({ get API_URL() { return mockOrigin; } }));
jest.mock('@oxy.so/services', () => ({ useOxy: () => ({ oxyServices: mockOxy, activeSessionId: mockSession }) }));
jest.mock('expo/fetch', () => ({ fetch: (input: string, init: RequestInit) => globalThis.fetch(input, init) }));
let server: Server;
const seen: string[] = [];
function token(id: string): string {
  return `e30.${Buffer.from(JSON.stringify({ userId: id, sessionId: `session-${id}`, exp: 2_000_000_000 })).toString('base64url')}.fixture`;
}
beforeAll(async () => {
  Object.assign(globalThis, Reflect.get(globalThis, '__realHttp'));
  server = createServer((req, res) => { seen.push(req.headers.authorization ?? ''); res.end('{"ok":true}'); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  mockOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
function watch(oxy: OxyServices) {
  const original = oxy.createLinkedClient.bind(oxy);
  const disposals: jest.SpyInstance[] = [];
  const created = jest.spyOn(oxy, 'createLinkedClient').mockImplementation((config) => {
    const linked = original(config); disposals.push(jest.spyOn(linked, 'dispose')); return linked;
  });
  return { created, disposals };
}
it('survives StrictMode effect replay and disposes every subscription on unmount', async () => {
  mockOxy = new OxyServices({ baseURL: mockOrigin }); mockOxy.session.setAccessToken(token('A'));
  const watched = watch(mockOxy);
  const hook = renderHook(() => useSindiAuthenticatedFetch(), { wrapper: StrictMode });
  try {
    expect(await (await hook.result.current(mockOrigin)).json()).toEqual({ ok: true });
    expect(seen.at(-1)).toBe(`Bearer ${token('A')}`);
  } finally { hook.unmount(); }
  expect(watched.created.mock.calls.length).toBeGreaterThanOrEqual(2);
  for (const dispose of watched.disposals) expect(dispose).toHaveBeenCalledTimes(1);
});
it('follows a replacement Oxy owner and closes previous/unmounted linked clients', async () => {
  const first = new OxyServices({ baseURL: mockOrigin }); first.session.setAccessToken(token('A')); mockOxy = first;
  const firstWatch = watch(first);
  const hook = renderHook(() => useSindiAuthenticatedFetch());
  const second = new OxyServices({ baseURL: mockOrigin }); second.session.setAccessToken(token('B')); const secondWatch = watch(second);
  try {
    await (await hook.result.current(mockOrigin)).text();
    mockOxy = second; hook.rerender(undefined);
    await (await hook.result.current(mockOrigin)).text();
    expect(seen.at(-1)).toBe(`Bearer ${token('B')}`);
    for (const dispose of firstWatch.disposals) expect(dispose).toHaveBeenCalledTimes(1);
  } finally { hook.unmount(); }
  for (const dispose of secondWatch.disposals) expect(dispose).toHaveBeenCalledTimes(1);
});

it('rejects a retained callback after switching session on the same Oxy owner', async () => {
  mockSession = 'A'; mockOxy = new OxyServices({ baseURL: mockOrigin }); mockOxy.session.setAccessToken(token('A'));
  const hook = renderHook(() => useSindiAuthenticatedFetch());
  try {
    const oldFetch = hook.result.current;
    mockSession = 'B'; mockOxy.session.setAccessToken(token('B')); hook.rerender(undefined);
    const count = seen.length;
    await expect(oldFetch(mockOrigin)).rejects.toThrow('not mounted');
    expect(seen.length).toBe(count);
    await (await hook.result.current(mockOrigin)).text();
    expect(seen.at(-1)).toBe(`Bearer ${token('B')}`);
  } finally { hook.unmount(); }
});

it('never revives the first A callback after A → B → A', async () => {
  mockSession = 'A'; mockOxy = new OxyServices({ baseURL: mockOrigin }); mockOxy.session.setAccessToken(token('A'));
  const hook = renderHook(() => useSindiAuthenticatedFetch());
  try {
    const firstA = hook.result.current;
    mockSession = 'B'; mockOxy.session.setAccessToken(token('B')); hook.rerender(undefined);
    mockSession = 'A'; mockOxy.session.setAccessToken(token('A')); hook.rerender(undefined);
    const count = seen.length;
    await expect(firstA(mockOrigin)).rejects.toThrow('not mounted');
    expect(seen.length).toBe(count);
    await (await hook.result.current(mockOrigin)).text();
    expect(seen.at(-1)).toBe(`Bearer ${token('A')}`);
  } finally { hook.unmount(); }
});

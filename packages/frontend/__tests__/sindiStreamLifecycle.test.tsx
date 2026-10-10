/** @jest-environment ./test/http-environment.cjs */
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { OxyServices } from '@oxy.so/core';
import { useSindiAuthenticatedFetch } from '../hooks/useSindiAuthenticatedFetch';
import { useSindiConversation } from '../hooks/useSindiConversation';

let mockOrigin = '';
let mockSession = 'A';
let mockOxy: OxyServices;
jest.mock('@/config', () => ({
  get API_URL() {
    return mockOrigin;
  },
}));
jest.mock('@oxy.so/services', () => ({
  useOxy: () => ({ oxyServices: mockOxy, activeSessionId: mockSession }),
}));
jest.mock('expo/fetch', () => ({
  fetch: (input: string, init: RequestInit) => globalThis.fetch(input, init),
}));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { error: jest.fn() } }));
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined }) }));
jest.mock('@/store/conversationStore', () => ({
  useConversationStore: () => ({
    updateConversationMessages: jest.fn(),
    saveConversation: jest.fn(),
  }),
}));
jest.mock('../hooks/useSindiActions', () => {
  const actions = {
    execute: jest.fn(),
    take: jest.fn(),
    settleTurn: jest.fn(),
    cancelTurn: jest.fn(),
  };
  return { useSindiActions: () => actions };
});
jest.mock('@/utils/logger', () => ({ logger: { error: jest.fn() } }));
let server: Server;
let openResponse: ServerResponse;
let closed = false;
const empty: [] = [];
function token(id: string): string {
  return `e30.${Buffer.from(JSON.stringify({ userId: id, sessionId: `session-${id}`, exp: 2_000_000_000 })).toString('base64url')}.fixture`;
}
beforeAll(async () => {
  Object.assign(globalThis, Reflect.get(globalThis, '__realHttp'));
  server = createServer((_req, res) => {
    openResponse = res;
    closed = false;
    res.on('close', () => {
      closed = true;
    });
    res.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'x-vercel-ai-data-stream': 'v1',
    });
    res.write('0:"private-A"\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  mockOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
function useConversation() {
  const authenticatedFetch = useSindiAuthenticatedFetch();
  return useSindiConversation({
    host: 'sheet',
    isAuthenticated: true,
    authenticatedFetch,
    initialMessages: empty,
    onOpenUpsell: () => undefined,
  });
}
it.each(['session switch', 'unmount'])(
  'aborts a delivered HTTP stream on %s',
  async (operation) => {
    mockSession = 'A';
    mockOxy = new OxyServices({ baseURL: mockOrigin });
    mockOxy.session.setAccessToken(token('A'));
    const hook = renderHook(useConversation);
    try {
      act(() => hook.result.current.onChangeInput('hello'));
      act(() => {
        void hook.result.current.onSubmit();
      });
      await waitFor(() =>
        expect(
          hook.result.current.messages.some((message) => message.content === 'private-A'),
        ).toBe(true),
      );
      if (operation === 'unmount') hook.unmount();
      else {
        mockSession = 'B';
        mockOxy.session.setAccessToken(token('B'));
        hook.rerender(undefined);
        await waitFor(() => expect(hook.result.current.messages).toEqual([]));
      }
      await waitFor(() => expect(closed).toBe(true));
    } finally {
      openResponse?.end();
      if (operation !== 'unmount') hook.unmount();
    }
  },
);

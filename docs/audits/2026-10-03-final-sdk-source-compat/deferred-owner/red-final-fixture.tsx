/** @jest-environment ./test/http-environment.cjs */
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { OxyServices } from '@oxy.so/core';
import * as DocumentPicker from 'expo-document-picker';
import { useSindiAuthenticatedFetch } from '../hooks/useSindiAuthenticatedFetch';
import { useSindiConversation } from '../hooks/useSindiConversation';
import { useConversationStore, type Conversation } from '../store/conversationStore';

let mockOrigin = '';
let mockSession: string | undefined = 'A';
let mockOxy: OxyServices;
jest.mock('@/config', () => ({ get API_URL() { return mockOrigin; } }));
jest.mock('@oxy.so/services', () => ({ useOxy: () => ({ oxyServices: mockOxy, activeSessionId: mockSession }) }));
jest.mock('expo/fetch', () => ({ fetch: (input: string, init: RequestInit) => globalThis.fetch(input, init) }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { error: jest.fn() } }));
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: { plusActive: true, fileCredits: 1 } }) }));
jest.mock('../hooks/useSindiActions', () => { const actions = { execute: jest.fn(), take: jest.fn(), settleTurn: jest.fn(), cancelTurn: jest.fn() }; return { useSindiActions: () => actions }; });
jest.mock('@/utils/logger', () => ({ logger: { error: jest.fn(), debug: jest.fn() } }));
let server: Server;
let pending: ServerResponse | undefined;
const initialMessages = [{ id: 'message-A', role: 'user' as const, content: 'private-A' }];
const empty: [] = [];
const conversation = (id: string): Conversation => ({ id, title: id, messages: [], createdAt: new Date(0), updatedAt: new Date(0) });
const original = conversation('conv_A');
function token(id: string): string {
  return `e30.${Buffer.from(JSON.stringify({ userId: id, sessionId: `session-${id}`, exp: 2_000_000_000 })).toString('base64url')}.fixture`;
}
beforeAll(async () => {
  Object.assign(globalThis, Reflect.get(globalThis, '__realHttp'));
  server = createServer((_req, res) => {
    pending = res;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.flushHeaders();
    res.write('{"success":true,');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  mockOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
beforeEach(() => {
  pending = undefined;
  mockSession = 'A'; mockOxy = new OxyServices({ baseURL: mockOrigin }); mockOxy.session.setAccessToken(token('A'));
  useConversationStore.setState({ conversations: [], currentConversation: null, error: null });
});
function useConversation({ persist }: { persist: boolean }) {
  const authenticatedFetch = useSindiAuthenticatedFetch();
  return useSindiConversation({ host: 'sheet', isAuthenticated: Boolean(mockSession), authenticatedFetch,
    conversationId: persist ? original.id : undefined, currentConversation: persist ? original : null,
    initialMessages: persist ? initialMessages : empty, onOpenUpsell: () => undefined });
}
function switchOwner(id: string | undefined) {
  mockSession = id;
  if (id) mockOxy.session.setAccessToken(token(id));
  else mockOxy.session.clear();
}
it.each(['switch', 'logout', 'ABA', 'unmount'])('does not write a delayed 200 body into the real store after %s', async (operation) => {
  const hook = renderHook(useConversation, { initialProps: { persist: true } });
  try {
    await waitFor(() => expect(pending).toBeDefined(), { timeout: 4000 });
    // Headers and partial JSON have crossed the SDK fence; the app owns body consumption.
    await new Promise((resolve) => setTimeout(resolve, 40));
    if (operation === 'unmount') hook.unmount();
    else {
      switchOwner(operation === 'logout' ? undefined : 'B'); hook.rerender({ persist: false });
      if (operation === 'ABA') { switchOwner('A'); hook.rerender({ persist: false }); }
    }
    const current = conversation('current-owner');
    act(() => useConversationStore.setState({ currentConversation: current, conversations: [current] }));
    await act(async () => {
      pending?.end('"conversation":{"id":"saved-A"}}');
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(useConversationStore.getState().currentConversation).toEqual(current);
    expect(useConversationStore.getState().conversations).toEqual([current]);
  } finally { pending?.end(); if (operation !== 'unmount') hook.unmount(); }
});
it('persists a current owner response through the real store', async () => {
  const hook = renderHook(useConversation, { initialProps: { persist: true } });
  try {
    await waitFor(() => expect(pending).toBeDefined(), { timeout: 4000 });
    await act(async () => { pending?.end('"conversation":{"id":"saved-A"}}'); });
    await waitFor(() => expect(useConversationStore.getState().currentConversation?.id).toBe('saved-A'));
  } finally { pending?.end(); hook.unmount(); }
});
it.each(['switch', 'logout', 'ABA', 'current'])('accepts picker results only for their mounted generation: %s', async (operation) => {
  let resolvePicker!: (value: DocumentPicker.DocumentPickerResult) => void;
  jest.mocked(DocumentPicker.getDocumentAsync).mockImplementationOnce(() => new Promise((resolve) => { resolvePicker = resolve; }));
  const hook = renderHook(useConversation, { initialProps: { persist: false } });
  try {
    act(() => { hook.result.current.onAttachFile(); });
    expect(resolvePicker).toBeDefined();
    if (operation !== 'current') {
      switchOwner(operation === 'logout' ? undefined : 'B'); hook.rerender({ persist: false });
      if (operation === 'ABA') { switchOwner('A'); hook.rerender({ persist: false }); }
    }
    const asset = { uri: 'file:///fixture-A.txt', name: 'fixture-A.txt', mimeType: 'text/plain' };
    await act(async () => resolvePicker({ canceled: false, assets: [asset] }));
    expect(hook.result.current.attachedFile).toEqual(operation === 'current' ? asset : null);
  } finally { hook.unmount(); }
});

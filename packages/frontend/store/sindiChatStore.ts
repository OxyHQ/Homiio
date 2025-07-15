import { create } from 'zustand';
import { sindiApi } from '@/utils/api';
import {               } from '@oxyhq/services';

export interface SindiChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

interface SindiChatState {
  messages: SindiChatMessage[];
  isLoading: boolean;
  error: string | null;
  fetchHistory: (oxyServices: OxyServices, activeSessionId: string) => Promise<void>;
  fetchConversation: (conversationId: string, oxyServices: OxyServices, activeSessionId: string) => Promise<void>;
  sendMessage: (userMessage: string, assistantMessage: string, oxyServices: OxyServices, activeSessionId: string) => Promise<void>;
  clearHistory: (oxyServices: OxyServices, activeSessionId: string) => Promise<void>;
  addMessage: (msg: SindiChatMessage) => void;
}

export const useSindiChatStore = create<SindiChatState>((set, get) => ({
  messages: [],
  isLoading: false,
  error: null,
  fetchHistory: async (oxyServices, activeSessionId) => {
    set({ isLoading: true, error: null });
    try {
      const res = await sindiApi.getSindiChatHistory(oxyServices, activeSessionId);
      set({ messages: res.history || [], isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to load chat history', isLoading: false });
    }
  },
  fetchConversation: async (conversationId, oxyServices, activeSessionId) => {
    set({ isLoading: true, error: null });
    try {
      const res = await sindiApi.getSindiConversation(conversationId, oxyServices, activeSessionId);
      set({ messages: res.conversation?.messages || [], isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to load conversation', isLoading: false });
    }
  },
  sendMessage: async (userMessage, assistantMessage, oxyServices, activeSessionId) => {
    set({ isLoading: true, error: null });
    try {
      await sindiApi.saveSindiChatHistory(userMessage, assistantMessage, oxyServices, activeSessionId);
      // Add both user and assistant messages to local state
      const now = new Date().toISOString();
      set((state) => ({
        messages: [
          ...state.messages,
          { role: 'user', content: userMessage, timestamp: now },
          { role: 'assistant', content: assistantMessage, timestamp: now },
        ],
        isLoading: false,
      }));
    } catch (err: any) {
      set({ error: err.message || 'Failed to send message', isLoading: false });
    }
  },
  clearHistory: async (oxyServices, activeSessionId) => {
    set({ isLoading: true, error: null });
    try {
      await sindiApi.clearSindiChatHistory(oxyServices, activeSessionId);
      set({ messages: [], isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to clear chat history', isLoading: false });
    }
  },
  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
})); 
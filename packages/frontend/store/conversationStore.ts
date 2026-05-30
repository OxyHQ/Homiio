import { create } from 'zustand';
import { API_URL } from '@/config';
import { logger } from '@/utils/logger';

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ConversationMessage[];
  createdAt: Date;
  updatedAt: Date;
}

interface ConversationState {
  // State
  conversations: Conversation[];
  currentConversation: Conversation | null;
  loading: boolean;
  error: string | null;
  creatingConversation: boolean;

  // Actions
  setConversations: (conversations: Conversation[]) => void;
  setCurrentConversation: (conversation: Conversation | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // API Actions
  loadConversations: (
    authenticatedFetch: (url: string, options?: RequestInit) => Promise<Response>,
  ) => Promise<void>;
  loadConversation: (
    conversationId: string,
    authenticatedFetch: (url: string, options?: RequestInit) => Promise<Response>,
  ) => Promise<Conversation | null>;
  saveConversation: (
    conversation: Conversation,
    authenticatedFetch: (url: string, options?: RequestInit) => Promise<Response>,
  ) => Promise<Conversation | null>;
  createConversation: (
    title: string,
    initialMessage?: string,
    authenticatedFetch?: (url: string, options?: RequestInit) => Promise<Response>,
  ) => Promise<Conversation>;
  updateConversationMessages: (conversationId: string, messages: ConversationMessage[]) => void;
  generateShareToken: (
    conversationId: string,
    authenticatedFetch: (url: string, options?: RequestInit) => Promise<Response>,
  ) => Promise<string | null>;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  // Initial state
  conversations: [],
  currentConversation: null,
  loading: false,
  error: null,
  creatingConversation: false,

  // Basic setters
  setConversations: (conversations) => set({ conversations }),
  setCurrentConversation: (conversation) => set({ currentConversation: conversation }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  // Load all conversations
  loadConversations: async (authenticatedFetch) => {
    try {
      set({ loading: true, error: null });
      const response = await authenticatedFetch(`${API_URL}/api/ai/conversations`);

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.conversations) {
          const formattedConversations: Conversation[] = data.conversations.map((conv: any) => ({
            id: conv._id,
            title: conv.title,
            messages: conv.messages || [],
            createdAt: new Date(conv.createdAt),
            updatedAt: new Date(conv.updatedAt),
          }));
          set({ conversations: formattedConversations });
        }
      } else {
        logger.error('Failed to load conversations:', response.status);
        set({ error: 'Failed to load conversations' });
      }
    } catch (error) {
      logger.error('Failed to load conversations:', error);
      set({ error: 'Failed to load conversations' });
    } finally {
      set({ loading: false });
    }
  },

  // Load specific conversation
  loadConversation: async (conversationId, authenticatedFetch) => {
    try {
      logger.debug('Loading conversation with ID:', conversationId);

      if (!conversationId) {
        logger.error('loadConversation called with undefined or null id');
        set({ error: 'Invalid conversation ID', loading: false });
        return null;
      }

      set({ loading: true, error: null });

      // Check if this is a client-generated ID (starts with 'conv_')
      if (conversationId.startsWith('conv_')) {
        logger.debug('Creating new client-side conversation');
        const newConversation: Conversation = {
          id: conversationId,
          title: 'New Conversation',
          messages: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        set({ currentConversation: newConversation, loading: false });
        return newConversation;
      }

      // Try to load from API
      const response = await authenticatedFetch(`${API_URL}/api/ai/conversations/${conversationId}`);

      if (response.ok) {
        const data = await response.json();

        if (data.success && data.conversation) {
          const apiConversation = data.conversation;

          const formattedConversation: Conversation = {
            id: apiConversation._id || apiConversation.id,
            title: apiConversation.title || 'Untitled Conversation',
            messages: (apiConversation.messages || []).map((msg: any) => ({
              id: msg._id || msg.id || `msg_${Date.now()}_${Math.random()}`,
              role: msg.role,
              content: msg.content || '',
              timestamp: new Date(msg.timestamp || Date.now()),
            })),
            createdAt: new Date(apiConversation.createdAt || Date.now()),
            updatedAt: new Date(apiConversation.updatedAt || Date.now()),
          };

          set({ currentConversation: formattedConversation });
          return formattedConversation;
        } else {
          logger.error('Invalid API response structure for conversation:', data);
        }
      } else if (response.status === 404) {
        logger.debug('Conversation not found, creating new one');
        // Conversation not found, create new one
        const newConversation: Conversation = {
          id: conversationId,
          title: 'New Conversation',
          messages: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        set({ currentConversation: newConversation });
        return newConversation;
      } else {
        logger.error('Failed to load conversation:', response.status, response.statusText);
        set({ error: 'Failed to load conversation' });
      }
    } catch (error) {
      logger.error('Exception while loading conversation:', error);
      set({ error: 'Failed to load conversation' });
      // Fallback to new conversation
      const newConversation: Conversation = {
        id: conversationId,
        title: 'New Conversation',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      set({ currentConversation: newConversation });
      return newConversation;
    } finally {
      set({ loading: false });
    }
    return null;
  },

  // Save conversation
  saveConversation: async (conversation, authenticatedFetch) => {
    try {
      logger.debug('saveConversation called', {
        id: conversation.id,
        messageCount: conversation.messages.length,
      });

      // Skip saving if this is a client-generated ID that hasn't been created yet
      if (conversation.id.startsWith('conv_') && conversation.messages.length === 0) {
        logger.debug('Skipping save - client ID with no messages');
        return conversation;
      }

      // If this is a client-generated ID with messages, create the conversation first
      if (conversation.id.startsWith('conv_') && conversation.messages.length > 0) {
        logger.debug('Creating new conversation from client ID');
        const requestBody = {
          title: conversation.title,
          messages: conversation.messages.map((msg) => ({
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp,
          })),
        };

        const response = await authenticatedFetch(`${API_URL}/api/ai/conversations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.conversation) {
            const newConversation: Conversation = {
              ...conversation,
              id: data.conversation._id,
            };
            set({ currentConversation: newConversation });

            // Update conversations list
            const { conversations } = get();
            const updatedConversations = conversations.map((c) =>
              c.id === conversation.id ? newConversation : c,
            );
            if (!updatedConversations.find((c) => c.id === newConversation.id)) {
              updatedConversations.unshift(newConversation);
            }
            set({ conversations: updatedConversations });

            return newConversation;
          }
        } else {
          logger.error('Create conversation request failed:', response.status, response.statusText);
        }
        return conversation;
      }

      // Update existing conversation
      logger.debug('Updating existing conversation', {
        id: conversation.id,
        messageCount: conversation.messages.length,
      });
      const requestBody = {
        title: conversation.title,
        messages: conversation.messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
        })),
      };

      const response = await authenticatedFetch(
        `${API_URL}/api/ai/conversations/${conversation.id}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        },
      );

      if (response.ok) {
        logger.debug('Update conversation request successful');
        // Update conversations list
        const { conversations } = get();
        const updatedConversations = conversations.map((c) =>
          c.id === conversation.id ? conversation : c,
        );
        set({ conversations: updatedConversations });
      } else {
        logger.error('Update conversation request failed:', response.status, response.statusText);
      }

      return conversation;
    } catch (error) {
      logger.error('Exception in saveConversation:', error);
      return conversation;
    }
  },

  // Create new conversation
  createConversation: async (title, initialMessage, authenticatedFetch) => {
    try {
      if (authenticatedFetch) {
        logger.debug('Creating conversation', { title, hasInitialMessage: Boolean(initialMessage) });
        const requestBody = {
          title,
          initialMessage,
        };
        const response = await authenticatedFetch(`${API_URL}/api/ai/conversations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (response.ok) {
          const data = await response.json();

          if (data.success && data.conversation && data.conversation._id) {
            const newConversation: Conversation = {
              id: data.conversation._id,
              title: data.conversation.title || title,
              messages: data.conversation.messages || [],
              createdAt: new Date(data.conversation.createdAt),
              updatedAt: new Date(data.conversation.updatedAt),
            };

            logger.debug('Created conversation', {
              id: newConversation.id,
              messageCount: newConversation.messages.length,
            });

            // Add to conversations list
            const { conversations } = get();
            set({ conversations: [newConversation, ...conversations] });

            return newConversation;
          } else {
            logger.error('Invalid API response structure for create conversation:', data);
          }
        } else {
          logger.error('Create conversation API failed with status:', response.status);
        }
      }

      // Fallback to client-side ID generation
      logger.debug('Falling back to client-side conversation ID generation');
      const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const newConversation: Conversation = {
        id: conversationId,
        title,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      return newConversation;
    } catch (error) {
      logger.error('Exception in createConversation:', error);
      // Fallback to client-side ID generation
      const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const newConversation: Conversation = {
        id: conversationId,
        title,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      return newConversation;
    }
  },

  // Update conversation messages
  updateConversationMessages: (conversationId, messages) => {
    const { currentConversation, conversations } = get();

    if (currentConversation && currentConversation.id === conversationId) {
      const updatedConversation: Conversation = {
        ...currentConversation,
        messages,
        updatedAt: new Date(),
        // Update title based on first user message if it's still the default
        title:
          currentConversation.title === 'New Conversation' &&
          messages.length > 0 &&
          messages[0].role === 'user'
            ? messages[0].content.substring(0, 50) + (messages[0].content.length > 50 ? '...' : '')
            : currentConversation.title,
      };

      set({ currentConversation: updatedConversation });

      // Update in conversations list
      const updatedConversations = conversations.map((c) =>
        c.id === conversationId ? updatedConversation : c,
      );
      set({ conversations: updatedConversations });
    }
  },

  // Generate share token
  generateShareToken: async (conversationId, authenticatedFetch) => {
    try {
      const response = await authenticatedFetch(
        `${API_URL}/api/ai/conversations/${conversationId}/share`,
        { method: 'POST' },
      );

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.shareToken) {
          return data.shareToken;
        }
      }
      return null;
    } catch (error) {
      logger.error('Failed to generate share token:', error);
      return null;
    }
  },
}));

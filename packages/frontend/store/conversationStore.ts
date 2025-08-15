import { create } from 'zustand';
import { API_URL } from '@/config';
import { fetch as expoFetch } from 'expo/fetch';

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
        console.error('Failed to load conversations:', response.status);
        set({ error: 'Failed to load conversations' });
      }
    } catch (error) {
      console.error('Failed to load conversations:', error);
      set({ error: 'Failed to load conversations' });
    } finally {
      set({ loading: false });
    }
  },

  // Load specific conversation
  loadConversation: async (conversationId, authenticatedFetch) => {
    try {
      console.log('Store: Loading conversation with ID:', conversationId);

      if (!conversationId) {
        console.error('Store: conversationId is undefined or null');
        set({ error: 'Invalid conversation ID', loading: false });
        return null;
      }

      set({ loading: true, error: null });

      // Check if this is a client-generated ID (starts with 'conv_')
      if (conversationId.startsWith('conv_')) {
        console.log('Store: Creating new client-side conversation');
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
      console.log('Store: Fetching conversation from API');
      const response = await authenticatedFetch(`${API_URL}/api/ai/conversations/${conversationId}`);

      if (response.ok) {
        const data = await response.json();
        console.log('Store: API response data:', data);

        if (data.success && data.conversation) {
          const apiConversation = data.conversation;
          console.log('Store: Processing API conversation:', apiConversation);

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

          console.log('Store: Formatted conversation:', formattedConversation);
          set({ currentConversation: formattedConversation });
          return formattedConversation;
        } else {
          console.error('Store: Invalid API response structure:', data);
        }
      } else if (response.status === 404) {
        console.log('Store: Conversation not found, creating new one');
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
        console.error('Store: Failed to load conversation:', response.status, response.statusText);
        set({ error: 'Failed to load conversation' });
      }
    } catch (error) {
      console.error('Store: Exception while loading conversation:', error);
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
      console.log('Store: saveConversation called with:', {
        id: conversation.id,
        title: conversation.title,
        messageCount: conversation.messages.length,
        messages: conversation.messages.map((m) => ({
          role: m.role,
          content: m.content.substring(0, 50) + '...',
        })),
      });

      // Skip saving if this is a client-generated ID that hasn't been created yet
      if (conversation.id.startsWith('conv_') && conversation.messages.length === 0) {
        console.log('Store: Skipping save - client ID with no messages');
        return conversation;
      }

      // If this is a client-generated ID with messages, create the conversation first
      if (conversation.id.startsWith('conv_') && conversation.messages.length > 0) {
        console.log('Store: Creating new conversation from client ID');
        const requestBody = {
          title: conversation.title,
          messages: conversation.messages.map((msg) => ({
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp,
          })),
        };
        console.log('Store: POST request body:', requestBody);

        const response = await authenticatedFetch(`${API_URL}/api/ai/conversations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (response.ok) {
          const data = await response.json();
          console.log('Store: POST response data:', data);
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
          console.error('Store: POST request failed:', response.status, response.statusText);
        }
        return conversation;
      }

      // Update existing conversation
      console.log('Store: Updating existing conversation with ID:', conversation.id);
      const requestBody = {
        title: conversation.title,
        messages: conversation.messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
        })),
      };
      console.log('Store: PUT request body:', requestBody);

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
        console.log('Store: PUT request successful');
        // Update conversations list
        const { conversations } = get();
        const updatedConversations = conversations.map((c) =>
          c.id === conversation.id ? conversation : c,
        );
        set({ conversations: updatedConversations });
      } else {
        console.error('Store: PUT request failed:', response.status, response.statusText);
      }

      return conversation;
    } catch (error) {
      console.error('Store: Exception in saveConversation:', error);
      return conversation;
    }
  },

  // Create new conversation
  createConversation: async (title, initialMessage, authenticatedFetch) => {
    try {
      if (authenticatedFetch) {
        console.log('Store: Creating conversation with title:', title);
        const response = await authenticatedFetch(`${API_URL}/api/ai/conversations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title,
            initialMessage,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          console.log('Store: Create conversation API response:', data);

          if (data.success && data.conversation && data.conversation._id) {
            const newConversation: Conversation = {
              id: data.conversation._id,
              title: data.conversation.title || title,
              messages: data.conversation.messages || [],
              createdAt: new Date(data.conversation.createdAt),
              updatedAt: new Date(data.conversation.updatedAt),
            };

            console.log('Store: Created conversation with ID:', newConversation.id);

            // Add to conversations list
            const { conversations } = get();
            set({ conversations: [newConversation, ...conversations] });

            return newConversation;
          } else {
            console.error('Store: Invalid API response structure for create conversation:', data);
          }
        } else {
          console.error('Store: Create conversation API failed with status:', response.status);
        }
      }

      // Fallback to client-side ID generation
      console.log('Store: Falling back to client-side ID generation');
      const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const newConversation: Conversation = {
        id: conversationId,
        title,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      console.log('Store: Generated client-side conversation with ID:', conversationId);
      return newConversation;
    } catch (error) {
      console.error('Store: Exception in createConversation:', error);
      // Fallback to client-side ID generation
      const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const newConversation: Conversation = {
        id: conversationId,
        title,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      console.log('Store: Exception fallback conversation with ID:', conversationId);
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
      console.error('Failed to generate share token:', error);
      return null;
    }
  },
}));

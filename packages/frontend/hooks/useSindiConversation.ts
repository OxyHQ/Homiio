import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, type ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useChat, type Message, type UseChatOptions } from '@ai-sdk/react';
import * as DocumentPicker from 'expo-document-picker';
import {
  useConversationStore,
  type Conversation,
  type ConversationMessage,
} from '@/store/conversationStore';
import { api } from '@/utils/api';
import { getData, storeData } from '@/utils/storage';
import { logger } from '@/utils/logger';
import { API_URL } from '@/config';

/** Key under which we record that the file-upsell sheet has been shown once. */
const FILE_UPSELL_KEY = 'sindi:fileUpsellShown';

const STREAM_ENDPOINT = `${API_URL}/api/ai/stream`;
const ANALYZE_FILE_ENDPOINT = `${API_URL}/api/ai/analyze-file`;

/** Debounce before persisting streamed messages back to the conversation store. */
const SAVE_DEBOUNCE_MS = 1000;
/** Length at which an auto-derived conversation title is truncated. */
const TITLE_MAX_LENGTH = 50;

const ENTITLEMENTS_STALE_MS = 1000 * 60 * 5;
const ENTITLEMENTS_GC_MS = 1000 * 60 * 10;

const PDF_MIME_PREFIX = 'application/pdf';
const FALLBACK_MIME = 'application/octet-stream';

export interface Entitlements {
  plusActive: boolean;
  plusSince?: string;
  plusStripeSubscriptionId?: string;
  fileCredits: number;
  lastPaymentAt?: string;
}

interface EntitlementsResponse {
  success: boolean;
  entitlements: Entitlements;
}

/** Attached document picked for analysis (subset of `DocumentPicker` asset we use). */
interface AttachedAsset {
  uri: string;
  name?: string;
  mimeType?: string;
}

type ConversationFetch = typeof globalThis.fetch;

export interface UseSindiConversationArgs {
  conversationId?: string;
  currentConversation?: Conversation | null;
  isAuthenticated: boolean;
  authenticatedFetch: ConversationFetch;
  initialMessages: Message[];
  messageFromUrl?: string;
  onOpenUpsell: () => void;
}

export interface UseSindiConversationResult {
  messages: Message[];
  error: Error | undefined;
  input: string;
  isLoading: boolean;
  isUploading: boolean;
  attachedFile: AttachedAsset | null;
  scrollViewRef: React.RefObject<ScrollView | null>;
  onChangeInput: (text: string) => void;
  onSubmit: () => void;
  onAttachFile: () => void;
  onRemoveFile: () => void;
  onSuggestionPress: (prompt: string) => void;
}

/** Whether a conversation ID refers to a persisted (server-side) conversation. */
function isPersistedConversation(conversationId?: string): conversationId is string {
  return Boolean(
    conversationId && conversationId !== 'undefined' && !conversationId.startsWith('conv_'),
  );
}

/** Derive a conversation title from its first user message when still unnamed. */
function deriveTitle(current: Conversation, messages: Message[]): string {
  const firstUser = messages[0];
  const shouldDerive =
    current.title === 'New Conversation' && firstUser?.role === 'user';
  if (!shouldDerive) return current.title;
  const text = firstUser.content;
  return text.length > TITLE_MAX_LENGTH ? `${text.substring(0, TITLE_MAX_LENGTH)}...` : text;
}

/**
 * Owns the full Sindi chat lifecycle for a single conversation: AI SDK
 * streaming, persistence back to the Zustand conversation store, scroll-to-end,
 * URL-seeded first message, file attachment + analysis, and entitlement gating.
 *
 * Returns a flat, presentational-friendly surface so the chat components stay
 * declarative. All conversation state lives in `conversationStore` (the single
 * source of truth) — this hook only mirrors the live streamed messages into it.
 */
export function useSindiConversation({
  conversationId,
  currentConversation,
  isAuthenticated,
  authenticatedFetch,
  initialMessages,
  messageFromUrl,
  onOpenUpsell,
}: UseSindiConversationArgs): UseSindiConversationResult {
  const router = useRouter();

  const [attachedFile, setAttachedFile] = useState<AttachedAsset | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const scrollViewRef = useRef<ScrollView | null>(null);
  const lastSyncedHash = useRef<string>('');
  const lastMsgKeyRef = useRef<string>('');
  const messageSentRef = useRef<string>('');

  const { updateConversationMessages, saveConversation } = useConversationStore();

  // Entitlements drive the file-attachment gate (Homiio+ or per-file credits).
  const { data: entitlements } = useQuery({
    queryKey: ['entitlements'],
    queryFn: async () => {
      const { data } = await api.get<EntitlementsResponse>('/api/profiles/me/entitlements');
      if (!data?.success) {
        throw new Error('Failed to load entitlements');
      }
      return data.entitlements ?? null;
    },
    enabled: isAuthenticated,
    staleTime: ENTITLEMENTS_STALE_MS,
    gcTime: ENTITLEMENTS_GC_MS,
  });

  const plusActive = entitlements?.plusActive ?? false;
  const fileCredits = entitlements?.fileCredits ?? 0;

  const scrollToEnd = useCallback(() => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  }, []);

  const chatOptions: UseChatOptions = useMemo(
    () => ({
      fetch: authenticatedFetch,
      api: STREAM_ENDPOINT,
      onError: (err: Error) => logger.error('Sindi chat stream error:', err),
      initialMessages,
      body: {
        conversationId: isPersistedConversation(conversationId) ? conversationId : undefined,
      },
    }),
    [authenticatedFetch, initialMessages, conversationId],
  );

  const { messages, error, handleInputChange, input, handleSubmit, isLoading, append } =
    useChat(chatOptions);

  // Persist streamed messages back to the store (hash-gated + debounced), and
  // promote a freshly-created conversation's route once it gains a real ID.
  // While streaming (`isLoading`) the dedicated auto-scroll effect handles the
  // viewport, so this effect bails without persisting or scrolling.
  useEffect(() => {
    const syncable =
      Boolean(currentConversation) &&
      messages.length > 0 &&
      Boolean(conversationId) &&
      conversationId !== 'undefined';

    if (syncable && currentConversation && conversationId) {
      if (isLoading) return;

      const conversationMessages: ConversationMessage[] = messages.map((msg, index) => {
        const existing = currentConversation.messages?.[index];
        return {
          id: msg.id,
          role: msg.role as ConversationMessage['role'],
          content: msg.content,
          timestamp: existing?.timestamp ? new Date(existing.timestamp) : new Date(),
        };
      });

      const newHash = JSON.stringify(conversationMessages.map((m) => [m.role, m.content]));
      if (lastSyncedHash.current === newHash) {
        scrollToEnd();
        return;
      }

      const currentMessages = currentConversation.messages;
      const messagesChanged =
        currentMessages.length !== conversationMessages.length ||
        conversationMessages.some(
          (msg, index) =>
            !currentMessages[index] ||
            currentMessages[index].content !== msg.content ||
            currentMessages[index].role !== msg.role,
        );

      if (messagesChanged) {
        updateConversationMessages(conversationId, conversationMessages);
        lastSyncedHash.current = newHash;

        const timeoutId = setTimeout(() => {
          const updatedConversation: Conversation = {
            ...currentConversation,
            messages: conversationMessages,
            updatedAt: new Date(),
            title: deriveTitle(currentConversation, messages),
          };

          saveConversation(updatedConversation, authenticatedFetch)
            .then((saved) => {
              if (saved && saved.id !== conversationId) {
                router.replace(`/sindi/${saved.id}`);
              }
            })
            .catch((e) => logger.error('Failed to save conversation:', e));
        }, SAVE_DEBOUNCE_MS);

        return () => clearTimeout(timeoutId);
      }
    }

    scrollToEnd();
  }, [
    messages,
    currentConversation,
    conversationId,
    isLoading,
    updateConversationMessages,
    saveConversation,
    authenticatedFetch,
    router,
    scrollToEnd,
  ]);

  // Auto-scroll when a new last message arrives.
  useEffect(() => {
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    const key = `${last.id}|${messages.length}`;
    if (lastMsgKeyRef.current === key) return;
    lastMsgKeyRef.current = key;
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(scrollToEnd);
    } else {
      setTimeout(scrollToEnd, 0);
    }
  }, [messages, scrollToEnd]);

  // Auto-send a message passed via the route (e.g. from a property bottom sheet).
  useEffect(() => {
    if (!messageFromUrl || !currentConversation || messageFromUrl === messageSentRef.current) {
      return;
    }
    messageSentRef.current = messageFromUrl;
    append({
      id: `${Date.now()}-initial-message`,
      role: 'user',
      content: decodeURIComponent(messageFromUrl),
    });
  }, [messageFromUrl, currentConversation, append]);

  const onChangeInput = useCallback(
    (text: string) => {
      handleInputChange({
        target: { value: text },
      } as React.ChangeEvent<HTMLInputElement>);
    },
    [handleInputChange],
  );

  const onRemoveFile = useCallback(() => setAttachedFile(null), []);

  const onAttachFile = useCallback(async () => {
    try {
      // Gate behind Homiio+ or per-file credits.
      if (!plusActive && fileCredits <= 0) {
        onOpenUpsell();
        return;
      }

      // Show the one-time upsell on the first attempt for non-subscribers.
      if (!plusActive) {
        const alreadyShown = await getData<boolean>(FILE_UPSELL_KEY);
        if (!alreadyShown) {
          await storeData(FILE_UPSELL_KEY, true);
          onOpenUpsell();
          return;
        }
      }

      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (!result.canceled && result.assets.length > 0) {
        setAttachedFile(result.assets[0]);
      }
    } catch (e) {
      logger.error('File pick error:', e);
    }
  }, [plusActive, fileCredits, onOpenUpsell]);

  const onSubmit = useCallback(async () => {
    try {
      const trimmed = (input || '').trim();

      if (!attachedFile) {
        handleSubmit();
        return;
      }

      if (isUploading) return; // guard against double submits
      setIsUploading(true);
      const asset = attachedFile;

      if (Platform.OS === 'web') {
        // Embed the file as a data URL in a single user message; the stream
        // endpoint handles the multimodal payload.
        const resp = await fetch(asset.uri);
        const blob = await resp.blob();
        const dataUrl = await readBlobAsDataUrl(blob);
        const isPdf = (blob.type || asset.mimeType || '').startsWith(PDF_MIME_PREFIX);
        const tag = isPdf
          ? `<FILE_DATA_URL>${dataUrl}</FILE_DATA_URL>`
          : `<IMAGE_DATA_URL>${dataUrl}</IMAGE_DATA_URL>`;

        append({
          id: `${Date.now()}-user-file`,
          role: 'user',
          content: `${trimmed ? `${trimmed}\n\n` : ''}Sent a file: ${asset.name || 'attachment'}\n${tag}`,
        });
        setAttachedFile(null);
        return;
      }

      // Native: optimistically append the user message, then call the JSON
      // analysis endpoint and append the assistant response.
      append({
        id: `${Date.now()}-user-file`,
        role: 'user',
        content: `${trimmed ? `${trimmed}\n\n` : ''}Sent a file: ${asset.name || 'attachment'}`,
      });

      const formData = new FormData();
      // React Native accepts a `{ uri, name, type }` file descriptor here, but
      // the DOM `FormData` type only models `Blob | string`. Asserting through
      // `Blob` matches the convention used elsewhere in the app (see
      // `applicationService`).
      formData.append('file', {
        uri: asset.uri,
        name: asset.name || 'upload',
        type: asset.mimeType || FALLBACK_MIME,
      } as unknown as Blob);
      if (trimmed) formData.append('text', trimmed);

      const res = await authenticatedFetch(ANALYZE_FILE_ENDPOINT, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || 'Failed to analyze file');
      }
      const data: { output?: unknown } = await res.json();
      if (data?.output) {
        append({
          id: `${Date.now()}-assistant-file`,
          role: 'assistant',
          content: String(data.output),
        });
      }
      setAttachedFile(null);
    } catch (e) {
      logger.error('File upload failed:', e);
      const messageText = e instanceof Error ? e.message : 'Could not analyze the file.';
      Alert.alert('Upload failed', messageText);
    } finally {
      setIsUploading(false);
    }
  }, [attachedFile, input, isUploading, append, authenticatedFetch, handleSubmit]);

  const onSuggestionPress = useCallback(
    (prompt: string) => {
      onChangeInput(prompt);
      setTimeout(onSubmit, 0);
    },
    [onChangeInput, onSubmit],
  );

  return {
    messages,
    error,
    input,
    isLoading,
    isUploading,
    attachedFile,
    scrollViewRef,
    onChangeInput,
    onSubmit,
    onAttachFile,
    onRemoveFile,
    onSuggestionPress,
  };
}

/** Read a Blob as a base64 data URL (web file attachment path). */
function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

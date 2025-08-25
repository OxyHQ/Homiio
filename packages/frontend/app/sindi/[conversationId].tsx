import { API_URL } from '@/config';
import { useChat } from '@ai-sdk/react';
import { fetch as expoFetch } from 'expo/fetch';
import {
  View,
  TextInput,
  ScrollView,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOxy } from '@oxyhq/services';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';

import { useRouter, useLocalSearchParams } from 'expo-router';
import { PropertyCard } from '@/components/PropertyCard';
import { propertyService } from '@/services/propertyService';
import { useQuery } from '@tanstack/react-query';
import { SindiIcon } from '@/assets/icons';
import { ThemedView } from '@/components/ThemedView';
import { Header } from '@/components/Header';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import * as DocumentPicker from 'expo-document-picker';
import React, { useEffect, useCallback } from 'react';
import {
  useConversationStore,
  type ConversationMessage,
  type Conversation,
} from '@/store/conversationStore';
import { EmptyState } from '@/components/ui/EmptyState';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { getData, storeData } from '@/utils/storage';
import { api } from '@/utils/api';

const IconComponent = Ionicons as any;

const FILE_UPSELL_KEY = 'sindi:fileUpsellShown';

interface Entitlements {
  plusActive: boolean;
  plusSince?: string;
  plusStripeSubscriptionId?: string;
  fileCredits: number;
  lastPaymentAt?: string;
}

// Simple bottom sheet content for premium upsell
const FilePremiumInfoSheet: React.FC<{ onClose: () => void; onUpgrade: () => void }> = ({ onClose, onUpgrade }) => {
  return (
    <View style={{ padding: 20 }}>
      <View style={{ alignItems: 'center', marginBottom: 12 }}>
        <IconComponent name="lock-closed-outline" size={36} color={colors.primaryColor} />
      </View>
      <Text style={{ fontSize: 18, fontWeight: '700', textAlign: 'center', color: '#111b21' }}>
        File analysis is a premium feature
      </Text>
      <Text style={{ fontSize: 14, marginTop: 8, textAlign: 'center', color: '#344053' }}>
        Upload rental contracts and legal documents for instant analysis. Get help understanding your rights and identifying potential issues.
      </Text>
      <View style={{ marginTop: 14, backgroundColor: '#f7f8f9', borderWidth: 1, borderColor: '#e9edef', borderRadius: 12, padding: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
          <IconComponent name="checkmark-circle" size={18} color={colors.primaryColor} />
          <Text style={{ marginLeft: 8, fontSize: 14, color: '#111b21' }}>Pay per contract: 5 € per review</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <IconComponent name="star-outline" size={18} color={colors.primaryColor} />
          <Text style={{ marginLeft: 8, fontSize: 14, color: '#111b21' }}>Homiio+ Subscription: 9.99 €/month</Text>
        </View>
        <Text style={{ marginLeft: 26, fontSize: 12, color: '#6b7280', marginTop: 4 }}>
          Includes up to 10 contracts per month free
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
        <TouchableOpacity
          onPress={onClose}
          style={{ flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: '#e9edef', alignItems: 'center', backgroundColor: '#fff' }}
        >
          <Text style={{ color: '#111b21', fontWeight: '600' }}>Maybe later</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onUpgrade}
          style={{ flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: colors.primaryColor }}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>Upgrade to Homiio+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// Normalize and sanitize property IDs coming from model output
function normalizePropertyIds(raw: unknown, max = 5): string[] {
  const tokens: string[] = [];
  const pushToken = (s: string) => {
    const trimmed = s.trim();
    if (!trimmed) return;
    // Filter out obvious junk; allow ObjectId-like or clean slug-like tokens
    const isObjectId = /^[a-f0-9]{24}$/i.test(trimmed);
    const isSlugLike = /^[A-Za-z0-9_-]{6,}$/i.test(trimmed) && !trimmed.includes('/') && !trimmed.includes(' ');
    if (isObjectId || isSlugLike) tokens.push(trimmed);
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') {
        // Split accidental concatenations like 'a/b/c' or 'a, b, c'
        String(item)
          .split(/[\s,\/]+/)
          .forEach(pushToken);
      } else if (typeof item === 'number') {
        pushToken(String(item));
      }
    }
  } else if (typeof raw === 'string') {
    String(raw)
      .split(/[\s,\/]+/)
      .forEach(pushToken);
  }

  // Dedupe and cap
  const deduped: string[] = [];
  for (const id of tokens) if (!deduped.includes(id)) deduped.push(id);
  return deduped.slice(0, max);
}

export default function ConversationDetail() {
  const { oxyServices, activeSessionId } = useOxy();
  const router = useRouter();
  const { t } = useTranslation();
  const { conversationId, message } = useLocalSearchParams<{
    conversationId: string;
    message?: string;
  }>();

  // Zustand store
  const {
    currentConversation,
    loading,
    loadConversation,
    generateShareToken,
  } = useConversationStore();

  // Create a custom fetch function that includes authentication
  const authenticatedFetch = useCallback(
    async (url: string, options: RequestInit = {}) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...((options.headers as Record<string, string>) || {}),
      };

      // Add authentication token if available
      if (oxyServices && activeSessionId) {
        try {
          const tokenData = await oxyServices.getTokenBySession(activeSessionId);
          if (tokenData) {
            headers['Authorization'] = `Bearer ${tokenData.accessToken}`;
          }
        } catch (error) {
          console.error('Failed to get authentication token:', error);
        }
      }

      // Create fetch options without null body
      const { body, ...otherOptions } = options;

      // If sending multipart, let fetch set the boundary header automatically
      if (typeof FormData !== 'undefined' && body instanceof FormData) {
        delete headers['Content-Type'];
      }
      const fetchOptions = {
        ...otherOptions,
        headers,
        ...(body !== null && { body }),
      };

      // On web, use the browser's native fetch to preserve ReadableStream semantics
      const fetchImpl: typeof globalThis.fetch = Platform.OS === 'web' ? (globalThis.fetch as any) : (expoFetch as any);
      return fetchImpl(url, fetchOptions as any);
    },
    [oxyServices, activeSessionId],
  );

  // Always call useChat, but only enable it if authenticated
  const isAuthenticated = !!oxyServices && !!activeSessionId;

  // Prepare initial messages from current conversation
  const initialMessages = React.useMemo(() => {
    if (currentConversation?.messages && currentConversation.messages.length > 0) {
      return currentConversation.messages.map((msg, index) => {
        const ts = (msg as any)?.timestamp
          ? new Date((msg as any).timestamp).getTime()
          : index;
        const stableId = msg.id || `${msg.role}-${ts}-${(msg.content || '').length}`;
        return {
          id: String(stableId),
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content,
        };
      });
    }
    return [];
  }, [currentConversation?.messages]);

  // no-op

  // Load conversation on mount
  useEffect(() => {
    if (conversationId && conversationId !== 'undefined' && isAuthenticated) {
      // Check if this is a client-side generated ID (starts with 'conv_')
      if (conversationId.startsWith('conv_')) {
        // This is a client-side ID, we need to create a new conversation
        return;
      }

      // Only try to load from database if it's a valid database ID
      loadConversation(conversationId, authenticatedFetch as unknown as typeof globalThis.fetch)
        .catch((error) => {
          console.error('Failed to load conversation:', error);
        });
    }
  }, [conversationId, isAuthenticated, loadConversation, authenticatedFetch]);



  // Early return for unauthenticated users
  if (!isAuthenticated) {
    return (
      <ThemedView style={styles.container} lightColor="transparent" darkColor="transparent">
        <Header
          options={{
            title: t('sindi.conversation.title'),
            showBackButton: true,
            rightComponents: [
              <TouchableOpacity
                key="share"
                onPress={() => {
                  /* TODO: Implement share */
                }}
              >
                <IconComponent name="share-outline" size={24} color={colors.COLOR_BLACK} />
              </TouchableOpacity>,
            ],
          }}
        />
        <EmptyState
          icon="lock-closed"
          title={t('sindi.auth.required')}
          description={t('sindi.auth.message')}
          actionText="Sign In"
          actionIcon="log-in"
          onAction={() => router.push('/profile')}
          iconColor={colors.primaryColor}
        />
      </ThemedView>
    );
  }

  if (loading) {
    return (
      <ThemedView style={styles.container} lightColor="transparent" darkColor="transparent">
        <Header
          options={{
            title: t('sindi.conversation.loading'),
            showBackButton: true,
          }}
        />
        <View style={styles.loadingContainer}>
          <IconComponent name="hourglass" size={48} color={colors.primaryColor} />
          <Text style={styles.loadingText}>{t('sindi.conversation.loadingMessage')}</Text>
        </View>
      </ThemedView>
    );
  }

  // Web-specific styles for sticky positioning
  const webStyles =
    Platform.OS === 'web'
      ? {
        container: { height: '100vh', display: 'flex', flexDirection: 'column' } as any,
        stickyHeader: { position: 'sticky', top: 0 } as any,
        messagesContainer: { marginTop: 0, marginBottom: 0, flex: 1, overflow: 'auto' } as any,
        stickyInput: { position: 'sticky', bottom: 0 } as any,
        messagesContent: { paddingBottom: 100 },
      }
      : {};

  return (
    <SafeAreaView style={[styles.container, (webStyles as any).container]}>
      <LinearGradient
        colors={["#ffffff", `${colors.primaryColor}40`]}
        style={styles.backgroundGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      {/* Header */}
      <Header
        options={{
          title: currentConversation?.title || t('sindi.conversation.title'),
          subtitle: t('sindi.conversation.subtitle'),
          showBackButton: true,
          rightComponents: [
            <TouchableOpacity
              key="share"
              onPress={async () => {
                if (!currentConversation || currentConversation.id.startsWith('conv_')) {
                  Alert.alert(
                    t('sindi.shared.share.error.title'),
                    t('sindi.shared.share.error.saveFirst'),
                  );
                  return;
                }

                // Don't allow sharing empty conversations
                if (!currentConversation.messages || currentConversation.messages.length === 0) {
                  Alert.alert(
                    t('sindi.shared.share.error.title'),
                    t('sindi.shared.share.error.emptyConversation'),
                  );
                  return;
                }

                try {
                  // Generate share token using store method
                  const shareToken = await generateShareToken(
                    currentConversation.id,
                    authenticatedFetch as unknown as typeof globalThis.fetch,
                  );

                  if (shareToken) {
                    const shareUrl = `${Platform.OS === 'web' ? window.location.origin : 'https://homiio.com'}/sindi/shared/${shareToken}`;

                    if (Platform.OS === 'web' && navigator.share) {
                      navigator.share({
                        title: currentConversation.title,
                        text: t('sindi.shared.share.text'),
                        url: shareUrl,
                      });
                    } else if (Platform.OS === 'web') {
                      navigator.clipboard.writeText(shareUrl);
                      Alert.alert(
                        t('sindi.shared.share.success.title'),
                        t('sindi.shared.share.success.copied'),
                      );
                    }
                  } else {
                    Alert.alert(
                      t('sindi.shared.share.error.title'),
                      t('sindi.shared.share.error.failed'),
                    );
                  }
                } catch (error) {
                  console.error('Failed to share conversation:', error);
                  Alert.alert(
                    t('sindi.shared.share.error.title'),
                    t('sindi.shared.share.error.failed'),
                  );
                }
              }}
            >
              <IconComponent name="share-outline" size={24} color={colors.COLOR_BLACK} />
            </TouchableOpacity>,
          ],
        }}
      />
      <ChatContent
        key={`${conversationId || 'new'}|${initialMessages.length}`}
        conversationId={conversationId}
        currentConversation={currentConversation}
        isAuthenticated={isAuthenticated}
        authenticatedFetch={authenticatedFetch as unknown as typeof globalThis.fetch}
        initialMessages={initialMessages}
        messageFromUrl={message as string | undefined}
      />
    </SafeAreaView>
  );
}

// Stable, top-level component to fetch and render property cards from IDs
const PropertiesFromIds = React.memo(function PropertiesFromIds({ ids }: { ids: string[] }) {
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ['chat-properties', ...ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const results: any[] = [];
      for (const id of ids) {
        try {
          const p = await propertyService.getPropertyById(id);
          if (p) { // Only push non-null properties
            results.push(p);
          }
        } catch {
          // ignore missing/bad ids
        }
      }
      return results;
    },
  });

  if (!data || data.length === 0) return null;

  // Filter out any null/undefined properties before rendering
  const validProperties = data.filter((property: any) => property && (property._id || property.id));

  if (validProperties.length === 0) return null;

  return (
    <View style={styles.propertyCardsContainer}>
      {validProperties.map((property: any) => (
        <PropertyCard
          key={property._id || property.id}
          property={property}
          orientation={'horizontal'}
          variant={'compact'}
          onPress={() => router.push(`/properties/${property._id || property.id}`)}
          showFavoriteButton={false}
        />
      ))}
    </View>
  );
});

// Chat pane that mounts after conversation load and initializes useChat with initial history
export function ChatContent({
  conversationId,
  currentConversation,
  isAuthenticated,
  authenticatedFetch,
  initialMessages,
  messageFromUrl,
  style,
}: {
  conversationId?: string;
  currentConversation?: Conversation | null;
  isAuthenticated: boolean;
  authenticatedFetch: typeof globalThis.fetch;
  initialMessages: { id: string; role: 'user' | 'assistant' | 'system'; content: string }[];
  messageFromUrl?: string;
  style?: any;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const bottomSheet = React.useContext(BottomSheetContext);
  const { oxyServices, activeSessionId } = useOxy();
  const [attachedFile, setAttachedFile] = React.useState<any>(null);
  const [isUploading, setIsUploading] = React.useState(false);
  const [isStreamingFile] = React.useState(false);
  const [streamingAssistantText] = React.useState('');
  const lastSyncedHash = React.useRef<string>('');
  const lastMsgKeyRef = React.useRef<string>('');
  const scrollViewRef = React.useRef<ScrollView>(null);
  const messageSentRef = React.useRef<string>(''); // Track which messageFromUrl was sent

  // Get user entitlements for subscription checks
  const {
    data: entitlements,
  } = useQuery({
    queryKey: ['entitlements'],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; entitlements: Entitlements }>(
        '/api/profiles/me/entitlements',
        { oxyServices, activeSessionId: activeSessionId || undefined }
      );
      if (!data?.success) {
        throw new Error('Failed to load entitlements');
      }
      return data.entitlements || null;
    },
    enabled: !!oxyServices && !!activeSessionId,
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 10, // 10 minutes
  });

  const plusActive = entitlements?.plusActive || false;
  const fileCredits = entitlements?.fileCredits || 0;

  const scrollToEnd = React.useCallback(() => {
    try {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    } catch { }
  }, []);

  const {
    updateConversationMessages,
    saveConversation,
  } = useConversationStore();

  // Hermes-friendly markdown renderer for chat messages
  const renderInlineSpans = React.useCallback((text: string, baseStyle: any, keyPrefix: string) => {
    // Handle inline code first: `code`
    const codeSplit = text.split(/(`[^`]+`)/g);
    const nodes: React.ReactNode[] = [];
    codeSplit.forEach((segment, i) => {
      const codeMatch = segment.match(/^`([^`]+)`$/);
      if (codeMatch) {
        nodes.push(
          <Text key={`${keyPrefix}-code-${i}`} style={[baseStyle, styles.codeInline]}>
            {codeMatch[1]}
          </Text>,
        );
      } else if (segment) {
        // Handle inline bold: **text**
        const boldSplit = segment.split(/(\*\*[^*]+\*\*)/g);
        const boldNodes: React.ReactNode[] = [];
        boldSplit.forEach((boldSegment, j) => {
          const boldMatch = boldSegment.match(/^\*\*([^*]+)\*\*$/);
          if (boldMatch) {
            boldNodes.push(
              <Text key={`${keyPrefix}-bold-${i}-${j}`} style={[baseStyle, styles.markdownBold]}>
                {boldMatch[1]}
              </Text>,
            );
          } else if (boldSegment) {
            // Handle markdown links: [text](https://...)
            const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
            let lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = linkRegex.exec(boldSegment)) !== null) {
              const [full, label, url] = match;
              const before = boldSegment.substring(lastIndex, match.index);
              if (before) boldNodes.push(
                <Text key={`${keyPrefix}-txt-${i}-${j}-${lastIndex}`} style={baseStyle}>{before}</Text>,
              );
              boldNodes.push(
                <Text
                  key={`${keyPrefix}-lnk-${i}-${j}-${match.index}`}
                  style={[baseStyle, styles.link]}
                  onPress={() => Linking.openURL(url)}
                  suppressHighlighting
                >
                  {label}
                </Text>,
              );
              lastIndex = match.index + full.length;
            }
            const rest = boldSegment.substring(lastIndex);
            if (rest) boldNodes.push(
              <Text key={`${keyPrefix}-rest-${i}-${j}-${lastIndex}`} style={baseStyle}>{rest}</Text>,
            );
          }
        });
        nodes.push(...boldNodes);
      }
    });
    return nodes;
  }, []);

  const renderMarkdown = React.useCallback((content: string, role: 'user' | 'assistant') => {
    if (!content) return null;
    const lines = content.split('\n');
    const out: React.ReactNode[] = [];
    const baseTextStyle = [styles.markdownParagraph, role === 'user' ? styles.userText : styles.assistantText];

    let inCodeBlock = false;
    let codeBuffer: string[] = [];
    // keep simple code fence support without language highlighting

    const flushCode = (key: string) => {
      if (codeBuffer.length === 0) return;
      const codeText = codeBuffer.join('\n');
      out.push(
        <View key={`code-${key}`} style={styles.codeBlock}>
          <Text style={[styles.codeText, role === 'user' ? styles.userText : styles.assistantText]}>
            {codeText}
          </Text>
        </View>,
      );
      codeBuffer = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i] ?? '';
      const line = raw.replace(/\s+$/, '');
      const key = `ln-${i}`;

      const fence = line.match(/^```\s*(\w+)?\s*$/);
      if (fence) {
        if (!inCodeBlock) {
          inCodeBlock = true;
        } else {
          inCodeBlock = false;
          flushCode(key);
        }
        continue;
      }

      if (inCodeBlock) {
        codeBuffer.push(line);
        continue;
      }

      const trimmed = line.trim();
      if (!trimmed) {
        out.push(<View key={`sp-${key}`} style={{ height: 6 }} />);
        continue;
      }

      // Headings
      if (trimmed.startsWith('# ')) {
        const text = trimmed.substring(2);
        out.push(
          <Text key={key} style={[styles.markdownH1, role === 'user' ? styles.userText : styles.assistantText]}>
            {text}
          </Text>,
        );
        continue;
      }
      if (trimmed.startsWith('## ')) {
        const text = trimmed.substring(3);
        out.push(
          <Text key={key} style={[styles.markdownH2, role === 'user' ? styles.userText : styles.assistantText]}>
            {text}
          </Text>,
        );
        continue;
      }
      if (trimmed.startsWith('### ')) {
        const text = trimmed.substring(4);
        out.push(
          <Text key={key} style={[styles.markdownH3, role === 'user' ? styles.userText : styles.assistantText]}>
            {text}
          </Text>,
        );
        continue;
      }

      // Bold
      if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
        const text = trimmed.substring(2, trimmed.length - 2);
        out.push(
          <Text key={key} style={[styles.markdownBold, role === 'user' ? styles.userText : styles.assistantText]}>
            {renderInlineSpans(text, [styles.markdownBold, role === 'user' ? styles.userText : styles.assistantText], `${key}-bold`) as any}
          </Text>,
        );
        continue;
      }

      // Lists
      const ulMatch = trimmed.match(/^[-*]\s+(.*)$/);
      const olMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
      if (ulMatch) {
        const text = ulMatch[1];
        out.push(
          <Text key={key} style={[styles.markdownListItem, role === 'user' ? styles.userText : styles.assistantText]}>
            • {renderInlineSpans(text, [styles.markdownListItem, role === 'user' ? styles.userText : styles.assistantText], `${key}-li`) as any}
          </Text>,
        );
        continue;
      }
      if (olMatch) {
        const num = olMatch[1];
        const text = olMatch[2];
        out.push(
          <Text key={key} style={[styles.markdownListItem, role === 'user' ? styles.userText : styles.assistantText]}>
            {num}. {renderInlineSpans(text, [styles.markdownListItem, role === 'user' ? styles.userText : styles.assistantText], `${key}-ol`) as any}
          </Text>,
        );
        continue;
      }

      // Blockquote
      if (trimmed.startsWith('> ')) {
        const text = trimmed.substring(2);
        out.push(
          <Text key={key} style={[styles.markdownBlockquote, role === 'user' ? styles.userText : styles.assistantText]}>
            {renderInlineSpans(text, [styles.markdownBlockquote, role === 'user' ? styles.userText : styles.assistantText], `${key}-bq`) as any}
          </Text>,
        );
        continue;
      }

      // Paragraph
      out.push(
        <Text key={key} style={baseTextStyle as any}>
          {renderInlineSpans(trimmed, baseTextStyle, `${key}-p`) as any}
        </Text>,
      );
    }

    // If file ends while in code block, flush
    if (inCodeBlock) flushCode('eof');

    return out;
  }, [renderInlineSpans]);

  const { messages, error, handleInputChange, input, handleSubmit, isLoading, append } = useChat({
    fetch: authenticatedFetch,
    api: `${API_URL}/api/ai/stream`,
    onError: (error: any) => console.error(error, 'ERROR'),
    enabled: isAuthenticated,
    initialMessages,
    body: {
      conversationId:
        conversationId && !conversationId.startsWith('conv_') ? conversationId : undefined,
    },
  } as any);

  // Sync messages to store (debounced; hash-gated)
  useEffect(() => {
    if (
      currentConversation &&
      messages.length > 0 &&
      conversationId &&
      conversationId !== 'undefined'
    ) {
      if (isLoading) return;

      const conversationMessages: ConversationMessage[] = messages.map((msg, index) => ({
        id: msg.id,
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
        timestamp:
          (currentConversation?.messages?.[index] as any)?.timestamp
            ? new Date((currentConversation as any).messages[index].timestamp)
            : new Date(),
      }));

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
            title:
              currentConversation.title === 'New Conversation' &&
                messages.length > 0 &&
                messages[0].role === 'user'
                ? messages[0].content.substring(0, 50) + (messages[0].content.length > 50 ? '...' : '')
                : currentConversation.title,
          } as Conversation;

          saveConversation(updatedConversation, authenticatedFetch)
            .then((savedConversation) => {
              if (savedConversation && savedConversation.id !== conversationId) {
                router.replace(`/sindi/${savedConversation.id}`);
              }
            })
            .catch((e) => console.error('Failed to save conversation:', e));
        }, 1000);

        return () => clearTimeout(timeoutId);
      }
    }

    scrollToEnd();
  }, [messages, currentConversation, conversationId, updateConversationMessages, saveConversation, authenticatedFetch, router, scrollToEnd, isLoading]);

  // Auto-scroll on new last message
  useEffect(() => {
    if (!messages.length) return;
    const last = messages[messages.length - 1];
    const key = `${last.id}|${messages.length}`;
    if (lastMsgKeyRef.current !== key) {
      lastMsgKeyRef.current = key;
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => scrollToEnd());
      } else {
        setTimeout(() => scrollToEnd(), 0);
      }
    }
  }, [messages, scrollToEnd]);

  // Auto-scroll while streaming file analysis
  useEffect(() => {
    if (isStreamingFile) {
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => scrollToEnd());
      } else {
        setTimeout(() => scrollToEnd(), 0);
      }
    }
  }, [isStreamingFile, streamingAssistantText, scrollToEnd]);

  // Automatically send message from URL parameter (e.g., from property bottom sheet)
  useEffect(() => {
    console.log('messageFromUrl useEffect triggered:', {
      messageFromUrl,
      hasConversation: !!currentConversation,
      alreadySent: messageSentRef.current,
      hasAppend: !!append
    });

    if (messageFromUrl && currentConversation && messageFromUrl !== messageSentRef.current && append) {
      console.log('Sending initial message from URL:', messageFromUrl);
      messageSentRef.current = messageFromUrl; // Mark this message as sent to prevent duplicates

      const decodedMessage = decodeURIComponent(messageFromUrl);
      console.log('Actually calling append with:', decodedMessage);
      append({
        id: `${Date.now()}-initial-message`,
        role: 'user',
        content: decodedMessage,
      });
    }
  }, [messageFromUrl, currentConversation, append]);

  const handleAttachFile = async () => {
    try {
      // Check subscription status for file uploads
      if (!plusActive && fileCredits <= 0) {
        // Show subscription upsell
        bottomSheet?.openBottomSheet(
          <FilePremiumInfoSheet
            onClose={() => bottomSheet?.closeBottomSheet()}
            onUpgrade={() => {
              bottomSheet?.closeBottomSheet();
              router.push('/profile/subscriptions');
            }}
          />,
        );
        return;
      }

      // Show one-time premium info bottom sheet on first attempt for non-subscribers
      if (!plusActive) {
        const alreadyShown = await getData<boolean>(FILE_UPSELL_KEY);
        if (!alreadyShown) {
          await storeData(FILE_UPSELL_KEY, true);
          bottomSheet?.openBottomSheet(
            <FilePremiumInfoSheet
              onClose={() => bottomSheet?.closeBottomSheet()}
              onUpgrade={() => {
                bottomSheet?.closeBottomSheet();
                router.push('/profile/subscriptions');
              }}
            />,
          );
          // Do not open the picker on this first tap; user can try again after reading
          return;
        }
      }

      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setAttachedFile(result.assets[0]);
      }
    } catch (e) {
      console.error('File pick error:', e);
    }
  };

  const handleRemoveFile = () => setAttachedFile(null);

  const handleSubmitWithFile = React.useCallback(async () => {
    try {
      // If a file is attached, send the file (and optional text) appropriately
      const trimmed = (input || '').trim();
      if (attachedFile) {
        if (isUploading) return; // guard against double submits
        setIsUploading(true);
        const asset = attachedFile;
        const formData = new FormData();

        if (Platform.OS === 'web') {
          // Fetch the blob from the uri for web
          const resp = await fetch(asset.uri);
          const blob = await resp.blob();
          const file = new File([blob], asset.name || 'upload', {
            type: asset.mimeType || blob.type || 'application/octet-stream',
          });
          formData.append('file', file);
        } else {
          formData.append('file', {
            uri: asset.uri,
            name: asset.name || 'upload',
            type: asset.mimeType || 'application/octet-stream',
          } as any);
          if (trimmed) {
            formData.append('text', trimmed);
          }
        }

        if (Platform.OS === 'web') {
          // Unify with chat: embed the image/PDF as a data URL hidden tag; let /api/ai/stream handle multimodal
          const resp = await fetch(asset.uri);
          const blob = await resp.blob();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onerror = () => reject(new Error('Failed to read file'));
            fr.onload = () => resolve(String(fr.result));
            fr.readAsDataURL(blob);
          });

          // Send one user message that includes a visible stub and a hidden data URL tag
          append({
            id: `${Date.now()}-user-file`,
            role: 'user',
            content: `${trimmed ? `${trimmed}\n\n` : ''}Sent a file: ${asset.name || 'attachment'}\n${(blob.type || asset.mimeType || '').startsWith('application/pdf')
              ? `<FILE_DATA_URL>${dataUrl}</FILE_DATA_URL>`
              : `<IMAGE_DATA_URL>${dataUrl}</IMAGE_DATA_URL>`}`,
          });

          setAttachedFile(null);
          setIsUploading(false);
          return;
        } else {
          // Native: fall back to JSON endpoint
          // Optimistically append a user message including any provided text and a file upload stub
          append({ id: `${Date.now()}-user-file`, role: 'user', content: `${trimmed ? `${trimmed}\n\n` : ''}Sent a file: ${asset.name || 'attachment'}` });
          const res = await authenticatedFetch(`${API_URL}/api/ai/analyze-file`, {
            method: 'POST',
            body: formData as any,
          });

          if (!res.ok) {
            const txt = await res.text();
            throw new Error(txt || 'Failed to analyze file');
          }
          const data = await res.json();

          // Append assistant response
          if (data?.output) {
            append({ id: `${Date.now()}-assistant-file`, role: 'assistant', content: String(data.output) });
          }

          setAttachedFile(null);
          setIsUploading(false);
          return;
        }
      }

      // Fallback to normal text submit
      handleSubmit();
    } catch (e: any) {
      console.error('File upload failed:', e);
      Alert.alert('Upload failed', e?.message || 'Could not analyze the file.');
    } finally {
      if (isUploading) setIsUploading(false);
    }
  }, [attachedFile, input, append, authenticatedFetch, handleSubmit, isUploading]);

  const handleSuggestionPress = React.useCallback(
    (text: string) => {
      handleInputChange({ target: { value: text } } as any);
      setTimeout(() => handleSubmitWithFile(), 0);
    },
    [handleInputChange, handleSubmitWithFile],
  );

  const webStyles =
    Platform.OS === 'web'
      ? {
        messagesContainer: { marginTop: 0, marginBottom: 0, flex: 1, overflow: 'auto' } as any,
        stickyInput: { position: 'sticky', bottom: 0 } as any,
        messagesContent: { paddingBottom: 100 },
      }
      : {} as any;

  return (
    <>
      {/* Error banner if chat stream fails */}
      {error && (
        <LinearGradient
          colors={[colors.primaryColor, colors.secondaryLight]}
          style={styles.errorContainer}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <View style={styles.errorContent}>
            <IconComponent name="alert-circle" size={48} color="white" />
            <Text style={styles.errorText}>{t('sindi.errors.connection')}</Text>
            <Text style={styles.errorSubtext}>{t('sindi.errors.connectionMessage')}</Text>
          </View>
        </LinearGradient>
      )}

      {/* Messages */}
      <ScrollView
        ref={scrollViewRef}
        style={[styles.messagesContainer, webStyles.messagesContainer, style]}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.messagesContent, webStyles.messagesContent]}
      >
        {messages.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyCard}>
              <View style={styles.emptyIconContainer}>
                <SindiIcon size={56} color={colors.primaryColor} />
              </View>
              <Text style={styles.emptyTitle}>Start your conversation</Text>
              <Text style={styles.emptySubtitle}>
                Ask about tenant rights, explore housing options, or get a quick lease review.
              </Text>
              <View style={styles.suggestionsWrap}>
                <TouchableOpacity
                  style={styles.suggestionChip}
                  onPress={() => handleSuggestionPress('What are my rights if my rent increases by 20%?')}
                >
                  <IconComponent name="help-circle-outline" size={16} color={colors.primaryColor} />
                  <Text style={styles.suggestionText}>Tenant rights</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.suggestionChip}
                  onPress={() => handleSuggestionPress('Find 2-bedroom apartments under $2000 in Seattle')}
                >
                  <IconComponent name="search-outline" size={16} color={colors.primaryColor} />
                  <Text style={styles.suggestionText}>Find housing</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.suggestionChip}
                  onPress={() => handleSuggestionPress('Can you review my lease for red flags?')}
                >
                  <IconComponent name="document-text-outline" size={16} color={colors.primaryColor} />
                  <Text style={styles.suggestionText}>Lease review</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.suggestionChip}
                  onPress={() => handleSuggestionPress('How should I respond to an eviction notice?')}
                >
                  <IconComponent name="alert-circle-outline" size={16} color={colors.primaryColor} />
                  <Text style={styles.suggestionText}>Eviction help</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : (
          messages.map((m) => (
            <View
              key={m.id}
              style={[
                styles.messageContainer,
                m.role === 'user' ? styles.userMessage : styles.assistantMessage,
              ]}
            >
              {/* Property cards for user messages - show BEFORE the bubble with enhanced styling */}
              {(() => {
                if (m.role === 'user' && typeof m.content === 'string') {
                  const startTag = '<PROPERTIES_JSON>';
                  const endTag = '</PROPERTIES_JSON>';
                  const startIdx = m.content.indexOf(startTag);
                  const endIdx = m.content.indexOf(endTag);

                  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                    const jsonStr = m.content.substring(startIdx + startTag.length, endIdx).trim();
                    try {
                      const parsed = JSON.parse(jsonStr);
                      const normalized = normalizePropertyIds(parsed);
                      if (normalized.length > 0) {
                        return (
                          <View style={styles.userPropertyCardsContainer}>
                            <PropertiesFromIds ids={normalized} />
                          </View>
                        );
                      }
                    } catch (e) {
                      console.warn('Failed to parse PROPERTIES_JSON for user message:', e);
                    }
                  }
                }
                return null;
              })()}

              <View
                style={[
                  styles.messageBubble,
                  m.role === 'user' ? styles.userBubble : styles.assistantBubble,
                ]}
              >
                {(() => {
                  // Support PROPERTIES_JSON parsing for both assistant AND user messages
                  if ((m.role === 'assistant' || m.role === 'user') && typeof m.content === 'string') {
                    const startTag = '<PROPERTIES_JSON>';
                    const endTag = '</PROPERTIES_JSON>';
                    const startIdx = m.content.indexOf(startTag);
                    const endIdx = m.content.indexOf(endTag);
                    let visible = m.content;
                    let idList: string[] | null = null;
                    const isLatestAssistant = m.role === 'assistant' && messages[messages.length - 1]?.id === m.id;
                    const canHydrateCards = !(isLatestAssistant && isLoading);
                    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                      const jsonStr = m.content.substring(startIdx + startTag.length, endIdx).trim();
                      visible = (m.content.substring(0, startIdx) + m.content.substring(endIdx + endTag.length)).trim();
                      try {
                        const parsed = JSON.parse(jsonStr);
                        const normalized = normalizePropertyIds(parsed);
                        if (normalized.length > 0) idList = normalized;
                      } catch (e) {
                        console.warn('Failed to parse PROPERTIES_JSON:', e);
                      }
                    }

                    // For user messages: Only show text content in bubble, property cards are shown above
                    if (m.role === 'user') {
                      return (
                        <>
                          {!!visible && (
                            <View style={{ flexShrink: 1, flexWrap: 'wrap', width: '100%' }}>
                              {renderMarkdown(visible, m.role)}
                            </View>
                          )}
                        </>
                      );
                    }

                    // For assistant messages: Show both text and property cards inside bubble (existing behavior)
                    return (
                      <>
                        {!!visible && (
                          <View style={{ flexShrink: 1, flexWrap: 'wrap', width: '100%' }}>
                            {renderMarkdown(visible, m.role)}
                          </View>
                        )}
                        {idList && idList.length > 0 && canHydrateCards && <PropertiesFromIds ids={idList} />}
                      </>
                    );
                  }

                  if (m.role === 'system' && m.content.startsWith('PROPERTY SEARCH RESULTS:')) {
                    const lines = m.content.split('\n').filter((line) => line.startsWith('- '));
                    const properties = lines
                      .map((line) => {
                        const match = line.match(/^- (.*?) \((.*?)(?:,\s*([^\)]+))?\)(?:,\s*(.*))?$/);
                        if (match) {
                          const title = match[1];
                          const type = match[2];
                          const price = parseFloat(match[3] || '0');
                          const city = match[4] || '';
                          const id = `${title}-${city}`;
                          return { id, title, type, price, currency: 'USD', city };
                        }
                        return undefined;
                      })
                      .filter((p): p is any => !!p);
                    return (
                      <View key={m.id || m.content} style={styles.propertyCardsContainer}>
                        {properties.map((property, idx) => {
                          // Additional safety check for null/undefined property
                          if (!property) return null;

                          // Convert parsed property data to Property interface format
                          const propertyData: any = {
                            _id: property.id || `temp-${idx}`,
                            id: property.id || `temp-${idx}`,
                            type: property.type || 'apartment',
                            rent: {
                              amount: property.price || 0,
                              currency: property.currency || 'USD',
                              paymentFrequency: 'monthly' as const,
                              deposit: 0,
                              utilities: 'not_included' as const
                            },
                            address: {
                              street: '',
                              city: property.city || '',
                              state: '',
                              zipCode: '',
                              country: ''
                            },
                            status: 'active' as const,
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                            bedrooms: 1,
                            bathrooms: 1
                          };

                          return (
                            <PropertyCard
                              key={property.id || idx}
                              property={propertyData}
                              orientation='horizontal'
                              variant={'compact'}
                              onPress={() => router.push(`/properties/${property.id}`)}
                            />
                          );
                        }).filter(Boolean)}
                      </View>
                    );
                  }

                  return (
                    <View style={{ flexShrink: 1, flexWrap: 'wrap', width: '100%' }}>
                      {renderMarkdown(
                        m.role === 'user'
                          ? ((m.content || '')
                            .replace(/<IMAGE_DATA_URL>[\s\S]*?<\/IMAGE_DATA_URL>/i, '')
                            .replace(/<FILE_DATA_URL>[\s\S]*?<\/FILE_DATA_URL>/i, '')
                            .trim() || m.content)
                          : m.content,
                        m.role as 'user' | 'assistant',
                      )}
                    </View>
                  );
                })()}
              </View>

              <Text style={[styles.messageTime, m.role === 'user' ? styles.messageTimeUser : styles.messageTimeAssistant]}>
                {m.role === 'user' ? t('sindi.chat.you') : t('sindi.name')} • {new Date().toLocaleTimeString()}
              </Text>
            </View>
          ))
        )}

        {/* Live assistant bubble during file streaming (web) */}
        {isStreamingFile && (
          <View
            style={[styles.messageContainer, styles.assistantMessage]}
          >
            <View style={[styles.messageBubble, styles.assistantBubble]}>
              <View style={{ flexShrink: 1, flexWrap: 'wrap', width: '100%' }}>
                {renderMarkdown(streamingAssistantText || 'Analyzing file…', 'assistant')}
              </View>
            </View>
            <Text style={[styles.messageTime, styles.messageTimeAssistant]}>
              {t('sindi.name')} • {new Date().toLocaleTimeString()}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Sticky Input */}
      <View style={[styles.stickyInput, webStyles.stickyInput]}>
        <View style={styles.inputBar}>
          <View style={styles.inputContainer}>
            {attachedFile && (
              <View style={styles.filePreviewContainer}>
                <Text style={styles.filePreviewText}>{attachedFile.name}</Text>
                <TouchableOpacity onPress={handleRemoveFile} style={styles.removeFileButton}>
                  <IconComponent name="close-circle" size={18} color="#e74c3c" />
                </TouchableOpacity>
              </View>
            )}
            <View style={styles.inputWrapper}>
              <TouchableOpacity onPress={handleAttachFile} style={styles.attachButton}>
                <IconComponent name="attach" size={20} color="#54656f" />
              </TouchableOpacity>
              <TextInput
                style={styles.textInput}
                placeholder={t('sindi.chat.placeholder')}
                placeholderTextColor="#667781"
                value={input}
                onChangeText={(text) => handleInputChange({ target: { value: text } } as any)}
                onSubmitEditing={Platform.OS !== 'web' ? handleSubmitWithFile : undefined}
                onKeyPress={(e: any) => {
                  const key = e?.nativeEvent?.key || e?.key;
                  const shift = e?.nativeEvent?.shiftKey || e?.shiftKey;
                  if (key === 'Enter' && !shift) {
                    if (Platform.OS === 'web') {
                      e.preventDefault?.();
                      e.stopPropagation?.();
                    }
                    if (!isLoading && !isUploading && (input.trim() || attachedFile)) {
                      handleSubmitWithFile();
                    }
                  }
                }}
                multiline
                blurOnSubmit={false}
                returnKeyType={Platform.OS === 'ios' ? 'send' : 'done'}
                maxLength={1000}
              />
              <TouchableOpacity
                style={[
                  styles.sendButtonPlain,
                  ((!input.trim() && !attachedFile) || isUploading) && styles.sendButtonDisabledPlain,
                ]}
                onPress={handleSubmitWithFile}
                disabled={(!input.trim() && !attachedFile) || isLoading || isUploading}
              >
                <IconComponent
                  name={(isLoading || isUploading) ? 'hourglass' : 'send'}
                  size={20}
                  color={(input.trim() || attachedFile) ? colors.primaryColor : '#99a2a7'}
                />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  backgroundGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  messagesContainer: {
    flex: 1,
    marginBottom: 72,
  },
  messagesContent: {
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  emptyContainer: {
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  emptyCard: {
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderColor: 'transparent',
  },
  emptyIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111b21',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#667781',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 8,
    marginBottom: 12,
  },
  suggestionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f0f2f5',
    borderWidth: 1,
    borderColor: '#e9edef',
    gap: 6,
  },
  suggestionText: {
    color: colors.primaryColor,
    fontSize: 13,
    fontWeight: '600',
  },
  messageContainer: {
    marginVertical: 2,
    paddingHorizontal: 4,
  },
  userMessage: {
    alignItems: 'flex-end',
    marginLeft: 40,
  },
  assistantMessage: {
    alignItems: 'flex-start',
    marginRight: 40,
  },
  messageBubble: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: 'transparent',
    elevation: 0,
    gap: 12,
  },
  userBubble: {
    backgroundColor: colors.primaryColor,
    borderTopRightRadius: 18,
  },
  assistantBubble: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e9edef',
    borderTopLeftRadius: 18,
  },
  timestampInBubble: { display: 'none' },
  timestampUser: { display: 'none' },
  timestampAssistant: { display: 'none' },
  stickyInput: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    backgroundColor: 'white',
    borderTopWidth: 1,
    borderTopColor: '#e9ecef',
  },
  inputBar: {
    backgroundColor: '#f0f2f5',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#e9edef',
  },
  inputContainer: {
    paddingHorizontal: 8,
    paddingVertical: 0,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#ffffff',
    borderRadius: 24,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#e9edef',
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    maxHeight: 120,
    paddingVertical: 8,
    paddingHorizontal: 6,
    color: '#111b21',
    lineHeight: 22,
  },
  sendButtonPlain: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  sendButtonDisabledPlain: {
    opacity: 0.5,
  },
  disclaimer: { display: 'none' },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    margin: 16,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK,
  },
  errorContent: {
    alignItems: 'center',
  },
  errorText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
    marginTop: 16,
    marginBottom: 8,
    fontFamily: 'Phudu',
  },
  errorSubtext: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
  },
  markdownParagraph: {
    fontSize: 15,
    lineHeight: 20,
    marginBottom: 2,
  },
  markdownBold: {
    fontWeight: '700',
  },
  markdownH1: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 26,
    marginTop: 8,
    marginBottom: 6,
  },
  markdownH2: {
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
    marginTop: 8,
    marginBottom: 6,
  },
  markdownH3: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
    marginTop: 8,
    marginBottom: 4,
  },
  markdownListItem: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 2,
  },
  markdownBlockquote: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#e9edef',
    paddingLeft: 8,
    fontStyle: 'italic',
  },
  userText: {
    color: 'white',
  },
  assistantText: {
    color: '#111b21',
  },
  link: {
    textDecorationLine: 'underline',
    color: '#1b72e8',
  },
  codeInline: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    backgroundColor: 'rgba(0,0,0,0.06)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  codeBlock: {
    backgroundColor: '#f6f8fa',
    borderWidth: 1,
    borderColor: '#e9edef',
    borderRadius: 8,
    padding: 8,
    marginVertical: 6,
  },
  codeText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 13,
    lineHeight: 18,
  },
  propertyCardsContainer: {
    gap: 12,
  },
  userPropertyCardsContainer: {
    marginTop: 4,
    marginBottom: 8, // More space before the bubble
    padding: 8,
    paddingBottom: 4,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e9ecef',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  filePreviewContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 8,
    padding: 6,
    marginBottom: 6,
  },
  filePreviewText: {
    color: 'white',
    fontSize: 13,
    marginRight: 8,
  },
  removeFileButton: {
    padding: 2,
  },
  attachButton: {
    marginRight: 8,
    padding: 4,
  },
  messageTime: {
    fontSize: 11,
    color: '#8696a0',
    marginTop: 2,
    marginHorizontal: 8,
  },
  messageTimeUser: {
    alignSelf: 'flex-end',
  },
  messageTimeAssistant: {
    alignSelf: 'flex-start',
  },
});

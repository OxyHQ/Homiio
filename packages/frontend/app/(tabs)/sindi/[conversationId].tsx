import React, { useCallback, useEffect, useMemo } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Text,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { Message } from '@ai-sdk/react';
import { fetch as expoFetch } from 'expo/fetch';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useOxy, showSignInModal } from '@oxyhq/services';
import { Header } from '@/components/Header';
import { EmptyState } from '@/components/ui/EmptyState';
import { ChatContent } from '@/components/sindi/ChatContent';
import { sindiStyles } from '@/components/sindi/styles';
import { useSindiShare } from '@/hooks/useSindiShare';
import { useConversationStore } from '@/store/conversationStore';
import { logger } from '@/utils/logger';
import { colors } from '@/styles/colors';

/** iOS keyboard offset accounting for the fixed Header height. */
const IOS_KEYBOARD_OFFSET = 64;

type ConversationFetch = typeof globalThis.fetch;

/**
 * Web layout overrides for the screen shell. RN's StyleSheet types reject the
 * web-only `100vh`/sticky values, so they are applied via typed inline
 * overrides (the standard escape hatch used across the app).
 */
const webContainer: ViewStyle | undefined =
  Platform.OS === 'web'
    ? ({
        height: '100vh' as unknown as number,
        display: 'flex' as const,
        flexDirection: 'column' as const,
      })
    : undefined;

/**
 * Sindi conversation route — a thin orchestrator.
 *
 * Responsibilities are limited to: building the authenticated fetch, loading
 * the conversation into the store, seeding the AI SDK history, and rendering
 * the auth/loading gates, header (with share), and the `ChatContent` pane.
 * All chat logic lives in `useSindiConversation`; presentation lives in
 * `components/sindi/*`.
 *
 * Safe area: the `Header` owns the top inset; `SafeAreaView edges={['bottom']}`
 * reserves the home-indicator gap; `KeyboardAvoidingView` lifts the composer
 * above the keyboard (iOS padding + Header offset; Android uses the native
 * `pan` layout mode configured in `app.config.js`).
 */
export default function ConversationDetail() {
  const { oxyServices, activeSessionId } = useOxy();
  const { t } = useTranslation();
  const { conversationId, message } = useLocalSearchParams<{
    conversationId: string;
    message?: string;
  }>();

  const { currentConversation, loading, loadConversation, generateShareToken } =
    useConversationStore();

  const isAuthenticated = Boolean(oxyServices) && Boolean(activeSessionId);

  // Authenticated fetch shared by conversation loading, the chat stream, and
  // share-token minting. On web we use the browser's native fetch to preserve
  // ReadableStream streaming semantics; native uses expo/fetch.
  const authenticatedFetch = useCallback<ConversationFetch>(
    async (input, init = {}) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...((init.headers as Record<string, string>) || {}),
      };

      if (oxyServices && activeSessionId) {
        try {
          const tokenData = await oxyServices.getTokenBySession(activeSessionId);
          if (tokenData) {
            headers['Authorization'] = `Bearer ${tokenData.accessToken}`;
          }
        } catch (error) {
          logger.error('Failed to get authentication token:', error);
        }
      }

      const { body, ...rest } = init;

      // Let fetch set the multipart boundary header automatically.
      if (typeof FormData !== 'undefined' && body instanceof FormData) {
        delete headers['Content-Type'];
      }

      const fetchOptions: RequestInit = {
        ...rest,
        headers,
        ...(body !== null ? { body } : {}),
      };

      const fetchImpl =
        Platform.OS === 'web'
          ? globalThis.fetch
          : (expoFetch as unknown as ConversationFetch);
      return fetchImpl(input, fetchOptions);
    },
    [oxyServices, activeSessionId],
  );

  // Seed the AI SDK with the conversation's persisted history.
  const initialMessages = useMemo<Message[]>(() => {
    const stored = currentConversation?.messages;
    if (!stored || stored.length === 0) return [];
    return stored.map((msg, index) => {
      const ts = msg.timestamp ? new Date(msg.timestamp).getTime() : index;
      const stableId = msg.id || `${msg.role}-${ts}-${(msg.content || '').length}`;
      return {
        id: String(stableId),
        role: msg.role,
        content: msg.content,
      };
    });
  }, [currentConversation?.messages]);

  // Load the conversation on mount (skip client-generated `conv_*` IDs, which
  // are created lazily on first message).
  useEffect(() => {
    if (!isAuthenticated || !conversationId || conversationId === 'undefined') return;
    if (conversationId.startsWith('conv_')) return;

    loadConversation(conversationId, authenticatedFetch).catch((error) => {
      logger.error('Failed to load conversation:', error);
    });
  }, [conversationId, isAuthenticated, loadConversation, authenticatedFetch]);

  const handleShare = useSindiShare({
    currentConversation,
    generateShareToken,
    authenticatedFetch,
  });

  if (!isAuthenticated) {
    return (
      <View style={sindiStyles.container}>
        <Header options={{ title: t('sindi.conversation.title'), showBackButton: true }} />
        <EmptyState
          icon="lock-closed"
          title={t('sindi.auth.required')}
          description={t('sindi.auth.message')}
          actionText="Sign In"
          actionIcon="log-in"
          onAction={() => showSignInModal()}
          iconColor={colors.primaryColor}
        />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={sindiStyles.container}>
        <Header options={{ title: t('sindi.conversation.loading'), showBackButton: true }} />
        <View style={sindiStyles.loadingContainer}>
          <Ionicons name="hourglass" size={48} color={colors.primaryColor} />
          <Text style={sindiStyles.loadingText}>{t('sindi.conversation.loadingMessage')}</Text>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={[sindiStyles.container, webContainer]} edges={['bottom']}>
      <LinearGradient
        colors={[colors.white, `${colors.primaryColor}40`]}
        style={sindiStyles.backgroundGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <Header
        options={{
          title: currentConversation?.title || t('sindi.conversation.title'),
          subtitle: t('sindi.conversation.subtitle'),
          showBackButton: true,
          rightComponents: [
            <TouchableOpacity
              key="share"
              onPress={handleShare}
              accessibilityRole="button"
              accessibilityLabel={t('common.share')}
            >
              <Ionicons name="share-outline" size={24} color={colors.COLOR_BLACK} />
            </TouchableOpacity>,
          ],
        }}
      />
      <KeyboardAvoidingView
        style={sindiStyles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? IOS_KEYBOARD_OFFSET : 0}
      >
        <ChatContent
          key={`${conversationId || 'new'}|${initialMessages.length}`}
          conversationId={conversationId}
          currentConversation={currentConversation}
          isAuthenticated={isAuthenticated}
          authenticatedFetch={authenticatedFetch}
          initialMessages={initialMessages}
          messageFromUrl={message}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

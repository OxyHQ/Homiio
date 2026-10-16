import { useEffect, useMemo } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { Message } from '@ai-sdk/react';
import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { Button } from '@oxy.so/bloom/button';
import { RiLockLine, RiLoginBoxLine, RiShare2Line } from '@oxy.so/bloom/icons';
import { Loading } from '@oxy.so/bloom/loading';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { useOxy, openAccountDialog } from '@oxy.so/services';
import { EmptyState } from '@/components/ui/EmptyState';
import { ChatContent } from '@/components/sindi/ChatContent';
import { useSindiShare } from '@/hooks/useSindiShare';
import { useSindiAuthenticatedFetch } from '@/hooks/useSindiAuthenticatedFetch';
import { useConversationStore } from '@/store/conversationStore';
import { logger } from '@/utils/logger';
import { colors } from '@/styles/colors';

/** iOS keyboard offset accounting for the page header height. */
const IOS_KEYBOARD_OFFSET = 64;

/**
 * Sindi conversation route — a thin orchestrator.
 *
 * Responsibilities are limited to: building the authenticated fetch, loading
 * the conversation into the store, seeding the AI SDK history, and rendering
 * the auth/loading gates, header (with share), and the `ChatContent` pane.
 * All chat logic lives in `useSindiConversation`; presentation lives in
 * `components/sindi/*`.
 *
 * Safe area: the app shell owns the insets; `KeyboardAvoidingView` lifts the
 * composer above the keyboard (iOS padding + header offset; Android uses the
 * native `pan` layout mode configured in `app.config.js`).
 */
export default function ConversationDetail() {
  const { oxyServices, activeSessionId } = useOxy();
  const { t } = useTranslation();
  const router = useRouter();
  const { conversationId, message } = useLocalSearchParams<{
    conversationId: string;
    message?: string;
  }>();

  const { currentConversation, loading, loadConversation, generateShareToken } =
    useConversationStore();

  const isAuthenticated = Boolean(oxyServices) && Boolean(activeSessionId);

  // Authenticated fetch shared by conversation loading, the chat stream, and
  // share-token minting (web-vs-native split + FormData handling lives in the
  // shared hook — the single source of truth across every Sindi surface).
  const authenticatedFetch = useSindiAuthenticatedFetch();

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
      <>
        <PageHeader
          title={t('sindi.conversation.title')}
          titleAlign="center"
          leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
          onBack={router.canGoBack() ? router.back : undefined}
          backLabel={t('goBack')}
        />
        <EmptyState
          icon={RiLockLine}
          title={t('sindi.auth.required')}
          description={t('sindi.auth.message')}
          actionText="Sign In"
          actionIcon={RiLoginBoxLine}
          onAction={() => openAccountDialog()}
          iconColor={colors.primaryColor}
        />
      </>
    );
  }

  if (loading) {
    return (
      <>
        <PageHeader
          title={t('sindi.conversation.loading')}
          titleAlign="center"
          leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
          onBack={router.canGoBack() ? router.back : undefined}
          backLabel={t('goBack')}
        />
        <Loading size="lg" text={t('sindi.conversation.loadingMessage')} style={styles.loading} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={currentConversation?.title || t('sindi.conversation.title')}
        subtitle={t('sindi.conversation.subtitle')}
        titleAlign="center"
        leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
        onBack={router.canGoBack() ? router.back : undefined}
        backLabel={t('goBack')}
        actions={
          <Button
            iconOnly
            leadingIcon={RiShare2Line}
            onPress={handleShare}
            accessibilityLabel={t('common.share')}
            tone="neutral"
            appearance="outline"
          />
        }
      />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? IOS_KEYBOARD_OFFSET : 0}
      >
        <ChatContent
          key={`${conversationId || 'new'}|${initialMessages.length}`}
          // The chat IS the screen here, so acting means going to the
          // destination: "muéstrame pisos" has nowhere else to land. The
          // executor holds the navigation until the turn stops streaming,
          // because this screen is inside `<Slot/>` and navigating unmounts the
          // chat mid-answer. It no longer matters whether the person happens to
          // have left the side panel open on a wide window — that flag used to
          // decide whether this surface acted at all.
          host="screen"
          conversationId={conversationId}
          currentConversation={currentConversation}
          isAuthenticated={isAuthenticated}
          authenticatedFetch={authenticatedFetch}
          initialMessages={initialMessages}
          messageFromUrl={message}
          // THIS host owns `/sindi/:id`, so promoting a new conversation's id
          // is a correction of its own address. The side panel passes a
          // different callback and the main pane is never touched (#519 §8.7).
          onConversationPersisted={(id) => router.replace(`/sindi/${id}`)}
        />
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loading: {
    flex: 1,
  },
});

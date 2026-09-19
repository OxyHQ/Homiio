import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Message } from '@ai-sdk/react';
import {
  AdmonitionButton,
  AdmonitionContent,
  AdmonitionIcon,
  AdmonitionRoot,
  AdmonitionRow,
  AdmonitionText,
} from '@oxy.so/bloom/admonition';
import { useSindiAppContext } from '@/hooks/useSindiAppContext';
import { useSindiConversation } from '@/hooks/useSindiConversation';
import { useSindiUpsell } from '@/hooks/useSindiUpsell';
import type { Conversation } from '@/store/conversationStore';
import { ChatComposer } from './ChatComposer';
import { ChatMessageList } from './ChatMessageList';
import { SindiActionCard } from './SindiActionCard';
import { extractPropertiesJson } from './propertyParsing';

type ConversationFetch = typeof globalThis.fetch;

export interface ChatContentProps {
  conversationId?: string;
  currentConversation?: Conversation | null;
  isAuthenticated: boolean;
  authenticatedFetch: ConversationFetch;
  initialMessages: Message[];
  messageFromUrl?: string;
  /** Optional style applied to the chat column (bottom-sheet host). */
  style?: StyleProp<ViewStyle>;
  /**
   * A new conversation just got its real id. The HOST decides what that means.
   *
   * Absent for a host with no route of its own (the property bottom sheet),
   * which then simply keeps its local id. See #519 §8.7 and
   * `useSindiConversation`'s `onConversationPersisted`.
   */
  onConversationPersisted?: (conversationId: string) => void;
  /**
   * Whether this host can drive the app at all.
   *
   * `false` for the in-property bottom sheet: it floats over a listing the user
   * is reading, so navigating the page beneath it is the same failure as
   * navigating behind the overlay panel's scrim. With no context, no action is
   * emitted for the turn and the chat answers in prose and cards.
   */
  canSendAppContext?: boolean;
}

/**
 * Chat pane: error callout, the thread and the composer, stacked as Bloom's
 * ai-chat container stacks them (thread flexes, footer holds the thinking
 * state and the composer). Mounts after the conversation is loaded and seeds
 * the AI SDK with the existing history.
 *
 * Reused by the full-screen Sindi route, the docked `SindiPanel` and the
 * in-property `SindiChatBottomSheet`; each host gives it a bounded height.
 */
export function ChatContent({
  conversationId,
  currentConversation,
  isAuthenticated,
  authenticatedFetch,
  initialMessages,
  messageFromUrl,
  style,
  onConversationPersisted,
  canSendAppContext = true,
}: ChatContentProps) {
  const { t } = useTranslation();
  const { openUpsell } = useSindiUpsell();
  const appContext = useSindiAppContext();

  const {
    messages,
    error,
    input,
    isLoading,
    isUploading,
    needsConsent,
    isRequestingConsent,
    attachedFile,
    scrollViewRef,
    onChangeInput,
    onSubmit,
    onStop,
    onAttachFile,
    onRemoveFile,
    onSuggestionPress,
    onRequestConsent,
    actions,
    takeAction,
  } = useSindiConversation({
    conversationId,
    currentConversation,
    isAuthenticated,
    authenticatedFetch,
    initialMessages,
    messageFromUrl,
    onOpenUpsell: openUpsell,
    ...(canSendAppContext ? { appContext } : {}),
    ...(onConversationPersisted ? { onConversationPersisted } : {}),
  });

  const last = messages[messages.length - 1];
  const hasStreamedText =
    last?.role === 'assistant' &&
    typeof last.content === 'string' &&
    extractPropertiesJson(last.content).visible.trim().length > 0;

  return (
    <View style={[styles.column, style]}>
      {error ? (
        <AdmonitionRoot type={needsConsent ? 'warning' : 'error'} style={styles.callout}>
          <AdmonitionRow>
            <AdmonitionIcon />
            <AdmonitionContent>
              <AdmonitionText style={styles.calloutTitle}>
                {needsConsent ? t('sindi.errors.consentTitle') : t('sindi.errors.connection')}
              </AdmonitionText>
              <AdmonitionText>
                {needsConsent
                  ? t('sindi.errors.consentMessage')
                  : t('sindi.errors.connectionMessage')}
              </AdmonitionText>
              {needsConsent ? (
                <AdmonitionButton
                  onPress={onRequestConsent}
                  disabled={isRequestingConsent}
                  loading={isRequestingConsent}
                >
                  {isRequestingConsent
                    ? t('sindi.errors.consentRequesting')
                    : t('sindi.errors.consentAction')}
                </AdmonitionButton>
              ) : null}
            </AdmonitionContent>
          </AdmonitionRow>
        </AdmonitionRoot>
      ) : null}

      <ChatMessageList
        ref={scrollViewRef}
        messages={messages}
        isLoading={isLoading}
        onSuggestionPress={onSuggestionPress}
      />

      {/* What Sindi did, or is offering to do. Above the composer so it reads as
          the tail of the answer rather than as part of the input. */}
      {actions.map((execution) => (
        <SindiActionCard
          key={execution.envelope.actionId}
          execution={execution}
          onTake={takeAction}
        />
      ))}

      <ChatComposer
        input={input}
        onChangeText={onChangeInput}
        onSubmit={onSubmit}
        onStop={onStop}
        onAttachFile={onAttachFile}
        onRemoveFile={onRemoveFile}
        attachedFile={attachedFile}
        isLoading={isLoading}
        isUploading={isUploading}
        disabled={needsConsent || isRequestingConsent}
        hasStreamedText={hasStreamedText}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    flex: 1,
    minHeight: 0,
    width: '100%',
  },
  callout: {
    marginHorizontal: 16,
    marginTop: 12,
  },
  calloutTitle: {
    fontWeight: '600',
  },
});

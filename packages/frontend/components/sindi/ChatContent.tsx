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
import { useSindiConversation } from '@/hooks/useSindiConversation';
import { useSindiUpsell } from '@/hooks/useSindiUpsell';
import type { Conversation } from '@/store/conversationStore';
import { ChatComposer } from './ChatComposer';
import { ChatMessageList } from './ChatMessageList';
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
}: ChatContentProps) {
  const { t } = useTranslation();
  const { openUpsell } = useSindiUpsell();

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
  } = useSindiConversation({
    conversationId,
    currentConversation,
    isAuthenticated,
    authenticatedFetch,
    initialMessages,
    messageFromUrl,
    onOpenUpsell: openUpsell,
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
        messageCount={messages.length}
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

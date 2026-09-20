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
import { useSindiControlCapability, type SindiChatHost } from '@/components/sindi/sindiHost';
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
   * WHICH SURFACE is rendering this chat.
   *
   * Required, and it replaced a `canSendAppContext` boolean that meant "I am
   * the bottom sheet" in everything but name. The host is what decides whether
   * Sindi may act and what acting looks like here
   * (`components/sindi/sindiHost.ts`); whether a context is sent follows from
   * that rather than being a second switch somebody can set the other way.
   */
  host: SindiChatHost;
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
  host,
  conversationId,
  currentConversation,
  isAuthenticated,
  authenticatedFetch,
  initialMessages,
  messageFromUrl,
  style,
  onConversationPersisted,
}: ChatContentProps) {
  const { t } = useTranslation();
  const { openUpsell } = useSindiUpsell();
  const capability = useSindiControlCapability(host);
  const appContext = useSindiAppContext(capability);

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
    host,
    conversationId,
    currentConversation,
    isAuthenticated,
    authenticatedFetch,
    initialMessages,
    messageFromUrl,
    onOpenUpsell: openUpsell,
    // A host that cannot act asks for nothing to act on. The server emits an
    // action only for a turn that carried a context, so this is also what keeps
    // the in-property sheet — which floats over a listing somebody chose to
    // read — out of the action path entirely.
    ...(capability.canControlApp ? { appContext } : {}),
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

import React from 'react';
import { Platform, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { Message } from '@ai-sdk/react';
import { useSindiConversation } from '@/hooks/useSindiConversation';
import { useSindiUpsell } from '@/hooks/useSindiUpsell';
import { colors } from '@/styles/colors';
import type { Conversation } from '@/store/conversationStore';
import { ChatComposer } from './ChatComposer';
import { ChatMessageList } from './ChatMessageList';
import { sindiStyles } from './styles';

type ConversationFetch = typeof globalThis.fetch;

/**
 * Web sticky-positioning for the composer. RN's StyleSheet types reject the
 * web-only `position: 'sticky'`, so it is applied via a typed inline override
 * (the standard escape hatch used across the app).
 */
const webStickyInput: ViewStyle | undefined =
  Platform.OS === 'web'
    ? ({
        position: 'sticky' as unknown as ViewStyle['position'],
        bottom: 0,
      })
    : undefined;

export interface ChatContentProps {
  conversationId?: string;
  currentConversation?: Conversation | null;
  isAuthenticated: boolean;
  authenticatedFetch: ConversationFetch;
  initialMessages: Message[];
  messageFromUrl?: string;
  /** Optional style applied to the message scroll container (bottom-sheet host). */
  style?: StyleProp<ViewStyle>;
}

/**
 * Chat pane: error banner, scrollable message list, and composer. Mounts after
 * the conversation is loaded and seeds the AI SDK with the existing history.
 *
 * Reused in two places: the full-screen Sindi route and the in-property
 * `SindiChatBottomSheet`. The prop contract is intentionally stable so both
 * hosts share one implementation.
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
    attachedFile,
    scrollViewRef,
    onChangeInput,
    onSubmit,
    onAttachFile,
    onRemoveFile,
    onSuggestionPress,
  } = useSindiConversation({
    conversationId,
    currentConversation,
    isAuthenticated,
    authenticatedFetch,
    initialMessages,
    messageFromUrl,
    onOpenUpsell: openUpsell,
  });

  return (
    <>
      {error ? (
        <LinearGradient
          colors={[colors.primaryColor, colors.secondaryLight]}
          style={sindiStyles.errorContainer}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <View style={sindiStyles.errorContent}>
            <Ionicons name="alert-circle" size={48} color={colors.primaryForeground} />
            <Text style={sindiStyles.errorText}>{t('sindi.errors.connection')}</Text>
            <Text style={sindiStyles.errorSubtext}>{t('sindi.errors.connectionMessage')}</Text>
          </View>
        </LinearGradient>
      ) : null}

      <ChatMessageList
        ref={scrollViewRef}
        messages={messages}
        isLoading={isLoading}
        onSuggestionPress={onSuggestionPress}
        style={style}
      />

      <ChatComposer
        input={input}
        onChangeText={onChangeInput}
        onSubmit={onSubmit}
        onAttachFile={onAttachFile}
        onRemoveFile={onRemoveFile}
        attachedFile={attachedFile}
        isLoading={isLoading}
        isUploading={isUploading}
        stickyStyle={webStickyInput}
      />
    </>
  );
}

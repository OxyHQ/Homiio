import React, { useRef } from 'react';
import { Platform, ScrollView, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import type { Message } from '@ai-sdk/react';
import { ChatEmptyState } from './ChatEmptyState';
import { ChatMessage } from './ChatMessage';

export interface ChatMessageListProps {
  messages: Message[];
  isLoading: boolean;
  onSuggestionPress: (prompt: string) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * The conversation thread, laid out exactly as Bloom's `AiChatThread`
 * (bottom-anchored, px 16 / pt 16, turns 12 apart).
 *
 * It is a plain `ScrollView` rather than `AiChatThread` itself because the
 * thread keeps its scroll ref private: `useSindiConversation` owns the ref and
 * scrolls to the end when a conversation opens, where `AiChatThread` only
 * follows content that GROWS after its first measure — a long restored history
 * would open at its oldest turn.
 */
export const ChatMessageList = React.forwardRef<ScrollView, ChatMessageListProps>(
  ({ messages, isLoading, onSuggestionPress, style }, ref) => {
    const lastIndex = messages.length - 1;

    // Turns present when the thread mounted are history and mount settled; only
    // turns that arrive afterwards play Bloom's blur-in.
    const historyIds = useRef<Set<string> | null>(null);
    if (historyIds.current === null) {
      historyIds.current = new Set(messages.map((message) => message.id));
    }

    return (
      <ScrollView
        ref={ref}
        style={[styles.scroll, style]}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {messages.length === 0 ? (
          <ChatEmptyState onSuggestionPress={onSuggestionPress} />
        ) : (
          messages.map((message, index) => (
            <ChatMessage
              key={message.id}
              message={message}
              isLast={index === lastIndex}
              isLoading={isLoading}
              animate={!historyIds.current?.has(message.id)}
            />
          ))
        )}
      </ScrollView>
    );
  },
);
ChatMessageList.displayName = 'ChatMessageList';

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    minHeight: 0,
    width: '100%',
  },
  content: {
    // react-native-web gives every view `min-height: 0`, so a flex-grown content
    // box stays the viewport's height and overflows instead of scrolling; the
    // percentage floor keeps it bottom-anchored AND scrollable (Bloom's fix).
    ...(Platform.OS === 'web' ? { minHeight: '100%', flexShrink: 0 } : { flexGrow: 1 }),
    justifyContent: 'flex-end',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
});

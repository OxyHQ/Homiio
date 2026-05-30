import React from 'react';
import {
  Platform,
  ScrollView,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { Message } from '@ai-sdk/react';
import { ChatEmptyState } from './ChatEmptyState';
import { ChatMessage } from './ChatMessage';
import { sindiStyles } from './styles';

/**
 * Web overrides for the scroll container. On web the messages area is a
 * `position: sticky` flex child that scrolls natively; RN's StyleSheet types
 * reject the web-only `overflow: 'auto'` so it is applied via a typed inline
 * override here (the standard escape hatch used across the app).
 */
const webMessagesContainer: ViewStyle | undefined =
  Platform.OS === 'web'
    ? ({
        marginTop: 0,
        marginBottom: 0,
        flex: 1,
        overflow: 'auto' as unknown as ViewStyle['overflow'],
      })
    : undefined;

const webMessagesContent: ViewStyle | undefined =
  Platform.OS === 'web' ? { paddingBottom: 100 } : undefined;

export interface ChatMessageListProps {
  messages: Message[];
  isLoading: boolean;
  onSuggestionPress: (prompt: string) => void;
  /** Optional style applied to the scroll container (used by the bottom sheet host). */
  style?: StyleProp<ViewStyle>;
}

/**
 * Scrollable message list: empty-state hero when there are no messages, the
 * rendered conversation otherwise. The parent owns the ref to drive
 * scroll-to-bottom.
 */
export const ChatMessageList = React.forwardRef<ScrollView, ChatMessageListProps>(
  ({ messages, isLoading, onSuggestionPress, style }, ref) => {
    const lastIndex = messages.length - 1;

    return (
      <ScrollView
        ref={ref}
        style={[sindiStyles.messagesContainer, webMessagesContainer, style]}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[sindiStyles.messagesContent, webMessagesContent]}
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
            />
          ))
        )}
      </ScrollView>
    );
  },
);
ChatMessageList.displayName = 'ChatMessageList';

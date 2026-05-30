import React from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { Message } from '@ai-sdk/react';
import { PropertyCard } from '@/components/PropertyCard';
import { ChatMarkdown } from './ChatMarkdown';
import { PropertiesFromIds } from './PropertiesFromIds';
import {
  extractPropertiesJson,
  isPropertySearchResults,
  parseSearchResultLines,
  stripAttachmentDataUrls,
} from './propertyParsing';
import { sindiStyles } from './styles';

export interface ChatMessageProps {
  message: Message;
  /** Whether this is the most recent message in the list. */
  isLast: boolean;
  /** Whether a stream is currently in flight (gates card hydration on the live bubble). */
  isLoading: boolean;
}

/** Property cards rendered above a user bubble (from an embedded PROPERTIES_JSON block). */
const UserPropertyCards: React.FC<{ content: string }> = ({ content }) => {
  const { ids } = extractPropertiesJson(content);
  if (!ids) return null;
  return (
    <View style={sindiStyles.userPropertyCardsContainer}>
      <PropertiesFromIds ids={ids} />
    </View>
  );
};

/** Legacy `PROPERTY SEARCH RESULTS:` system message rendered as a stack of cards. */
const SearchResultCards: React.FC<{ content: string }> = ({ content }) => {
  const router = useRouter();
  const properties = parseSearchResultLines(content);
  if (properties.length === 0) return null;
  return (
    <View style={sindiStyles.propertyCardsContainer}>
      {properties.map((property) => {
        const key = property._id || property.id;
        return (
          <PropertyCard
            key={key}
            property={property}
            orientation="horizontal"
            variant="compact"
            onPress={() => router.push(`/properties/${key}`)}
          />
        );
      })}
    </View>
  );
};

/**
 * A single chat message bubble.
 *
 * Handles the three structured-content cases the assistant can emit, preserving
 * the original rendering rules exactly:
 *  - User messages with `<PROPERTIES_JSON>` show property cards ABOVE the bubble
 *    and only the visible text inside it.
 *  - Assistant messages with `<PROPERTIES_JSON>` show text then cards INSIDE the
 *    bubble; cards are withheld while the latest assistant message is streaming.
 *  - `PROPERTY SEARCH RESULTS:` system messages render a card stack.
 *  - Everything else renders markdown, stripping attachment data-URL tags from
 *    user text.
 */
export const ChatMessage = React.memo<ChatMessageProps>(({ message, isLast, isLoading }) => {
  const { t } = useTranslation();
  const role = message.role;
  const content = typeof message.content === 'string' ? message.content : '';

  const isUser = role === 'user';
  const isStructuredRole = role === 'assistant' || role === 'user';

  const renderBody = (): React.ReactNode => {
    if (isStructuredRole) {
      const { visible, ids } = extractPropertiesJson(content);

      // User bubbles only show text; cards are rendered above the bubble.
      if (isUser) {
        return visible ? (
          <View style={sindiStyles.bubbleTextWrap}>
            <ChatMarkdown content={visible} role="user" />
          </View>
        ) : null;
      }

      // Assistant bubbles show text + cards; withhold cards while streaming live.
      const isLatestAssistant = role === 'assistant' && isLast;
      const canHydrateCards = !(isLatestAssistant && isLoading);
      return (
        <>
          {visible ? (
            <View style={sindiStyles.bubbleTextWrap}>
              <ChatMarkdown content={visible} role="assistant" />
            </View>
          ) : null}
          {ids && canHydrateCards ? <PropertiesFromIds ids={ids} /> : null}
        </>
      );
    }

    if (isPropertySearchResults(role, content)) {
      return <SearchResultCards content={content} />;
    }

    const text = isUser ? stripAttachmentDataUrls(content) : content;
    return (
      <View style={sindiStyles.bubbleTextWrap}>
        <ChatMarkdown content={text} role={isUser ? 'user' : 'assistant'} />
      </View>
    );
  };

  const timeLabel = isUser ? t('sindi.chat.you') : t('sindi.name');

  return (
    <View
      style={[
        sindiStyles.messageContainer,
        isUser ? sindiStyles.userMessage : sindiStyles.assistantMessage,
      ]}
    >
      {isUser ? <UserPropertyCards content={content} /> : null}

      <View
        style={[
          sindiStyles.messageBubble,
          isUser ? sindiStyles.userBubble : sindiStyles.assistantBubble,
        ]}
      >
        {renderBody()}
      </View>

      <Text
        style={[
          sindiStyles.messageTime,
          isUser ? sindiStyles.messageTimeUser : sindiStyles.messageTimeAssistant,
        ]}
      >
        {timeLabel} • {new Date().toLocaleTimeString()}
      </Text>
    </View>
  );
});
ChatMessage.displayName = 'ChatMessage';

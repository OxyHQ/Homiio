import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  AiChatAssistantMessage,
  AiChatMessageLine,
  AiChatUserMessage,
} from '@oxy.so/bloom/ai-chat';
import { PropertyCard } from '@/components/PropertyCard';
import { renderMarkdownBlocks } from './ChatMarkdown';
import { PropertiesFromIds } from './PropertiesFromIds';
import {
  extractPropertiesJson,
  isPropertySearchResults,
  parseSearchResultLines,
  stripAttachmentDataUrls,
} from './propertyParsing';

/** The fields of an AI SDK `Message` a turn renders (shared views pass stored rows). */
export interface ChatMessageData {
  id: string;
  role: string;
  content: unknown;
}

export interface ChatMessageProps {
  message: ChatMessageData;
  /** Whether this is the most recent message in the list. */
  isLast: boolean;
  /** Whether a stream is currently in flight (gates card hydration on the live bubble). */
  isLoading: boolean;
  /**
   * Play Bloom's blur-in. Turns restored from history (or a shared transcript)
   * mount settled; only turns that arrive while the thread is open animate.
   */
  animate?: boolean;
  /** A secondary line under the turn (the shared transcript's real timestamp). */
  footnote?: string;
}

/** Legacy `PROPERTY SEARCH RESULTS:` system message rendered as a stack of cards. */
const SearchResultCards: React.FC<{ content: string }> = ({ content }) => {
  const router = useRouter();
  const properties = parseSearchResultLines(content);
  if (properties.length === 0) return null;
  return (
    <View style={styles.cards}>
      {properties.map((property) => (
        <PropertyCard
          key={property.id}
          property={property}
          orientation="horizontal"
          variant="compact"
          onPress={() => router.push(`/properties/${property.id}`)}
        />
      ))}
    </View>
  );
};

/**
 * One turn of a Sindi conversation, drawn with Bloom's ai-chat turns.
 *
 * The structured-content rules are unchanged:
 *  - User messages with `<PROPERTIES_JSON>` show property cards ABOVE the
 *    bubble and only the visible text inside it.
 *  - Assistant messages with `<PROPERTIES_JSON>` show text then cards; cards are
 *    withheld while the latest assistant message is still streaming.
 *  - `PROPERTY SEARCH RESULTS:` system messages render a card stack.
 *  - Everything else renders markdown, stripping attachment data-URL tags from
 *    user text.
 */
export const ChatMessage = React.memo<ChatMessageProps>(
  ({ message, isLast, isLoading, animate = false, footnote }) => {
    const role = message.role;
    const content = typeof message.content === 'string' ? message.content : '';
    const isUser = role === 'user';

    const footnoteLine = footnote ? (
      <AiChatMessageLine tone="secondary">{footnote}</AiChatMessageLine>
    ) : null;

    if (isUser) {
      const { visible, ids } = extractPropertiesJson(content);
      const text = stripAttachmentDataUrls(visible).trim();
      return (
        <View style={styles.userTurn}>
          {ids ? (
            <View style={styles.cards}>
              <PropertiesFromIds ids={ids} />
            </View>
          ) : null}
          {text ? (
            <AiChatUserMessage animate={animate}>
              {renderMarkdownBlocks(text)}
            </AiChatUserMessage>
          ) : null}
          {footnote ? <View style={styles.userFootnote}>{footnoteLine}</View> : null}
        </View>
      );
    }

    if (isPropertySearchResults(role, content)) {
      return <SearchResultCards content={content} />;
    }

    const { visible, ids } = extractPropertiesJson(content);
    // Withhold card hydration on the reply that is still streaming.
    const canHydrateCards = !(role === 'assistant' && isLast && isLoading);
    return (
      <AiChatAssistantMessage animate={animate} feedback={false}>
        {renderMarkdownBlocks(visible)}
        {ids && canHydrateCards ? (
          <View key="properties" style={styles.cards}>
            <PropertiesFromIds ids={ids} />
          </View>
        ) : null}
        {footnoteLine}
      </AiChatAssistantMessage>
    );
  },
);
ChatMessage.displayName = 'ChatMessage';

const styles = StyleSheet.create({
  userTurn: {
    width: '100%',
    gap: 8,
  },
  userFootnote: {
    alignSelf: 'flex-end',
  },
  cards: {
    gap: 12,
  },
});

import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Card } from '@oxy.so/bloom/card';
import { RiChat3Line } from '@oxy.so/bloom/icons';
import { Item } from '@oxy.so/bloom/item';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text } from '@oxy.so/bloom/typography';
import { deviceTimeZone, formatDate } from '@homiio/shared-types';
import type { Conversation } from '@/store/conversationStore';
import { useFormatting } from '@/utils/format';
import { extractPropertiesJson, stripAttachmentDataUrls } from './propertyParsing';

/**
 * Compact label for a conversation's last-activity time (today → time, else
 * date), in the reader's chosen language rather than the device's.
 */
const formatTimestamp = (date: Date, locale: string, timeZone: string): string => {
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return formatDate(date, locale, timeZone, { hour: '2-digit', minute: '2-digit' });
  }
  return formatDate(date, locale, timeZone, { month: 'short', day: 'numeric' });
};

export interface ConversationItemProps {
  conversation: Conversation;
  onPress: () => void;
  /** Marks the row as the currently open conversation (panel selection). */
  isActive?: boolean;
  /** Empty-state preview text when the conversation has no messages yet. */
  emptyPreview?: string;
}

/**
 * One Sindi conversation as a Bloom `Item`: a chat glyph, the title with its
 * last-activity time, and a one-line preview of the latest message (with the
 * machine-only property and attachment tags removed).
 *
 * Shared by the `/sindi` index screen and the docked `SindiPanel`; group rows
 * in a `ConversationList`.
 */
export const ConversationItem = memo<ConversationItemProps>(
  ({ conversation, onPress, isActive = false, emptyPreview = 'No messages yet' }) => {
    const { colors } = useTheme();
    const { locale } = useFormatting();
    const last = conversation.messages[conversation.messages.length - 1];
    const preview = last
      ? stripAttachmentDataUrls(extractPropertiesJson(last.content || '').visible)
      : emptyPreview;

    return (
      <Item
        onPress={onPress}
        active={isActive}
        accessibilityLabel={conversation.title}
        leading={
          <View style={[styles.glyph, { backgroundColor: colors.backgroundSecondary }]}>
            <RiChat3Line width={18} height={18} fill={colors.textSecondary} />
          </View>
        }
        title={conversation.title}
        subtitle={
          <Text variant="body-2-regular" numberOfLines={1} style={{ color: colors.textSecondary }}>
            {preview}
          </Text>
        }
        trailing={
          <Text variant="caption-1-regular" style={{ color: colors.textTertiary }}>
            {formatTimestamp(new Date(conversation.updatedAt), locale, deviceTimeZone())}
          </Text>
        }
      />
    );
  },
);
ConversationItem.displayName = 'ConversationItem';

/** The card a run of `ConversationItem` rows sits in. */
export function ConversationList({ children }: { children: React.ReactNode }) {
  return (
    <Card variant="outlined" style={styles.list}>
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  glyph: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    padding: 4,
    gap: 2,
  },
});

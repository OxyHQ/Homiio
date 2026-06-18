import React, { memo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { radius, spacing, withShadow } from '@/constants/styles';
import { colors } from '@/styles/colors';
import type { Conversation } from '@/store/conversationStore';

/** Compact label for a conversation's last-activity time (today → time, else date). */
const formatTimestamp = (date: Date): string => {
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
};

export interface ConversationItemProps {
  conversation: Conversation;
  /** Suppresses the bottom hairline on the final row of a grouped list. */
  isLast: boolean;
  onPress: () => void;
  /** Marks the row as the currently open conversation (panel selection). */
  isActive?: boolean;
  /** Empty-state preview text when the conversation has no messages yet. */
  emptyPreview?: string;
}

/**
 * One row in a Sindi conversation list: avatar glyph, title + last-activity
 * time, and a single-line preview of the most recent message.
 *
 * Shared by the `/sindi` index screen and the docked `SindiPanel` so both
 * lists render identically. Owns its own pressed/active visuals (the function
 * form of `style` is unsupported under NativeWind — see CLAUDE.md).
 */
export const ConversationItem = memo<ConversationItemProps>(
  ({ conversation, isLast, onPress, isActive = false, emptyPreview = 'No messages yet' }) => {
    const last = conversation.messages[conversation.messages.length - 1];
    const [pressed, setPressed] = useState(false);
    return (
      <Pressable
        onPress={onPress}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={[
          styles.conversationItem,
          isLast && styles.conversationItemLast,
          (pressed || isActive) && styles.conversationItemPressed,
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected: isActive }}
        accessibilityLabel={conversation.title}
      >
        <View style={styles.conversationAvatar}>
          <Ionicons name="chatbubble" size={18} color={colors.info} />
        </View>
        <View style={styles.conversationBody}>
          <View style={styles.conversationHeader}>
            <BloomText style={styles.conversationTitle} numberOfLines={1}>
              {conversation.title}
            </BloomText>
            <BloomText style={styles.conversationDate}>
              {formatTimestamp(new Date(conversation.updatedAt))}
            </BloomText>
          </View>
          <BloomText style={styles.conversationPreview} numberOfLines={1}>
            {last ? last.content : emptyPreview}
          </BloomText>
        </View>
      </Pressable>
    );
  },
);
ConversationItem.displayName = 'ConversationItem';

const styles = StyleSheet.create({
  conversationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  conversationItemLast: {
    borderBottomWidth: 0,
  },
  conversationItemPressed: {
    backgroundColor: colors.mutedSubtle,
  },
  conversationAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.infoSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  conversationBody: {
    flex: 1,
    gap: 2,
  },
  conversationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  conversationTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  conversationDate: {
    fontSize: 12,
    color: colors.muted,
  },
  conversationPreview: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
  },
});

/** Card surface that hosts a list of `ConversationItem` rows (rounded, elevated). */
export const conversationListStyles = StyleSheet.create({
  list: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...withShadow('sm'),
  },
});

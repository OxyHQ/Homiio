/**
 * One row in a case's public coordination thread: author avatar + name, a
 * relative timestamp, the comment body, and a delete affordance shown only when
 * the viewer may remove it (its author or the case owner). The delete button is
 * the shared `IconButton` (which owns its own pressed state), so this row needs
 * no interaction hooks and is safe inside the thread's `.map`.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Avatar } from '@oxyhq/bloom/avatar';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import type { EvictionComment } from '@homiio/shared-types';

import { IconButton } from '@/components/ui/IconButton';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

interface EvictionCommentRowProps {
  comment: EvictionComment;
  authorName: string;
  avatarFileId?: string;
  time: string;
  canDelete: boolean;
  onDelete: () => void;
  deleteLabel: string;
}

export const EvictionCommentRow: React.FC<EvictionCommentRowProps> = ({
  comment,
  authorName,
  avatarFileId,
  time,
  canDelete,
  onDelete,
  deleteLabel,
}) => (
  <View style={styles.row}>
    <Avatar size={40} name={authorName} source={avatarFileId ?? null} variant="thumb" />
    <View style={styles.body}>
      <View style={styles.headerRow}>
        <BloomText style={styles.author} numberOfLines={1}>
          {authorName}
        </BloomText>
        <BloomText style={styles.time}>{time}</BloomText>
        {canDelete ? (
          <IconButton
            icon="trash-outline"
            variant="ghost"
            size={16}
            color={colors.textTertiary}
            accessibilityLabel={deleteLabel}
            onPress={onDelete}
          />
        ) : null}
      </View>
      <BloomText style={styles.text}>{comment.body}</BloomText>
    </View>
  </View>
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  author: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  time: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  text: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
});

export default EvictionCommentRow;

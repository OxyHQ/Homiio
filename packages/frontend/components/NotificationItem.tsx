/**
 * NotificationItem — one inbox row, a Bloom `Item`.
 *
 * Layout (left → right):
 *   [type disc]  title + 1-line preview        timestamp  [unread dot]  [delete]
 *
 * The disc pairs a subtle theme surface with its own ink per notification
 * type (the Bloom `IconCircle` tinting rule), the glyph is Remix, and unread
 * rows are signalled by a bolder title plus a brand dot rather than a fill.
 * Delete is an explicit icon button (long press still works on touch), so
 * it is reachable on web where long press is not.
 */
import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxy.so/bloom/button';
import {
  RiBankCardLine,
  RiChat3Fill,
  RiChat4Fill,
  RiDeleteBinLine,
  RiFilePaper2Line,
  RiGroupFill,
  RiHome5Fill,
  RiMegaphoneLine,
  RiNotification3Fill,
  RiQuestionLine,
} from '@oxy.so/bloom/icons';
import { Item } from '@oxy.so/bloom/item';
import { useTheme, type ThemeColors } from '@oxy.so/bloom/theme';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { spacing } from '@/constants/styles';

type IconComponent = React.ComponentType<{ width?: number; height?: number; fill?: string }>;

type NotificationItemProps = {
  type: string;
  title: string;
  description: string;
  time: string;
  read: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  onDelete?: () => void;
  style?: ViewStyle;
};

/** Theme key pair for a disc: the subtle surface and the ink drawn on it. */
type Tone = { surface: keyof ThemeColors; ink: keyof ThemeColors };

const TONES = {
  primary: { surface: 'primarySubtle', ink: 'primary' },
  info: { surface: 'infoSubtle', ink: 'info' },
  success: { surface: 'successSubtle', ink: 'success' },
  warning: { surface: 'warningSubtle', ink: 'warning' },
  negative: { surface: 'negativeSubtle', ink: 'negative' },
  neutral: { surface: 'backgroundSecondary', ink: 'textSecondary' },
} satisfies Record<string, Tone>;

/** Visual identity (glyph + tone) for each known notification type. */
const TYPE_VISUALS: Record<string, { icon: IconComponent; tone: Tone }> = {
  message: { icon: RiChat3Fill, tone: TONES.primary },
  property: { icon: RiHome5Fill, tone: TONES.info },
  contract: { icon: RiFilePaper2Line, tone: TONES.warning },
  payment: { icon: RiBankCardLine, tone: TONES.success },
  system: { icon: RiNotification3Fill, tone: TONES.neutral },
  eviction_update: { icon: RiMegaphoneLine, tone: TONES.negative },
  eviction_comment: { icon: RiChat4Fill, tone: TONES.primary },
  eviction_rsvp: { icon: RiGroupFill, tone: TONES.success },
  eviction_outcome_reminder: { icon: RiQuestionLine, tone: TONES.warning },
};

const DEFAULT_VISUAL = { icon: RiNotification3Fill, tone: TONES.neutral };

const ICON_SIZE = 20;

export function NotificationItem({
  type,
  title,
  description,
  time,
  read,
  onPress,
  onLongPress,
  onDelete,
  style,
}: NotificationItemProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { icon: Icon, tone } = TYPE_VISUALS[type] ?? DEFAULT_VISUAL;

  return (
    <Item
      role="listitem"
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      onLongPress={onLongPress}
      style={style}
      title={title}
      subtitle={description}
      titleStyle={read ? undefined : styles.titleUnread}
      leading={
        <View style={[styles.disc, { backgroundColor: colors[tone.surface] }]}>
          <Icon width={ICON_SIZE} height={ICON_SIZE} fill={colors[tone.ink]} />
        </View>
      }
      trailing={
        <View style={styles.trailing}>
          <View style={styles.meta}>
            <BloomText style={[styles.time, { color: colors.textTertiary }]} numberOfLines={1}>
              {time}
            </BloomText>
            {!read ? <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} /> : null}
          </View>
          {onDelete ? (
            <Button
              variant="ghost"
              size="small"
              iconOnly
              leadingIcon={RiDeleteBinLine}
              accessibilityLabel={t('notification.delete.title')}
              onPress={onDelete}
            />
          ) : null}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  disc: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleUnread: {
    fontWeight: '700',
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  meta: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  time: {
    fontSize: 12,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});

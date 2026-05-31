/**
 * NotificationItem — a single flat inbox row (Airbnb-2026).
 *
 * Layout (left → right):
 *   [type icon circle]  title + 1-line preview        timestamp
 *                                                      unread dot
 *
 * No card shadow, no tinted card background — the row sits directly on the
 * page surface and is separated from its neighbours by the list's hairline
 * gutter, matching the rest of the app's flat list aesthetic. Unread rows are
 * signalled by a bolder title + a brand dot, not by a coloured fill.
 *
 * NativeWind v4's css-interop rewrites the `style` prop and swallows React
 * Native's render-function form, so the pressed tint is driven by
 * onPressIn/onPressOut state over a static style array.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

type NotificationItemProps = {
  type: string;
  title: string;
  description: string;
  time: string;
  read: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: ViewStyle;
};

/** Visual identity (icon + accent tint) for each known notification type. */
type TypeVisual = { icon: IoniconName; color: string; surface: string };

const TYPE_VISUALS: Record<string, TypeVisual> = {
  message: {
    icon: 'chatbubble-ellipses',
    color: colors.primaryColor,
    surface: colors.infoSubtle,
  },
  property: {
    icon: 'home',
    color: colors.exchangeAccent,
    surface: colors.exchangeSubtle,
  },
  contract: {
    icon: 'document-text',
    color: colors.saleAccent,
    surface: colors.saleSubtle,
  },
  payment: {
    icon: 'card',
    color: colors.success,
    surface: colors.successSubtle,
  },
  system: {
    icon: 'notifications',
    color: colors.textSecondary,
    surface: colors.mutedSubtle,
  },
};

const DEFAULT_VISUAL: TypeVisual = {
  icon: 'notifications',
  color: colors.textSecondary,
  surface: colors.mutedSubtle,
};

const ICON_SIZE = 20;

export function NotificationItem({
  type,
  title,
  description,
  time,
  read,
  onPress,
  onLongPress,
  style,
}: NotificationItemProps) {
  const [pressed, setPressed] = useState(false);

  const visual = useMemo<TypeVisual>(
    () => TYPE_VISUALS[type] ?? DEFAULT_VISUAL,
    [type],
  );

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={[styles.row, pressed && styles.rowPressed, style]}
    >
      <View style={[styles.iconCircle, { backgroundColor: visual.surface }]}>
        <Ionicons name={visual.icon} size={ICON_SIZE} color={visual.color} />
      </View>

      <View style={styles.content}>
        <BloomText
          style={[styles.title, !read && styles.titleUnread]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {title}
        </BloomText>
        <BloomText
          style={styles.description}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {description}
        </BloomText>
      </View>

      <View style={styles.meta}>
        <BloomText style={styles.time} numberOfLines={1}>
          {time}
        </BloomText>
        {!read ? <View style={styles.unreadDot} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: 'transparent',
  },
  rowPressed: {
    backgroundColor: colors.mutedSubtle,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  titleUnread: {
    fontWeight: '700',
  },
  description: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  meta: {
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  time: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primaryColor,
  },
});

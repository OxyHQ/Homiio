/**
 * EmptyState — single empty UI used across the app whenever a list or
 * grid has nothing to show. Sits in place of the list content. Pattern:
 *
 *   icon
 *   title
 *   one-line subtitle
 *   action button (optional)
 *
 * Use this everywhere instead of inline "Nothing here yet" Text. Pairs
 * with ErrorState (network/fetch failure) and Skeleton.Box (loading).
 */
import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Button } from '@oxy.so/bloom/button';
import type { ButtonIconComponent } from '@oxy.so/bloom/button';
import { RiErrorWarningFill } from '@oxy.so/bloom/icons';
import { H3, Text as BloomText } from '@oxy.so/bloom/typography';

import { colors } from '@/styles/colors';
import { ICON_SIZES, spacing } from '@/constants/styles';

type EmptyStateProps = {
  /** A Bloom (Remix) icon component, e.g. `RiHomeLine` — never a glyph name. */
  icon?: ButtonIconComponent;
  title: string;
  description?: string;
  actionText?: string;
  /** Optional Remix icon component shown before the action label. */
  actionIcon?: ButtonIconComponent;
  onAction?: () => void;
  style?: ViewStyle;
  iconSize?: number;
  iconColor?: string;
};

export function EmptyState({
  icon: Icon = RiErrorWarningFill,
  title,
  description,
  actionText,
  actionIcon,
  onAction,
  style,
  iconSize = ICON_SIZES.xl,
  iconColor = colors.COLOR_BLACK_LIGHT_3,
}: EmptyStateProps) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.iconCircle}>
        <Icon width={iconSize} height={iconSize} fill={iconColor} />
      </View>

      <H3 style={styles.title}>{title}</H3>

      {description ? (
        <BloomText style={styles.description}>{description}</BloomText>
      ) : null}

      {actionText && onAction ? (
        <View style={styles.action}>
          <Button
            onPress={onAction}
            variant="primary"
            size="medium"
            leadingIcon={actionIcon}
          >
            {actionText}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing['4xl'],
    paddingHorizontal: spacing['2xl'],
    minHeight: 240,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  description: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
  },
  action: {
    marginTop: spacing.xl,
  },
});

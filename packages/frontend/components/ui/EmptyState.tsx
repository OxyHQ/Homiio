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
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@oxyhq/bloom/button';
import { H3, Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

type EmptyStateProps = {
  icon?: IoniconName;
  title: string;
  description?: string;
  actionText?: string;
  /** Optional Ionicon name shown inside the action button. */
  actionIcon?: IoniconName;
  onAction?: () => void;
  style?: ViewStyle;
  iconSize?: number;
  iconColor?: string;
};

export function EmptyState({
  icon = 'alert-circle-outline',
  title,
  description,
  actionText,
  actionIcon,
  onAction,
  style,
  iconSize = 28,
  iconColor = colors.COLOR_BLACK_LIGHT_3,
}: EmptyStateProps) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.iconCircle}>
        <Ionicons name={icon} size={iconSize} color={iconColor} />
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
            icon={
              actionIcon ? (
                <Ionicons name={actionIcon} size={16} color={colors.white} />
              ) : undefined
            }
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

/**
 * ErrorState — single error UI used across the app whenever a fetch
 * fails. Sits in place of the list/grid/card content. Pattern:
 *
 *   icon
 *   title
 *   one-line subtitle
 *   retry button (optional)
 *
 * Use this instead of inline "Something went wrong" Text inside every
 * screen. If the caller doesn't pass `onRetry`, the button is hidden and
 * we fall back to a help link.
 */
import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@oxyhq/bloom/button';
import { H3, Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface ErrorStateProps {
  /** Override the default cloud-with-cross icon. */
  icon?: IoniconName;
  title: string;
  /** Short, single-line explanation. Avoid stack traces. */
  description?: string;
  retryLabel?: string;
  onRetry?: () => void;
  style?: ViewStyle;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  icon = 'cloud-offline-outline',
  title,
  description,
  retryLabel = 'Try again',
  onRetry,
  style,
}) => {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.iconCircle}>
        <Ionicons name={icon} size={28} color={colors.COLOR_BLACK_LIGHT_3} />
      </View>
      <H3 style={styles.title}>{title}</H3>
      {description ? (
        <BloomText style={styles.description}>{description}</BloomText>
      ) : null}
      {onRetry ? (
        <View style={styles.action}>
          <Button onPress={onRetry} variant="primary" size="medium">
            {retryLabel}
          </Button>
        </View>
      ) : null}
    </View>
  );
};

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
    maxWidth: 320,
    lineHeight: 20,
  },
  action: {
    marginTop: spacing.xl,
  },
});

export default ErrorState;

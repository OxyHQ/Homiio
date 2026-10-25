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
import type React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Button } from '@oxy.so/bloom/button';
import type { ButtonIconComponent } from '@oxy.so/bloom/button';
import { RiAlertLine } from '@oxy.so/bloom/icons/RiAlertLine';
import { useTheme } from '@oxy.so/bloom/theme';
import { H3, Text as BloomText } from '@oxy.so/bloom/typography';

import { ICON_SIZES, spacing } from '@/constants/styles';

interface ErrorStateProps {
  /** Override the default warning icon with another Remix icon component. */
  icon?: ButtonIconComponent;
  title: string;
  /** Short, single-line explanation. Avoid stack traces. */
  description?: string;
  retryLabel?: string;
  onRetry?: () => void;
  style?: ViewStyle;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  icon: Icon = RiAlertLine,
  title,
  description,
  retryLabel = 'Try again',
  onRetry,
  style,
}) => {
  const { colors } = useTheme();
  return (
    <View style={[styles.container, style]}>
      <View className="bg-muted" style={styles.iconCircle}>
        <Icon width={ICON_SIZES.xl} height={ICON_SIZES.xl} fill={colors.textSecondary} />
      </View>
      <H3 style={styles.title}>{title}</H3>
      {description ? (
        <BloomText className="text-muted-foreground" style={styles.description}>
          {description}
        </BloomText>
      ) : null}
      {onRetry ? (
        <View style={styles.action}>
          <Button onPress={onRetry} size="md" tone="accent" appearance="solid">
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
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  description: {
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 320,
    lineHeight: 20,
  },
  action: {
    marginTop: spacing.xl,
  },
});

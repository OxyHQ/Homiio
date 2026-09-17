/**
 * The leading glyph for a Bloom `SettingsListItem` on the account screens
 * (profile, settings and their sub-screens).
 *
 * Remix icons do not inherit a colour, so the fill comes from the theme here:
 * secondary text for an ordinary row, the error ink for a destructive one.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { useTheme } from '@oxy.so/bloom/theme';

import { contentClamp, spacing } from '@/constants/styles';

export type SettingsIconComponent = React.ComponentType<{
  width?: number;
  height?: number;
  fill?: string;
}>;

export function SettingsRowIcon({
  icon: Icon,
  destructive,
}: {
  icon: SettingsIconComponent;
  destructive?: boolean;
}) {
  const { colors } = useTheme();
  return <Icon width={20} height={20} fill={destructive ? colors.error : colors.textSecondary} />;
}

/**
 * Content container for a screen made of `SettingsListGroup`s. Bloom 2's group
 * draws no horizontal inset of its own, so the screen supplies the gutter, and
 * clamps the width so rows do not run edge to edge on wide web.
 */
export const settingsScreenStyles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: contentClamp.copy,
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
});

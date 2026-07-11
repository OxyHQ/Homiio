/**
 * CardSurface — Airbnb-2026 flat card primitive.
 *
 * Wraps section content in a surface with the standard card radius and a 1px
 * hairline border (no shadow — Airbnb-flat, image-forward). The hairline is what
 * separates the card from the page: `surfaceElevated` resolves to the same value
 * as the page `background`, so a borderless flat card would be invisible.
 * Personal screens compose these instead of hand-rolling
 * `style={{ backgroundColor: …, borderRadius: …, borderWidth: … }}` everywhere.
 *
 * Usage:
 *   <CardSurface>
 *     <H3>Section title</H3>
 *     ...
 *   </CardSurface>
 */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

export interface CardSurfaceProps {
  children: React.ReactNode;
  /** Override container style (margin, width, etc.). */
  style?: StyleProp<ViewStyle>;
  /** Override inner padding. Defaults to `spacing.xl` (20). */
  padding?: number;
}

export const CardSurface: React.FC<CardSurfaceProps> = ({
  children,
  style,
  padding = spacing.xl,
}) => (
  <View style={[styles.card, { padding }, style]}>
    {children}
  </View>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
});

export default CardSurface;

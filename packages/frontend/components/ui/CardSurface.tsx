/**
 * CardSurface — Airbnb-2026 flat card primitive.
 *
 * Wraps section content in a white surface with the standard card radius and no
 * border or shadow (Airbnb-flat, image-forward). Personal screens compose these
 * instead of hand-rolling `style={{ backgroundColor: colors.white, borderRadius:
 * … }}` everywhere. The card is FLAT by default; pass `flat={false}` only for the
 * rare floating surface that genuinely needs the small elevation shadow.
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
import { radius, spacing, withShadow } from '@/constants/styles';

export interface CardSurfaceProps {
  children: React.ReactNode;
  /** Override container style (margin, width, etc.). */
  style?: StyleProp<ViewStyle>;
  /** Override inner padding. Defaults to `spacing.xl` (20). */
  padding?: number;
  /** Add the small elevation shadow. Defaults to `true` (flat). */
  flat?: boolean;
}

export const CardSurface: React.FC<CardSurfaceProps> = ({
  children,
  style,
  padding = spacing.xl,
  flat = true,
}) => (
  <View
    style={[
      styles.card,
      { padding },
      flat ? null : withShadow('sm'),
      style,
    ]}
  >
    {children}
  </View>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
  },
});

export default CardSurface;

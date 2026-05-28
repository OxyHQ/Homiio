/**
 * CardSurface — Airbnb-2026 lifted card primitive.
 *
 * Wraps section content in a white surface with the small Homiio shadow
 * (`withShadow('sm')`), the standard card radius, and zero border. Personal
 * screens compose these instead of hand-rolling `style={{ backgroundColor:
 * '#fff', borderRadius: …, shadow*: … }}` everywhere.
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
  /** Skip the elevation shadow (useful when the parent already provides one). */
  flat?: boolean;
}

export const CardSurface: React.FC<CardSurfaceProps> = ({
  children,
  style,
  padding = spacing.xl,
  flat = false,
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

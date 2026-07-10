/**
 * ThumbnailCard — the horizontal "thumbnail + body" list card.
 *
 * The application, reservation, and exchange-request cards all rendered the
 * same flat white surface (radius `lg`, a hairline `colors.border`, clipped
 * corners, `spacing.md` bottom margin) wrapping a fixed-size thumbnail next to a
 * flexible body, with an optional action row beneath. This owns that shell so the
 * three cards can't drift; each one supplies its own thumbnail node, body, press
 * handler, and optional actions.
 *
 * Layout:
 *   ┌─────────────────────────────┐
 *   │ [thumb]  body … (Pressable) │
 *   ├─────────────────────────────┤
 *   │ actions (optional footer)   │
 *   └─────────────────────────────┘
 *
 * The thumbnail + body row is the press target (so the footer's own buttons stay
 * independently tappable). When there are no actions the row is the whole card,
 * which matches the previous "the card itself is the Pressable" layout.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';
import { CardActionsFooter } from './CardActionsFooter';

/** Edge length of the square thumbnail slot. */
const THUMBNAIL_SIZE = 96;

export interface ThumbnailCardProps {
  /** Leading thumbnail node (typically a `ThumbnailImage`). */
  thumbnail: React.ReactNode;
  /** Body content rendered beside the thumbnail. */
  children: React.ReactNode;
  /** Press handler for the thumbnail + body row. */
  onPress?: () => void;
  /** Accessibility label for the pressable row. */
  accessibilityLabel?: string;
  /** Optional action buttons rendered in a footer below the row. */
  actions?: React.ReactNode;
}

export const ThumbnailCard: React.FC<ThumbnailCardProps> = ({
  thumbnail,
  children,
  onPress,
  accessibilityLabel,
  actions,
}) => (
  <View style={styles.card}>
    <Pressable
      style={styles.row}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.thumb}>{thumbnail}</View>
      <View style={styles.body}>{children}</View>
    </Pressable>
    {actions ? <CardActionsFooter>{actions}</CardActionsFooter> : null}
  </View>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
  },
  thumb: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
  },
  body: {
    flex: 1,
    padding: spacing.md,
    justifyContent: 'space-between',
  },
});

export default ThumbnailCard;

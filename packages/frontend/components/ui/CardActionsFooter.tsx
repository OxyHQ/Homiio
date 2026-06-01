/**
 * CardActionsFooter — the consistent action-button row at the bottom of a list
 * card.
 *
 * The reservation, exchange-request, and contract cards each hand-rolled the
 * same horizontal button row. This owns that one layout (a `flexDirection: row`
 * with `spacing.sm` gaps) so the spacing can't drift between cards.
 *
 * Two insets map to the two existing contexts:
 *   - `card`   (default): the footer sits directly below a clipped card body
 *              (e.g. a thumbnail card whose surface has `overflow: 'hidden'`),
 *              so it supplies its own bottom + horizontal padding.
 *   - `inline`: the footer lives inside an already-padded surface (e.g.
 *              `CardSurface`), so it only adds a small top margin and no padding.
 *
 * Children are the action buttons (typically Bloom `Button`s).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/constants/styles';

export interface CardActionsFooterProps {
  children: React.ReactNode;
  /** Padding context. Defaults to `card` (clipped card body above). */
  inset?: 'card' | 'inline';
}

export const CardActionsFooter: React.FC<CardActionsFooterProps> = ({
  children,
  inset = 'card',
}) => (
  <View style={[styles.row, inset === 'inline' ? styles.inline : styles.card]}>
    {children}
  </View>
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  card: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  inline: {
    marginTop: spacing.xs,
  },
});

export default CardActionsFooter;

/**
 * Stars — a compact, read-only star rating row (full / half / empty) drawn
 * with Ionicons. Shared by the property Community Notes blocks (the per-note
 * card and the section's rating summary), which previously each carried an
 * identical half-star copy differing only by glyph size.
 *
 * Half-star rule: a fractional part of >= 0.5 renders a `star-half`, otherwise
 * the star is empty. Always renders exactly `STAR_COUNT` glyphs.
 *
 * Note: pre-existing copies in `NeighborhoodRatingWidget` and `PropertyCard`
 * could adopt this later — left untouched here to keep the change focused.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@/styles/colors';

/** Total glyphs rendered (5-star scale). */
const STAR_COUNT = 5;
/** Fractional part at/above which a half star is shown. */
const HALF_STAR_THRESHOLD = 0.5;
/** Default glyph size (px). */
const DEFAULT_STAR_SIZE = 14;

interface StarsProps {
  /** Rating on a 0–5 scale. */
  rating: number;
  /** Glyph size in px. */
  size?: number;
  /** Filled/half-star tint. */
  color?: string;
}

export const Stars: React.FC<StarsProps> = ({
  rating,
  size = DEFAULT_STAR_SIZE,
  color = colors.ratingStar,
}) => {
  const fullStars = Math.floor(rating);
  const hasHalf = rating - fullStars >= HALF_STAR_THRESHOLD;
  const emptyStars = STAR_COUNT - fullStars - (hasHalf ? 1 : 0);

  return (
    <View style={styles.row}>
      {Array.from({ length: fullStars }).map((_, i) => (
        <Ionicons key={`f-${i}`} name="star" size={size} color={color} />
      ))}
      {hasHalf ? <Ionicons name="star-half" size={size} color={color} /> : null}
      {Array.from({ length: emptyStars }).map((_, i) => (
        <Ionicons
          key={`e-${i}`}
          name="star-outline"
          size={size}
          color={colors.COLOR_BLACK_LIGHT_5}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
});

export default Stars;

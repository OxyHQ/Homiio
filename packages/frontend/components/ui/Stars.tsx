/**
 * Stars — a compact, read-only star rating row (full / half / empty) drawn
 * with Bloom's Remix stars. Shared by the property Community Notes blocks (the
 * per-note card and the section's rating summary), which previously each
 * carried an identical half-star copy differing only by glyph size.
 *
 * Half-star rule: a fractional part of >= 0.5 renders a half star, otherwise
 * the star is empty. Always renders exactly `STAR_COUNT` glyphs. Bloom ships no
 * half-star glyph, so a half star is an empty star with the left half of a
 * filled star clipped over it.
 *
 * Note: pre-existing copies in `NeighborhoodRatingWidget` and `PropertyCard`
 * could adopt this later — left untouched here to keep the change focused.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { RiStarFill, RiStarLine } from '@oxy.so/bloom/icons';

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
  // Clamp to [0, STAR_COUNT] first: an out-of-range rating (e.g. > 5 or
  // negative) would otherwise make `emptyStars` negative, and
  // `Array.from({ length: negative })` throws a RangeError that unmounts the
  // whole section. Clamping keeps the row safe for any incoming value.
  const clampedRating = Math.max(0, Math.min(STAR_COUNT, rating));
  const fullStars = Math.floor(clampedRating);
  const hasHalf = clampedRating - fullStars >= HALF_STAR_THRESHOLD;
  const emptyStars = STAR_COUNT - fullStars - (hasHalf ? 1 : 0);

  return (
    <View style={styles.row}>
      {Array.from({ length: fullStars }).map((_, i) => (
        <RiStarFill key={`f-${i}`} width={size} height={size} fill={color} />
      ))}
      {hasHalf ? (
        <View style={{ width: size, height: size }}>
          <RiStarLine width={size} height={size} fill={color} />
          <View style={[styles.halfClip, { width: size / 2, height: size }]}>
            <RiStarFill width={size} height={size} fill={color} />
          </View>
        </View>
      ) : null}
      {Array.from({ length: emptyStars }).map((_, i) => (
        <RiStarLine
          key={`e-${i}`}
          width={size}
          height={size}
          fill={colors.COLOR_BLACK_LIGHT_5}
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
  halfClip: {
    position: 'absolute',
    top: 0,
    left: 0,
    overflow: 'hidden',
  },
});

export default Stars;

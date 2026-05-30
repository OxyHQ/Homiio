import React from 'react';
import { View, type DimensionValue, type ViewStyle } from 'react-native';
import { Skeleton } from '@oxyhq/bloom';

interface TextLinesProps {
  /** Number of placeholder lines (defaults to 1). */
  lines?: number;
  /**
   * Width of the last line — typically narrower than 100% to hint at the
   * ragged right edge of natural prose. Defaults to '100%'.
   */
  lastLineWidth?: DimensionValue;
  /** Height of each line. Defaults to 16. */
  lineHeight?: number;
  /** Vertical gap between lines. Defaults to 8. */
  lineSpacing?: number;
  style?: ViewStyle;
}

/**
 * Multi-line text placeholder built on top of `Skeleton.Box`. Replaces the
 * pre-0.6.0 local `SkeletonText` primitive, mapping the same surface so
 * consumer files migrate verbatim except for the import.
 */
export function TextLines({
  lines = 1,
  lastLineWidth = '100%',
  lineHeight = 16,
  lineSpacing = 8,
  style,
}: TextLinesProps) {
  return (
    <View style={style}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton.Box
          key={index}
          width={index === lines - 1 ? lastLineWidth : '100%'}
          height={lineHeight}
          style={index > 0 ? { marginTop: lineSpacing } : undefined}
        />
      ))}
    </View>
  );
}

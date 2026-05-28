/**
 * ListSkeleton — vertical Skeleton.Box grid used while async lists load.
 *
 * Renders 4–6 placeholder cards spaced like the real list, instead of a
 * full-screen ActivityIndicator. Personal screens (applications, stays,
 * saved, profile sub-screens) all use the same rhythm so the loading
 * state looks like a deferred version of the loaded state, not a separate
 * UI.
 */
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { Skeleton } from '@oxyhq/bloom';

import { spacing } from '@/constants/styles';

export interface ListSkeletonProps {
  /** How many placeholder rows to render. Defaults to 5. */
  rows?: number;
  /** Per-row height in pixels. Defaults to 120 (matches ApplicationCard). */
  rowHeight?: number;
  /** Gap between rows. Defaults to `spacing.lg` (16). */
  gap?: number;
  /** Optional wrapper style override. */
  style?: StyleProp<ViewStyle>;
}

export const ListSkeleton: React.FC<ListSkeletonProps> = ({
  rows = 5,
  rowHeight = 120,
  gap = spacing.lg,
  style,
}) => (
  <View style={[{ gap }, style]}>
    {Array.from({ length: rows }).map((_, index) => (
      <Skeleton.Box
        key={index}
        width="100%"
        height={rowHeight}
        borderRadius={16}
      />
    ))}
  </View>
);

export default ListSkeleton;

/**
 * PropertyResultsGridSkeleton — shimmer placeholders that mirror the
 * `PropertyResultsGrid` layout so loading states don't shift content
 * once the real data arrives.
 *
 * Built entirely from Bloom `Skeleton.Box` primitives — no
 * ActivityIndicator, no hand-rolled placeholders.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  LayoutChangeEvent,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useMediaQuery } from 'react-responsive';

import * as Skeleton from '@oxyhq/bloom/skeleton';

import { colors } from '@/styles/colors';
import { PROPERTY_GRID_GAP, radius, spacing } from '@/constants/styles';

interface PropertyResultsGridSkeletonProps {
  count?: number;
  columns?: Partial<{ sm: number; md: number; lg: number; xl: number }>;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}

const DEFAULT_COLUMNS = { sm: 1, md: 2, lg: 2, xl: 3 };

export const PropertyResultsGridSkeleton: React.FC<
  PropertyResultsGridSkeletonProps
> = ({ count = 6, columns, gap = PROPERTY_GRID_GAP, style }) => {
  const isMd = useMediaQuery({ minWidth: 640 });
  const isLg = useMediaQuery({ minWidth: 1024 });
  const isXL = useMediaQuery({ minWidth: 1280 });
  const [gridWidth, setGridWidth] = useState(0);

  const cols = useMemo(() => {
    const merged = { ...DEFAULT_COLUMNS, ...columns };
    if (isXL) return merged.xl;
    if (isLg) return merged.lg;
    if (isMd) return merged.md;
    return merged.sm;
  }, [columns, isMd, isLg, isXL]);

  const cellWidth = useMemo(() => {
    if (gridWidth <= 0 || cols <= 0) return undefined;
    const totalGap = gap * (cols - 1);
    return (gridWidth - totalGap) / cols;
  }, [gridWidth, cols, gap]);

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    setGridWidth(e.nativeEvent.layout.width);
  }, []);

  // Same split as PropertyResultsGrid: the caller's `style` (padding) lives
  // on the OUTER View; the inner grid is measured so `cellWidth` is derived
  // from the padded content width and the skeleton doesn't overflow (and
  // matches the real grid once it loads — no layout shift).
  return (
    <View style={style}>
      <View style={[styles.grid, { gap }]} onLayout={handleLayout}>
        {Array.from({ length: count }).map((_, idx) => (
          <View
            key={idx}
            style={[
              styles.cell,
              cellWidth ? { width: cellWidth } : { width: `${100 / cols}%` },
            ]}
          >
            <Skeleton.Box
              width="100%"
              height={240}
              borderRadius={radius.photo}
              style={styles.image}
            />
            <View style={styles.meta}>
              <Skeleton.Box width="70%" height={14} borderRadius={4} />
              <Skeleton.Box
                width="40%"
                height={12}
                borderRadius={4}
                style={styles.metaLine}
              />
              <Skeleton.Box
                width="30%"
                height={14}
                borderRadius={4}
                style={styles.metaLine}
              />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    flexGrow: 0,
    flexShrink: 0,
  },
  image: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
  meta: {
    paddingTop: spacing.md,
    gap: spacing.xs,
  },
  metaLine: {
    marginTop: 2,
  },
});

export default PropertyResultsGridSkeleton;

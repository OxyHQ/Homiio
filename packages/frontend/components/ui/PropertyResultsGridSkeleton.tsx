/**
 * PropertyResultsGridSkeleton — shimmer placeholders that mirror the
 * `PropertyResultsGrid` layout so loading states don't shift content
 * once the real data arrives.
 *
 * Mirrors the grid's two-platform layout exactly so there is no column-count
 * flash or layout shift when the real data replaces the shimmer:
 *  - WEB: the same CSS Grid (`display: grid` + the `auto-fill`/`minmax`/`min`
 *    track rule) so the skeleton shows the SAME number of columns the real grid
 *    will, with no `onLayout` and no 1-column fallback.
 *  - NATIVE: the same measured flex-wrap (`onLayout` → `resolveGridColumns` →
 *    `resolveGridCellWidth` → per-cell width).
 *
 * Built entirely from Bloom `Skeleton.Box` primitives — no
 * ActivityIndicator, no hand-rolled placeholders.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  LayoutChangeEvent,
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import * as Skeleton from '@oxyhq/bloom/skeleton';

import { colors } from '@/styles/colors';
import {
  GRID_TARGET_CELL,
  PROPERTY_GRID_GAP,
  radius,
  resolveGridCellWidth,
  resolveGridColumns,
  spacing,
} from '@/constants/styles';

const IS_WEB = Platform.OS === 'web';

/**
 * Identical `grid-template-columns` to `PropertyResultsGrid` so the skeleton's
 * column count matches the real grid's (no shift). See that component for the
 * `min(GRID_TARGET_CELL, 50% - gap/2)` track-floor rationale.
 */
const webGridTemplateColumns = (gap: number): string =>
  `repeat(auto-fill, minmax(min(${GRID_TARGET_CELL}px, calc(50% - ${gap / 2}px)), 1fr))`;

interface PropertyResultsGridSkeletonProps {
  count?: number;
  /**
   * Optional cap on the column count. Mirrors `PropertyResultsGrid` so the
   * loading state matches the real grid (no layout shift). Container-driven by
   * default; never forces below `GRID_MIN_COLUMNS`. NATIVE-only (web CSS-Grid
   * auto-fill is uncapped, matching the real grid).
   */
  maxColumns?: number;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}

export const PropertyResultsGridSkeleton: React.FC<
  PropertyResultsGridSkeletonProps
> = ({ count = 6, maxColumns, gap = PROPERTY_GRID_GAP, style }) => {
  const [gridWidth, setGridWidth] = useState(0);

  // NATIVE only — web uses CSS Grid and never reads these.
  const cols = useMemo(
    () => resolveGridColumns(gridWidth, maxColumns),
    [gridWidth, maxColumns],
  );

  const cellWidth = useMemo(
    () => resolveGridCellWidth(gridWidth, cols, gap),
    [gridWidth, cols, gap],
  );

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    setGridWidth(e.nativeEvent.layout.width);
  }, []);

  const webGridStyle = useMemo<ViewStyle | undefined>(
    () =>
      IS_WEB
        ? ({
            display: 'grid',
            gridTemplateColumns: webGridTemplateColumns(gap),
            gap,
          } as unknown as ViewStyle)
        : undefined,
    [gap],
  );

  // Same split as PropertyResultsGrid: the caller's `style` (padding) lives on
  // the OUTER View. On NATIVE the inner grid is measured so `cellWidth` is
  // derived from the padded content width; on WEB the CSS Grid sizes its own
  // tracks. Either way the skeleton matches the real grid once it loads — no
  // layout shift, no 1-column flash.
  return (
    <View style={style}>
      <View
        style={IS_WEB ? webGridStyle : [styles.grid, { gap }]}
        onLayout={IS_WEB ? undefined : handleLayout}
      >
        {Array.from({ length: count }).map((_, idx) => (
          <View
            key={idx}
            style={[
              styles.cell,
              // WEB: CSS Grid sizes the track — no width style. NATIVE: explicit
              // measured cell width (or a percentage basis until measured).
              IS_WEB
                ? null
                : cellWidth
                  ? { width: cellWidth }
                  : { width: `${100 / cols}%` },
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

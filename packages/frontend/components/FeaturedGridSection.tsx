/**
 * FeaturedGridSection — Airbnb-2026 inspired multi-column property grid.
 *
 * Renders a single bold section title and a responsive grid of
 * `PropertyCard variant="grid"` cells. The grid collapses to 1 column on
 * narrow phones, 2 columns on tablets, 3 on small laptops, and 4 on wide
 * desktops. Gap follows `gridGap.comfortable` (24px) for hero-tier
 * spacing.
 *
 * The section hides itself if no items are provided — there is no
 * skeleton placeholder loop on the home page, per the Airbnb-2026
 * directive ("no empty rows", "no shimmer carpets").
 */
import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { useMediaQuery } from 'react-responsive';

import { H1 } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { gridGap, resolvePagePadding, spacing, tracker } from '@/constants/styles';

interface FeaturedGridSectionProps<T> {
  title: string;
  items: readonly T[];
  renderItem: (item: T, idx: number) => React.ReactNode;
  /**
   * Override default column counts. Keys correspond to breakpoint
   * thresholds (`sm`, `md`, `lg`, `xl`). Default: `{ sm: 1, md: 2, lg: 3, xl: 4 }`.
   */
  columns?: Partial<{ sm: number; md: number; lg: number; xl: number }>;
}

const DEFAULT_COLUMNS = { sm: 1, md: 2, lg: 3, xl: 4 };

export function FeaturedGridSection<T>({
  title,
  items,
  renderItem,
  columns,
}: FeaturedGridSectionProps<T>) {
  const isMd = useMediaQuery({ minWidth: 640 });
  const isLg = useMediaQuery({ minWidth: 1024 });
  const isXL = useMediaQuery({ minWidth: 1280 });
  const isWide = useMediaQuery({ minWidth: 768 });
  const [gridWidth, setGridWidth] = useState(0);

  const cols = useMemo(() => {
    const merged = { ...DEFAULT_COLUMNS, ...columns };
    if (isXL) return merged.xl;
    if (isLg) return merged.lg;
    if (isMd) return merged.md;
    return merged.sm;
  }, [columns, isMd, isLg, isXL]);

  const gap = gridGap.comfortable;
  const horizontalPadding = resolvePagePadding(isWide);

  /**
   * Cell width is derived from the measured inner width and column
   * count. Falls back to a percentage estimate on the very first paint
   * before `onLayout` fires so cells don't briefly stack.
   */
  const cellWidth = useMemo(() => {
    if (gridWidth <= 0 || cols <= 0) return undefined;
    const totalGap = gap * (cols - 1);
    return (gridWidth - totalGap) / cols;
  }, [gridWidth, cols, gap]);

  if (items.length === 0) return null;

  const handleLayout = (e: LayoutChangeEvent) => {
    setGridWidth(e.nativeEvent.layout.width);
  };

  return (
    <View style={[styles.section, { paddingHorizontal: horizontalPadding }]}>
      <H1 style={styles.title}>{title}</H1>
      <View style={[styles.grid, { gap }]} onLayout={handleLayout}>
        {items.map((item, idx) => (
          <View
            key={idx}
            style={[
              styles.cell,
              cellWidth ? { width: cellWidth } : { width: `${100 / cols}%` },
            ]}
          >
            {renderItem(item, idx)}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    width: '100%',
  },
  title: {
    fontSize: 26,
    color: colors.COLOR_BLACK,
    fontWeight: '700',
    letterSpacing: tracker.tight,
    lineHeight: 32,
    marginBottom: spacing.xl,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    flexGrow: 0,
    flexShrink: 0,
  },
});

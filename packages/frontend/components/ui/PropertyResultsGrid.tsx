/**
 * PropertyResultsGrid — Airbnb-2026 inspired results grid for the search
 * screen. Wraps the standard `PropertyCard` in a responsive column grid
 * shared with `FeaturedGridSection` so the search results read like an
 * extension of the home page.
 *
 * Layout:
 *  - Mobile (≤640px): 1 column
 *  - Tablet (≥640px): 2 columns
 *  - Laptop (≥1024px): 2 columns by default — search panels are narrower
 *    than the home page, so we stay at 2 even on `lg` unless the caller
 *    explicitly opts into 3+.
 *  - Wide (≥1280px): 3 columns
 *
 * Pass a custom `columns` map to override per breakpoint (e.g. List view
 * gets `{ sm: 1, md: 2, lg: 3, xl: 4 }` because it has the full width).
 *
 * Highlight support: when `highlightedPropertyId` matches a card, it
 * gets a primary-color outline ring so users can tie the marker click
 * back to the result.
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

import { PropertyCard } from '@/components/PropertyCard';
import { colors } from '@/styles/colors';
import { PROPERTY_GRID_GAP, radius } from '@/constants/styles';
import type { Property } from '@homiio/shared-types';

interface PropertyResultsGridProps {
  properties: readonly Property[];
  onPropertyPress: (property: Property) => void;
  highlightedPropertyId?: string | null;
  /** Override default column counts per breakpoint. */
  columns?: Partial<{ sm: number; md: number; lg: number; xl: number }>;
  /** Override the gap between cells. Defaults to the shared `PROPERTY_GRID_GAP`. */
  gap?: number;
  /** Container style. */
  style?: StyleProp<ViewStyle>;
  /**
   * Optional per-card footer slot — rendered inside each `PropertyCard` below
   * the standard content. Owner-facing lists (My properties) use this to attach
   * edit/delete actions without forking the card. Defaults to `undefined`, in
   * which case the cards render exactly as on search/browse.
   */
  renderFooter?: (property: Property) => React.ReactNode;
}

const DEFAULT_COLUMNS = { sm: 1, md: 2, lg: 2, xl: 3 };

export const PropertyResultsGrid: React.FC<PropertyResultsGridProps> = ({
  properties,
  onPropertyPress,
  highlightedPropertyId,
  columns,
  gap = PROPERTY_GRID_GAP,
  style,
  renderFooter,
}) => {
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

  if (properties.length === 0) return null;

  // The caller's `style` (which may carry horizontal padding) lives on the
  // OUTER View. The inner grid is what we measure via `onLayout`, so
  // `gridWidth` is the padded content width — not the border-box width.
  // Computing `cellWidth` from the content width keeps cells inside the
  // gutter instead of overflowing by the padding. Mirrors
  // `FeaturedGridSection`.
  return (
    <View style={style}>
      <View style={[styles.grid, { gap }]} onLayout={handleLayout}>
        {properties.map((property) => {
          const isHighlighted = property._id === highlightedPropertyId;
          return (
            <View
              key={property._id}
              style={[
                styles.cell,
                cellWidth ? { width: cellWidth } : { width: `${100 / cols}%` },
                isHighlighted ? styles.cellHighlighted : null,
              ]}
            >
              <PropertyCard
                property={property}
                variant="grid"
                orientation="vertical"
                onPress={() => onPropertyPress(property)}
                showSaveButton
                showVerifiedBadge
                showSaveCount={false}
                footerContent={renderFooter ? renderFooter(property) : undefined}
              />
            </View>
          );
        })}
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
    borderRadius: radius.lg,
  },
  cellHighlighted: {
    borderWidth: 2,
    borderColor: colors.primaryColor,
  },
});

export default PropertyResultsGrid;

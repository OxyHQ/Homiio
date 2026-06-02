/**
 * PropertyResultsGrid — the single, app-wide multi-column property grid.
 *
 * Every surface that renders a grid of `PropertyCard`s uses THIS component:
 * search/explore, the browse screens (`/properties`, `/properties/my`,
 * `/properties/type/[type]`, recently-viewed), the home featured grid
 * (`FeaturedGridSection` delegates here), Saved (recent + folder detail), and
 * a public profile's grid view. Carousels (horizontal scrollers) and
 * single-card/popover/chat/widget usages are intentionally NOT grids and do
 * not use this component.
 *
 * Columns are CONTAINER-driven, not window-driven, on BOTH platforms — but the
 * mechanism differs because the two layout engines have different failure modes:
 *
 *  - WEB: real CSS Grid (`display: grid` +
 *    `grid-template-columns: repeat(auto-fill, minmax(min(GRID_TARGET_CELL,
 *    calc(50% - gap/2)), 1fr))`). The browser sizes the tracks from the
 *    container's own width with NO JS measurement. The `min(180px, 50% - gap/2)`
 *    track floor guarantees AT LEAST 2 columns (each track may shrink to ~half
 *    the container, so two always fit) while letting the grid add 3, 4, 5, …
 *    columns as the container widens. This removes the flaky `onLayout` path,
 *    which on web could report `0` inside a normal page `ScrollView` and fall
 *    back to a `width: 50%` basis that exact-overflowed the gap and collapsed
 *    `flex-wrap` to a single full-width column (the `/properties` bug).
 *
 *  - NATIVE: measured flex-wrap. `onLayout` is reliable on native, so we measure
 *    the width the grid occupies (`gridWidth`) and fit as many ~`GRID_TARGET_CELL`-
 *    wide columns as it allows, clamped to `[GRID_MIN_COLUMNS, GRID_MAX_COLUMNS]`
 *    (see `resolveGridColumns`), giving each cell an explicit measured width.
 *
 * Either way the explore split column (a narrow half-window panel beside the
 * map) lays out 2 columns while a full-width grid spreads to more, with no
 * caller-declared breakpoints and never collapsing to a single full-bleed card.
 *
 * `maxColumns` caps a particular grid below the global ceiling on NATIVE (it can
 * never push below `GRID_MIN_COLUMNS`). On WEB the CSS-Grid auto-fill is not
 * capped by `maxColumns` — the responsive fill is intentional and the explore
 * caller no longer passes a cap — so the prop is effectively native-only there.
 *
 * Highlight support: when `highlightedPropertyId` matches a card, it
 * gets a primary-color outline ring so users can tie the marker click
 * back to the result.
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

import { PropertyCard } from '@/components/PropertyCard';
import { colors } from '@/styles/colors';
import {
  GRID_TARGET_CELL,
  PROPERTY_GRID_GAP,
  radius,
  resolveGridCellWidth,
  resolveGridColumns,
} from '@/constants/styles';
import type { Property } from '@homiio/shared-types';

const IS_WEB = Platform.OS === 'web';

/**
 * CSS `grid-template-columns` for the web property grid. `auto-fill` packs as
 * many tracks as fit; each track's floor is `min(GRID_TARGET_CELL, 50% - gap/2)`
 * so a track may shrink to ~half the container (always 2 columns) but otherwise
 * targets `GRID_TARGET_CELL`, and `1fr` lets tracks grow to share leftover
 * space. The `gap` is folded into the 50% term so an overridden gap stays exact.
 */
const webGridTemplateColumns = (gap: number): string =>
  `repeat(auto-fill, minmax(min(${GRID_TARGET_CELL}px, calc(50% - ${gap / 2}px)), 1fr))`;

interface PropertyResultsGridProps {
  properties: readonly Property[];
  onPropertyPress: (property: Property) => void;
  highlightedPropertyId?: string | null;
  /**
   * Web-only — fired when a pointer enters a card, with the card's `_id`. The
   * explore split view uses it to highlight the matching map price chip. Paired
   * with {@link onPropertyHoverOut}. Both are wired only on web (the list and
   * map are a toggle on native and never co-visible, so hover is moot there).
   */
  onPropertyHoverIn?: (id: string) => void;
  /** Web-only — fired when the pointer leaves a card (un-highlights the chip). */
  onPropertyHoverOut?: () => void;
  /**
   * Optional cap on the column count, below the global `GRID_MAX_COLUMNS`. The
   * grid is container-driven by default; pass this only to deliberately limit
   * how wide a specific grid spreads. Never forces below `GRID_MIN_COLUMNS`.
   *
   * NATIVE-only: the WEB CSS-Grid auto-fill is intentionally not capped (it
   * stays responsive to the container width).
   */
  maxColumns?: number;
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

export const PropertyResultsGrid: React.FC<PropertyResultsGridProps> = ({
  properties,
  onPropertyPress,
  highlightedPropertyId,
  onPropertyHoverIn,
  onPropertyHoverOut,
  maxColumns,
  gap = PROPERTY_GRID_GAP,
  style,
  renderFooter,
}) => {
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

  // The web grid container is a real CSS Grid: no measurement, no exact-fill
  // wrap, responsive to its own width. `gridTemplateColumns` is a CSS-only
  // string and `display: 'grid'` is a web value RN's `ViewStyle` lacks, so the
  // whole block is web-cast (same pattern as the rest of the codebase).
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

  if (properties.length === 0) return null;

  // The caller's `style` (which may carry horizontal padding) lives on the
  // OUTER View. On NATIVE the inner grid is what we measure via `onLayout`, so
  // `gridWidth` is the padded content width — not the border-box width.
  // Computing `cellWidth` from the content width keeps cells inside the gutter
  // instead of overflowing by the padding. Mirrors `FeaturedGridSection`. On
  // WEB the CSS Grid sizes its own tracks from the same (padded) content width,
  // so cells need neither a measured nor a percentage width.
  return (
    <View style={style}>
      <View
        style={IS_WEB ? webGridStyle : [styles.grid, { gap }]}
        onLayout={IS_WEB ? undefined : handleLayout}
      >
        {properties.map((property) => {
          const isHighlighted = property._id === highlightedPropertyId;
          return (
            <View
              key={property._id}
              style={[
                styles.cell,
                // WEB: CSS Grid sizes the track — no width style. NATIVE: explicit
                // measured cell width (or a percentage basis until measured).
                IS_WEB
                  ? null
                  : cellWidth
                    ? { width: cellWidth }
                    : { width: `${100 / cols}%` },
                isHighlighted ? styles.cellHighlighted : null,
              ]}
              // Web-only: hovering anywhere on the card highlights its map price
              // chip. This lives on the OUTERMOST per-card wrapper (not inside
              // PropertyCard) so the whole card — photo, info, and save button —
              // is one hover target; the card's interactive subtrees (carousel,
              // content button, heart) don't fragment it. Pointer enter/leave fire
              // on this View's own boundary: leave does NOT misfire when the
              // pointer moves over inner children, so it clears only when the
              // pointer truly exits the card. Gated to web (native shows list/map
              // as a toggle, never together) and keyed on `_id` (the marker id).
              onPointerEnter={
                IS_WEB && onPropertyHoverIn
                  ? () => onPropertyHoverIn(property._id)
                  : undefined
              }
              onPointerLeave={
                IS_WEB && onPropertyHoverOut ? onPropertyHoverOut : undefined
              }
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

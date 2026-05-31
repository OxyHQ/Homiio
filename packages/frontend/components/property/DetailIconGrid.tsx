/**
 * DetailIconGrid — the single source of truth for the flat, Airbnb-2026
 * 2-column "icon + label" grid used by the property-detail sections that list
 * small facts: "What this place offers" (amenities) and "What's nearby"
 * (services). Both used to carry their own (identical) grid/row StyleSheet and
 * drifted in lockstep; this primitive owns that layout so they can't diverge.
 *
 * It exposes three pieces, sharing ONE StyleSheet:
 *   - `DetailIconGrid`        the responsive wrapping container (column/row
 *                             gaps, cell width/minWidth, flex-grow).
 *   - `DetailIconRow`         one line: leading icon + label, with an optional
 *                             TRAILING text (e.g. a distance), an optional
 *                             `muted` state (greyed icon/label/trailing for an
 *                             "absent" item), and an optional `divided` top
 *                             hairline (for the grouped show-all list).
 *   - `DetailIconCell`        a single grid cell wrapper (applies the shared
 *                             cell width). Use it around a `DetailIconRow` when
 *                             mapping grid items.
 *
 * Layout notes:
 *   - Two columns on a phone, ~three on tablet/web (the `minWidth` floor keeps
 *     a single short label from truncating before the row wraps). The floor is
 *     a touch wider when a row carries a trailing distance so "Pharmacy · 97 m"
 *     stays on one row across both columns — pass `reserveTrailing` on the grid
 *     to opt the wider floor (the nearby grid does; the amenity grid doesn't).
 *   - No card, no shadow, no background: these grids sit flat on the page
 *     surface (per the design system, greys are for cards/badges only).
 *   - The icon is rendered by the caller (an `Ionicons` node) so each section
 *     keeps its own glyph map and per-state tint; the primitive only owns the
 *     icon BOX size (width + centering) so columns align.
 */
import React from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { hairline, spacing } from '@/constants/styles';

/**
 * Icon glyph size for every detail-grid row (line weight, Airbnb scale,
 * compact). Exported so callers size their `Ionicons` node to match the box
 * the primitive reserves for it.
 */
export const DETAIL_ICON_SIZE = 22;

/**
 * Edge length of the box every detail-grid icon sits in. An isometric PNG fills
 * the box (full-color, larger than the line glyph so it reads); the Ionicons
 * fallback is centered in the same box at `DETAIL_ICON_SIZE`. Sizing both to one
 * box keeps PNG rows and line-icon rows aligned (the row hugs the icon's width).
 */
const DETAIL_ICON_BOX_SIZE = 32;

/**
 * Opacity for a `muted` ("absent") PNG — dimmed so it reads as quiet/disabled
 * while still showing the same isometric art as its present counterpart, so the
 * present/absent distinction stays legible without swapping the glyph.
 */
const MUTED_ICON_OPACITY = 0.4;

/**
 * The shared "PNG-or-Ionicons" leading icon used by the amenity and feature
 * grids: a centered box that shows `image` when art exists, else `fallbackIcon`
 * as a tinted Ionicons glyph. Pass the result as `DetailIconRow`'s `icon`.
 *
 * `muted` (for "absent"/disabled rows) dims the PNG via opacity and tints the
 * Ionicons fallback with the muted glyph color; off by default so the amenity
 * and feature callers keep their full-strength look unchanged.
 */
export const DetailIcon: React.FC<{
  image?: ImageSourcePropType;
  fallbackIcon: React.ComponentProps<typeof Ionicons>['name'];
  muted?: boolean;
}> = ({ image, fallbackIcon, muted = false }) => (
  <View style={styles.detailIconBox}>
    {image ? (
      <Image
        source={image}
        style={[styles.detailIconImage, muted && styles.detailIconImageMuted]}
        resizeMode="contain"
        accessible={false}
      />
    ) : (
      <Ionicons
        name={fallbackIcon}
        size={DETAIL_ICON_SIZE}
        color={muted ? colors.COLOR_BLACK_LIGHT_5 : colors.COLOR_BLACK_LIGHT_1}
      />
    )}
  </View>
);

interface DetailIconGridProps {
  children: React.ReactNode;
  /**
   * Widen the per-cell `minWidth` floor so a trailing distance ("· 97 m") fits
   * on one row in both columns on a phone. Off by default (amenity rows carry
   * no trailing text); the nearby-services grid turns it on.
   */
  reserveTrailing?: boolean;
}

/**
 * Responsive wrapping container for detail-grid cells. Owns the column/row
 * gaps so every section breathes identically.
 */
export const DetailIconGrid: React.FC<DetailIconGridProps> = ({
  children,
  reserveTrailing = false,
}) => (
  <View style={styles.grid}>
    {React.Children.map(children, (child) =>
      React.isValidElement<DetailIconCellProps>(child) && child.type === DetailIconCell
        ? React.cloneElement(child, { reserveTrailing })
        : child,
    )}
  </View>
);

interface DetailIconCellProps {
  children: React.ReactNode;
  /**
   * Injected by `DetailIconGrid` to widen the floor when the grid reserves
   * room for trailing text. Not set directly by callers.
   */
  reserveTrailing?: boolean;
}

/**
 * One grid cell. Wrap a `DetailIconRow` (or a skeleton placeholder) so it picks
 * up the shared column width. `reserveTrailing` is injected by the parent grid.
 */
export const DetailIconCell: React.FC<DetailIconCellProps> = ({
  children,
  reserveTrailing = false,
}) => (
  <View style={[styles.cell, reserveTrailing && styles.cellReserveTrailing]}>
    {children}
  </View>
);

interface DetailIconRowProps {
  /** Leading glyph — a pre-sized, pre-tinted `Ionicons` (use `DETAIL_ICON_SIZE`). */
  icon: React.ReactNode;
  /** Primary label text. */
  label: string;
  /**
   * Optional trailing text (e.g. a distance "97 m"). When present, the label
   * and trailing share a baseline-aligned, space-between line; the label
   * shrinks to fit. When absent, the label takes the full remaining width.
   */
  trailing?: string;
  /**
   * Muted ("absent") state — greys the label and trailing. The icon tint is
   * owned by the caller (it passes an already-tinted node), so this only
   * affects the text the primitive renders.
   */
  muted?: boolean;
  /** Top hairline above the row (used inside the grouped show-all list). */
  divided?: boolean;
}

/**
 * One detail row: icon + label (+ optional trailing text). Flat by default; the
 * `divided` variant adds a top hairline so items in a grouped list read cleanly.
 */
export const DetailIconRow: React.FC<DetailIconRowProps> = ({
  icon,
  label,
  trailing,
  muted = false,
  divided = false,
}) => (
  <View style={[styles.row, divided && styles.rowDivided]}>
    <View style={styles.rowIcon}>{icon}</View>
    {trailing !== undefined ? (
      <View style={styles.rowText}>
        <BloomText style={[styles.label, styles.labelShrink, muted && styles.labelMuted]}>
          {label}
        </BloomText>
        <BloomText style={[styles.trailing, muted && styles.trailingMuted]}>
          {trailing}
        </BloomText>
      </View>
    ) : (
      <BloomText style={[styles.label, styles.labelFill, muted && styles.labelMuted]}>
        {label}
      </BloomText>
    )}
  </View>
);

const styles = StyleSheet.create({
  detailIconBox: {
    width: DETAIL_ICON_BOX_SIZE,
    height: DETAIL_ICON_BOX_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailIconImage: {
    width: DETAIL_ICON_BOX_SIZE,
    height: DETAIL_ICON_BOX_SIZE,
  },
  detailIconImageMuted: {
    opacity: MUTED_ICON_OPACITY,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.xl,
    rowGap: spacing.xs,
  },
  cell: {
    // ~3 columns on tablet/web, 2 on a phone. The minWidth floor keeps a single
    // short label from truncating before the row wraps.
    width: '31%',
    minWidth: 150,
    flexGrow: 1,
  },
  cellReserveTrailing: {
    // A touch wider so a trailing distance ("Pharmacy · 97 m") fits on one row
    // in both columns on a phone, yet two columns still fit; the label's
    // `flexShrink` absorbs the longest names.
    minWidth: 165,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  rowDivided: {
    borderTopWidth: hairline.width,
    borderTopColor: hairline.color,
  },
  rowIcon: {
    width: DETAIL_ICON_SIZE,
    alignItems: 'center',
  },
  rowText: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  label: {
    fontSize: 15,
    lineHeight: 20,
    color: colors.COLOR_BLACK,
  },
  // The label fills the row when there's no trailing text...
  labelFill: {
    flex: 1,
  },
  // ...and shrinks to make room for trailing text when there is.
  labelShrink: {
    flexShrink: 1,
  },
  labelMuted: {
    color: colors.COLOR_BLACK_LIGHT_5,
  },
  trailing: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  trailingMuted: {
    fontWeight: '400',
    color: colors.COLOR_BLACK_LIGHT_5,
  },
});

export default DetailIconGrid;

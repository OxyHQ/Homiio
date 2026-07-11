/**
 * Homiio design tokens — shadows, radii, spacing, and typography helpers.
 *
 * Goal: enforce a single elevation, spacing, and radius language across
 * every surface in the app. Pick three shadow weights (sm/md/lg) and stick
 * to them. Same idea for corner radii — photos use 3xl, cards 2xl, inputs
 * 2xl, pills full. Spacing follows a 4px-based scale so any inline value
 * always rounds to the nearest valid step.
 *
 * Usage:
 *   import { cardShadow, radius, spacing, tracker, withShadow } from '@/constants/styles';
 *   <View style={[styles.card, withShadow('md')]} />
 *   <Text style={{ letterSpacing: tracker.eyebrow }} />
 *   <View style={{ gap: spacing.lg, padding: spacing.xl }} />
 */
import { Platform, type ViewStyle } from 'react-native';
import { colors } from '@/styles/colors';
import { shadowToken } from '@/styles/shadows';

type ShadowStyle = Pick<ViewStyle, 'boxShadow' | 'elevation'>;

export type ShadowLevel = 'sm' | 'md' | 'lg';

/**
 * Three elevation tiers. All platforms get a cross-platform `boxShadow`
 * (RN 0.83 supports it on web AND native); Android additionally keeps
 * `elevation` since `boxShadow` alone does not reproduce native elevation.
 * Color uses pure black with low opacity so the shadow tints any surface the
 * card sits on (cream, white, light gray) the same way.
 */
export const cardShadow: Record<ShadowLevel, ShadowStyle> = {
  sm: shadowToken({ y: 1, blur: 4, color: colors.COLOR_BLACK, opacity: 0.06, elevation: 2 }),
  md: shadowToken({ y: 4, blur: 12, color: colors.COLOR_BLACK, opacity: 0.08, elevation: 5 }),
  lg: shadowToken({ y: 12, blur: 32, color: colors.COLOR_BLACK, opacity: 0.12, elevation: 12 }),
};

/**
 * Web-only `boxShadow` strings — useful when the consumer wants to skip
 * the RN shadow* props (e.g. inside a className-driven layout that
 * targets Tailwind's `[boxShadow:_X]` arbitrary value).
 */
export const cardBoxShadowWeb = {
  sm: '0 1px 4px rgba(0, 0, 0, 0.06)',
  md: '0 4px 12px rgba(0, 0, 0, 0.08)',
  lg: '0 12px 32px rgba(0, 0, 0, 0.12)',
} as const;

/**
 * Resolve the platform-appropriate shadow style. Use this in `style={[…]}`
 * arrays instead of indexing `cardShadow` directly so consumers can swap
 * elevation tiers without thinking about which prop to call.
 */
export const withShadow = (level: ShadowLevel): ShadowStyle => cardShadow[level];

/**
 * Single source of truth for corner radii. Pulled from the Airbnb-2026
 * inspiration: photos and hero media are noticeably rounder (3xl) than
 * cards (2xl), inputs match cards, and chips/pills are fully rounded.
 */
export const radius = {
  /** Inputs, action chips, small buttons. */
  md: 12,
  /** Cards, sheets, modals. */
  lg: 16,
  /** Hero containers, photo grids, large surfaces. */
  xl: 24,
  /** Individual photo tiles. */
  photo: 24,
  /** Pills, fully circular elements (hero search bar). */
  pill: 9999,
} as const;

/**
 * Icon-size scale for `Ionicons`/glyph `size={…}`. Pick the nearest token
 * instead of sprinkling raw numbers so glyphs line up across buttons, list
 * rows, empty/error states, and widget headers.
 *
 *   xs (12) — inline meta glyphs, chip progress markers
 *   sm (16) — button-leading icons, dense badges
 *   md (20) — list-row affordances, secondary actions
 *   lg (24) — widget headers, primary nav icons
 *   xl (28) — empty/error hero glyphs, large rating stars
 *
 * The property detail grid keeps its own `DETAIL_ICON_SIZE` (22) because it
 * is sized to the fixed box the isometric PNG fallback reserves; it sits
 * between `lg` and `xl` on purpose and stays independent of this scale.
 */
export const ICON_SIZES = {
  xs: 12,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 28,
} as const;

export type IconSizeKey = keyof typeof ICON_SIZES;

/**
 * Section spacing rhythm. Web is a touch more generous; mobile keeps
 * content dense enough to avoid scroll fatigue but still breathes.
 *
 * Airbnb-2026 rhythm (32 web / 24 mobile). Home uses NativeWind
 * `gap-6 md:gap-8`; this constant is the JS fallback for screens that
 * still resolve spacing imperatively.
 */
export const sectionSpacing = {
  web: 32,
  mobile: 24,
} as const;

/**
 * Resolve the platform-appropriate section gap. Pass the `isWide`
 * boolean derived from your media query hook to switch between mobile
 * and web rhythm.
 */
export const resolveSectionSpacing = (isWide: boolean): number =>
  isWide ? sectionSpacing.web : sectionSpacing.mobile;

/**
 * 4-point spacing scale. Every padding/margin/gap value in the app should
 * snap to one of these tokens. Any inline `padding: 13` or `gap: 17` is
 * a bug — pick the closest token (typically `lg=16` or `xl=24`).
 *
 * Naming follows Tailwind's xs/sm/md/lg/xl/2xl conventions so the mental
 * model carries over to NativeWind class names.
 */
export const spacing = {
  /** 4 — tightest internal gap (icon + label). */
  xs: 4,
  /** 8 — chip padding, small card gap. */
  sm: 8,
  /** 12 — secondary card padding. */
  md: 12,
  /** 16 — default card padding, list item spacing. */
  lg: 16,
  /** 20 — comfortable card padding. */
  xl: 20,
  /** 24 — sheet content padding, dialog padding. */
  '2xl': 24,
  /** 32 — section header → body. */
  '3xl': 32,
  /** 40 — large vertical breaks within a section. */
  '4xl': 40,
  /** 56 — mobile section break. */
  '5xl': 56,
  /** 80 — secondary web section break. */
  '6xl': 80,
  /** 96 — primary web section break. */
  '7xl': 96,
} as const;

export type SpacingKey = keyof typeof spacing;

/**
 * Letter-spacing constants. Use these instead of inline numbers so
 * uppercase eyebrow labels, tight display titles, and normal body copy
 * share a consistent tracking language.
 */
export const tracker = {
  /** -0.5 — large display headings (H1, hero). */
  tight: -0.5,
  /** 0 — body copy, default. */
  normal: 0,
  /** 0.2 — section titles, button labels. */
  wide: 0.5,
  /** 1.5 — uppercase eyebrow labels above section titles. */
  eyebrow: 1.5,
} as const;

/**
 * Grid gap presets for `gap` style or `gap-X` className. Use `tight` for
 * dense badge clusters, `cozy` for the app-wide property grid (the single
 * gap every `PropertyCard` grid shares), `normal` for typical cards-in-row,
 * and `comfortable` for hero-tier photo grids.
 *
 * `cozy` (12) is the canonical property-grid gap: the single shared
 * `PropertyResultsGrid` (used by search/explore, the browse screens, the home
 * featured grid via `FeaturedGridSection`, Saved, and profile) points at it so
 * multi-column property tiles read at one consistent, Airbnb-2026 density
 * across the whole app. Keep it in sync with `PropertyResultsGridSkeleton`'s
 * default so loading shimmers don't shift.
 */
export const gridGap = {
  tight: 8,
  cozy: 12,
  normal: 16,
  comfortable: 24,
} as const;

/**
 * The single gap shared by every property grid (`PropertyResultsGrid` and its
 * matching skeleton, plus the `FeaturedGridSection` wrapper that delegates to
 * it). Importing this alias — rather than re-deciding the tier per component —
 * guarantees the grids never drift apart. Currently `gridGap.cozy` (12px).
 */
export const PROPERTY_GRID_GAP = gridGap.cozy;

/**
 * Container-responsive property-grid column tuning. The shared property grid
 * (`PropertyResultsGrid` and its matching skeleton) derives its column count
 * from the width it ACTUALLY occupies — measured via `onLayout` — rather than
 * from window-width media queries. A grid living in a narrow split column (e.g.
 * explore's list next to the map) therefore lays out the same as a standalone
 * narrow grid, and a full-width grid spreads to more columns, all from one
 * rule.
 *
 *  - `GRID_TARGET_CELL` (180) — the ideal card width we aim each column at. We
 *    fit as many whole `GRID_TARGET_CELL`-wide columns as the measured width
 *    allows.
 *  - `GRID_MIN_COLUMNS` (2) — hard floor. Property grids never collapse to a
 *    single full-bleed card, even on the narrowest column or first paint.
 *  - `GRID_MAX_COLUMNS` (6) — ceiling so ultra-wide grids don't shrink cards to
 *    postage stamps. Set high enough that full-width browse screens AND a wide
 *    explore list column on ultra-wide displays can spread past 4 when there's
 *    genuinely room, while `GRID_TARGET_CELL` still keeps each card readable.
 *
 * Worked examples (widths are the MEASURED inner/content width, after the
 * `spacing.lg` gutter on each side):
 *  - explore list column ≈ 438px content → floor(438 / 180) = 2 columns.
 *  - wider explore list ≈ 820px content → floor(820 / 180) = 4 columns.
 *  - full-width grid ≈ 1600px content → floor(1600 / 180) = 8 → clamped to 6 (the ceiling).
 */
export const GRID_TARGET_CELL = 180;
export const GRID_MIN_COLUMNS = 2;
export const GRID_MAX_COLUMNS = 6;

/**
 * Resolve the property-grid column count from a measured container width.
 *
 * Returns `GRID_MIN_COLUMNS` until the width is known (`measuredWidth <= 0`, the
 * first paint) so grids never flash a single column before `onLayout` fires.
 * Once measured, fits `floor(width / GRID_TARGET_CELL)` whole columns, clamped
 * to `[GRID_MIN_COLUMNS, maxColumns]`. `maxColumns` defaults to
 * `GRID_MAX_COLUMNS`; callers may pass a smaller cap to cap a particular grid
 * (it can never push below `GRID_MIN_COLUMNS`).
 */
export const resolveGridColumns = (
  measuredWidth: number,
  maxColumns: number = GRID_MAX_COLUMNS,
): number => {
  const ceiling = Math.max(GRID_MIN_COLUMNS, maxColumns);
  if (measuredWidth <= 0) return GRID_MIN_COLUMNS;
  const fit = Math.floor(measuredWidth / GRID_TARGET_CELL);
  return Math.min(Math.max(fit, GRID_MIN_COLUMNS), ceiling);
};

/**
 * Safety margin (px) shaved off the total row width before dividing into
 * cells, so N cells + (N-1) gaps always sum to strictly LESS than the measured
 * container. Without it, an exact fit (`cells + gaps === containerWidth`)
 * leaves zero slack and sub-pixel rounding tips `flex-wrap: wrap` into dropping
 * every item onto its own row — collapsing a 2+ column grid to a single visual
 * column of half-width cards. 1px is invisible but reliably prevents the wrap.
 */
export const GRID_CELL_SAFETY_MARGIN = 1;

/**
 * Width of one cell in an `columns`-column grid of `measuredWidth`, leaving a
 * `GRID_CELL_SAFETY_MARGIN` (1px) gap so N cells + (N-1) gaps never exact-fill
 * the row (which makes `flex-wrap` drop to a single column on sub-pixel
 * rounding — see `GRID_CELL_SAFETY_MARGIN`). `Math.floor` keeps the result an
 * integer so widths don't reintroduce sub-pixel slack of their own.
 *
 * Returns `undefined` until the width is known (`measuredWidth <= 0`, the first
 * paint) so callers can fall back to a percentage basis while measuring.
 *
 * Worked example: a 586px container at 2 columns with the 12px grid gap →
 * `floor((586 - 12 - 1) / 2) = 286`; `286 * 2 + 12 = 584 < 586`, so 2 cells fit.
 */
export const resolveGridCellWidth = (
  measuredWidth: number,
  columns: number,
  gap: number,
): number | undefined => {
  if (measuredWidth <= 0 || columns <= 0) return undefined;
  const totalGap = gap * (columns - 1);
  return Math.floor((measuredWidth - totalGap - GRID_CELL_SAFETY_MARGIN) / columns);
};

/**
 * Modal/sheet backdrop alpha — same value everywhere so dialogs and
 * the photo gallery feel consistent.
 */
export const backdrop = {
  color: colors.overlay,
} as const;

/**
 * Convenience NativeWind class strings for use in `className`. Keeps
 * a card recipe colocated with the token definitions so consumers
 * don't reinvent the styles in every component.
 */
export const cardSurface = {
  /** Soft, lifted card: white background, rounded-2xl, md shadow. */
  classNameMd: 'bg-white rounded-2xl',
  /** Hero/elevated card: white background, rounded-3xl, lg shadow. */
  classNameLg: 'bg-white rounded-3xl',
} as const;

/**
 * Hairline divider — 1px on web, ~0.5px on iOS (via StyleSheet.hairlineWidth
 * equivalent on the consuming side).
 */
export const hairline = {
  width: Platform.OS === 'web' ? 1 : 0.5,
  color: 'rgba(0, 0, 0, 0.08)',
} as const;

/**
 * Container clamp — Airbnb-2026 sections never run edge-to-edge on ultra-
 * wide displays. We cap content at 1280px and let the page background
 * breathe on either side. Sub-clamps for narrower hero/copy blocks.
 */
export const contentClamp = {
  /** Default page content max width on web. */
  page: 1280,
  /** Narrower max width for centered copy blocks (hero subtitles, banners). */
  copy: 720,
} as const;

/**
 * Responsive horizontal page padding. Phones get 16px, tablets 24px, large
 * desktops 32px. Use this everywhere instead of inline numbers so sections
 * align to the same vertical gutter.
 */
export const pagePadding = {
  mobile: spacing.lg,
  tablet: spacing['2xl'],
  desktop: spacing['3xl'],
} as const;

/**
 * Resolve the platform-appropriate horizontal page padding. Pass the
 * `isWide` boolean derived from your media query hook.
 */
export const resolvePagePadding = (isWide: boolean): number =>
  isWide ? pagePadding.desktop : pagePadding.mobile;

/**
 * NativeWind class for responsive horizontal page gutters. Matches
 * {@link resolvePagePadding}: 16px mobile (`px-4`), 32px from `md` (`px-8`).
 */
export const PAGE_GUTTER_CLASS = 'px-4 md:px-8';

/**
 * Minimum height for a full-bleed CTA banner rendered in grid (`fill`) mode —
 * i.e. two banners side-by-side as equal-height columns on wide screens. In
 * that mode the banners drop their intrinsic `aspectRatio` and stretch to the
 * taller sibling via row `alignItems: 'stretch'`; this floor keeps a half-width
 * column from collapsing when its content is short (~Airbnb card density).
 * Standalone full-width banners keep using `aspectRatio` and ignore this token.
 */
export const BANNER_FILL_MIN_HEIGHT = 200;

/**
 * Shared header/bar chrome — the "gold recipe" from the property sticky bar,
 * promoted app-wide so every bar (the shared `Header`, `StickyPropertyHeader`,
 * and the property floating-header actions) reads identically. Consume these
 * instead of re-hand-rolling a per-bar icon button or clamp.
 *
 * - `barContent`: clamp the inner content row to `contentClamp.page`, centered,
 *   so titles/actions line up on wide web instead of running edge-to-edge (the
 *   surrounding bar background still spans full width).
 * - `barIconButton` (+ `barIconButtonPressed`): ONE circular icon button for the
 *   back button and every left/right icon action. Pair the two via a `pressed`
 *   `useState` + a static style array — never the NativeWind-incompatible
 *   function-form `style` (§NativeWind Pressable).
 */
export const barContent: ViewStyle = {
  maxWidth: contentClamp.page,
  width: '100%',
  alignSelf: 'center',
};

export const barIconButton: ViewStyle = {
  padding: spacing.sm,
  borderRadius: radius.pill,
};

export const barIconButtonPressed: ViewStyle = {
  backgroundColor: colors.mutedSubtle,
};

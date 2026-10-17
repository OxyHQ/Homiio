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
 *   import { cardShadow, radius, spacing, tracker } from '@/constants/styles';
 *   <View style={[styles.card, cardShadow.md]} />
 *   <Text style={{ letterSpacing: tracker.eyebrow }} />
 *   <View style={{ gap: spacing.lg, padding: spacing.xl }} />
 */
import { Platform, type ViewStyle } from 'react-native';
import { bloomShadowStyle } from '@oxy.so/bloom/design-tokens';

export type ShadowLevel = 'sm' | 'md' | 'lg';

/**
 * Three elevation tiers, backed by Bloom's shadow roles (Bloom owns the
 * web `boxShadow` / native `shadow*` + `elevation` split): `sm` is Bloom's
 * subtle `s`, `md` its `floating` rung (between `s` and `m`), `lg` its overlay
 * `m` (menus, popovers).
 */
export const cardShadow: Record<ShadowLevel, ViewStyle> = {
  sm: bloomShadowStyle('s'),
  md: bloomShadowStyle('floating'),
  lg: bloomShadowStyle('m'),
};

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
 * Icon-size scale for a Remix glyph's `width`/`height`. Pick the nearest
 * token instead of sprinkling raw numbers so glyphs line up across buttons, list
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
 * Hairline divider — 1px on web, ~0.5px on iOS (via StyleSheet.hairlineWidth
 * equivalent on the consuming side).
 */
export const hairline = {
  width: Platform.OS === 'web' ? 1 : 0.5,
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
 * NativeWind class for responsive horizontal page gutters: 16px mobile
 * (`px-4`), 32px from `md` (`px-8`).
 */
export const PAGE_GUTTER_CLASS = 'px-4 md:px-8';

/** Glyph size for bar action icons (share, save, host, …). */
export const barIconSize = 20;

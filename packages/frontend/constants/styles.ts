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

type ShadowStyle = Pick<
  ViewStyle,
  'shadowColor' | 'shadowOffset' | 'shadowOpacity' | 'shadowRadius' | 'elevation'
>;

export type ShadowLevel = 'sm' | 'md' | 'lg';

/**
 * Three elevation tiers. iOS/web get `shadow*` props, Android gets `elevation`.
 * Color uses pure black with low opacity so the shadow tints any surface
 * the card sits on (cream, white, light gray) the same way.
 *
 * Web also picks up a CSS `boxShadow` via NativeWind/RN-Web for crisper
 * rendering, but the RN props above are the source of truth.
 */
export const cardShadow: Record<ShadowLevel, ShadowStyle> = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 5,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 32,
    elevation: 12,
  },
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
 * Section spacing rhythm. Web is more generous; mobile keeps content
 * dense enough to avoid scroll fatigue but still breathes.
 *
 * Bumped web from 80 → 96 to give Airbnb-style rhythm between sections.
 * Mobile bumped from 48 → 56 to match.
 */
export const sectionSpacing = {
  web: 96,
  mobile: 56,
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
 * dense badge clusters, `normal` for typical cards-in-row, and
 * `comfortable` for hero-tier photo grids.
 */
export const gridGap = {
  tight: 8,
  normal: 16,
  comfortable: 24,
} as const;

/**
 * Modal/sheet backdrop alpha — same value everywhere so dialogs and
 * the photo gallery feel consistent.
 */
export const backdrop = {
  color: 'rgba(0, 0, 0, 0.5)',
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

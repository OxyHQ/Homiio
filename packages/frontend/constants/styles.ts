/**
 * Homiio design tokens — shadows, radii, and spacing.
 *
 * Goal: enforce a single elevation language across cards, sheets, and
 * modals. Pick 3 shadow weights (sm/md/lg) and stick to them. Same idea
 * for corner radii — photos use 3xl, cards 2xl, inputs 2xl, pills full.
 *
 * Usage:
 *   import { cardShadow, radius, spacing } from '@/constants/styles';
 *   <View style={[styles.card, cardShadow.md]}>...</View>
 */
import { Platform, type ViewStyle } from 'react-native';

type ShadowStyle = Pick<
  ViewStyle,
  'shadowColor' | 'shadowOffset' | 'shadowOpacity' | 'shadowRadius' | 'elevation'
>;

/**
 * Three elevation tiers. iOS/web get `shadow*` props, Android gets `elevation`.
 * Color uses pure black with low opacity so the shadow tints any surface
 * the card sits on (cream, white, light gray) the same way.
 *
 * Web also picks up a CSS `boxShadow` via NativeWind/RN-Web for crisper
 * rendering, but the RN props above are the source of truth.
 */
export const cardShadow: Record<'sm' | 'md' | 'lg', ShadowStyle> = {
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
 * dense to avoid scroll fatigue.
 */
export const sectionSpacing = {
  web: 80,
  mobile: 48,
} as const;

/**
 * Resolve the platform-appropriate section gap. Pass the `isWide`
 * boolean derived from your media query hook to switch between mobile
 * and web rhythm.
 */
export const resolveSectionSpacing = (isWide: boolean): number =>
  isWide ? sectionSpacing.web : sectionSpacing.mobile;

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

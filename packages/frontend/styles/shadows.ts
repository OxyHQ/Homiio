/**
 * Cross-platform shadow tokens.
 *
 * Expo 55 / React Native 0.85 (and React Native Web) deprecated the discrete
 * `shadow*` / `textShadow*` style props in favour of the single CSS-style
 * `boxShadow` / `textShadow` props, which are now supported on web AND native.
 * These helpers fold the legacy four-prop form into one string so the web build
 * stops logging the deprecation warnings, with byte-identical output to what
 * React Native Web previously synthesised from the `shadow*` props (so there is
 * no visual regression).
 *
 * Parity contract with `react-native-web`'s `createBoxShadowValue`:
 *   - String shape: `"<x>px <y>px <blur>px <rgba>"`.
 *   - Color folding: the resolved color's intrinsic alpha is MULTIPLIED by the
 *     `opacity` argument — mirroring `normalizeColor(color, opacity)` (which
 *     does `alpha = (a * opacity).toFixed(2)`). So `boxShadow({ color: 'rgba(0,0,0,0.1)', opacity: 0.1 })`
 *     yields `rgba(0,0,0,0.01)`, exactly as the old `shadowColor + shadowOpacity`
 *     pair did. Pass `opacity` only when the legacy style set `shadowOpacity`.
 *
 * Android: callers KEEP their existing `elevation` alongside the returned
 * `boxShadow` — `elevation` is not deprecated and `boxShadow` alone does not
 * reproduce Android's native elevation shadow. The `ShadowToken` helper pairs
 * the two so a `StyleSheet` block stays a single spread.
 *
 * Usage:
 *   import { boxShadow, shadowToken, textShadow } from '@/styles/shadows';
 *   card: { ...shadowToken({ y: 2, blur: 4, color: colors.COLOR_BLACK, opacity: 0.1, elevation: 3 }) }
 *   pill: { boxShadow: boxShadow({ y: 1, blur: 2, color: colors.COLOR_BLACK, opacity: 0.18 }) }
 *   label: { textShadow: textShadow({ y: 1, blur: 4, color: 'rgba(0,0,0,0.35)' }) }
 */
import type { ViewStyle } from 'react-native';

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Number of fractional digits RN Web emits for the shadow alpha channel. */
const ALPHA_PRECISION = 2;
/** Fully opaque alpha — the implicit alpha of a color with no explicit channel. */
const OPAQUE = 1;

const clampChannel = (value: number): number =>
  Math.max(0, Math.min(255, Math.round(value)));

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

const expandHexDigit = (digit: string): number => parseInt(digit + digit, 16);

/**
 * Parse a hex / `rgb()` / `rgba()` color into channels. Returns `null` for any
 * value we cannot fold numerically (e.g. the keyword `transparent`), so callers
 * can decide to drop the shadow rather than emit a broken string.
 */
const parseColor = (color: string): Rgba | null => {
  const value = color.trim();

  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: expandHexDigit(hex[0]),
        g: expandHexDigit(hex[1]),
        b: expandHexDigit(hex[2]),
        a: hex.length === 4 ? expandHexDigit(hex[3]) / 255 : OPAQUE,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : OPAQUE,
      };
    }
    return null;
  }

  const fn = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (fn) {
    const parts = fn[1].split(',').map((part) => part.trim());
    if (parts.length === 3 || parts.length === 4) {
      const [r, g, b] = parts;
      return {
        r: Number(r),
        g: Number(g),
        b: Number(b),
        a: parts.length === 4 ? Number(parts[3]) : OPAQUE,
      };
    }
  }

  return null;
};

/**
 * Resolve a color + optional opacity multiplier to the canonical
 * `rgba(r,g,b,a)` string RN Web produces. Returns `null` when the color is not
 * numerically foldable.
 */
const toRgba = (color: string, opacity: number): string | null => {
  const parsed = parseColor(color);
  if (parsed === null) return null;
  const alpha = clampUnit(parsed.a * opacity);
  // Match RN Web's `normalizeColor` byte-for-byte: it emits the raw
  // `(a * opacity).toFixed(2)` string (e.g. `0.30`, not `0.3`). The two are the
  // same CSS color, but keeping the exact string avoids any diff with the value
  // RN Web previously synthesised.
  return `rgba(${clampChannel(parsed.r)},${clampChannel(parsed.g)},${clampChannel(
    parsed.b,
  )},${alpha.toFixed(ALPHA_PRECISION)})`;
};

interface ShadowInput {
  /** Horizontal offset in px (legacy `shadowOffset.width`). Default 0. */
  x?: number;
  /** Vertical offset in px (legacy `shadowOffset.height`). Default 0. */
  y?: number;
  /** Blur radius in px (legacy `shadowRadius`). Default 0. */
  blur?: number;
  /** Shadow color — hex or rgb/rgba string (legacy `shadowColor`). */
  color: string;
  /** Legacy `shadowOpacity` — multiplied into the color's alpha. Default 1. */
  opacity?: number;
}

/**
 * Build a `boxShadow` string from the legacy four-prop shadow form. Throws if
 * the color cannot be folded numerically — shadows are always given a concrete
 * hex/rgba color in this app, so an unfoldable value is a programming error we
 * want surfaced rather than silently dropped.
 */
export const boxShadow = ({
  x = 0,
  y = 0,
  blur = 0,
  color,
  opacity = OPAQUE,
}: ShadowInput): string => {
  const rgba = toRgba(color, opacity);
  if (rgba === null) {
    throw new Error(`boxShadow: cannot resolve color "${color}" to rgba`);
  }
  return `${x}px ${y}px ${blur}px ${rgba}`;
};

/**
 * Resolve a color to its `"r, g, b"` channel triple (no alpha). Useful when a
 * shadow's alpha is animated (e.g. a Reanimated worklet building an animated
 * `boxShadow`): precompute the channels from the theme color once on the JS
 * thread, then interpolate only the alpha inside the worklet —
 * `` `0px 2px 3px rgba(${channels}, ${alpha})` ``. Avoids hardcoding magic
 * channel literals at the call site. Throws on an unfoldable color, matching
 * `boxShadow`.
 */
export const colorChannels = (color: string): string => {
  const parsed = parseColor(color);
  if (parsed === null) {
    throw new Error(`colorChannels: cannot resolve color "${color}" to rgb`);
  }
  return `${clampChannel(parsed.r)}, ${clampChannel(parsed.g)}, ${clampChannel(parsed.b)}`;
};

interface ShadowTokenInput extends ShadowInput {
  /** Android elevation, preserved verbatim alongside `boxShadow`. */
  elevation?: number;
}

type ShadowTokenStyle = Pick<ViewStyle, 'boxShadow' | 'elevation'>;

/**
 * Build a `StyleSheet`-ready `{ boxShadow, elevation? }` object — the drop-in
 * replacement for a `{ shadowColor, shadowOffset, shadowOpacity, shadowRadius,
 * elevation }` block. `elevation` is passed through unchanged for Android.
 */
export const shadowToken = ({
  elevation,
  ...shadow
}: ShadowTokenInput): ShadowTokenStyle =>
  elevation === undefined
    ? { boxShadow: boxShadow(shadow) }
    : { boxShadow: boxShadow(shadow), elevation };

interface TextShadowInput {
  /** Horizontal offset in px (legacy `textShadowOffset.width`). Default 0. */
  x?: number;
  /** Vertical offset in px (legacy `textShadowOffset.height`). Default 0. */
  y?: number;
  /** Blur radius in px (legacy `textShadowRadius`). Default 0. */
  blur?: number;
  /**
   * Text shadow color — used verbatim (RN Web's `createTextShadowValue` does
   * not apply an opacity multiplier), so pass an rgba string when alpha is
   * required.
   */
  color: string;
}

/**
 * Build a `textShadow` string from the legacy three-prop text-shadow form.
 * Mirrors RN Web's `createTextShadowValue` shape (`"<x>px <y>px <blur>px <color>"`)
 * AND its color handling: RN Web runs `textShadowColor` through `normalizeColor`
 * (opacity 1), collapsing it to the compact `rgba(r,g,b,a)` form. We do the same
 * so the output matches byte-for-byte; a color that is not numerically foldable
 * (e.g. a CSS keyword) is passed through verbatim, exactly as `normalizeColor`
 * would.
 */
export const textShadow = ({
  x = 0,
  y = 0,
  blur = 0,
  color,
}: TextShadowInput): string => {
  const resolved = toRgba(color, OPAQUE) ?? color;
  return `${x}px ${y}px ${blur}px ${resolved}`;
};

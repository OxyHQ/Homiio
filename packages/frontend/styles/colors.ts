/**
 * Bloom is the single source of truth for Homiio's colors.
 *
 * The static `colors` object below is DERIVED from Bloom's `blue` preset via
 * `buildTheme('blue', …)` so brand, text, background, border and status colors
 * always track Bloom. `buildTheme` is a pure function (it only reads
 * `Platform.OS` inside its adaptive branch, which we never enable), so it is
 * safe to call at module load — even though `styles/colors.ts` is imported in
 * static (non-component) scope across the app.
 *
 * Bloom serialises its palette as `hsl(…)` strings. The static `colors` map is
 * a legacy compatibility layer consumed by ~1700 call sites, some of which
 * append an 8-bit alpha suffix to the brand color (`colors.primaryColor + '20'`),
 * a pattern that requires hex. We therefore convert Bloom's `hsl(…)` values to
 * hex once, at module load, via `toHex()` — the values stay 100% Bloom-sourced,
 * just serialised as hex. Components that need live light/dark values should use
 * the `useColors()` hook (see `@/hooks/useThemeColor`), which returns Bloom's
 * native palette unchanged.
 *
 * App-specific colors Bloom does not model (the yellow secondary, chat/message
 * palette) live in `DomainColors` below and are layered on top — mirroring the
 * accounts app's `useColors()` + `DomainColors` pattern. No hand-copied generic
 * palette: every brand/neutral/status value comes from Bloom.
 */

import { buildTheme } from '@oxyhq/bloom/theme';
import type { ThemeColors } from '@oxyhq/bloom/theme';

/** Bloom `blue` resolved palettes — the single source of truth. */
export const BLOOM_LIGHT: ThemeColors = buildTheme('blue', 'light').colors;
export const BLOOM_DARK: ThemeColors = buildTheme('blue', 'dark').colors;

const channelToHex = (value: number): string =>
  Math.round(Math.max(0, Math.min(255, value)))
    .toString(16)
    .padStart(2, '0');

const hslToHex = (h: number, s: number, l: number): string => {
  const sat = s / 100;
  const lum = l / 100;
  const k = (n: number): number => (n + h / 30) % 12;
  const a = sat * Math.min(lum, 1 - lum);
  const f = (n: number): number =>
    255 * (lum - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))));
  return `#${channelToHex(f(0))}${channelToHex(f(8))}${channelToHex(f(4))}`;
};

/**
 * Normalise a Bloom color value to a 6-digit hex string.
 *
 * Bloom currently serialises neutrals as comma-separated `hsl(h, s%, l%)`, but
 * the parser also accepts the space-separated CSS Color 4 syntax
 * (`hsl(h s% l%)`) so a future Bloom serialisation change cannot silently leak
 * an unconverted `hsl(…)` string into React Native style props (RN's color
 * parser rejects space-separated hsl). Separators between the three components
 * may be commas and/or whitespace. Anything already hex/rgba passes through so
 * the conversion is total.
 */
const toHex = (value: string): string => {
  const match =
    /^hsl\(\s*([\d.]+)\s*(?:,\s*|\s+)([\d.]+)%\s*(?:,\s*|\s+)([\d.]+)%\s*\)$/i.exec(
      value,
    );
  if (match) {
    return hslToHex(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  return value;
};

/** Bloom `blue` light palette converted to hex for the legacy static `colors` map. */
const L = (key: keyof ThemeColors): string => toHex(BLOOM_LIGHT[key]);

/** Pure white — Bloom's primary-foreground for the `blue` preset. */
const WHITE = '#ffffff';
/** Pure black — used for true black icon/text fills. */
const BLACK = '#000000';

/**
 * App-only colors Bloom does not model. Kept here (not in the Bloom-derived
 * palette) so the design system stays honest about what is Bloom and what is
 * Homiio-specific. Layered on top of Bloom via `useColors()`.
 */
export const DomainColors = {
  light: {
    /** Homiio secondary brand accent (warm yellow). Not a Bloom token. */
    secondaryColor: '#ffd013',
    /** Soft tint behind the yellow secondary. */
    secondaryLight: '#fff7d7',
    /** Amber used for rating stars / highlights. */
    ratingStar: '#F2B400',
    /** Deep authoritative blue for "official / government-verified" landlord badges. */
    governmentBadge: '#1E40AF',
    // --- Chat / messaging surface (Homiio inbox) ---
    messageBubbleReceived: toHex(BLOOM_LIGHT.backgroundTertiary),
    messageTextReceived: toHex(BLOOM_LIGHT.text),
    messageTimestamp: toHex(BLOOM_LIGHT.textTertiary),
    messageSeparator: toHex(BLOOM_LIGHT.border),
    chatInputBackground: toHex(BLOOM_LIGHT.backgroundSecondary),
    chatInputBorder: toHex(BLOOM_LIGHT.border),
    chatInputText: toHex(BLOOM_LIGHT.text),
    chatInputPlaceholder: toHex(BLOOM_LIGHT.textTertiary),
    chatHeaderBorder: toHex(BLOOM_LIGHT.border),
  },
  dark: {
    secondaryColor: '#ffd013',
    secondaryLight: '#3a3413',
    ratingStar: '#F2B400',
    governmentBadge: '#2563EB',
    messageBubbleReceived: toHex(BLOOM_DARK.backgroundTertiary),
    messageTextReceived: toHex(BLOOM_DARK.text),
    messageTimestamp: toHex(BLOOM_DARK.textTertiary),
    messageSeparator: toHex(BLOOM_DARK.border),
    chatInputBackground: toHex(BLOOM_DARK.backgroundSecondary),
    chatInputBorder: toHex(BLOOM_DARK.border),
    chatInputText: toHex(BLOOM_DARK.text),
    chatInputPlaceholder: toHex(BLOOM_DARK.textTertiary),
    chatHeaderBorder: toHex(BLOOM_DARK.border),
  },
} as const;

export type DomainColorKey = keyof typeof DomainColors.light;

/**
 * Static color map kept for backwards compatibility with the ~1700 legacy
 * `colors.X` call sites. Every key is preserved; values are derived from
 * Bloom's `blue` light palette by ROLE (what each key is actually used for in
 * the app), so appearance is preserved except for the intended brand-primary
 * shift to Bloom blue. The grayscale ramp is Homiio's neutral domain.
 */
export const colors = {
  // --- Brand (now Bloom `blue` #1D9BF0) ---
  primaryColor: L('primary'),
  /**
   * Page/content surface (the white panel behind app content). Tracks Bloom's
   * `background` neutral (near-white) rather than a hardcoded `#fff` so it stays
   * in step with the rest of the Bloom-derived surfaces.
   */
  primaryLight: L('background'),
  primaryLight_1: L('primarySubtle'),
  primaryLight_2: L('primarySubtle'),
  /** Near-black used as default icon/heading color (role: foreground). */
  primaryDark: L('text'),
  primaryDark_1: L('textSecondary'),
  primaryDark_2: L('textTertiary'),
  secondaryColor: DomainColors.light.secondaryColor,
  secondaryLight: DomainColors.light.secondaryLight,
  overlay: BLOOM_LIGHT.overlay,
  shadow: BLOOM_LIGHT.shadow,

  // --- Neutral grayscale ramp (now derived BY ROLE from Bloom `blue` light
  //     neutrals, darkest → lightest). Bloom models fewer neutral steps than
  //     this legacy 9-stop ramp and uses one value for textSecondary/textTertiary,
  //     so adjacent stops can coincide; the ordering stays monotonic
  //     (non-increasing darkness), preserving the original visual hierarchy.
  //       _1/_2  headings / primary text     → text          (#1f1f1f)
  //       _3/_4  body / muted text           → textSecondary (#666c70)
  //       _5     faint icons / placeholders  → textTertiary  (#666c70)
  //       _6     hairline borders            → border        (#dee1e3)
  //       _7     light fills                 → backgroundTertiary  (#f1f2f3)
  //       _8     lighter fills               → backgroundSecondary (#f7f7f8)
  //       _9     near-white surfaces         → background          (#fcfcfc)
  COLOR_BLACK: BLACK,
  COLOR_BLACK_LIGHT_1: L('text'),
  COLOR_BLACK_LIGHT_2: L('text'),
  COLOR_BLACK_LIGHT_3: L('textSecondary'),
  COLOR_BLACK_LIGHT_4: L('textSecondary'),
  COLOR_BLACK_LIGHT_5: L('textTertiary'),
  COLOR_BLACK_LIGHT_6: L('border'),
  COLOR_BLACK_LIGHT_7: L('backgroundTertiary'),
  COLOR_BLACK_LIGHT_8: L('backgroundSecondary'),
  COLOR_BLACK_LIGHT_9: L('background'),
  COLOR_BACKGROUND: L('primarySubtle'),

  // --- Messaging / chat (Homiio inbox domain) ---
  messageBubbleSent: L('primary'),
  messageBubbleReceived: DomainColors.light.messageBubbleReceived,
  messageTextSent: WHITE,
  messageTextReceived: DomainColors.light.messageTextReceived,
  messageTimestamp: DomainColors.light.messageTimestamp,
  messageSeparator: DomainColors.light.messageSeparator,
  chatInputBackground: DomainColors.light.chatInputBackground,
  chatInputBorder: DomainColors.light.chatInputBorder,
  chatInputText: DomainColors.light.chatInputText,
  chatInputPlaceholder: DomainColors.light.chatInputPlaceholder,
  chatHeaderBorder: DomainColors.light.chatHeaderBorder,
  chatUnreadBadge: L('error'),
  chatTypingIndicator: L('success'),

  // --- Interactive elements ---
  buttonPrimary: L('primary'),
  buttonSecondary: L('textSecondary'),
  buttonDisabled: L('border'),
  linkColor: L('primary'),

  // --- Status colors ---
  online: L('success'),
  offline: L('textSecondary'),
  busy: L('error'),
  away: L('warning'),
  sindiColor: L('primarySubtleForeground'),

  // --- Semantic tokens (Bloom-backed) ---
  /** Page surface (off-white, Bloom `backgroundSecondary`). */
  surface: L('backgroundSecondary'),
  /** Raised card surface — Bloom `background` (brighter than `surface`, so cards
   *  read as elevated above the page). */
  surfaceElevated: L('background'),
  /** Muted neutral text used for secondary labels. */
  muted: L('textSecondary'),
  /** Soft neutral fill used for chips/badges that sit on `surface`. */
  mutedSubtle: L('backgroundTertiary'),
  /** Strong danger color used for error icons + critical labels. */
  danger: L('error'),
  /** Soft danger background used behind danger icons (icon badges). */
  dangerSubtle: L('negativeSubtle'),
  /** Success accent (confirmed bookings, approved applications). */
  success: L('success'),
  /**
   * Soft success surface (badges / calendar blocks). Bloom models only a single
   * subtle pair (primary/negative), so this green tint is a Homiio status surface.
   */
  successSubtle: '#E5F5EC',
  /** Warning accent (pending requests, in-review items). */
  warning: L('warning'),
  /**
   * Soft warning surface (badges / calendar blocks). Bloom has no amber subtle,
   * so this is a Homiio status surface paired with Bloom's `warning`.
   */
  warningSubtle: '#FBEFDD',
  /** Informational accent (neutral statuses, secondary metadata highlights). */
  info: L('info'),
  /** Soft info surface for info badges and inline notices. */
  infoSubtle: L('primarySubtle'),
  /** Deep brand-tinted foreground for text/icons on `primaryLight_1` surfaces. */
  primarySubtleForeground: L('primarySubtleForeground'),
  /** Subtle background used to mark "blocked" / unavailable calendar cells. */
  blockedSubtle: L('negativeSubtle'),
  /** Soft accent surface used for rating stars and amber highlights. */
  ratingStar: DomainColors.light.ratingStar,
  /** Deep blue for official / government-verified landlord badges (domain). */
  governmentBadge: DomainColors.light.governmentBadge,
  /** Mid-strength border color for hairlines on cards. */
  border: L('border'),

  // --- Semantic aliases (stable names used across screens) ---
  /** Primary brand color alias (= primaryColor). */
  primary: L('primary'),
  /** Default body text color. */
  text: L('text'),
  /** Secondary/muted text. */
  textSecondary: L('textSecondary'),
  /** Tertiary/faint text. */
  textTertiary: L('textTertiary'),
  /** App background surface (near-white, Bloom `background`). */
  background: L('background'),
  /** Pure white (icon/text on colored fills). Intentionally literal white. */
  white: WHITE,
  /** Error color alias (= danger). */
  error: L('error'),
} as const;

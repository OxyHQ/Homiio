function lightenColor(hex: string, percent: number): string {
  const num = parseInt(hex.slice(1), 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) + amt;
  const G = ((num >> 8) & 0x00ff) + amt;
  const B = (num & 0x0000ff) + amt;
  return `#${(0x1000000 + (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 + (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 + (B < 255 ? (B < 1 ? 0 : B) : 255)).toString(16).slice(1).toUpperCase()}`;
}

// Updated primary color for better contrast and modern feel
const primaryColor = '#0070e9';

export const colors = {
  primaryColor,
  primaryLight: '#ffffff',
  primaryLight_1: '#DDF3F5',
  primaryLight_2: '#E5F0FF',
  primaryDark: '#1A1A1A',
  primaryDark_1: '#2D2D2D',
  primaryDark_2: '#404040',
  secondaryColor: '#ffd013',
  secondaryLight: '#fff7d7',
  overlay: 'rgba(0, 0, 0, 0.5)',
  shadow: 'rgba(0, 0, 0, 0.1)',
  COLOR_BLACK: '#000',
  COLOR_BLACK_LIGHT_1: '#111111',
  COLOR_BLACK_LIGHT_2: '#1e1e1e',
  COLOR_BLACK_LIGHT_3: '#3c3c3c',
  COLOR_BLACK_LIGHT_4: '#5e5e5e',
  COLOR_BLACK_LIGHT_5: '#949494',
  COLOR_BLACK_LIGHT_6: '#ededed',
  COLOR_BLACK_LIGHT_7: '#F5F5F5',
  COLOR_BLACK_LIGHT_8: '#FAFAFA',
  COLOR_BLACK_LIGHT_9: '#FDFDFD',
  COLOR_BACKGROUND: lightenColor(primaryColor, 90),

  // New modern messaging colors
  messageBubbleSent: primaryColor,
  messageBubbleReceived: '#EDF2F7',
  messageTextSent: '#FFFFFF',
  messageTextReceived: '#1A202C',
  messageTimestamp: '#A0AEC0',
  messageSeparator: '#CBD5E0',

  // Chat UI specific colors
  chatInputBackground: '#F7FAFC',
  chatInputBorder: '#E2E8F0',
  chatInputText: '#2D3748',
  chatInputPlaceholder: '#A0AEC0',
  chatHeaderBorder: '#E2E8F0',
  chatUnreadBadge: '#FF3B30',
  chatTypingIndicator: '#00C853',

  // Interactive elements
  buttonPrimary: primaryColor,
  buttonSecondary: '#718096',
  buttonDisabled: '#CBD5E0',
  linkColor: primaryColor,

  // Status colors
  online: '#00C853',
  offline: '#718096',
  busy: '#FF3B30',
  away: '#FFCC00',
  sindiColor: '#175fac',

  // Semantic tokens — use these in new components instead of brand/grey
  // aliases above. Keeps the design system aligned with Bloom's theme
  // language (danger/success/warning + muted/surface) without coupling
  // consumers to the Bloom theme provider for static styles.
  /** Page surface (off-white background, same as Bloom `background`). */
  surface: '#FAFAFA',
  /** Raised card surface (white card on top of `surface`). */
  surfaceElevated: '#FFFFFF',
  /** Muted neutral text used for secondary labels. */
  muted: '#5e5e5e',
  /** Soft neutral fill used for chips/badges that sit on `surface`. */
  mutedSubtle: '#F1F1F1',
  /** Strong danger color used for error icons + critical labels. */
  danger: '#D7263D',
  /** Soft danger background used behind danger icons (icon badges). */
  dangerSubtle: '#FBE9EC',
  /** Success accent (confirmed bookings, approved applications). */
  success: '#2E7D5B',
  /** Soft success surface used behind success badges and calendar blocks. */
  successSubtle: '#E5F5EC',
  /** Warning accent (pending requests, in-review items). */
  warning: '#B5651D',
  /** Soft warning surface used behind warning badges and calendar blocks. */
  warningSubtle: '#FBEFDD',
  /** Informational accent (neutral statuses, secondary metadata highlights). */
  info: '#175FAC',
  /** Soft info surface for info badges and inline notices. */
  infoSubtle: '#E5F0FF',
  /** Subtle background used to mark "blocked" / unavailable calendar cells. */
  blockedSubtle: '#F5E6E8',
  /** Soft accent surface used for rating stars and amber highlights. */
  ratingStar: '#F2B400',
  /** Mid-strength border color for hairlines on cards. */
  border: '#ECECEC',
} as const;

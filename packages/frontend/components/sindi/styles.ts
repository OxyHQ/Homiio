import { Platform, StyleSheet } from 'react-native';
import { radius, spacing } from '@/constants/styles';
import { colors } from '@/styles/colors';
import { shadowToken } from '@/styles/shadows';

/**
 * Shared StyleSheet for the Sindi chat experience.
 *
 * Co-located with the Sindi chat components (`components/sindi/*`) so the route
 * orchestrator (`app/sindi/[conversationId].tsx`) and every presentational
 * piece (message list, bubble, composer, empty state, premium sheet) draw from
 * one styling source. All values are Bloom-derived (`@/styles/colors`) or
 * design tokens (`@/constants/styles`); no hand-rolled palette.
 */

/** Code-block monospace font, resolved per platform. */
const MONOSPACE = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

/** Height of the floating composer; messages reserve this much bottom space. */
const COMPOSER_RESERVED_HEIGHT = 72;

/** Inline-code background tint (subtle dark wash, not a Bloom token). */
const INLINE_CODE_BACKGROUND = 'rgba(0,0,0,0.06)';
/** File-preview chip background on the (primary) user bubble surface. */
const FILE_PREVIEW_BACKGROUND = 'rgba(255,255,255,0.15)';
/** Error subtext on the gradient error banner. */
const ERROR_SUBTEXT_COLOR = 'rgba(255, 255, 255, 0.8)';

export const sindiStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  backgroundGradient: {
    ...StyleSheet.absoluteFill,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing['4xl'],
  },
  loadingText: {
    marginTop: spacing.lg,
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  messagesContainer: {
    flex: 1,
    marginBottom: COMPOSER_RESERVED_HEIGHT,
  },
  messagesContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  emptyContainer: {
    paddingVertical: spacing['3xl'],
    paddingHorizontal: spacing.lg,
  },
  emptyCard: {
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: 'transparent',
  },
  emptyIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs + 2,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.md,
  },
  suggestionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  messageContainer: {
    marginVertical: 2,
    paddingHorizontal: spacing.xs,
  },
  userMessage: {
    alignItems: 'flex-end',
    marginLeft: spacing['4xl'],
  },
  assistantMessage: {
    alignItems: 'flex-start',
    marginRight: spacing['4xl'],
  },
  messageBubble: {
    paddingHorizontal: spacing.md - 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: 18,
    overflow: 'hidden',
    elevation: 0,
    gap: spacing.md,
  },
  userBubble: {
    backgroundColor: colors.primaryColor,
    borderTopRightRadius: 18,
  },
  assistantBubble: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopLeftRadius: 18,
  },
  /** Wraps message text so long content shrinks/wraps inside the bubble. */
  bubbleTextWrap: {
    flexShrink: 1,
    flexWrap: 'wrap',
    width: '100%',
  },
  /** Vertical gap rendered for a blank markdown line. */
  markdownSpacer: {
    height: spacing.xs + 2,
  },
  stickyInput: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  inputBar: {
    backgroundColor: colors.mutedSubtle,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  inputContainer: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 0,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.white,
    borderRadius: 24,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    maxHeight: 120,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs + 2,
    color: colors.text,
    lineHeight: 22,
  },
  sendButtonPlain: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: spacing.sm,
  },
  sendButtonDisabledPlain: {
    opacity: 0.5,
  },
  sendButtonPressed: {
    opacity: 0.8,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing['4xl'],
    margin: spacing.lg,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK,
  },
  errorContent: {
    alignItems: 'center',
  },
  errorText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primaryForeground,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  errorSubtext: {
    fontSize: 14,
    color: ERROR_SUBTEXT_COLOR,
    textAlign: 'center',
  },
  markdownParagraph: {
    fontSize: 15,
    lineHeight: 20,
    marginBottom: 2,
  },
  markdownBold: {
    fontWeight: '700',
  },
  markdownH1: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 26,
    marginTop: spacing.sm,
    marginBottom: spacing.xs + 2,
  },
  markdownH2: {
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
    marginTop: spacing.sm,
    marginBottom: spacing.xs + 2,
  },
  markdownH3: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  markdownListItem: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 2,
  },
  markdownBlockquote: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: spacing.xs + 2,
    borderLeftWidth: 3,
    borderLeftColor: colors.border,
    paddingLeft: spacing.sm,
    fontStyle: 'italic',
  },
  userText: {
    color: colors.primaryForeground,
  },
  assistantText: {
    color: colors.text,
  },
  link: {
    textDecorationLine: 'underline',
    color: colors.linkColor,
  },
  codeInline: {
    fontFamily: MONOSPACE,
    backgroundColor: INLINE_CODE_BACKGROUND,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: spacing.xs,
  },
  codeBlock: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.sm,
    padding: spacing.sm,
    marginVertical: spacing.xs + 2,
  },
  codeText: {
    fontFamily: MONOSPACE,
    fontSize: 13,
    lineHeight: 18,
  },
  propertyCardsContainer: {
    gap: spacing.md,
  },
  userPropertyCardsContainer: {
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    paddingBottom: spacing.xs,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadowToken({ y: 1, blur: 2, color: colors.COLOR_BLACK, opacity: 0.05, elevation: 1 }),
  },
  filePreviewContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: FILE_PREVIEW_BACKGROUND,
    borderRadius: spacing.sm,
    padding: spacing.xs + 2,
    marginBottom: spacing.xs + 2,
  },
  filePreviewText: {
    color: colors.white,
    fontSize: 13,
    marginRight: spacing.sm,
  },
  removeFileButton: {
    padding: 2,
  },
  attachButton: {
    marginRight: spacing.sm,
    padding: spacing.xs,
  },
  messageTime: {
    fontSize: 11,
    color: colors.textTertiary,
    marginTop: 2,
    marginHorizontal: spacing.sm,
  },
  messageTimeUser: {
    alignSelf: 'flex-end',
  },
  messageTimeAssistant: {
    alignSelf: 'flex-start',
  },
  premiumSheet: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  premiumIconWrap: {
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.infoSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  premiumTitle: {
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  premiumBody: {
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 20,
  },
  premiumPriceCard: {
    backgroundColor: colors.mutedSubtle,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  premiumPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  premiumPriceLabel: {
    fontSize: 14,
    color: colors.COLOR_BLACK,
  },
  premiumPriceCaption: {
    fontSize: 12,
    color: colors.muted,
    marginLeft: 26,
  },
  premiumActionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  premiumActionButton: {
    flex: 1,
  },
});

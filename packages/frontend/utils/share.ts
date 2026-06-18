/**
 * Transport-only share helper — the resilient "native share, fall back to
 * clipboard" ladder shared across the app (partner referral, Sindi
 * conversations, property detail). It owns NO feature-specific copy or tokens:
 * callers build their own title/message/url and decide what toast/alert to show
 * from the returned {@link ShareOutcome}.
 *
 * The ladder, in order:
 *   1. Web Share API (`navigator.share`) when running on web and available.
 *   2. React Native `Share.share` (the OS share sheet) on native.
 *   3. Clipboard copy (`expo-clipboard`) when neither is available or sharing
 *      throws.
 *
 * Outcomes:
 *   'shared'    → a share sheet / Web Share dialog completed (or, on native, was
 *                 not reported as dismissed — RN can't always tell).
 *   'copied'    → fell back to copying to the clipboard.
 *   'dismissed' → the user dismissed the native share sheet without sharing.
 *   'failed'    → neither sharing nor copying worked.
 */
import { Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';

export type ShareOutcome = 'shared' | 'copied' | 'dismissed' | 'failed';

export interface ShareContent {
  /** Sheet/dialog title (Android share sheet, Web Share). */
  title?: string;
  /** Native `Share.share` message (often "text\nurl" or text with the link). */
  message: string;
  /** The link to share, surfaced as the dedicated `url` field where supported. */
  url?: string;
  /**
   * Web Share `text` field, kept separate from `message` because the Web Share
   * API takes `text` and `url` independently. Defaults to `message`.
   */
  webText?: string;
  /**
   * Text written to the clipboard on the fallback path. Defaults to `url` when
   * present, otherwise `message` — pass it explicitly when the copy should carry
   * richer content than the bare link (e.g. full listing details).
   */
  copyText?: string;
}

/** Copy the fallback text to the clipboard, mapping success/failure to an outcome. */
async function copyToClipboard(text: string): Promise<ShareOutcome> {
  try {
    await Clipboard.setStringAsync(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/**
 * Share `content` through the best available transport, falling back to the
 * clipboard. See the module header for the ladder and outcomes. Never throws —
 * every failure path is mapped to a {@link ShareOutcome}.
 */
export async function shareContent(content: ShareContent): Promise<ShareOutcome> {
  const { title, message, url, webText, copyText } = content;
  const clipboardText = copyText ?? url ?? message;

  if (Platform.OS === 'web') {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text: webText ?? message, url });
        return 'shared';
      } catch (error) {
        // A user-cancelled Web Share dialog rejects with AbortError — treat that
        // as a dismissal (no fallback) rather than a failure. Any other error
        // means sharing genuinely failed, so fall back to the clipboard.
        if (error instanceof Error && error.name === 'AbortError') {
          return 'dismissed';
        }
        return copyToClipboard(clipboardText);
      }
    }
    return copyToClipboard(clipboardText);
  }

  try {
    const result = await Share.share(
      url ? { title, message, url } : { title, message },
    );
    return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
  } catch {
    return copyToClipboard(clipboardText);
  }
}

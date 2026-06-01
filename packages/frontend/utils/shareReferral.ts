/**
 * Share a partner referral link via the OS share sheet, falling back to a
 * clipboard copy when the sheet is unavailable (e.g. web without the Web Share
 * API). Shared by the agent hero CTA and the `ReferralLinkCard` so both entry
 * points behave identically.
 *
 * Returns the outcome so callers can surface the right toast:
 *  - 'shared'  → the share sheet opened (we can't tell if the user completed it)
 *  - 'copied'  → fell back to copying the link to the clipboard
 *  - 'failed'  → neither sharing nor copying worked
 */
import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';

export type ShareReferralOutcome = 'shared' | 'copied' | 'failed';

interface ShareReferralOptions {
  link: string;
  message: string;
  title: string;
}

export async function shareReferralLink({
  link,
  message,
  title,
}: ShareReferralOptions): Promise<ShareReferralOutcome> {
  try {
    await Share.share({ message, url: link, title });
    return 'shared';
  } catch {
    try {
      await Clipboard.setStringAsync(link);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
}

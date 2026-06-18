/**
 * Share a partner referral link. Builds the referral-specific message/title and
 * delegates the transport (native share → clipboard fallback, plus the web Web
 * Share path) to the shared {@link shareContent} ladder, so the agent hero CTA
 * and the `ReferralLinkCard` behave identically to every other share in the app.
 *
 * Returns the {@link ShareOutcome} so callers can surface the right toast:
 *  - 'shared'    → the share sheet / Web Share dialog completed
 *  - 'copied'    → fell back to copying the link to the clipboard
 *  - 'dismissed' → the native share sheet was dismissed without sharing
 *  - 'failed'    → neither sharing nor copying worked
 */
import { shareContent, type ShareOutcome } from '@/utils/share';

export type ShareReferralOutcome = ShareOutcome;

interface ShareReferralOptions {
  link: string;
  message: string;
  title: string;
}

export function shareReferralLink({
  link,
  message,
  title,
}: ShareReferralOptions): Promise<ShareReferralOutcome> {
  return shareContent({ message, url: link, title });
}

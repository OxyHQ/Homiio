/**
 * GB portal challenge heuristics shared by Rightmove, Zoopla, OnTheMarket, OpenRent.
 */

import { isAntiBotChallenge } from '../../parse/challenge';

/** HTML markers of a UK portal interstitial / bot wall served with HTTP 200. */
export function isGbPortalChallenge(html: string): boolean {
  const trimmed = html.trim();
  if (trimmed.length < 200) return true;
  if (!/<html/i.test(html) && trimmed.length < 1024) return true;
  // UK-portal-specific interstitial phrases the shared vendor markers don't cover.
  if (/are you a robot|enable javascript and cookies/i.test(html)) return true;
  return isAntiBotChallenge(html);
}

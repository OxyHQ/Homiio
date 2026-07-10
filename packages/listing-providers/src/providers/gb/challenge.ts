/**
 * GB portal challenge heuristics shared by Rightmove, Zoopla, OnTheMarket, OpenRent.
 */

/** HTML markers of a UK portal interstitial / bot wall served with HTTP 200. */
export function isGbPortalChallenge(html: string): boolean {
  const trimmed = html.trim();
  if (trimmed.length < 200) return true;
  if (!/<html/i.test(html) && trimmed.length < 1024) return true;
  return /just a moment|cf-browser-verification|attention required|access denied|datadome|captcha-delivery|perimeterx|px-captcha|are you a robot|unusual traffic|enable javascript and cookies/i.test(
    html,
  );
}

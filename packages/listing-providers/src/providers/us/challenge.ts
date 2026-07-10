/**
 * US portal challenge heuristics shared by Zillow and apartments.com.
 */

/** HTML markers of a US rental portal interstitial served with HTTP 200. */
export function isUsPortalChallenge(html: string): boolean {
  const trimmed = html.trim();
  if (trimmed.length < 200) return true;
  if (!/<html/i.test(html) && trimmed.length < 1024) return true;
  return /perimeterx|px-captcha|access denied|please verify|are you a robot|unusual traffic|cf-browser-verification|datadome|captcha-delivery/i.test(
    html,
  );
}

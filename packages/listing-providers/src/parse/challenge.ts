/**
 * Shared AJAX / HTML challenge heuristics (DataDome, Cloudflare, PerimeterX).
 *
 * Providers must import these — never re-copy challenge regexes per portal.
 */

/** True when an AJAX body is a bot challenge rather than portal JSON/HTML. */
export function isDataDomeAjaxChallenge(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed.length === 0) return true;
  if (/captcha-delivery\.com|geo\.captcha|datadome|acceso denegado|accesso negato|px-captcha/i.test(trimmed)) {
    return true;
  }
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) return true;
  if (/sentimos la interrupci|pardon our interruption|verifica que eres/i.test(trimmed)) return true;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return /"url"\s*:\s*"https?:\/\/geo\.captcha/i.test(trimmed);
  }
  return false;
}

/**
 * Cloudflare / generic interstitial markers (Navent MX, Vivanuncios, …).
 * Also treats tiny / non-HTML bodies as challenges.
 */
export function isCloudflareChallenge(html: string): boolean {
  const trimmed = html.trim();
  if (trimmed.length < 128) return true;
  if (
    /just a moment|cf-browser-verification|cf-mitigated|attention required|access denied|datadome|captcha-delivery|perimeterx|px-captcha|are you a robot|unusual traffic|enable javascript and cookies|cloudflare/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  return isDataDomeAjaxChallenge(trimmed);
}

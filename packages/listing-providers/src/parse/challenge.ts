/**
 * Shared AJAX / HTML challenge heuristics (DataDome, Kasada, AWS WAF,
 * PerimeterX/HUMAN, Cloudflare, Imperva/Incapsula).
 *
 * Providers must import these — never re-copy challenge regexes per portal.
 *
 * CRITICAL — false positives. A portal fronted by an anti-bot vendor loads that
 * vendor's PASSIVE sensor on EVERY good page, lists a cookie-consent category
 * literally named after the vendor, and embeds a reCAPTCHA/hCaptcha site key in
 * page config. Matching a bare vendor name (`datadome`, `captcha`, `recaptcha`,
 * `cloudflare`, `akamai`) therefore flags good pages as challenges — verified
 * against a live Otodom SERP, whose 37-listing HTML carries `"datadome":["C0001"]`
 * in its consent config and a `googleReCaptchaApiKey`. {@link ANTIBOT_CHALLENGE_MARKERS}
 * keys ONLY on a CHALLENGE-ONLY artefact: the vendor's captcha/challenge HOST or
 * a block-page interstitial phrase — never a passive sensor tag or widget class.
 * All patterns are linear (bounded quantifiers) — safe against ReDoS on ~1 MB
 * SERP bodies.
 */

const DATADOME_MARKERS =
  /captcha-delivery\.com|geo\.captcha|ct\.captcha-delivery|var\s+dd\s*=|datadome\.co\/|dd\.js/i;

/**
 * Markers that appear ONLY on an anti-bot challenge / block / captcha
 * interstitial across the major vendors. Presence of any one means the response
 * is a bot wall, not portal content — regardless of HTTP status (many vendors
 * serve the wall with a 200). Consumed by {@link isAntiBotChallenge},
 * `classifyOutcome` (the fetch ladder) and every portal warm-session detector.
 */
export const ANTIBOT_CHALLENGE_MARKERS: readonly RegExp[] = [
  // DataDome — captcha iframe / redirect host + interstitial ad-block text.
  /captcha-delivery\.com/i,
  /please enable (?:js|javascript) and disable any ad ?blocker/i,
  // Kasada — challenge-token header names emitted by the block bootstrap.
  /x-kpsdk-c[dt]/i,
  // AWS WAF — challenge / captcha token hosts.
  /token\.awswaf\.com/i,
  /captcha\.awswaf\.com/i,
  // PerimeterX / HUMAN — captcha global, host + block text.
  /_pxCaptcha/i,
  /captcha\.px-cloud\.net/i,
  /px-captcha/i,
  /access to this page has been denied/i,
  // Cloudflare — managed-challenge script path, legacy JS challenge + runtime.
  /\/cdn-cgi\/challenge-platform\//i,
  /cf-browser-verification/i,
  /cf_chl_(?:opt|rt|prog|tk)/i,
  /<title[^>]{0,120}>\s*just a moment/i,
  /attention required!?\s*(?:\||–|-)\s*cloudflare/i,
  // Imperva / Incapsula.
  /_Incapsula_Resource/i,
  /Incapsula incident ID/i,
  // Akamai / F5 BIG-IP ASM block page (title-scoped so listing copy is safe).
  /<title[^>]{0,120}>\s*access denied\s*<\/title>/i,
  // Generic bot-wall interstitials.
  /pardon our interruption/i,
  /unusual traffic/i,
];

/**
 * True when a response body is an anti-bot challenge / block page from any major
 * vendor (see {@link ANTIBOT_CHALLENGE_MARKERS}). Marker-only — it does NOT flag
 * short bodies (a small JSON payload is legitimate), so it is safe to run over
 * both HTML SERPs and JSON tiers; portal HTML detectors add their own tiny-body
 * heuristic on top.
 */
export function isAntiBotChallenge(html: string): boolean {
  return ANTIBOT_CHALLENGE_MARKERS.some((re) => re.test(html));
}

/**
 * True when a full HTML page is still on a DataDome interstitial (not real portal
 * content). Callers may pass `hasContent` to skip the check when listing markup
 * is already present (e.g. Idealista `article.item` on a warmed search page).
 */
export function isDataDomeHtmlChallenge(html: string, hasContent?: boolean): boolean {
  const trimmed = (html ?? '').trim();
  if (trimmed.length < 512) return true;
  if (hasContent) return false;
  if (/acceso denegado|comprueba que eres humano|verifica que eres|sentimos la interrupci|pardon our interruption/i.test(trimmed)) {
    return true;
  }
  return DATADOME_MARKERS.test(trimmed) || isAntiBotChallenge(trimmed);
}

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
 * Also treats tiny bodies as challenges. Does NOT treat normal HTML pages as
 * challenges — use {@link isDataDomeAjaxChallenge} for AJAX/JSON bodies only
 * (that helper flags any `<!DOCTYPE`/`<html` payload as a bot wall).
 */
export function isCloudflareChallenge(html: string): boolean {
  const trimmed = html.trim();
  if (trimmed.length < 128) return true;
  return /just a moment|cf-browser-verification|cf-mitigated|attention required|access denied|datadome|captcha-delivery|perimeterx|px-captcha|are you a robot|unusual traffic|enable javascript and cookies|cloudflare/i.test(
    trimmed,
  );
}

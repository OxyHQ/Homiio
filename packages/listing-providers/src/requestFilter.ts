/**
 * Browser-tier request filtering to keep residential-proxy bandwidth (billed per
 * GB) down. A portal page pulls in ads, trackers, analytics, maps, video embeds
 * and third-party widgets — none of which we need to read a listing, yet every
 * byte rides the proxy. This restricts what the browser is allowed to fetch to
 * the portal's own domain plus the anti-bot vendors whose challenge scripts a
 * warm session must run to get past DataDome/PerimeterX/Cloudflare/Imperva.
 */

/**
 * Multi-label public suffixes we serve, so `registrableDomain` returns the real
 * site (`rightmove.co.uk`, not `co.uk`). Not exhaustive — just the TLDs Homiio's
 * portals live under.
 */
const COMPOUND_SUFFIXES = new Set([
  'co.uk',
  'com.au',
  'com.mx',
  'com.ar',
  'com.br',
  'com.co',
  'com.ec',
  'com.pe',
  'com.py',
  'co.nz',
  'co.za',
  'co.il',
]);

/** Registrable domain (eTLD+1) of a hostname, honouring the compound suffixes. */
export function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  if (COMPOUND_SUFFIXES.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}

/**
 * Anti-bot vendor registrable domains a warm session legitimately needs to load
 * (challenge/verification scripts). Everything else off the portal is trimmed.
 */
const ANTIBOT_DOMAINS = new Set([
  'captcha-delivery.com', // DataDome
  'datadome.co',
  'cloudflare.com', // Cloudflare Turnstile / challenges (challenges.cloudflare.com)
  'hcaptcha.com',
  'perimeterx.net', // PerimeterX / HUMAN
  'px-cloud.net',
  'px-cdn.net',
  'akamai.net', // Akamai Bot Manager
  'akamaihd.net',
  'incapsula.com', // Imperva
  'imperva.com',
]);

/**
 * Whether the browser may fetch `requestUrl` while warming `portalDomain`
 * (a registrable domain). Allows the portal's own domain + subdomains and the
 * anti-bot vendors; blocks all other third parties (ads/trackers/maps/video).
 */
export function isAllowedBrowserRequest(requestUrl: string, portalDomain: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(requestUrl).hostname;
  } catch {
    return false;
  }
  const domain = registrableDomain(hostname);
  return domain === portalDomain || ANTIBOT_DOMAINS.has(domain);
}

/** Registrable domain of a page URL, or undefined when it can't be parsed. */
export function portalDomainFromUrl(url: string): string | undefined {
  try {
    return registrableDomain(new URL(url).hostname);
  } catch {
    return undefined;
  }
}

/**
 * yaencontre.com (Spain) — JSON-first with Playwright session warm-up.
 *
 * Cold HTTP and even residential-proxy Playwright currently hit Cloudflare
 * (challenge HTML ~1.5 KB). The provider still prefers AJAX/JSON once a session
 * clears; HTML is last resort. Registered OFF (`PROVIDER_YAENCONTRE_ENABLED`).
 */
export declare const YAENCONTRE_BASE_URL = "https://www.yaencontre.com";
export declare function yaencontreSearchUrl(city: string, page?: number): string;
/** Search/list AJAX candidate (tried from warmed session). */
export declare function yaencontreListAjaxUrl(city: string, page?: number): string;
export declare const YAENCONTRE_FIXTURE_DETAIL_JSON: string;
export declare const YAENCONTRE_FIXTURE_SEARCH_JSON: string;

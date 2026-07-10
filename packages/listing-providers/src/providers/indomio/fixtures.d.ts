/**
 * indomio.es (Spain) — JSON-first with Playwright session warm-up.
 *
 * Cold HTTP / proxy Playwright currently Cloudflare-challenged. Prefer list/
 * detail JSON once a session clears. Registered OFF (`PROVIDER_INDOMIO_ENABLED`).
 */
export declare const INDOMIO_BASE_URL = "https://www.indomio.es";
export declare function indomioSearchUrl(city: string, page?: number): string;
export declare function indomioListAjaxUrl(city: string, page?: number): string;
export declare const INDOMIO_FIXTURE_DETAIL_JSON: string;
export declare const INDOMIO_FIXTURE_SEARCH_JSON: string;

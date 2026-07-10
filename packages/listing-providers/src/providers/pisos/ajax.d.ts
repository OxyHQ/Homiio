/**
 * pisos.com AJAX / URL helpers (pure).
 *
 * Prefer structured JSON (search JSON-LD, detail `data-var` + tracking blob,
 * contact AJAX) over HTML scraping. Cold HTTP works for search/detail; contact
 * endpoints are best-effort and must not fail ingest on 403/empty.
 */
/** Rental search URL for a city + 1-based page. */
export declare function pisosSearchUrl(city: string, page?: number): string;
/** Sale search URL (secondary discover path). */
export declare function pisosSaleSearchUrl(city: string, page?: number): string;
/** Contact phone AJAX (best-effort; often returns `{ phone: null }`). */
export declare function pisosContactPhoneUrl(sourceId: string): string;
/** Parse a contact AJAX JSON body into a phone string when present. */
export declare function parsePisosContactPhone(body: string): string | undefined;

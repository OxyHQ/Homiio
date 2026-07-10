/**
 * milanuncios.com (Spain) — general classifieds, REAL-ESTATE ONLY.
 *
 * Classifieds providers must scope discover to real-estate categories and reject
 * non-housing in normalize. This plugin:
 *   1. Discovers ONLY via housing category URL allowlist (inmobiliaria / pisos /
 *      alquiler / venta / habitaciones / vacacional) — never site-wide search.
 *   2. Prefers JSON/AJAX listing APIs via a warmed Playwright session (GeeTest
 *      blocks cold HTTP). HTML is last resort.
 *   3. `normalize()` hard-rejects cars/jobs/electronics via {@link assertHousingListing}.
 *
 * Registered OFF by default (`PROVIDER_MILANUNCIOS_ENABLED`). Do NOT enable in
 * prod until the housing filter + session path are verified end-to-end.
 */
export declare const MILANUNCIOS_BASE_URL = "https://www.milanuncios.com";
/**
 * Allowlisted category path slugs for discover. Site-wide `/anuncios/` or
 * motor/empleo paths are intentionally absent.
 */
export declare const MILANUNCIOS_HOUSING_CATEGORY_SLUGS: ReadonlySet<string>;
/** Category ids observed on milanuncios inmobiliaria taxonomy (allowlist). */
export declare const MILANUNCIOS_HOUSING_CATEGORY_IDS: ReadonlySet<string>;
/** Housing-only search URL for a city (alquiler de pisos). */
export declare function milanunciosHousingSearchUrl(city: string, page?: number): string;
/** Alternate inmobiliaria category URL. */
export declare function milanunciosInmobiliariaSearchUrl(city: string, page?: number): string;
/**
 * AJAX/list endpoint candidates (tried from a warmed session). Response shapes
 * vary; parsers accept several wrappers. Cold HTTP returns GeeTest 405.
 */
export declare function milanunciosListAjaxUrl(city: string, page?: number): string;
/** Hand-authored housing advert JSON (portal-shaped). */
export declare const MILANUNCIOS_FIXTURE_HOUSING_JSON: string;
/** Hand-authored car advert JSON — MUST be rejected by normalize. */
export declare const MILANUNCIOS_FIXTURE_CAR_JSON: string;
/** Search AJAX wrapper with one housing advert. */
export declare const MILANUNCIOS_FIXTURE_SEARCH_JSON: string;

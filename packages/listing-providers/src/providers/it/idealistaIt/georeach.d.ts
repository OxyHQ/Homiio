/**
 * Idealista.it georeach AJAX discover helpers (pure).
 *
 * IT host mirrors ES layout with Italian path segments:
 *   warm: `/affitto-case/{city}/`
 *   detail: `/immobile/{id}/`
 *   georeach: `/it/ajax/listing/georeach/{city}-{province}`
 */
export declare function idealistaItGeoreachSlug(city: string): string;
export declare function idealistaItGeoreachUrl(city: string, page?: number): string;
export declare function idealistaItWarmSearchUrl(city: string, page?: number): string;
export declare function isIdealistaItGeoreachChallenge(body: string): boolean;
export declare function parseIdealistaItGeoreach(body: string): {
    sourceId: string;
    url: string;
}[];

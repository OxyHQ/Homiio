/**
 * schema.org JSON-LD extraction for Italian portals (Idealista.it, Casa.it, …).
 *
 * Mirrors {@link ../es/jsonLd} with IT amenity aliases and countryCode default `IT`.
 */
export interface ItSchemaListing {
    types: string[];
    name?: string;
    description?: string;
    url?: string;
    address: {
        street?: string;
        city?: string;
        region?: string;
        postalCode?: string;
        neighborhood?: string;
        country?: string;
        countryCode?: string;
    };
    coordinates?: {
        lat: number;
        lng: number;
    };
    images: string[];
    bedrooms?: number;
    bathrooms?: number;
    squareMeters?: number;
    price?: number;
    priceCurrency?: string;
    operation?: 'rent' | 'sale';
    amenities: string[];
    furnished?: boolean;
}
export declare function extractItSchemaListings(html: string): ItSchemaListing[];
export declare function pickItListing(listings: ItSchemaListing[]): ItSchemaListing | undefined;

/**
 * Recorded HotPads JSON fixtures (portal-shaped, hand-authored).
 */
export declare const HOTPADS_API_BASE = "https://hotpads-api-gke-prod-1-west-20250228-public.hotpads.com/hotpads-api/api/v2";
export declare const HOTPADS_BASE_URL = "https://hotpads.com";
export interface HotpadsListingFixture {
    aliasEncoded: string;
    lotIdEncoded: string;
    uriMalone: string;
    title: string;
    propertyType: string;
    listingType: string;
    address: {
        street: string;
        city: string;
        state: string;
        zip: string;
    };
    geo: {
        lat: number;
        lon: number;
    };
    modelSummary: {
        minBeds: number;
        maxBeds: number;
        minPrice: number;
        maxPrice: number;
        minBaths: number;
        maxBaths: number;
        minSqft: number;
        maxSqft: number;
    };
    medPhotoUrl: string;
    medPhotoUrls: string[];
}
export declare const HOTPADS_AREA_FIXTURE: {
    status: string;
    success: boolean;
    data: {
        id: string;
        resourceId: string;
        name: string;
        state: string;
        city: string;
        minLat: number;
        maxLat: number;
        minLon: number;
        maxLon: number;
        coordinates: {
            lon: number;
            lat: number;
        };
    };
};
export declare const HOTPADS_LISTING_FIXTURE: HotpadsListingFixture;
export declare const HOTPADS_SEARCH_FIXTURE: {
    status: string;
    success: boolean;
    data: {
        numListingsAvailable: number;
        numListingsIncluded: number;
        buildings: {
            lotIdEncoded: string;
            geo: {
                lat: number;
                lon: number;
            };
            uri: string;
            listings: HotpadsListingFixture[];
        }[];
    };
};

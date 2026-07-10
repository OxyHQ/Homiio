/**
 * Recorded realtor.com GraphQL fixtures (portal-shaped, hand-authored).
 */
export declare const REALTOR_COM_BASE_URL = "https://www.realtor.com";
export interface RecordedRealtorListing {
    property_id: string;
    listing_id: string;
    permalink: string;
    status: string;
    list_price: number | null;
    list_price_min: number | null;
    list_price_max: number | null;
    description: {
        beds: number | null;
        baths: number | null;
        sqft: number | null;
    };
    location: {
        address: {
            line: string;
            city: string;
            state_code: string;
            postal_code: string;
            coordinate: {
                lat: number;
                lon: number;
            };
        };
    };
    photos: Array<{
        href: string;
    }>;
    primary_photo?: {
        href: string;
    } | null;
}
export declare const REALTOR_COM_RENT_FIXTURE: RecordedRealtorListing;
export declare const REALTOR_COM_SALE_FIXTURE: RecordedRealtorListing;
export declare const REALTOR_COM_SEARCH_FIXTURE: {
    data: {
        home_search: {
            count: number;
            total: number;
            results: RecordedRealtorListing[];
        };
    };
};

/**
 * Recorded Redfin Stingray JSON fixtures (portal-shaped, hand-authored).
 */
export declare const REDFIN_BASE_URL = "https://www.redfin.com";
export interface RedfinHomeFixture {
    propertyId: number;
    listingId: number;
    url: string;
    price: number;
    beds: number;
    baths: number;
    sqFt: number;
    street: string;
    city: string;
    state: string;
    zip: string;
    lat: number;
    lng: number;
    photoUrls: string[];
}
export declare const REDFIN_GIS_FIXTURE: {
    version: number;
    errorMessage: string;
    resultCode: number;
    payload: {
        homes: {
            propertyId: number;
            listingId: number;
            url: string;
            price: {
                value: number;
            };
            beds: number;
            baths: number;
            sqFt: {
                value: number;
            };
            streetLine: {
                value: string;
            };
            city: string;
            state: string;
            zip: string;
            latLong: {
                value: {
                    latitude: number;
                    longitude: number;
                };
            };
            photos: {
                value: {
                    url: string;
                }[];
            };
            sashes: {
                sashType: number;
                sashTypeName: string;
                openHouseText: string;
            }[];
        }[];
    };
};
export declare const REDFIN_INITIAL_INFO_FIXTURE: {
    version: number;
    errorMessage: string;
    resultCode: number;
    payload: {
        propertyId: number;
        listingId: number;
        url: string;
        price: {
            value: number;
        };
        beds: number;
        baths: number;
        sqFt: {
            value: number;
        };
        streetLine: {
            value: string;
        };
        city: string;
        state: string;
        zip: string;
        latLong: {
            value: {
                latitude: number;
                longitude: number;
            };
        };
        photos: {
            value: {
                url: string;
            }[];
        };
        sashes: {
            sashType: number;
            sashTypeName: string;
            openHouseText: string;
        }[];
    };
};

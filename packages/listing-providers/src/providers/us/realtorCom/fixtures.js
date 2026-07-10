"use strict";
/**
 * Recorded realtor.com GraphQL fixtures (portal-shaped, hand-authored).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.REALTOR_COM_SEARCH_FIXTURE = exports.REALTOR_COM_SALE_FIXTURE = exports.REALTOR_COM_RENT_FIXTURE = exports.REALTOR_COM_BASE_URL = void 0;
exports.REALTOR_COM_BASE_URL = 'https://www.realtor.com';
exports.REALTOR_COM_RENT_FIXTURE = {
    property_id: '8700596318',
    listing_id: '2991925477',
    permalink: '9209-Northgate-Blvd_Austin_TX_78758_M87005-96318',
    status: 'for_rent',
    list_price: null,
    list_price_min: 500,
    list_price_max: 1099,
    description: { beds: 2, baths: 2, sqft: 980 },
    location: {
        address: {
            line: '9209 Northgate Blvd',
            city: 'Austin',
            state_code: 'TX',
            postal_code: '78758',
            coordinate: { lat: 30.371404, lon: -97.715268 },
        },
    },
    photos: [
        { href: 'https://ar.rdcpix.com/example/realtor-rent-1.jpg' },
        { href: 'https://ar.rdcpix.com/example/realtor-rent-2.jpg' },
    ],
    primary_photo: { href: 'https://ar.rdcpix.com/example/realtor-rent-1.jpg' },
};
exports.REALTOR_COM_SALE_FIXTURE = {
    property_id: '7211899596',
    listing_id: '2997168140',
    permalink: '4719-Castleman-Dr_Austin_TX_78725_M72118-99596',
    status: 'for_sale',
    list_price: 385000,
    list_price_min: null,
    list_price_max: null,
    description: { beds: 3, baths: 2, sqft: 1405 },
    location: {
        address: {
            line: '4719 Castleman Dr',
            city: 'Austin',
            state_code: 'TX',
            postal_code: '78725',
            coordinate: { lat: 30.246305, lon: -97.583195 },
        },
    },
    photos: [{ href: 'https://ap.rdcpix.com/example/realtor-sale-1.jpg' }],
    primary_photo: { href: 'https://ap.rdcpix.com/example/realtor-sale-1.jpg' },
};
exports.REALTOR_COM_SEARCH_FIXTURE = {
    data: {
        home_search: {
            count: 2,
            total: 500,
            results: [exports.REALTOR_COM_RENT_FIXTURE, exports.REALTOR_COM_SALE_FIXTURE],
        },
    },
};

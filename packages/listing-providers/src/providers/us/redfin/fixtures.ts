/**
 * Recorded Redfin Stingray JSON fixtures (portal-shaped, hand-authored).
 */

export const REDFIN_BASE_URL = 'https://www.redfin.com';

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

export const REDFIN_GIS_FIXTURE = {
  version: 649,
  errorMessage: '',
  resultCode: 0,
  payload: {
    homes: [
      {
        propertyId: 184562901,
        listingId: 204819901,
        url: '/TX/Austin/2100-San-Jacinto-Blvd-78712/home/184562901',
        price: { value: 425000 },
        beds: 2,
        baths: 2,
        sqFt: { value: 1180 },
        streetLine: { value: '2100 San Jacinto Blvd' },
        city: 'Austin',
        state: 'TX',
        zip: '78712',
        latLong: { value: { latitude: 30.28412, longitude: -97.74155 } },
        photos: { value: [{ url: 'https://ssl.cdn-redfin.com/example/redfin-1.jpg' }] },
        sashes: [],
      },
      {
        propertyId: 184562902,
        listingId: 204819902,
        url: '/TX/Austin/88-Rainey-St-78701/home/184562902',
        price: { value: 3150 },
        beds: 1,
        baths: 1,
        sqFt: { value: 720 },
        streetLine: { value: '88 Rainey St Unit 12' },
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        latLong: { value: { latitude: 30.25701, longitude: -97.73844 } },
        photos: { value: [{ url: 'https://ssl.cdn-redfin.com/example/redfin-2.jpg' }] },
        sashes: [{ sashType: 32, sashTypeName: 'Rental', openHouseText: '' }],
      },
    ],
  },
};

export const REDFIN_INITIAL_INFO_FIXTURE = {
  version: 649,
  errorMessage: '',
  resultCode: 0,
  payload: REDFIN_GIS_FIXTURE.payload.homes[0],
};

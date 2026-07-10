/**
 * Realtor.ca fixtures — `api2.realtor.ca` JSON (Imperva-gated live).
 */

export const REALTOR_CA_BASE_URL = 'https://www.realtor.ca';
export const REALTOR_CA_API_BASE = 'https://api2.realtor.ca';

export const REALTOR_CA_FIXTURE_SEARCH_JSON = JSON.stringify({
  Results: [
    {
      Id: '29767355',
      MlsNumber: 'C12141141',
      PublicRemarks: 'Bright south-facing condo in Church-Yonge Corridor with city views.',
      Building: {
        Bedrooms: '2',
        BathroomTotal: '2',
        SizeInterior: '750 sqft',
      },
      Property: {
        Address: {
          AddressText: '1201-81 Wellesley Street E, Toronto, Ontario M4Y1H6',
          Latitude: '43.6654',
          Longitude: '-79.3839',
        },
        Price: '$2,800 /month',
        PriceUnformattedValue: '2800',
        Type: 'Condo Apartment',
        Photo: [
          {
            HighResPath: 'https://cdn.realtor.ca/listings/TS638765432100000000/highres/0/c1314114_1.jpg',
          },
          {
            HighResPath: 'https://cdn.realtor.ca/listings/TS638765432100000000/highres/0/c1314114_2.jpg',
          },
        ],
      },
      Individual: [
        {
          Name: 'Jane Doe',
          Phones: [{ PhoneType: 'Telephone', AreaCode: '416', PhoneNumber: '555-0199' }],
          Organization: { Name: 'Example Realty Inc.' },
        },
      ],
    },
  ],
  Paging: {
    RecordsPerPage: 12,
    CurrentPage: 1,
    TotalPages: 3,
  },
});

export const REALTOR_CA_FIXTURE_DETAIL_JSON = JSON.stringify({
  Id: '29767355',
  MlsNumber: 'C12141141',
  PublicRemarks: 'Bright south-facing condo in Church-Yonge Corridor with city views.',
  Building: {
    Bedrooms: '2',
    BathroomTotal: '2',
    SizeInterior: '750 sqft',
  },
  Property: {
    Address: {
      AddressText: '1201-81 Wellesley Street E, Toronto, Ontario M4Y1H6',
      Latitude: '43.6654',
      Longitude: '-79.3839',
    },
    Price: '$2,800 /month',
    PriceUnformattedValue: '2800',
    Type: 'Condo Apartment',
    Photo: [
      {
        HighResPath: 'https://cdn.realtor.ca/listings/TS638765432100000000/highres/0/c1314114_1.jpg',
      },
    ],
  },
  Individual: [
    {
      Name: 'Jane Doe',
      Phones: [{ PhoneType: 'Telephone', AreaCode: '416', PhoneNumber: '555-0199' }],
      Organization: { Name: 'Example Realty Inc.' },
    },
  ],
});

/** Default map bounding boxes for major Canadian cities. */
export const REALTOR_CA_CITY_BBOX: Readonly<
  Record<string, { latMin: number; latMax: number; lngMin: number; lngMax: number; province: string }>
> = {
  toronto: { latMin: 43.58, latMax: 43.85, lngMin: -79.64, lngMax: -79.12, province: 'ON' },
  vancouver: { latMin: 49.2, latMax: 49.35, lngMin: -123.25, lngMax: -123.0, province: 'BC' },
  montreal: { latMin: 45.45, latMax: 45.65, lngMin: -73.75, lngMax: -73.45, province: 'QC' },
  calgary: { latMin: 50.9, latMax: 51.15, lngMin: -114.2, lngMax: -113.9, province: 'AB' },
  ottawa: { latMin: 45.3, latMax: 45.5, lngMin: -75.9, lngMax: -75.5, province: 'ON' },
};

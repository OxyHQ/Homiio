/**
 * Bien'ici fixtures — portal-shaped JSON (not live copies).
 */

export const BIENICI_BASE_URL = 'https://www.bienici.com';

/** Search JSON with one priced buy (range) + one rent with scalar price. */
export const BIENICI_FIXTURE_SEARCH_JSON = JSON.stringify({
  total: 2,
  from: 0,
  perPage: 24,
  realEstateAds: [
    {
      id: 'nexity-57__57006',
      adType: 'buy',
      propertyType: 'flat',
      city: 'La Chapelle-Saint-Mesmin',
      postalCode: '45380',
      price: [1, 275000],
      surfaceArea: 64,
      roomsQuantity: 3,
      bedroomsQuantity: 2,
      description: 'Appartement neuf à la Chapelle Saint-Mesmin.',
      photos: [
        {
          url: 'https://file.bienici.com/photo/fixture-buy-1.jpg',
          exists: true,
        },
      ],
      blurInfo: {
        position: { lat: 47.88724, lon: 1.8354 },
      },
    },
    {
      id: 'ag750725-49688129',
      adType: 'rent',
      propertyType: 'flat',
      city: 'Paris',
      postalCode: '75007',
      price: 1850,
      surfaceArea: 40,
      roomsQuantity: 2,
      bedroomsQuantity: 1,
      bathroomsQuantity: 1,
      isFurnished: true,
      floor: 1,
      description: 'Charmant T2 Oudinot 7ème.',
      photos: [
        {
          url: 'https://file.bienici.com/photo/fixture-rent-1.jpg',
          exists: true,
        },
      ],
      blurInfo: {
        position: { lat: 48.857, lng: 2.3202 },
      },
      contactRelativeData: {
        agencyNameToDisplay: 'AKOUN PROPRIETES',
        contactNameToDisplay: 'AKOUN PROPRIETES',
        phoneToDisplay: '01 43 29 49 06',
        hasEmailToDisplay: true,
        contactIsAgency: true,
        contactIsPro: true,
        address: { street: '29 rue St Louis', city: 'PARIS 4ÈME', postalCode: '75004' },
      },
    },
  ],
});

/** Detail JSON for the rent fixture (contact + photos). */
export const BIENICI_FIXTURE_DETAIL_JSON = JSON.stringify({
  id: 'ag750725-49688129',
  adType: 'rent',
  propertyType: 'flat',
  city: 'Paris',
  postalCode: '75007',
  price: 1850,
  surfaceArea: 40,
  roomsQuantity: 2,
  bedroomsQuantity: 1,
  bathroomsQuantity: 1,
  isFurnished: true,
  floor: 1,
  hasElevator: false,
  hasBalcony: false,
  title: 'QUARTIER RESIDENTIEL OUDINOT 7ème',
  description:
    'QUARTIER RESIDENTIEL OUDINOT 7ème Très charmant appartement de deux pièces au 1er étage.',
  photos: [
    {
      url: 'https://file.bienici.com/photo/5e2d1f2e-cd62-44c9-ba01-484bfc05feab',
      exists: true,
    },
    {
      url: 'https://file.bienici.com/photo/fixture-rent-2.jpg',
      exists: true,
    },
  ],
  blurInfo: {
    type: 'cityOrArrondissement',
    position: { lat: 48.8570280931866, lng: 2.32019530595631 },
  },
  contactRelativeData: {
    agencyNameToDisplay: 'AKOUN PROPRIETES',
    contactNameToDisplay: 'AKOUN PROPRIETES',
    phoneToDisplay: '01 43 29 49 06',
    hasEmailToDisplay: true,
    contactIsAgency: true,
    contactIsPro: true,
    address: { street: '29 rue St Louis', city: 'PARIS 4ÈME', postalCode: '75004' },
  },
});

/** Detail JSON for the buy fixture (price may be absent on detail — use search hint). */
export const BIENICI_FIXTURE_BUY_DETAIL_JSON = JSON.stringify({
  id: 'nexity-57__57006',
  adType: 'buy',
  propertyType: 'flat',
  city: 'La Chapelle-Saint-Mesmin',
  postalCode: '45380',
  price: null,
  surfaceArea: 64,
  roomsQuantity: 3,
  bedroomsQuantity: 2,
  description: 'Devenez propriétaire de votre appartement à la Chapelle Saint-Mesmin.',
  photos: [{ url: 'https://file.bienici.com/photo/fixture-buy-1.jpg', exists: true }],
  blurInfo: { position: { lat: 47.88724, lon: 1.8354 } },
  contactRelativeData: {
    agencyNameToDisplay: 'Nexity',
    contactNameToDisplay: 'Nexity',
    phoneToDisplay: '0805620810',
    hasEmailToDisplay: true,
    contactIsAgency: true,
    contactIsPro: true,
    address: { street: '67 rue Arago', city: 'Saint-Ouen', postalCode: '93400' },
  },
});

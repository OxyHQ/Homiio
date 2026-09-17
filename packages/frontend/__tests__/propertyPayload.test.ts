/**
 * The publish flow's request body, pinned.
 *
 * The create/edit screen was rebuilt on Bloom's `wizard` and `listing-editor`
 * families. The steps still write the same `createPropertyFormStore` sections
 * and `buildPropertyPayload` still turns them into the body `POST`/`PUT
 * /api/properties` receives — this file is the proof that the body did not
 * move. `EXPECTED_BODY` was captured from `buildPropertyPayload` on `main`
 * BEFORE the rebuild, from the same fully populated form, so any drift in a
 * default, a parse or a conditional block fails here.
 *
 * A saved draft is JSON in AsyncStorage, so the second case round-trips the form
 * through JSON first: resuming a draft must publish the same body the unsaved
 * form would have.
 *
 * ONE deliberate change since that capture: `addressPublishedPrecision`. The
 * Location step's floor "Private" toggle was never sent, so every listing
 * published its floor and unit whatever the host chose (found in #491). The
 * body now carries the choice — `building` for private (and for an untouched
 * toggle), `exact` for public — and nothing else in it moved. Both values are
 * pinned below, because a body that always sent one of them would pass a test
 * that only looked at the other.
 */
import { ExchangeMode, OfferingType, AvailabilityWindowStatus } from '@homiio/shared-types';

import { buildPropertyPayload } from '@/hooks/useCreatePropertyWizard';
import { createDefaultFormData, type CreatePropertyFormData } from '@/store/createPropertyFormStore';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

function populatedForm(): CreatePropertyFormData {
  const form = createDefaultFormData();
  form.basicInfo = {
    ...form.basicInfo,
    propertyType: 'apartment',
    bedrooms: 3,
    bathrooms: 2,
    squareFootage: 96,
    yearBuilt: 1998,
    description: 'Bright corner flat with a long balcony over the square.',
  };
  form.location = {
    ...form.location,
    address: 'Carrer de Verdi',
    number: '14',
    unit: '3-2',
    floor: 3,
    showFloor: false,
    neighborhood: 'Gràcia',
    city: 'Barcelona',
    state: 'Barcelona',
    postal_code: '08012',
    country: 'Spain',
    countryCode: 'ES',
    latitude: 41.40312,
    longitude: 2.15681,
  };
  form.pricing = {
    ...form.pricing,
    offerings: [
      OfferingType.LONG_TERM_RENT,
      OfferingType.SHORT_TERM_RENT,
      OfferingType.SALE,
      OfferingType.EXCHANGE,
    ],
    currency: 'EUR',
    monthlyRent: 1450.5,
    securityDeposit: 2900,
    applicationFee: 0,
    lateFee: 25,
    nightlyRate: 96,
    cleaningFee: 35,
    serviceFee: 0,
    taxesPercent: 10,
    minNights: 2,
    maxNights: undefined,
    instantBook: true,
  };
  form.amenities = { selectedAmenities: ['wifi', 'elevator', 'balcony'] };
  form.media = {
    images: [
      {
        imageId: 'img-1',
        urls: {
          small: 'https://cdn.example/1-s.jpg',
          medium: 'https://cdn.example/1-m.jpg',
          large: 'https://cdn.example/1-l.jpg',
          original: 'https://cdn.example/1.jpg',
        },
        keys: { original: 'properties/1.jpg', variants: {} },
        metadata: { originalSize: 1, originalFormat: 'jpeg', uploadedAt: new Date('2026-09-01T00:00:00Z') },
        isPrimary: true,
        caption: 'Living room',
      },
    ],
    videos: [],
  };
  form.offering = {
    ...form.offering,
    salePrice: 385000,
    saleCurrency: 'EUR',
    chainStatus: 'no_chain',
    isPriceReduced: false,
    exchangeMode: ExchangeMode.SWAP,
    exchangeAvailabilityWindows: [
      {
        start: '2026-10-01T00:00:00.000Z',
        end: '2026-10-15T00:00:00.000Z',
        status: AvailabilityWindowStatus.AVAILABLE,
      },
    ],
    exchangeMinStay: 3,
    exchangeWelcomeNote: '  Plants need water.  ',
    exchangeLanguages: ['Catalan', 'English'],
    exchangeMealsIncluded: false,
    exchangeRequiresReciprocity: true,
  };
  return form;
}

const EXPECTED_BODY = {
  address: {
    street: 'Carrer de Verdi',
    city: 'Barcelona',
    state: 'Barcelona',
    postal_code: '08012',
    country: 'Spain',
    countryCode: 'ES',
    neighborhood: 'Gràcia',
    coordinates: { type: 'Point', coordinates: [2.15681, 41.40312] },
    number: '14',
    unit: '3-2',
  },
  // The form's `showFloor: false` — floor and door private.
  addressPublishedPrecision: 'building',
  type: 'apartment',
  description: 'Bright corner flat with a long balcony over the square.',
  bedrooms: 3,
  bathrooms: 2,
  squareFootage: 96,
  floor: 3,
  yearBuilt: 1998,
  amenities: ['wifi', 'elevator', 'balcony'],
  images: [{ url: 'https://cdn.example/1.jpg', caption: 'Living room', isPrimary: true }],
  status: 'published',
  offerings: ['long_term_rent', 'short_term_rent', 'sale', 'exchange'],
  longTermRent: {
    monthlyAmount: 1450.5,
    currency: 'EUR',
    deposit: 2900,
    utilities: 'excluded',
    lateFee: 25,
  },
  shortTermRent: {
    nightlyRate: 96,
    currency: 'EUR',
    instantBook: true,
    cleaningFee: 35,
    taxesPercent: 10,
    minNights: 2,
  },
  sale: { price: 385000, currency: 'EUR', chainStatus: 'no_chain', isPriceReduced: false },
  exchange: {
    mode: 'swap',
    availabilityWindows: [
      { start: '2026-10-01T00:00:00.000Z', end: '2026-10-15T00:00:00.000Z', status: 'available' },
    ],
    mealsIncluded: false,
    requiresReciprocity: true,
    minStay: 3,
    welcomeNote: 'Plants need water.',
    languages: ['Catalan', 'English'],
  },
};

/** What goes over the wire: `undefined` keys are dropped by JSON. */
const wire = (value: unknown) => JSON.parse(JSON.stringify(value));

describe('buildPropertyPayload', () => {
  it('produces the request body main produced for the same form', () => {
    expect(wire(buildPropertyPayload(populatedForm()))).toEqual(EXPECTED_BODY);
  });

  it('publishes the same body from a draft that went through AsyncStorage JSON', () => {
    const resumed = JSON.parse(JSON.stringify(populatedForm())) as CreatePropertyFormData;
    expect(wire(buildPropertyPayload(resumed))).toEqual(EXPECTED_BODY);
  });

  it('publishes the floor and door only when the host made them public', () => {
    const form = populatedForm();
    form.location.showFloor = true;
    expect(wire(buildPropertyPayload(form))).toEqual({
      ...EXPECTED_BODY,
      addressPublishedPrecision: 'exact',
    });
  });

  it('keeps the default new-listing body (long-term rent only) unchanged', () => {
    expect(wire(buildPropertyPayload(createDefaultFormData()))).toEqual({
      address: {
        street: '',
        city: '',
        state: '',
        postal_code: '',
        country: 'US',
        countryCode: 'US',
        coordinates: { type: 'Point', coordinates: [2.16538, 41.38723] },
      },
      // An untouched toggle is private.
      addressPublishedPrecision: 'building',
      type: '',
      description: '',
      bedrooms: 1,
      bathrooms: 1,
      squareFootage: 0,
      amenities: [],
      images: [],
      status: 'published',
      offerings: ['long_term_rent'],
      longTermRent: { monthlyAmount: 0, currency: 'USD', deposit: 0, utilities: 'excluded' },
    });
  });
});

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
 * TWO deliberate changes since that capture, both of them corrections of what
 * the capture proved was being sent:
 *
 *  1. `addressPublishedPrecision`. The Location step's floor "Private" toggle
 *     was never sent, so every listing published its floor and unit whatever
 *     the host chose (found in #491). The body now carries the choice —
 *     `building` for private (and for an untouched toggle), `exact` for public.
 *     Both values are pinned below, because a body that always sent one of them
 *     would pass a test that only looked at the other.
 *
 *  2. `images[]`. The captured shape was `{ url, caption, isPrimary }`, and
 *     THAT SHAPE COULD NOT BE STORED: `property_images.image_id` is NOT NULL,
 *     so the insert raised `23502` and every publish carrying a photo answered
 *     500. The captured expectation was therefore pinning a body that never
 *     worked, and keeping it would mean keeping the defect. A photo now states
 *     its identity — the canonical `imageId` when the server already holds one,
 *     the upload's storage `keys` when it does not — and its `order`, which the
 *     backend has always honoured and the body never carried, so a reordered
 *     photo list published in upload order. See `utils/propertyPhotos`.
 */
import { ExchangeMode, OfferingType, AvailabilityWindowStatus } from '@homiio/shared-types';

import { buildPropertyPayload } from '@/hooks/useCreatePropertyWizard';
import type { UploadedImage } from '@/services/imageUploadService';
import { createDefaultFormData, type CreatePropertyFormData } from '@/store/createPropertyFormStore';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

/** A photo as the upload endpoint hands it back: no row yet, four keys. */
function uploadedPhoto(
  n: number,
  extra: { isPrimary?: boolean; caption?: string } = {},
): UploadedImage {
  return {
    imageId: `upload-${n}`,
    urls: {
      small: `https://cdn.example/${n}-s.webp`,
      medium: `https://cdn.example/${n}-m.webp`,
      large: `https://cdn.example/${n}-l.webp`,
      original: `https://cdn.example/${n}.jpg`,
    },
    keys: {
      original: `properties/${n}-original.jpeg`,
      variants: {
        small: `properties/${n}-small.webp`,
        medium: `properties/${n}-medium.webp`,
        large: `properties/${n}-large.webp`,
      },
    },
    metadata: {
      originalSize: 4096,
      originalFormat: 'jpeg',
      uploadedAt: new Date('2026-09-01T00:00:00Z'),
      width: 1600,
      height: 1200,
    },
    ...extra,
  };
}

/** The same photo once the server holds it — what the edit screen loads back. */
function storedPhoto(n: number, extra: { isPrimary?: boolean; caption?: string } = {}): UploadedImage {
  return { ...uploadedPhoto(n, extra), storedImageId: `image-row-${n}` };
}

/** The publish body's entry for {@link uploadedPhoto}. */
function uploadedPhotoBody(n: number, order: number, caption: string) {
  return {
    keys: {
      original: `properties/${n}-original.jpeg`,
      small: `properties/${n}-small.webp`,
      medium: `properties/${n}-medium.webp`,
      large: `properties/${n}-large.webp`,
    },
    caption,
    isPrimary: order === 0,
    order,
    bytes: 4096,
    width: 1600,
    height: 1200,
  };
}

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
  form.media = { images: [uploadedPhoto(1, { isPrimary: true, caption: 'Living room' })], videos: [] };
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
  images: [uploadedPhotoBody(1, 0, 'Living room')],
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

  it('publishes the photos in the order the host arranged them', () => {
    const form = populatedForm();
    // The grid's order after a reorder: the cover is photo 3.
    form.media.images = [
      uploadedPhoto(3, { isPrimary: true, caption: 'kitchen' }),
      uploadedPhoto(1, { caption: 'bedroom' }),
      uploadedPhoto(2, { caption: 'balcony' }),
    ];
    // Position IS the order, and the backend reads the list back by it. The old
    // body carried no `order` at all, so this arrangement was lost on publish.
    expect(wire(buildPropertyPayload(form)).images).toEqual([
      uploadedPhotoBody(3, 0, 'kitchen'),
      uploadedPhotoBody(1, 1, 'bedroom'),
      uploadedPhotoBody(2, 2, 'balcony'),
    ]);
  });

  it('leads with the cover even when it is not first in the stored list', () => {
    const form = populatedForm();
    form.media.images = [
      uploadedPhoto(1, { caption: 'bedroom' }),
      uploadedPhoto(2, { isPrimary: true, caption: 'kitchen' }),
    ];
    const images = wire(buildPropertyPayload(form)).images as {
      caption: string;
      isPrimary: boolean;
    }[];
    expect(images.map((image) => image.caption)).toEqual(['kitchen', 'bedroom']);
    // Exactly one primary reaches the server — the database permits one per
    // listing and would reject the whole publish over a second.
    expect(images.filter((image) => image.isPrimary)).toHaveLength(1);
  });

  it('sends a stored photo by its canonical id, not by its keys', () => {
    const form = populatedForm();
    form.media.images = [storedPhoto(7, { isPrimary: true, caption: 'hall' })];
    // An edit that only reorders must not re-upload or re-mint anything.
    expect(wire(buildPropertyPayload(form)).images).toEqual([
      { imageId: 'image-row-7', caption: 'hall', isPrimary: true, order: 0 },
    ]);
  });

  it('drops a photo that can identify itself neither way', () => {
    const form = populatedForm();
    const orphan = uploadedPhoto(9, { caption: 'orphan' });
    orphan.keys = { original: 'properties/9-original.jpeg', variants: {} };
    form.media.images = [uploadedPhoto(1, { isPrimary: true, caption: 'ok' }), orphan];
    // The server would refuse it; failing the publish over one unusable entry
    // would lose the photos that are fine too.
    expect(wire(buildPropertyPayload(form)).images).toEqual([uploadedPhotoBody(1, 0, 'ok')]);
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

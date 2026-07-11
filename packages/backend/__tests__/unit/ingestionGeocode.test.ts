/**
 * IngestionService address resolution — portal coordinates + geocode fallbacks.
 */

import { OfferingType, PropertyType, type NormalizedListing } from '@homiio/shared-types';
import {
  PisosProvider,
  parsePisosDetail,
  PISOS_FIXTURE_DETAIL_HTML,
  PISOS_FIXTURE_DETAIL_VALLADOLID_HTML,
} from '@homiio/listing-providers';

import { IngestionService } from '../../services/ingestion/IngestionService';
import { ExternalMediaIngest } from '../../services/ingestion/ExternalMediaIngest';
import type { ImageBufferInput } from '../../services/imageUploadService';
import { forwardGeocode, reverseGeocode } from '../../services/geocodingService';
import { clearResolutionCache } from '../../services/geoResolutionService';

jest.mock('../../services/geocodingService', () => ({
  forwardGeocode: jest.fn(),
  reverseGeocode: jest.fn(),
}));

const { Property, Address } = require('../../models');

const mockedForwardGeocode = forwardGeocode as jest.MockedFunction<typeof forwardGeocode>;
const mockedReverseGeocode = reverseGeocode as jest.MockedFunction<typeof reverseGeocode>;

const EXTERNAL_POSTAL_FALLBACK = '00000';

const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const baseListing: NormalizedListing = {
  source: 'fixture',
  sourceId: 'geocode-test-1',
  sourceUrl: 'https://fixtures.homiio.com/geocode-test-1',
  address: { street: '10 Downing Street', city: 'London', country: 'United Kingdom' },
  type: PropertyType.APARTMENT,
  offerings: [OfferingType.LONG_TERM_RENT],
  longTermRent: { monthlyAmount: 2500, currency: 'GBP' },
  remoteImages: [{ url: 'https://example.com/a.jpg', isPrimary: true }],
  status: 'published',
};

function buildIngestionService(): IngestionService {
  const fetchImage = jest.fn(
    async (_url: string): Promise<ImageBufferInput> => ({ buffer: ONE_BY_ONE_PNG, mimetype: 'image/png' }),
  );
  return new IngestionService({ mediaIngest: new ExternalMediaIngest({ fetchImage }) });
}

beforeEach(() => {
  mockedForwardGeocode.mockReset();
  mockedReverseGeocode.mockReset();
  // Collections are wiped after every test; drop the in-process geo resolution
  // cache too so a resolution never returns an id for a now-deleted geo doc.
  clearResolutionCache();
});

describe('IngestionService.resolveAddress geocode fallbacks', () => {
  it('uses portal coordinates when present without requiring Nominatim forward geocode', async () => {
    mockedReverseGeocode.mockResolvedValue({ success: false, error: 'rate limited' });

    const listing: NormalizedListing = {
      ...baseListing,
      sourceId: 'portal-coords',
      address: {
        ...baseListing.address,
        coordinates: { lat: 51.5034, lng: -0.1276 },
      },
    };

    const result = await buildIngestionService().ingest(listing);

    expect(result.status).toBe('created');
    expect(mockedForwardGeocode).not.toHaveBeenCalled();
    expect(mockedReverseGeocode).toHaveBeenCalledWith(-0.1276, 51.5034);

    const property = await Property.findById(result.propertyId);
    expect(property).not.toBeNull();
    expect(property.get('addressId')).toBeTruthy();
  });

  it('falls back to city-centroid coordinates when street geocode fails', async () => {
    mockedForwardGeocode
      .mockResolvedValueOnce({ success: false, error: 'No coordinates found' })
      .mockResolvedValueOnce({
        success: true,
        data: {
          coordinates: [-0.1276, 51.5074],
          postalCode: 'SW1A',
          city: 'London',
          country: 'United Kingdom',
        },
      });
    mockedReverseGeocode.mockResolvedValue({ success: false, error: 'No address found' });

    const listing: NormalizedListing = {
      ...baseListing,
      sourceId: 'city-centroid',
      address: { street: 'Unknown Street', city: 'London', country: 'United Kingdom' },
    };

    const result = await buildIngestionService().ingest(listing);

    expect(result.status).toBe('created');
    expect(mockedForwardGeocode).toHaveBeenCalledTimes(2);
    expect(mockedForwardGeocode.mock.calls[0]?.[0]).toContain('Unknown Street');
    expect(mockedForwardGeocode.mock.calls[1]?.[0]).toBe('London, United Kingdom');

    const property = await Property.findById(result.propertyId);
    expect(property).not.toBeNull();
    expect(property.get('addressId')).toBeTruthy();
  });

  it('reuses a stored City centroid for a placeholder-street listing without a second geocode', async () => {
    // A high-volume, real prod skip class: immobilienscout24 emits a placeholder
    // street ("Die vollständige Adresse …") with a REAL city — the street geocode
    // can never resolve, and under a Nominatim flood the city retry was rate-limited
    // too, so the listing was dropped. Once the city is known to us, ingest must
    // never hit Nominatim for it again.
    mockedReverseGeocode.mockResolvedValue({ success: false, error: 'no address' });

    const service = buildIngestionService();

    // Seed the city from a listing that carries portal coordinates (no geocode).
    await service.ingest({
      ...baseListing,
      sourceId: 'hh-seed',
      address: {
        street: 'Reeperbahn 1',
        city: 'Hamburg',
        state: 'Hamburg',
        country: 'Germany',
        countryCode: 'DE',
        coordinates: { lat: 53.5503, lng: 9.9937 },
      },
    });
    expect(mockedForwardGeocode).not.toHaveBeenCalled();

    // Now a placeholder-street listing in the SAME city with no coordinates.
    // The street geocode fails; the city centroid must come from the DB City doc.
    mockedForwardGeocode.mockResolvedValue({ success: false, error: 'No coordinates found' });
    const result = await service.ingest({
      ...baseListing,
      sourceId: 'hh-vague',
      address: {
        street: 'Die vollständige Adresse der Immobilie erhältst du vom Anbieter.',
        city: 'Hamburg',
        state: 'Hamburg',
        country: 'Germany',
        countryCode: 'DE',
      },
    });

    expect(result.status).toBe('created');
    // Only the (failing) street query hit the geocoder — the city centroid was
    // read from the DB, so NO city-level forward geocode was issued.
    expect(mockedForwardGeocode).toHaveBeenCalledTimes(1);
    const cityGeocodes = mockedForwardGeocode.mock.calls.filter((call) =>
      /^Hamburg,/.test(String(call[0])),
    );
    expect(cityGeocodes).toHaveLength(0);

    const property = await Property.findById(result.propertyId);
    const address = await Address.findById(property.get('addressId'));
    expect(address?.coordinates?.coordinates).toEqual([9.9937, 53.5503]);
  });

  it('skips a listing only when the city cannot be resolved by any means', async () => {
    // Street AND city geocode both fail, and the country name is unrecognised so
    // no DB city can be found — the one remaining case where we still skip.
    mockedForwardGeocode.mockResolvedValue({ success: false, error: 'No coordinates found' });
    mockedReverseGeocode.mockResolvedValue({ success: false, error: 'No address found' });

    const listing: NormalizedListing = {
      ...baseListing,
      sourceId: 'unresolvable-city',
      address: { street: 'Some Street', city: 'Zzqxville', country: 'Nowherestan' },
    };

    await expect(buildIngestionService().ingest(listing)).rejects.toThrow(
      /Could not resolve coordinates/,
    );
  });

  it('persists with postal fallback when geocoders return none', async () => {
    mockedForwardGeocode.mockResolvedValue({
      success: true,
      data: {
        coordinates: [-0.1276, 51.5074],
        city: 'London',
        country: 'United Kingdom',
      },
    });
    mockedReverseGeocode.mockResolvedValue({ success: false, error: 'No address found' });

    const listing: NormalizedListing = {
      ...baseListing,
      sourceId: 'no-postal',
      address: { street: '221B Baker Street', city: 'London', country: 'United Kingdom' },
    };

    const result = await buildIngestionService().ingest(listing);

    expect(result.status).toBe('created');
    const property = await Property.findById(result.propertyId);
    expect(property).not.toBeNull();

    const address = await Address.findById(property.get('addressId'));
    expect(address?.postal_code).toBe(EXTERNAL_POSTAL_FALLBACK);
  });

  it('ingests two pisos listings with distinct portal coordinates into different geo points', async () => {
    mockedReverseGeocode.mockResolvedValue({ success: false, error: 'No address found' });

    const pisos = new PisosProvider();
    const madridRaw = parsePisosDetail(
      PISOS_FIXTURE_DETAIL_HTML,
      'https://www.pisos.com/alquilar/piso-sol_barrio28012-20026385030_992099/',
    );
    const valladolidRaw = parsePisosDetail(
      PISOS_FIXTURE_DETAIL_VALLADOLID_HTML,
      'https://www.pisos.com/alquilar/piso-valladolid_capital_universidad-65009504308_106400/',
    );
    const madridListing = pisos.normalize({
      ref: { provider: 'pisos', sourceId: madridRaw.sourceId, url: madridRaw.url },
      payload: madridRaw,
    });
    const valladolidListing = pisos.normalize({
      ref: { provider: 'pisos', sourceId: valladolidRaw.sourceId, url: valladolidRaw.url },
      payload: valladolidRaw,
    });

    const service = buildIngestionService();
    const madridResult = await service.ingest(madridListing);
    const valladolidResult = await service.ingest(valladolidListing);

    expect(mockedForwardGeocode).not.toHaveBeenCalled();

    const madridProperty = await Property.findById(madridResult.propertyId);
    const valladolidProperty = await Property.findById(valladolidResult.propertyId);
    expect(madridProperty?.addressId).toBeTruthy();
    expect(valladolidProperty?.addressId).toBeTruthy();
    expect(String(madridProperty?.addressId)).not.toBe(String(valladolidProperty?.addressId));

    const madridAddress = await Address.findById(madridProperty?.addressId);
    const valladolidAddress = await Address.findById(valladolidProperty?.addressId);
    expect(madridAddress?.coordinates?.coordinates).toEqual([-3.7083892232908435, 40.41593545782718]);
    expect(valladolidAddress?.coordinates?.coordinates).toEqual([-4.7216201, 41.6531628]);
  });
});

describe('IngestionService external description truncation', () => {
  it('truncates portal descriptions to the Property schema maxlength', async () => {
    mockedForwardGeocode.mockResolvedValue({
      success: true,
      data: {
        coordinates: [-0.1276, 51.5074],
        city: 'London',
        country: 'United Kingdom',
        postalCode: 'SW1A 1AA',
      },
    });
    mockedReverseGeocode.mockResolvedValue({ success: false, error: 'No address found' });

    const longDescription = 'x'.repeat(2500);
    const listing: NormalizedListing = {
      ...baseListing,
      sourceId: 'long-description',
      description: longDescription,
    };

    const result = await buildIngestionService().ingest(listing);
    const property = await Property.findById(result.propertyId);
    expect(property?.description).toHaveLength(2000);
    expect(property?.description).toBe('x'.repeat(2000));
  });
});

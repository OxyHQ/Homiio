/**
 * IngestionService address resolution — portal coordinates + geocode fallbacks.
 */

import { OfferingType, PropertyType, type NormalizedListing } from '@homiio/shared-types';

import { IngestionService } from '../../services/ingestion/IngestionService';
import { ExternalMediaIngest } from '../../services/ingestion/ExternalMediaIngest';
import type { ImageBufferInput } from '../../services/imageUploadService';
import { forwardGeocode, reverseGeocode } from '../../services/geocodingService';

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

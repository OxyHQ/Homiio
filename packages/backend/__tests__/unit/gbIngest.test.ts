/**
 * GB provider normalize → IngestionService mapping (fixtures + in-memory Mongo).
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  OpenRentProvider,
  RightmoveProvider,
  parseOpenRentDetail,
  parseRightmoveDetail,
  OPENRENT_FIXTURE_DETAIL_HTML,
  RIGHTMOVE_FIXTURE_DETAIL_HTML,
} from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

import { IngestionService } from '../../services/ingestion/IngestionService';
import { ExternalMediaIngest } from '../../services/ingestion/ExternalMediaIngest';
import type { ImageBufferInput } from '../../services/imageUploadService';

const { Property, Image } = require('../../models');

const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const LOCAL_IMAGE_STORE_DIR = path.join(__dirname, '..', '..', '.local-image-store-gb');

const fetchImage = jest.fn(
  async (_url: string): Promise<ImageBufferInput> => ({ buffer: ONE_BY_ONE_PNG, mimetype: 'image/png' }),
);

function buildIngestionService(): IngestionService {
  return new IngestionService({ mediaIngest: new ExternalMediaIngest({ fetchImage }) });
}

afterAll(async () => {
  await fs.rm(LOCAL_IMAGE_STORE_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  fetchImage.mockClear();
});

describe('GB listing ingest mapping', () => {
  it('ingests Rightmove fixture as published external property', async () => {
    const provider = new RightmoveProvider();
    const payload = parseRightmoveDetail(
      RIGHTMOVE_FIXTURE_DETAIL_HTML,
      'https://www.rightmove.co.uk/properties/90551949',
    );
    const normalized = provider.normalize({
      ref: { provider: 'rightmove', sourceId: payload.sourceId, url: payload.url },
      payload,
    });

    const ingestion = buildIngestionService();
    const result = await ingestion.ingest(normalized);

    expect(result.status).toBe('created');
    expect(result.source).toBe('rightmove');
    expect(result.sourceId).toBe('90551949');

    const property = await Property.findOne({ source: 'rightmove', sourceId: '90551949' }).lean();
    expect(property?.isExternal).toBe(true);
    expect(property?.status).toBe('published');
    expect(property?.profileId).toBeFalsy();
    expect(property?.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(property?.longTermRent.monthlyAmount).toBe(3400);
    expect(property?.type).toBe(PropertyType.APARTMENT);
    expect(property?.externalContact?.phone).toContain('020');
    expect(property?.images?.length).toBeGreaterThan(0);

    const imageDocs = await Image.find({ entityType: 'property', entityId: property._id });
    expect(imageDocs.length).toBe(property.images.length);
  });

  it('strips HTML from description before persisting', async () => {
    const provider = new RightmoveProvider();
    const payload = parseRightmoveDetail(
      RIGHTMOVE_FIXTURE_DETAIL_HTML,
      'https://www.rightmove.co.uk/properties/90551949',
    );
    payload.description =
      '<b>Council Tax Band:</b> E<br /><br /><i>Information contained within this listing is for guidance only...</i>';
    const normalized = provider.normalize({
      ref: { provider: 'rightmove', sourceId: payload.sourceId, url: payload.url },
      payload,
    });

    const ingestion = buildIngestionService();
    await ingestion.ingest(normalized);

    const property = await Property.findOne({ source: 'rightmove', sourceId: '90551949' }).lean();
    expect(property?.description).toBe(
      'Council Tax Band: E\n\nInformation contained within this listing is for guidance only...',
    );
    expect(property?.description).not.toMatch(/<[^>]+>/);
  });

  it('ingests OpenRent outcode-only address when coordinates are present', async () => {
    const provider = new OpenRentProvider();
    const payload = parseOpenRentDetail(
      OPENRENT_FIXTURE_DETAIL_HTML,
      'https://www.openrent.co.uk/property-to-rent/london/1-bed-flat-london-wc2n/2865841',
    );
    const normalized = provider.normalize({
      ref: { provider: 'openrent', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(normalized.address.postalCode).toBe('WC2N');
    normalized.address.coordinates = { lat: 51.5074, lng: -0.1278 };

    const ingestion = buildIngestionService();
    const result = await ingestion.ingest(normalized);

    expect(result.status).toBe('created');
    expect(result.source).toBe('openrent');

    const property = await Property.findOne({ source: 'openrent', sourceId: payload.sourceId }).lean();
    expect(property?.isExternal).toBe(true);
    expect(property?.longTermRent.monthlyAmount).toBe(2750);
    expect(property?.externalContact?.email).toBe('landlord@example.com');
  });
});

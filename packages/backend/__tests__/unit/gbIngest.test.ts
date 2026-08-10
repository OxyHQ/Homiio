/**
 * GB provider normalize → IngestionService mapping, against a REAL Postgres.
 *
 * The assertions read the listing back through `findPropertyById` +
 * `serializeProperty` — the same repository and serializer the catalogue
 * endpoints use — so what they check is the shape the API actually serves, not
 * a row projection only this file knows how to read.
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

import { and, eq } from 'drizzle-orm';

import { getDb } from '../../db/postgres';
import { images, properties } from '../../db/schema';
import { findPropertyById } from '../../db/properties/propertyReads';
import { serializeProperty } from '../../db/properties/propertySerializer';
import { resetGeoTables } from '../helpers/postgresGeoFixtures';
import { assertFound } from '../helpers/assertFound';

import { installNoNetworkGuard } from '../helpers/noNetwork';

/**
 * Wikimedia Commons, reached per-listing by ingest's fire-and-forget city-cover
 * call. Nothing here asserts on a cover, so a live third-party round trip was
 * pure flakiness — see `__tests__/helpers/noNetwork.ts`.
 */
jest.mock('../../services/cityCoverSyncService', () => ({
  ensureCover: jest.fn(async () => undefined),
  syncCovers: jest.fn(async () => 0),
  syncMissingCovers: jest.fn(async () => 0),
}));

/** Nominatim. A FALLBACK for listings without coordinates; asserted on nowhere here. */
jest.mock('../../services/geocodingService', () => {
  const unavailable = async () => ({ success: false, error: 'geocoder stubbed in tests' });
  return {
    reverseGeocode: jest.fn(unavailable),
    forwardGeocode: jest.fn(unavailable),
    default: { reverseGeocode: jest.fn(unavailable), forwardGeocode: jest.fn(unavailable) },
  };
});

installNoNetworkGuard('gbIngest');

const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const LOCAL_IMAGE_STORE_DIR = path.join(__dirname, '..', '..', '.local-image-store-gb');

const fetchImage = jest.fn(
  async (): Promise<ImageBufferInput> => ({ buffer: ONE_BY_ONE_PNG, mimetype: 'image/png' }),
);

function buildIngestionService(): IngestionService {
  return new IngestionService({ mediaIngest: new ExternalMediaIngest({ fetchImage }) });
}

afterAll(async () => {
  await fs.rm(LOCAL_IMAGE_STORE_DIR, { recursive: true, force: true });
});

/** The ingested listing in its wire shape, by portal identity. */
async function readIngested(
  source: string,
  sourceId: string,
): Promise<Record<string, unknown> | null> {
  const [row] = await getDb()
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.source, source as 'rightmove'), eq(properties.sourceId, sourceId)))
    .limit(1);
  if (!row) return null;
  const hydrated = await findPropertyById(row.id);
  return hydrated ? serializeProperty(hydrated) : null;
}

/** The canonical `images` rows the pipeline persisted for a listing. */
async function countImageRows(propertyId: string): Promise<number> {
  const rows = await getDb()
    .select({ id: images.id })
    .from(images)
    .where(and(eq(images.entityType, 'property'), eq(images.entityId, propertyId)));
  return rows.length;
}

beforeEach(async () => {
  // Two of these tests ingest the SAME `(rightmove, 90551949)` identity, and
  // Postgres persists for the whole worker where the per-test in-memory Mongo
  // did not. Without the reset the second would meet
  // `properties_source_source_id_key` instead of a clean table.
  await resetGeoTables();
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

    const property = await readIngested('rightmove', '90551949');
    assertFound(property, 'property');
    expect(property.isExternal).toBe(true);
    expect(property.status).toBe('published');
    expect(property.oxyUserId).toBeFalsy();
    expect(property.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect((property.longTermRent as { monthlyAmount?: number }).monthlyAmount).toBe(3400);
    expect(property.type).toBe(PropertyType.APARTMENT);
    expect((property.externalContact as { phone?: string }).phone).toContain('020');

    const servedImages = property.images as unknown[];
    expect(servedImages.length).toBeGreaterThan(0);
    expect(await countImageRows(String(property.id))).toBe(servedImages.length);
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

    const property = await readIngested('rightmove', '90551949');
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

    const property = await readIngested('openrent', payload.sourceId);
    assertFound(property, 'property');
    expect(property.isExternal).toBe(true);
    expect((property.longTermRent as { monthlyAmount?: number }).monthlyAmount).toBe(2750);
    expect((property.externalContact as { email?: string }).email).toBe('landlord@example.com');
  });
});

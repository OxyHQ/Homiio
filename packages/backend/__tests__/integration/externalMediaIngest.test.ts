/**
 * A scraped listing's photos go to Oxy Files in ONE batch import per listing,
 * in order, with one primary, and one broken photo never costs the listing
 * (`services/ingestion/ExternalMediaIngest.ts`). Against Postgres — each photo
 * becomes an `images` row — and the suite's in-memory Oxy Files.
 */

import { like } from 'drizzle-orm';

import { getDb } from '../../db/postgres';
import { images } from '../../db/schema';
import { ExternalMediaIngest } from '../../services/ingestion/ExternalMediaIngest';
import { fakeOxyFiles } from '../helpers/fakeOxyFiles';

function remoteImages(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    url: `https://portal.test/photo-${index}.jpg`,
    isPrimary: index === 0,
  }));
}

describe('ExternalMediaIngest.ingestForProperty', () => {
  // The photos are imported by Oxy itself (ADR 0043 D7): the throughput question
  // is now "one request per listing, not one per photo", and the download
  // concurrency is Oxy's (four at a time per batch).
  const silent = { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as never;

  beforeEach(() => {
    fakeOxyFiles.reset();
  });

  afterAll(async () => {
    await getDb().delete(images).where(like(images.entityId, 'ingest-test-%'));
  });

  it('imports a listing’s photos in ONE batch request, not one call per photo', async () => {
    const ingest = new ExternalMediaIngest({ proxyFallback: null, maxImages: 30 });

    const refs = await ingest.ingestForProperty('ingest-test-1', remoteImages(24));

    expect(refs).toHaveLength(24);
    expect(fakeOxyFiles.callsOf('importAppFiles')).toHaveLength(1);
    expect(fakeOxyFiles.callsOf('importAppFile')).toHaveLength(0);
  });

  it('keeps gallery order and exactly one primary', async () => {
    const ingest = new ExternalMediaIngest({ proxyFallback: null });

    const refs = await ingest.ingestForProperty('ingest-test-2', remoteImages(8));

    expect(refs.map((ref) => ref.order ?? -1)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(refs.filter((ref) => ref.isPrimary)).toHaveLength(1);
    expect(refs[0].isPrimary).toBe(true);
  });

  it('still loses only the broken photo, never the listing', async () => {
    fakeOxyFiles.failingSources.set('https://portal.test/photo-3.jpg', 502);
    const ingest = new ExternalMediaIngest({ proxyFallback: null, logger: silent });

    const refs = await ingest.ingestForProperty('ingest-test-3', remoteImages(6));

    expect(refs).toHaveLength(5);
    expect(refs.filter((ref) => ref.isPrimary)).toHaveLength(1);
  });

  it('fetches through the proxy only what Oxy could not, and registers its use', async () => {
    fakeOxyFiles.failingSources.set('https://portal.test/photo-1.jpg', 502);
    const proxyFallback = jest.fn(async () => ({
      buffer: Buffer.from('proxied-bytes'),
      mimetype: 'image/jpeg',
    }));
    const ingest = new ExternalMediaIngest({ proxyFallback, logger: silent });

    const refs = await ingest.ingestForProperty('ingest-test-4', remoteImages(3));

    expect(refs).toHaveLength(3);
    expect(proxyFallback).toHaveBeenCalledTimes(1);
    expect(proxyFallback).toHaveBeenCalledWith('https://portal.test/photo-1.jpg');
    const [[added]] = fakeOxyFiles.callsOf('references.add') as [[Array<{ entityId: string }>]];
    expect(added[0].entityId).toBe('ingest-test-4');
  });

  it('does not use the proxy for a source Oxy refused (it is not a fetch failure)', async () => {
    fakeOxyFiles.failingSources.set('https://portal.test/photo-0.jpg', 415);
    const proxyFallback = jest.fn();
    const ingest = new ExternalMediaIngest({ proxyFallback, logger: silent });

    const refs = await ingest.ingestForProperty('ingest-test-5', remoteImages(2));

    expect(refs).toHaveLength(1);
    expect(proxyFallback).not.toHaveBeenCalled();
  });

  it('honours the image cap before doing any work', async () => {
    const ingest = new ExternalMediaIngest({ proxyFallback: null, maxImages: 3 });

    const refs = await ingest.ingestForProperty('ingest-test-6', remoteImages(30));

    expect(refs).toHaveLength(3);
    const [[items]] = fakeOxyFiles.callsOf('importAppFiles') as [[unknown[]]];
    expect(items).toHaveLength(3);
  });
});

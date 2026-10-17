/**
 * The reference drain and the nightly reconciliation against the suite's
 * in-memory Oxy Files: Oxy's record of which Homiio entities use which file
 * ends up equal to Homiio's tables, whatever order the changes came in.
 */

import { eq } from 'drizzle-orm';
import { uuidv7 } from '@oxy.so/db';

import { getDb } from '../../db/postgres';
import { cities, fileReferenceChanges, properties } from '../../db/schema';
import { replacePropertyImages } from '../../db/properties/propertyWrites';
import { insertOxyImage } from '../../services/files/publicImages';
import { syncFileReferences } from '../../services/files/referenceSync';
import { reconcileFileReferenceType } from '../../services/files/referenceReconcile';
import { setOxyFilesForTests } from '../../services/files/oxyFilesClient';
import { fakeOxyFiles, oxyError } from '../helpers/fakeOxyFiles';
import {
  resetGeoTables,
  seedAddress,
  seedGeoChain,
  seedProperty,
  type GeoChain,
} from '../helpers/postgresGeoFixtures';

let chain: GeoChain;

async function listing(): Promise<string> {
  const addressId = await seedAddress({ chain, street: `Carrer ${uuidv7()}` });
  return seedProperty({ addressId });
}

/** A Homiio-owned file in the fake Oxy, and its `images` row. */
async function photo(entityType: 'property' | 'city', entityId: string) {
  const { file } = await fakeOxyFiles
    .api()
    .uploadAppFile(Buffer.from(`bytes-${uuidv7()}`), 'image/jpeg', { visibility: 'public' });
  const row = await insertOxyImage(entityType, entityId, {
    fileId: file.id,
    owner: 'application',
    format: 'jpeg',
    bytes: file.size,
    sha256: file.sha256,
  });
  return { fileId: file.id, imageId: row.id };
}

async function pending(): Promise<number> {
  const rows = await getDb()
    .select({ id: fileReferenceChanges.id, settledAt: fileReferenceChanges.settledAt })
    .from(fileReferenceChanges);
  return rows.filter((row) => row.settledAt === null).length;
}

beforeEach(async () => {
  await resetGeoTables();
  fakeOxyFiles.reset();
  chain = await seedGeoChain({ cityName: `Syncville ${uuidv7().slice(-6)}` });
});

afterAll(async () => {
  await resetGeoTables();
});

describe('syncFileReferences', () => {
  it("registers a listing's photo, and withdraws it when the listing expires", async () => {
    const propertyId = await listing();
    const { fileId, imageId } = await photo('property', propertyId);
    await replacePropertyImages(propertyId, [{ imageId }]);

    const first = await syncFileReferences({ limit: 50 });
    expect(first.added).toBe(1);
    expect(fakeOxyFiles.hasReference(fileId, 'property', propertyId)).toBe(true);
    expect(await pending()).toBe(0);

    // The expiry sweep's delete: photo rows CASCADE, the trigger marks the pair.
    await getDb().delete(properties).where(eq(properties.id, propertyId));
    const second = await syncFileReferences({ limit: 50 });
    expect(second.removed).toBe(1);
    expect(fakeOxyFiles.hasReference(fileId, 'property', propertyId)).toBe(false);
  });

  it('decides from the PRESENT: a photo replaced and re-added is one add', async () => {
    const propertyId = await listing();
    const { fileId, imageId } = await photo('property', propertyId);
    await replacePropertyImages(propertyId, [{ imageId }]);
    await replacePropertyImages(propertyId, []);
    await replacePropertyImages(propertyId, [{ imageId }]);

    const summary = await syncFileReferences({ limit: 50 });
    expect(summary).toMatchObject({ claimed: 1, added: 1, removed: 0 });
    expect(fakeOxyFiles.hasReference(fileId, 'property', propertyId)).toBe(true);
  });

  it('settles only the generation it read: a change during the call stays pending', async () => {
    const propertyId = await listing();
    const { imageId } = await photo('property', propertyId);
    await replacePropertyImages(propertyId, [{ imageId }]);

    // Oxy answers slowly; while it does, the host removes the photo.
    const api = fakeOxyFiles.api();
    const realAdd = api.references.add;
    let removedDuringCall = false;
    api.references.add = async (refs) => {
      if (!removedDuringCall) {
        removedDuringCall = true;
        await replacePropertyImages(propertyId, []);
      }
      return realAdd(refs);
    };
    setOxyFilesForTests(api);
    try {
      await syncFileReferences({ limit: 50 });
    } finally {
      setOxyFilesForTests(fakeOxyFiles.api());
    }

    expect(await pending()).toBe(1);
    const next = await syncFileReferences({ limit: 50 });
    expect(next.removed).toBe(1);
  });

  it('backs off on failure and keeps the pair, with the error recorded', async () => {
    const propertyId = await listing();
    const { imageId } = await photo('property', propertyId);
    await replacePropertyImages(propertyId, [{ imageId }]);
    fakeOxyFiles.referencesError = oxyError(503, 'UNAVAILABLE');

    const summary = await syncFileReferences({ limit: 50 });
    expect(summary.failed).toBe(1);

    const [row] = await getDb().select().from(fileReferenceChanges);
    expect(row.settledAt).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.lastError).toMatch(/^503:/);
    expect(row.availableAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
    // Not due again yet: the next pass claims nothing.
    fakeOxyFiles.referencesError = null;
    expect((await syncFileReferences({ limit: 50 })).claimed).toBe(0);
  });

  it('treats Oxy refusing an add (file gone) as final, not as a retry', async () => {
    const propertyId = await listing();
    const { fileId, imageId } = await photo('property', propertyId);
    await replacePropertyImages(propertyId, [{ imageId }]);
    const file = fakeOxyFiles.files.get(fileId);
    if (file) file.status = 'deleted';

    const summary = await syncFileReferences({ limit: 50 });
    expect(summary.refused).toBe(1);
    expect(await pending()).toBe(0);
  });
});

describe('reconcileFileReferenceType', () => {
  it('adds what Homiio uses and Oxy lacks, and removes what Homiio no longer uses', async () => {
    const used = await listing();
    const { fileId: usedFile, imageId } = await photo('property', used);
    await replacePropertyImages(used, [{ imageId }]);
    // Oxy holds a stale reference to a listing that no longer shows anything.
    const { fileId: staleFile } = await photo('property', 'gone-listing');
    fakeOxyFiles.referenceSet.add(`${staleFile}|property|gone-listing`);

    const dry = await reconcileFileReferenceType('property', { dryRun: true });
    expect(dry.result).toMatchObject({ added: 1, removed: 1, dryRun: true });
    expect(fakeOxyFiles.hasReference(usedFile, 'property', used)).toBe(false);

    const real = await reconcileFileReferenceType('property');
    expect(real.result).toMatchObject({ added: 1, removed: 1, dryRun: false });
    expect(fakeOxyFiles.hasReference(usedFile, 'property', used)).toBe(true);
    expect(fakeOxyFiles.hasReference(staleFile, 'property', 'gone-listing')).toBe(false);
  });

  it('re-marks the pairs the drain settled after its snapshot', async () => {
    const cover = await photo('city', chain.cityId);
    await getDb()
      .update(cities)
      .set({ coverImageId: cover.imageId })
      .where(eq(cities.id, chain.cityId));
    await syncFileReferences({ limit: 50 });
    expect(await pending()).toBe(0);

    // A pair settled DURING the reconciliation: stamped after the snapshot.
    const api = fakeOxyFiles.api();
    const realReconcile = api.references.reconcile;
    api.references.reconcile = async (type, items, options) => {
      await getDb()
        .update(fileReferenceChanges)
        .set({ settledAt: new Date(Date.now() + 1000) });
      return realReconcile(type, items, options);
    };
    setOxyFilesForTests(api);
    try {
      const report = await reconcileFileReferenceType('city');
      expect(report.remarked).toBe(1);
    } finally {
      setOxyFilesForTests(fakeOxyFiles.api());
    }
    expect(await pending()).toBe(1);
  });
});

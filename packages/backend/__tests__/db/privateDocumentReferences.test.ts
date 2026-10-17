/**
 * The references of a person's private documents (ADR 0043 stage 4c): the
 * triggers of migration `0038_oxy_private_documents`, the "in use" queries in
 * `services/files/referenceUsage.ts`, and the drain and reconciliation that
 * tell Oxy — for the three document tables.
 *
 * A row naming `oxy:<fileId>` is a use of that file by its lease, application
 * or maintenance request; a bucket key is not, and marks nothing. The case that
 * matters most is the cascade: a lease deleted takes its documents with it, no
 * application code running, and Oxy must still hear the use ended.
 */

import { eq, inArray } from 'drizzle-orm';

import { getDb } from '../../db/postgres';
import {
  fileReferenceChanges,
  leaseDocuments,
  leases,
  maintenanceRequestAttachments,
  maintenanceRequests,
} from '../../db/schema';
import { reconcileFileReferenceType } from '../../services/files/referenceReconcile';
import { syncFileReferences } from '../../services/files/referenceSync';
import { isReferenceInUse, referenceInventory } from '../../services/files/referenceUsage';
import { fakeOxyFiles } from '../helpers/fakeOxyFiles';
import { objectIdHex, resetGeoTables, seedListingWithGeo } from '../helpers/postgresGeoFixtures';

let counter = 0;

let lastPropertyId = '';

async function lease(): Promise<string> {
  counter += 1;
  const { propertyId } = await seedListingWithGeo({
    countryCode: `R${counter}`,
    cityName: `Refville ${counter}`,
    overrides: { oxyUserId: 'oxy-landlord' },
  });
  lastPropertyId = propertyId;
  const [row] = await getDb()
    .insert(leases)
    .values({
      id: objectIdHex(),
      propertyId,
      landlordOxyUserId: 'oxy-landlord',
      tenantOxyUserId: 'oxy-tenant',
      status: 'active',
      leaseTermsStartDate: new Date('2026-01-01T00:00:00.000Z'),
      leaseTermsEndDate: new Date('2027-01-01T00:00:00.000Z'),
      rentDetailsMonthlyRent: 900,
    })
    .returning({ id: leases.id });
  return row.id;
}

async function document(leaseId: string, url: string): Promise<string> {
  const [row] = await getDb()
    .insert(leaseDocuments)
    .values({
      leaseId,
      name: 'Agreement',
      url,
      type: 'lease_agreement',
      uploadedByOxyUserId: 'oxy-landlord',
      uploadedDate: new Date('2026-01-02T00:00:00.000Z'),
    })
    .returning({ id: leaseDocuments.id });
  return row.id;
}

/** The marks for some file ids, as `type:entity:file` → generation. */
async function marks(fileIds: string[]): Promise<Map<string, number>> {
  const rows = await getDb()
    .select({ id: fileReferenceChanges.id, generation: fileReferenceChanges.generation })
    .from(fileReferenceChanges)
    .where(inArray(fileReferenceChanges.oxyFileId, fileIds));
  return new Map(rows.map((row) => [row.id, row.generation]));
}

/** A private file in a person's account, as Homiio stores it. */
async function personFile(owner: string): Promise<string> {
  const api = fakeOxyFiles.api();
  const { file } = await api.uploadUserMediaLarge(
    owner,
    new Uint8Array(Buffer.from(objectIdHex())),
    {
      mime: 'application/pdf',
      visibility: 'private',
    },
  );
  return file.id;
}

beforeEach(async () => {
  fakeOxyFiles.reset();
  await getDb().delete(maintenanceRequests);
  await getDb().delete(leases);
  await getDb().delete(fileReferenceChanges);
  await resetGeoTables();
});

// Leave the shared per-worker tables as this file found them.
afterAll(async () => {
  await getDb().delete(maintenanceRequests);
  await getDb().delete(leases);
  await getDb().delete(fileReferenceChanges);
  await resetGeoTables();
});

describe('the triggers', () => {
  it('mark a lease document naming an Oxy file, and nothing for a bucket one', async () => {
    const leaseId = await lease();
    await document(leaseId, 'oxy:fileA');
    await document(leaseId, 'https://api.homiio.com/api/images/file/private/leases/x/y.pdf');

    const all = await getDb().select().from(fileReferenceChanges);
    expect(all.map((row) => row.id)).toEqual([`lease:${leaseId}:fileA`]);
  });

  it('mark both files when a row moves from one to another, and the old one when it goes', async () => {
    const leaseId = await lease();
    const id = await document(leaseId, 'oxy:fileB');
    await getDb().delete(fileReferenceChanges);

    await getDb().update(leaseDocuments).set({ url: 'oxy:fileC' }).where(eq(leaseDocuments.id, id));
    expect([...(await marks(['fileB', 'fileC'])).keys()].sort()).toEqual([
      `lease:${leaseId}:fileB`,
      `lease:${leaseId}:fileC`,
    ]);

    await getDb().delete(leaseDocuments).where(eq(leaseDocuments.id, id));
    expect((await marks(['fileC'])).get(`lease:${leaseId}:fileC`)).toBe(2);
  });

  it('mark through the cascade when the lease itself is deleted', async () => {
    const leaseId = await lease();
    await document(leaseId, 'oxy:fileD');
    await getDb().delete(fileReferenceChanges);

    await getDb().delete(leases).where(eq(leases.id, leaseId));

    expect([...(await marks(['fileD'])).keys()]).toEqual([`lease:${leaseId}:fileD`]);
  });

  it('mark a maintenance photo naming an Oxy file', async () => {
    const leaseId = await lease();
    const [request] = await getDb()
      .insert(maintenanceRequests)
      .values({
        leaseId,
        propertyId: lastPropertyId,
        reportedByOxyUserId: 'oxy-tenant',
        category: 'plumbing',
        urgency: 'high',
        title: 'Leak',
        description: 'Under the sink.',
      })
      .returning({ id: maintenanceRequests.id });
    await getDb().insert(maintenanceRequestAttachments).values({
      requestId: request.id,
      uploadedByOxyUserId: 'oxy-tenant',
      role: 'tenant',
      storageKey: 'oxy:fileE',
      contentType: 'image/webp',
      bytes: 10,
    });

    expect([...(await marks(['fileE'])).keys()]).toEqual([
      `maintenance_request:${request.id}:fileE`,
    ]);
  });
});

describe('"in use", and telling Oxy', () => {
  it('registers the use, removes it when the document goes, and reconciles the type', async () => {
    const leaseId = await lease();
    const fileId = await personFile('oxy-landlord');
    const id = await document(leaseId, `oxy:${fileId}`);

    expect(
      await isReferenceInUse(getDb(), {
        oxyFileId: fileId,
        entityType: 'lease',
        entityId: leaseId,
      }),
    ).toBe(true);
    const inventory = [];
    for await (const item of referenceInventory(getDb(), 'lease')) inventory.push(item);
    expect(inventory).toEqual([{ fileId, entityId: leaseId }]);

    await syncFileReferences({ limit: 50 });
    expect(fakeOxyFiles.hasReference(fileId, 'lease', leaseId)).toBe(true);

    await getDb().delete(leaseDocuments).where(eq(leaseDocuments.id, id));
    await syncFileReferences({ limit: 50 });
    expect(fakeOxyFiles.hasReference(fileId, 'lease', leaseId)).toBe(false);

    // A use Oxy lost is restored by the nightly reconciliation of the type.
    const other = await document(leaseId, `oxy:${fileId}`);
    fakeOxyFiles.referenceSet.clear();
    await reconcileFileReferenceType('lease');
    expect(fakeOxyFiles.hasReference(fileId, 'lease', leaseId)).toBe(true);
    expect(other).toBeTruthy();
  });
});

/**
 * Saved properties and their folders — ownership, the composite uniques, and the
 * two referential rules that replaced application code.
 *
 * The real handlers against the REAL Postgres this worker owns, mounted behind a
 * fake-auth middleware. Both Mongo collections were empty in production, so
 * nothing here asserts a preserved row; what it asserts is that the rules the
 * schema now carries actually hold, in BOTH directions.
 *
 * ## Why a mocked drizzle could not have caught any of this
 *
 * Every load-bearing case below is a statement a mock accepts and a server
 * refuses, or a behaviour the SERVER performs and no application code does:
 *
 *  - `saved_items_owner_target_key` and `saved_property_folders_owner_name_key`
 *    are composite uniques. A mocked `insert` returns whatever it was told to,
 *    so the "two people may both save this" half — the half a plain
 *    `UNIQUE(target_id)` would break while still passing every "rejects a
 *    duplicate" assertion — is invisible without a real index.
 *  - `saved_items.folder_id` is `ON DELETE SET NULL`, which is what now re-files
 *    a deleted folder's saves. The Mongo handler did that with an explicit
 *    `updateMany`; the port deleted that statement, so if the constraint were
 *    wrong the saves would vanish with the folder and no unit test would know.
 *  - `saved_items.target_id` is `ON DELETE CASCADE` against a real foreign key.
 *    Both the 404 on saving a listing that does not exist and the disappearance
 *    of a save when its listing is reaped are the server's behaviour, not the
 *    controller's.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';

import * as savedFolders from '../../controllers/profile/savedFolders';
import * as savedProperties from '../../controllers/profile/savedProperties';
import { getDb } from '../../db/postgres';
import {
  properties as propertiesTable,
  savedItems,
  savedPropertyFolders,
} from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import { resetGeoTables, seedListingWithGeo, seedProperty } from '../helpers/postgresGeoFixtures';

function buildApp(oxyUserId?: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (oxyUserId) {
      (req as unknown as { user: { id: string } }).user = { id: oxyUserId };
    }
    next();
  });
  app.get('/saved-properties', (req, res, next) => savedProperties.getSavedProperties(req, res, next));
  app.post('/save-property', (req, res, next) => savedProperties.saveProperty(req, res, next));
  app.delete('/saved-properties/:propertyId', (req, res, next) =>
    savedProperties.unsaveProperty(req, res, next),
  );
  app.patch('/saved-properties/:propertyId/notes', (req, res, next) =>
    savedProperties.updateSavedPropertyNotes(req, res, next),
  );
  app.get('/folders', (req, res, next) => savedFolders.getSavedPropertyFolders(req, res, next));
  app.post('/folders', (req, res, next) => savedFolders.createSavedPropertyFolder(req, res, next));
  app.put('/folders/:folderId', (req, res, next) =>
    savedFolders.updateSavedPropertyFolder(req, res, next),
  );
  app.delete('/folders/:folderId', (req, res, next) =>
    savedFolders.deleteSavedPropertyFolder(req, res, next),
  );
  app.use(errorHandler);
  return app;
}

/** Two listings, so "the right one" is distinguishable from "the only one". */
let listingA: string;
let listingB: string;
let addressId: string;

async function savesOf(oxyUserId: string) {
  return getDb().select().from(savedItems).where(eq(savedItems.oxyUserId, oxyUserId));
}

async function foldersOf(oxyUserId: string) {
  return getDb()
    .select()
    .from(savedPropertyFolders)
    .where(eq(savedPropertyFolders.oxyUserId, oxyUserId));
}

beforeEach(async () => {
  const db = getDb();
  // Saves and folders first: `saved_items` CASCADEs from `properties`, so
  // `resetGeoTables` would take them anyway — but folders do NOT reference a
  // listing, so a folder from the previous test would survive and make the
  // duplicate-name cases fail for the wrong reason.
  await db.delete(savedItems);
  await db.delete(savedPropertyFolders);
  await resetGeoTables();

  const seeded = await seedListingWithGeo({ cityName: 'Barcelona' });
  addressId = seeded.addressId;
  listingA = seeded.propertyId;
  listingB = await seedProperty({ addressId });
});

/**
 * Leave the database as this file found it.
 *
 * Truncating in `beforeEach` protects THIS file and leaves the last test's
 * fixtures behind for whatever runs next on the same worker — which shares one
 * database with it. That residue is not inert: `countries_code_key` is a UNIQUE
 * index on `code`, and `db/backfill/geo.ts` copies with
 * `ON CONFLICT DO NOTHING`, so a leftover `ES` country makes the backfill skip
 * inserting its OWN country and then fail the `regions` foreign key. Measured:
 * `jest --runInBand --runTestsByPath <this file> __tests__/db/geoBackfill.test.ts`
 * fails 10 cases in that suite without this hook and passes with it.
 */
afterAll(async () => {
  const db = getDb();
  await db.delete(savedItems);
  await db.delete(savedPropertyFolders);
  await resetGeoTables();
});

describe('saveProperty', () => {
  it('saves a listing into a default folder it creates on first use', async () => {
    const res = await request(buildApp('oxy-a')).post('/save-property').send({ propertyId: listingA });

    expect(res.status).toBe(200);
    const folders = await foldersOf('oxy-a');
    expect(folders).toHaveLength(1);
    expect(folders[0].isDefault).toBe(true);
    expect(folders[0].name).toBe('Favorites');
    expect(res.body.data.folderId).toBe(folders[0].id);

    const saved = await savesOf('oxy-a');
    expect(saved).toHaveLength(1);
    expect(saved[0].targetId).toBe(listingA);
    expect(saved[0].targetType).toBe('property');
    expect(saved[0].folderId).toBe(folders[0].id);
  });

  it('reuses the default folder on the next save rather than creating a second', async () => {
    // The half that fails if `ensureDefaultFolder` inserts unconditionally: the
    // unique index would raise, and a caller would get a 500 on their second
    // save.
    const app = buildApp('oxy-a');
    await request(app).post('/save-property').send({ propertyId: listingA });
    await request(app).post('/save-property').send({ propertyId: listingB });

    expect(await foldersOf('oxy-a')).toHaveLength(1);
    expect(await savesOf('oxy-a')).toHaveLength(2);
  });

  it('is idempotent per listing — a repeat save updates rather than duplicating', async () => {
    const app = buildApp('oxy-a');
    await request(app).post('/save-property').send({ propertyId: listingA, notes: 'first' });
    const second = await request(app)
      .post('/save-property')
      .send({ propertyId: listingA, notes: 'second' });
    expect(second.status).toBe(200);

    const saved = await savesOf('oxy-a');
    expect(saved).toHaveLength(1);
    expect(saved[0].notes).toBe('second');
  });

  it('scopes the save to the OWNER — two people may both save one listing', async () => {
    // The index that breaks this is `UNIQUE(target_type, target_id)`, which
    // passes every "rejects a duplicate" assertion above. This is the permit
    // half `CONVENTIONS.md` requires a unique index to be tested on.
    const a = await request(buildApp('oxy-a')).post('/save-property').send({ propertyId: listingA });
    const b = await request(buildApp('oxy-b')).post('/save-property').send({ propertyId: listingA });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    expect(await savesOf('oxy-a')).toHaveLength(1);
    expect(await savesOf('oxy-b')).toHaveLength(1);
  });

  it('answers 404 for a listing that does not exist, and stores nothing', async () => {
    // Mongo stored a bare string with nothing behind it, so this used to
    // succeed. The foreign key refuses it; without the `23503` handler the
    // caller would get a 500 instead.
    const res = await request(buildApp('oxy-a'))
      .post('/save-property')
      .send({ propertyId: '507f1f77bcf86cd799439011' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('PROPERTY_NOT_FOUND');
    expect(await savesOf('oxy-a')).toHaveLength(0);
  });

  it('requires authentication and a property id', async () => {
    expect((await request(buildApp()).post('/save-property').send({ propertyId: listingA })).status).toBe(401);
    expect((await request(buildApp('oxy-a')).post('/save-property').send({})).status).toBe(400);
  });

  it("refuses to file a save into somebody else's folder", async () => {
    const folder = await request(buildApp('oxy-b')).post('/folders').send({ name: 'B private' });
    expect(folder.status).toBe(201);

    const res = await request(buildApp('oxy-a'))
      .post('/save-property')
      .send({ propertyId: listingA, folderId: folder.body.data.id });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('FOLDER_NOT_FOUND');

    // A handler that 404s and writes anyway passes any assertion made on the
    // response alone.
    expect(await savesOf('oxy-a')).toHaveLength(0);
  });

  it('stores a blank note as NULL and puts an empty string on the wire', async () => {
    // The two Mongo writers disagreed — one stored `null`, the other `''`. The
    // column is nullable with no default, so absence has one spelling now.
    await request(buildApp('oxy-a'))
      .post('/save-property')
      .send({ propertyId: listingA, notes: '   ' });

    const saved = await savesOf('oxy-a');
    expect(saved[0].notes).toBeNull();

    const listed = await request(buildApp('oxy-a')).get('/saved-properties');
    expect(listed.body.data[0].notes).toBe('');
  });
});

describe('getSavedProperties', () => {
  it('returns the hydrated listing, newest save first, with the saved fields merged', async () => {
    const app = buildApp('oxy-a');
    await request(app).post('/save-property').send({ propertyId: listingA });
    await request(app).post('/save-property').send({ propertyId: listingB, notes: 'second' });

    const res = await request(app).get('/saved-properties');
    expect(res.status).toBe(200);
    expect(res.body.data.map((row: { id: string }) => row.id)).toEqual([listingB, listingA]);

    // Hydrated through the catalogue serializer, not a bare row: the address is
    // the join `findProperties` performs.
    expect(res.body.data[0].address).toBeDefined();
    expect(res.body.data[0].savedAt).toEqual(expect.any(String));
    expect(res.body.data[0].notes).toBe('second');
    // The wire contract is `id`, not `_id` (PR #287's clean cut).
    expect(res.body.data[0]._id).toBeUndefined();
  });

  it("returns only the caller's own saves", async () => {
    await request(buildApp('oxy-a')).post('/save-property').send({ propertyId: listingA });
    await request(buildApp('oxy-b')).post('/save-property').send({ propertyId: listingB });

    const res = await request(buildApp('oxy-a')).get('/saved-properties');
    expect(res.body.data.map((row: { id: string }) => row.id)).toEqual([listingA]);
  });

  it('drops a save when its listing is deleted — the foreign key CASCADEs', async () => {
    await request(buildApp('oxy-a')).post('/save-property').send({ propertyId: listingA });
    expect(await savesOf('oxy-a')).toHaveLength(1);

    await getDb().delete(propertiesTable).where(eq(propertiesTable.id, listingA));

    // The Mongo handler needed an application-side `if (!prop) return null` for
    // exactly this case, because its `targetId` pointed at nothing. Here the row
    // is already gone.
    expect(await savesOf('oxy-a')).toHaveLength(0);
    const res = await request(buildApp('oxy-a')).get('/saved-properties');
    expect(res.body.data).toEqual([]);
  });
});

describe('unsaveProperty / updateSavedPropertyNotes — ownership', () => {
  it('lets the owner unsave, and refuses a stranger without deleting', async () => {
    await request(buildApp('oxy-a')).post('/save-property').send({ propertyId: listingA });

    const stranger = await request(buildApp('oxy-b')).delete(`/saved-properties/${listingA}`);
    expect(stranger.status).toBe(404);
    expect(await savesOf('oxy-a')).toHaveLength(1);

    const owner = await request(buildApp('oxy-a')).delete(`/saved-properties/${listingA}`);
    expect(owner.status).toBe(200);
    expect(await savesOf('oxy-a')).toHaveLength(0);
  });

  it("does not let user B rewrite user A's note", async () => {
    await request(buildApp('oxy-a'))
      .post('/save-property')
      .send({ propertyId: listingA, notes: 'mine' });

    const res = await request(buildApp('oxy-b'))
      .patch(`/saved-properties/${listingA}/notes`)
      .send({ notes: 'hijacked' });
    expect(res.status).toBe(404);

    const saved = await savesOf('oxy-a');
    expect(saved[0].notes).toBe('mine');
  });

  it('lets the owner replace and clear their own note', async () => {
    const app = buildApp('oxy-a');
    await request(app).post('/save-property').send({ propertyId: listingA, notes: 'first' });

    const updated = await request(app)
      .patch(`/saved-properties/${listingA}/notes`)
      .send({ notes: 'second' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.notes).toBe('second');

    const cleared = await request(app).patch(`/saved-properties/${listingA}/notes`).send({ notes: '' });
    expect(cleared.status).toBe(200);
    expect((await savesOf('oxy-a'))[0].notes).toBeNull();
  });

  it('answers 404 for a listing this person never saved', async () => {
    const res = await request(buildApp('oxy-a'))
      .patch(`/saved-properties/${listingA}/notes`)
      .send({ notes: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('SAVED_PROPERTY_NOT_FOUND');
  });
});

describe('saved-property folders', () => {
  it('creates a folder and returns it with an `id` and a zero count', async () => {
    const res = await request(buildApp('oxy-a'))
      .post('/folders')
      .send({ name: '  Barcelona  ', description: '  by the sea  ' });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toEqual(expect.any(String));
    expect(res.body.data._id).toBeUndefined();
    expect(res.body.data.propertyCount).toBe(0);
    // Trimmed at the call site: the unique index is on `lower(name)` over the
    // stored bytes, so an untrimmed name would retire the duplicate rule.
    expect(res.body.data.name).toBe('Barcelona');
    expect(res.body.data.description).toBe('by the sea');
    // Column defaults, not mongoose document defaults.
    expect(res.body.data.color).toBe('#3B82F6');
    expect(res.body.data.icon).toBe('folder-outline');
  });

  it('stores a blank description as NULL rather than as an empty string', async () => {
    const res = await request(buildApp('oxy-a')).post('/folders').send({ name: 'Plain', description: '  ' });
    expect(res.status).toBe(201);
    expect(res.body.data.description).toBeNull();
  });

  it('answers 409 on a duplicate name IGNORING CASE, leaving the first intact', async () => {
    const app = buildApp('oxy-a');
    const first = await request(app).post('/folders').send({ name: 'Beach', color: '#111111' });
    expect(first.status).toBe(201);

    const second = await request(app).post('/folders').send({ name: 'bEaCh', color: '#222222' });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('FOLDER_NAME_EXISTS');

    const folders = await foldersOf('oxy-a');
    expect(folders).toHaveLength(1);
    expect(folders[0].color).toBe('#111111');
  });

  it('scopes the unique name to the OWNER — two people may both have "Beach"', async () => {
    const a = await request(buildApp('oxy-a')).post('/folders').send({ name: 'Beach' });
    const b = await request(buildApp('oxy-b')).post('/folders').send({ name: 'Beach' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });

  it('counts saves per folder, from `saved_items` and scoped to the owner', async () => {
    const app = buildApp('oxy-a');
    const beach = await request(app).post('/folders').send({ name: 'Beach' });
    // Created but never filled: a folder with no saves must report 0 rather
    // than being absent from the response, which is what the `?? 0` in the
    // controller supplies (the count map omits empty folders).
    await request(app).post('/folders').send({ name: 'City' });

    await request(app).post('/save-property').send({ propertyId: listingA, folderId: beach.body.data.id });
    await request(app).post('/save-property').send({ propertyId: listingB, folderId: beach.body.data.id });
    // Another person's save in their OWN folder must not be counted here.
    await request(buildApp('oxy-b')).post('/save-property').send({ propertyId: listingA });

    const res = await request(app).get('/folders');
    expect(res.status).toBe(200);
    const counts = Object.fromEntries(
      res.body.data.folders.map((f: { name: string; propertyCount: number }) => [f.name, f.propertyCount]),
    );
    expect(counts).toEqual({ Beach: 2, City: 0 });
  });

  it('lists the default folder first, then oldest first', async () => {
    const app = buildApp('oxy-a');
    await request(app).post('/folders').send({ name: 'Alpha' });
    await request(app).post('/folders').send({ name: 'Beta' });
    // Creates the default folder LAST, so a query that merely ordered by
    // `created_at` would put it at the end.
    await request(app).post('/save-property').send({ propertyId: listingA });

    const res = await request(app).get('/folders');
    expect(res.body.data.folders.map((f: { name: string }) => f.name)).toEqual([
      'Favorites',
      'Alpha',
      'Beta',
    ]);
  });

  it("returns only the caller's own folders", async () => {
    await request(buildApp('oxy-a')).post('/folders').send({ name: 'Mine' });
    await request(buildApp('oxy-b')).post('/folders').send({ name: 'Theirs' });

    const res = await request(buildApp('oxy-a')).get('/folders');
    expect(res.body.data.folders.map((f: { name: string }) => f.name)).toEqual(['Mine']);
  });

  it('refuses to update or delete the DEFAULT folder', async () => {
    const app = buildApp('oxy-a');
    await request(app).post('/save-property').send({ propertyId: listingA });
    const defaultFolder = (await foldersOf('oxy-a'))[0];

    const updated = await request(app).put(`/folders/${defaultFolder.id}`).send({ name: 'Renamed' });
    expect(updated.status).toBe(400);
    expect(updated.body.code).toBe('CANNOT_UPDATE_DEFAULT_FOLDER');

    const deleted = await request(app).delete(`/folders/${defaultFolder.id}`);
    expect(deleted.status).toBe(400);
    expect(deleted.body.code).toBe('CANNOT_DELETE_DEFAULT_FOLDER');

    expect((await foldersOf('oxy-a'))[0].name).toBe('Favorites');
  });

  it("does not let user B rename or delete user A's folder", async () => {
    const created = await request(buildApp('oxy-a')).post('/folders').send({ name: 'Mine' });

    const renamed = await request(buildApp('oxy-b'))
      .put(`/folders/${created.body.data.id}`)
      .send({ name: 'Hijacked' });
    expect(renamed.status).toBe(404);

    const deleted = await request(buildApp('oxy-b')).delete(`/folders/${created.body.data.id}`);
    expect(deleted.status).toBe(404);

    const folders = await foldersOf('oxy-a');
    expect(folders).toHaveLength(1);
    expect(folders[0].name).toBe('Mine');
  });

  it('answers 409 when a rename collides with another of the same owner\'s folders', async () => {
    const app = buildApp('oxy-a');
    await request(app).post('/folders').send({ name: 'Taken' });
    const other = await request(app).post('/folders').send({ name: 'Free' });

    const res = await request(app).put(`/folders/${other.body.data.id}`).send({ name: 'TAKEN' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('FOLDER_NAME_EXISTS');

    const folders = await foldersOf('oxy-a');
    expect(folders.map((f) => f.name).sort()).toEqual(['Free', 'Taken']);
  });

  it('KEEPS the saves when their folder is deleted, un-filing them', async () => {
    // The load-bearing case of this port. The Mongo handler ran an explicit
    // `Saved.updateMany({ folderId }, { folderId: null })` before deleting; that
    // statement is GONE, and `ON DELETE SET NULL` is what replaced it. If the
    // constraint were CASCADE — or absent — a person would lose every saved
    // listing by tidying up a folder.
    const app = buildApp('oxy-a');
    const folder = await request(app).post('/folders').send({ name: 'Temporary' });
    await request(app).post('/save-property').send({ propertyId: listingA, folderId: folder.body.data.id });
    await request(app).post('/save-property').send({ propertyId: listingB, folderId: folder.body.data.id });

    const res = await request(app).delete(`/folders/${folder.body.data.id}`);
    expect(res.status).toBe(200);

    const saved = await savesOf('oxy-a');
    expect(saved).toHaveLength(2);
    expect(saved.every((row) => row.folderId === null)).toBe(true);

    const listed = await request(app).get('/saved-properties');
    expect(listed.body.data).toHaveLength(2);
    expect(listed.body.data.every((row: { folderId: null }) => row.folderId === null)).toBe(true);
  });

  it('answers 404 for a folder id that never existed, whatever shape it is', async () => {
    // Both id shapes are live in a `text` primary key after the cutover, so a
    // handler that recognised only a 24-hex ObjectId would answer 400 for a
    // perfectly valid uuid v7.
    const app = buildApp('oxy-a');
    expect((await request(app).delete('/folders/0198f0a1-0000-7000-8000-000000000000')).status).toBe(404);
    expect((await request(app).delete('/folders/507f1f77bcf86cd799439011')).status).toBe(404);
    expect((await request(app).delete('/folders/not-an-id')).status).toBe(404);
  });

  it('requires authentication on every folder route', async () => {
    const app = buildApp();
    expect((await request(app).get('/folders')).status).toBe(401);
    expect((await request(app).post('/folders').send({ name: 'x' })).status).toBe(401);
    expect((await request(app).put('/folders/abc').send({ name: 'x' })).status).toBe(401);
    expect((await request(app).delete('/folders/abc')).status).toBe(401);
  });
});

describe('the folder membership table has no writer', () => {
  it('files a save through `saved_items.folder_id` and never `saved_property_folder_items`', async () => {
    // The Mongo document carried BOTH a `Saved.folderId` pointer and a
    // `SavedPropertyFolder.properties[]` array — two representations of one
    // fact, kept in step by a best-effort `try {} catch {}`. Only the pointer
    // survives; this pins that the port did not quietly start maintaining both.
    const app = buildApp('oxy-a');
    const folder = await request(app).post('/folders').send({ name: 'Beach' });
    await request(app).post('/save-property').send({ propertyId: listingA, folderId: folder.body.data.id });

    const filed = await getDb()
      .select()
      .from(savedItems)
      .where(and(eq(savedItems.oxyUserId, 'oxy-a'), eq(savedItems.folderId, folder.body.data.id)));
    expect(filed).toHaveLength(1);
  });
});

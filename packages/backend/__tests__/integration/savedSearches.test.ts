/**
 * Saved searches — ownership, the unique-name rule, and the `jsonb` filters.
 *
 * The real handlers against the REAL Postgres this worker owns, mounted behind a
 * fake-auth middleware. The Mongo collection was empty in production, so nothing
 * here asserts a preserved row; what it asserts is that the RULES the schema now
 * carries actually hold, in both directions.
 *
 * ## What makes these tests non-vacuous
 *
 * `saved_searches` was empty, so a suite that only inserted one row and read it
 * back would pass against almost any implementation. Each case below is written
 * against a rule that has a way to be WRONG:
 *
 *  - the unique name is asserted per OWNER, so an index missing `oxy_user_id`
 *    (which would reject two different people saving "Madrid") fails,
 *  - the 409 is asserted to leave the FIRST row intact, so an upsert
 *    masquerading as a create fails,
 *  - `filters` is asserted to survive a shape the column would lose if it were
 *    ever flattened into columns,
 *  - every ownership case re-reads the row afterwards, because a handler that
 *    404s and writes anyway passes any assertion made on the response alone.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';

import * as savedSearches from '../../controllers/profile/savedSearches';
import { getDb } from '../../db/postgres';
import { savedSearches as savedSearchesTable } from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';

function buildApp(oxyUserId?: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (oxyUserId) {
      (req as unknown as { user: { id: string } }).user = { id: oxyUserId };
    }
    next();
  });
  app.get('/saved-searches', (req, res, next) => savedSearches.getSavedSearches(req, res, next));
  app.post('/saved-searches', (req, res, next) => savedSearches.saveSearch(req, res, next));
  app.put('/saved-searches/:searchId', (req, res, next) => savedSearches.updateSavedSearch(req, res, next));
  app.patch('/saved-searches/:searchId/notifications', (req, res, next) =>
    savedSearches.toggleSearchNotifications(req, res, next),
  );
  app.delete('/saved-searches/:searchId', (req, res, next) => savedSearches.deleteSavedSearch(req, res, next));
  app.use(errorHandler);
  return app;
}

async function rowById(id: string) {
  const [row] = await getDb()
    .select()
    .from(savedSearchesTable)
    .where(eq(savedSearchesTable.id, id))
    .limit(1);
  return row;
}

beforeEach(async () => {
  await getDb().delete(savedSearchesTable);
});

describe('saveSearch', () => {
  it('stores the search and returns it with an `id`', async () => {
    const res = await request(buildApp('oxy-a'))
      .post('/saved-searches')
      .send({ name: 'Madrid centro', query: 'madrid', filters: { minPrice: 500 } });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toEqual(expect.any(String));
    // The wire contract is `id`, not `_id` (PR #287's clean cut).
    expect(res.body.data._id).toBeUndefined();

    const persisted = await rowById(res.body.data.id);
    expect(persisted?.oxyUserId).toBe('oxy-a');
    expect(persisted?.name).toBe('Madrid centro');
    expect(persisted?.notificationsEnabled).toBe(false);
  });

  it('trims the name and the query before storing them', async () => {
    // Not cosmetic: the unique index is on the stored bytes, so an untrimmed
    // name would make `'Madrid '` a second row and retire the rule below.
    const res = await request(buildApp('oxy-a'))
      .post('/saved-searches')
      .send({ name: '  Madrid  ', query: '  madrid  ' });
    expect(res.status).toBe(201);

    const persisted = await rowById(res.body.data.id);
    expect(persisted?.name).toBe('Madrid');
    expect(persisted?.query).toBe('madrid');
  });

  it('rejects a blank name or query with 400', async () => {
    const app = buildApp('oxy-a');
    const blankName = await request(app).post('/saved-searches').send({ name: '   ', query: 'x' });
    expect(blankName.status).toBe(400);
    const missingQuery = await request(app).post('/saved-searches').send({ name: 'x' });
    expect(missingQuery.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(buildApp()).post('/saved-searches').send({ name: 'x', query: 'y' });
    expect(res.status).toBe(401);
  });

  it('answers 409 on a duplicate name and leaves the FIRST row untouched', async () => {
    const app = buildApp('oxy-a');
    const created = await request(app).post('/saved-searches').send({ name: 'Madrid', query: 'one' });
    expect(created.status).toBe(201);

    const second = await request(app).post('/saved-searches').send({ name: 'Madrid', query: 'two' });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('SEARCH_NAME_EXISTS');

    // An upsert wearing a create's clothes would pass the 409 assertion only if
    // it also failed — but a handler that returned 409 *after* overwriting would
    // not, which is what this re-read is for.
    const persisted = await rowById(created.body.data.id);
    expect(persisted?.query).toBe('one');

    const all = await getDb().select().from(savedSearchesTable);
    expect(all).toHaveLength(1);
  });

  it('scopes the unique name to the OWNER — two people may both save "Madrid"', async () => {
    // The index that would break this is a plain `UNIQUE(name)`, which passes
    // every "rejects a duplicate" assertion above. This is the permit half that
    // `CONVENTIONS.md` says a unique index has to be tested on.
    const a = await request(buildApp('oxy-a')).post('/saved-searches').send({ name: 'Madrid', query: 'q' });
    const b = await request(buildApp('oxy-b')).post('/saved-searches').send({ name: 'Madrid', query: 'q' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const all = await getDb().select().from(savedSearchesTable);
    expect(all).toHaveLength(2);
  });

  it('round-trips a nested `filters` object through jsonb', async () => {
    // `filters` is one of the five columns that earned `jsonb`: its shape is
    // whatever the search UI supported the day it was saved. A column set that
    // flattened it would lose the nesting and the array silently.
    const filters = {
      priceRange: { min: 500, max: 1200 },
      amenities: ['wifi', 'lift'],
      furnished: false,
      nested: { deep: { deeper: 'value' } },
    };
    const res = await request(buildApp('oxy-a'))
      .post('/saved-searches')
      .send({ name: 'Complex', query: 'q', filters });
    expect(res.status).toBe(201);

    const persisted = await rowById(res.body.data.id);
    expect(persisted?.filters).toEqual(filters);

    const listed = await request(buildApp('oxy-a')).get('/saved-searches');
    expect(listed.body.data[0].filters).toEqual(filters);
  });
});

describe('getSavedSearches', () => {
  it("returns only the caller's own searches, newest first", async () => {
    await request(buildApp('oxy-a')).post('/saved-searches').send({ name: 'first', query: 'q' });
    await request(buildApp('oxy-a')).post('/saved-searches').send({ name: 'second', query: 'q' });
    await request(buildApp('oxy-b')).post('/saved-searches').send({ name: 'other', query: 'q' });

    const res = await request(buildApp('oxy-a')).get('/saved-searches');
    expect(res.status).toBe(200);
    const names = res.body.data.map((row: { name: string }) => row.name);
    expect(names).toHaveLength(2);
    expect(names).not.toContain('other');
  });
});

describe('updateSavedSearch / toggleSearchNotifications — ownership', () => {
  it('lets the owner rename their own search', async () => {
    const created = await request(buildApp('oxy-a'))
      .post('/saved-searches')
      .send({ name: 'old', query: 'q' });

    const res = await request(buildApp('oxy-a'))
      .put(`/saved-searches/${created.body.data.id}`)
      .send({ name: 'new' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('new');
  });

  it("does not let user B rename user A's search (404, unchanged)", async () => {
    const created = await request(buildApp('oxy-a'))
      .post('/saved-searches')
      .send({ name: 'mine', query: 'q' });

    const res = await request(buildApp('oxy-b'))
      .put(`/saved-searches/${created.body.data.id}`)
      .send({ name: 'hijacked' });
    expect(res.status).toBe(404);

    const persisted = await rowById(created.body.data.id);
    expect(persisted?.name).toBe('mine');
  });

  it('answers 409 when a rename collides with another of the same owner\'s searches', async () => {
    const app = buildApp('oxy-a');
    await request(app).post('/saved-searches').send({ name: 'taken', query: 'q' });
    const other = await request(app).post('/saved-searches').send({ name: 'free', query: 'q' });

    const res = await request(app).put(`/saved-searches/${other.body.data.id}`).send({ name: 'taken' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SEARCH_NAME_EXISTS');

    const persisted = await rowById(other.body.data.id);
    expect(persisted?.name).toBe('free');
  });

  it('toggles notifications for the owner and refuses a stranger', async () => {
    const created = await request(buildApp('oxy-a'))
      .post('/saved-searches')
      .send({ name: 'alerts', query: 'q' });

    const on = await request(buildApp('oxy-a'))
      .patch(`/saved-searches/${created.body.data.id}/notifications`)
      .send({ notificationsEnabled: true });
    expect(on.status).toBe(200);
    expect(on.body.data.notificationsEnabled).toBe(true);

    const stranger = await request(buildApp('oxy-b'))
      .patch(`/saved-searches/${created.body.data.id}/notifications`)
      .send({ notificationsEnabled: false });
    expect(stranger.status).toBe(404);

    const persisted = await rowById(created.body.data.id);
    expect(persisted?.notificationsEnabled).toBe(true);
  });
});

describe('deleteSavedSearch — ownership', () => {
  it('lets the owner delete their own search', async () => {
    const created = await request(buildApp('oxy-a'))
      .post('/saved-searches')
      .send({ name: 'bye', query: 'q' });

    const res = await request(buildApp('oxy-a')).delete(`/saved-searches/${created.body.data.id}`);
    expect(res.status).toBe(200);
    expect(await rowById(created.body.data.id)).toBeUndefined();
  });

  it("does not let user B delete user A's search (404, still there)", async () => {
    const created = await request(buildApp('oxy-a'))
      .post('/saved-searches')
      .send({ name: 'keep', query: 'q' });

    const res = await request(buildApp('oxy-b')).delete(`/saved-searches/${created.body.data.id}`);
    expect(res.status).toBe(404);
    expect(await rowById(created.body.data.id)).toBeDefined();
  });

  it('answers 404 for an id that never existed, whatever shape it is', async () => {
    // Both id shapes are live in a `text` primary key after the cutover, so a
    // handler that still recognised only a 24-hex ObjectId would answer 400 for
    // a perfectly valid uuid v7.
    const app = buildApp('oxy-a');
    expect((await request(app).delete('/saved-searches/0198f0a1-0000-7000-8000-000000000000')).status).toBe(404);
    expect((await request(app).delete('/saved-searches/507f1f77bcf86cd799439011')).status).toBe(404);
    expect((await request(app).delete('/saved-searches/not-an-id')).status).toBe(404);
  });
});

/**
 * The `location` column and its lazy, CONFIRMED migration (ADR 0002 §11).
 *
 * The property under test is not "a jsonb value round-trips" — it is that a row
 * WITHOUT a location is reported as needing confirmation rather than being
 * quietly resolved from its label. Geocoding a stored label and keeping the
 * first hit is the homonym bug, and doing it one row at a time on read is the
 * same mistake as doing it to everyone at once in a migration.
 */
describe('saved-search location', () => {
  const barcelona = {
    kind: 'place',
    source: { kind: 'homiio', entity: 'city', id: '01H8XQ7C2R9V6WQ2N4M0KJ3ZTA' },
    placeType: 'city',
    label: { primary: 'Barcelona', secondary: 'Catalonia, Spain', kind: 'place' },
    admin: { countryCode: 'ES', regionName: 'Catalonia', cityName: 'Barcelona' },
    center: { longitude: 2.1734, latitude: 41.3851 },
    precision: 'centroid',
  };

  it('stores a selection and reports it resolved', async () => {
    const res = await request(buildApp('oxy-a'))
      .post('/saved-searches')
      .send({ name: 'Barcelona · Catalonia, Spain', query: '', location: barcelona });

    expect(res.status).toBe(201);
    expect(res.body.data.locationStatus).toBe('resolved');
    // The IDENTITY survives the round trip. A row that kept only the label
    // would reopen in whichever Barcelona a geocoder preferred that day.
    expect(res.body.data.location.source.id).toBe('01H8XQ7C2R9V6WQ2N4M0KJ3ZTA');

    const persisted = await rowById(res.body.data.id);
    expect((persisted?.location as { source: { id: string } }).source.id).toBe(
      '01H8XQ7C2R9V6WQ2N4M0KJ3ZTA',
    );
  });

  it('accepts a PLACE-ONLY save, where the free text is empty', async () => {
    // The guard used to require a non-empty `query`, back when `query` held the
    // location's LABEL. Once it became the free-text dimension — normally empty
    // for a place search — that check would have rejected every saved city with
    // a 400 nobody could act on.
    const res = await request(buildApp('oxy-a'))
      .post('/saved-searches')
      .send({ name: 'place only', location: barcelona });

    expect(res.status).toBe(201);
  });

  it('still refuses a save with neither a location nor any text', async () => {
    // The floor for the previous case: relaxing the guard must not accept a
    // search that asks for nothing at all.
    const res = await request(buildApp('oxy-a')).post('/saved-searches').send({ name: 'empty' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SEARCH_DATA_REQUIRED');
  });

  it('marks a row with no location as NEEDING CONFIRMATION, not as resolved', async () => {
    // Exactly the shape a pre-contract row has: a label in `query`, no
    // `location`. It must not be resolved on the caller's behalf.
    const res = await request(buildApp('oxy-a'))
      .post('/saved-searches')
      .send({ name: 'legacy', query: 'Barcelona' });

    expect(res.status).toBe(201);
    expect(res.body.data.locationStatus).toBe('needs_confirmation');
    expect(res.body.data.location).toBeNull();
    // …and the label is still there, so the UI can ask "did you mean?" rather
    // than losing the row.
    expect(res.body.data.query).toBe('Barcelona');
  });

  it('refuses a location that is not a recognised selection', async () => {
    const res = await request(buildApp('oxy-a'))
      .post('/saved-searches')
      .send({ name: 'bogus', query: 'q', location: { kind: 'wherever', lat: 1 } });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_LOCATION');
  });

  it('keeps notificationsEnabled on the DTO beside the new location fields', async () => {
    // A regression guard with a story: adding `location`/`locationStatus` to
    // this DTO dropped `notificationsEnabled` from it, and the only thing that
    // noticed was the ownership test two describes up — a 200 whose body had
    // quietly lost a field. Alerts are decided by that flag.
    const created = await request(buildApp('oxy-a'))
      .post('/saved-searches')
      .send({ name: 'with alerts', query: 'q', notificationsEnabled: true });

    expect(created.body.data.notificationsEnabled).toBe(true);
    expect(created.body.data.locationStatus).toBe('needs_confirmation');
  });
});

/**
 * The saved-home, folder, saved-search, alert and recently-viewed tools,
 * through the wrapped handlers both MCP lanes call (`callTool`), against the
 * real Postgres.
 *
 * What is pinned: every tool acts as the EFFECTIVE account and the ownership is
 * the repository statement's — somebody else's folder, search or alert is the
 * route's 404, never a 403 and never theirs to touch — and a save replays its
 * stored receipt for a repeated idempotency key.
 */

import { and, count, eq } from 'drizzle-orm';
import type { AlertExplanation } from '@homiio/shared-types';

import { getDb } from '../../db/postgres';
import { trackPropertyView } from '../../db/saved/recentlyViewedRepository';
import {
  capabilityEffectReceipts,
  housingAlerts,
  recentlyViewed,
  savedItems,
  savedPropertyFolders,
  savedSearches,
} from '../../db/schema';
import { claimAlert } from '../../db/watches/alertRepository';
import { assertFound } from '../helpers/assertFound';
import { callTool } from '../helpers/capabilityHarness';
import { resetGeoTables, seedListingWithGeo, seedProperty } from '../helpers/postgresGeoFixtures';

const ME = 'oxy-saver';
const STRANGER = 'oxy-stranger';

let listingA: string;
let listingB: string;

async function reset(): Promise<void> {
  const db = getDb();
  await db.delete(capabilityEffectReceipts);
  await db.delete(housingAlerts);
  await db.delete(savedSearches);
  await db.delete(savedItems);
  await db.delete(savedPropertyFolders);
  await db.delete(recentlyViewed);
  await resetGeoTables();
}

beforeEach(async () => {
  await reset();
  const seeded = await seedListingWithGeo({ cityName: 'Barcelona' });
  listingA = seeded.propertyId;
  listingB = await seedProperty({ addressId: seeded.addressId });
});

afterAll(reset);

async function savesOf(oxyUserId: string) {
  return getDb().select().from(savedItems).where(eq(savedItems.oxyUserId, oxyUserId));
}

describe('saved homes', () => {
  it('saves, lists, annotates and unsaves as the effective account', async () => {
    const saved = await callTool('saveHome', ME, { propertyId: listingA, notes: 'sunny' });
    expect(saved.isError).toBe(false);
    const folderId = (saved.structuredContent.data as { folderId: string }).folderId;
    expect(folderId).toEqual(expect.any(String));

    const listed = await callTool('listSavedHomes', ME);
    const homes = listed.structuredContent.data as Array<Record<string, unknown>>;
    expect(homes.map((home) => home.id)).toEqual([listingA]);
    expect(homes[0].notes).toBe('sunny');

    const noted = await callTool('updateSavedHomeNotes', ME, {
      propertyId: listingA,
      notes: 'very sunny',
    });
    expect(noted.structuredContent.data).toMatchObject({
      propertyId: listingA,
      notes: 'very sunny',
    });

    expect((await callTool('unsaveHome', ME, { propertyId: listingA })).isError).toBe(false);
    expect(await savesOf(ME)).toHaveLength(0);
  });

  it("never touches somebody else's save: their note and unsave are the route's 404", async () => {
    await callTool('saveHome', ME, { propertyId: listingA });

    const unsave = await callTool('unsaveHome', STRANGER, { propertyId: listingA });
    expect(unsave.error).toMatchObject({ code: 'SAVED_PROPERTY_NOT_FOUND', status: 404 });
    const note = await callTool('updateSavedHomeNotes', STRANGER, {
      propertyId: listingA,
      notes: 'mine now',
    });
    expect(note.error).toMatchObject({ code: 'SAVED_PROPERTY_NOT_FOUND', status: 404 });
    expect(await savesOf(ME)).toHaveLength(1);
    expect((await callTool('listSavedHomes', STRANGER)).structuredContent.data).toEqual([]);
  });

  it("refuses to file into somebody else's folder", async () => {
    const created = await callTool('createSavedFolder', ME, { name: 'Madrid' });
    const folderId = (created.structuredContent.data as { id: string }).id;
    const result = await callTool('saveHome', STRANGER, { propertyId: listingA, folderId });
    expect(result.error).toMatchObject({ code: 'FOLDER_NOT_FOUND', status: 404 });
  });

  it('replays the stored receipt for a repeated key and refuses the key with other input', async () => {
    const first = await callTool(
      'saveHome',
      ME,
      { propertyId: listingA },
      { idempotencyKey: 'save-1', lane: 'capability' },
    );
    const replay = await callTool(
      'saveHome',
      ME,
      { propertyId: listingA },
      { idempotencyKey: 'save-1', lane: 'capability' },
    );
    expect(replay.structuredContent).toEqual(first.structuredContent);
    const [receipts] = await getDb()
      .select({ total: count() })
      .from(capabilityEffectReceipts)
      .where(
        and(
          eq(capabilityEffectReceipts.oxyUserId, ME),
          eq(capabilityEffectReceipts.tool, 'saveHome'),
        ),
      );
    expect(receipts.total).toBe(1);

    const mismatch = await callTool(
      'saveHome',
      ME,
      { propertyId: listingB },
      { idempotencyKey: 'save-1', lane: 'capability' },
    );
    expect(mismatch.error).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect((await savesOf(ME)).map((row) => row.targetId)).toEqual([listingA]);
  });
});

describe('folders', () => {
  it('creates, lists, renames and deletes a folder; a duplicate name is the 409', async () => {
    const created = await callTool('createSavedFolder', ME, { name: 'Madrid', color: '#f00' });
    expect(created.isError).toBe(false);
    const folderId = (created.structuredContent.data as { id: string }).id;

    const duplicate = await callTool('createSavedFolder', ME, { name: 'madrid' });
    expect(duplicate.error).toMatchObject({ code: 'FOLDER_NAME_EXISTS', status: 409 });

    const renamed = await callTool('updateSavedFolder', ME, { folderId, name: 'Valencia' });
    expect(renamed.structuredContent.data).toMatchObject({ id: folderId, name: 'Valencia' });

    const listed = await callTool('listSavedFolders', ME);
    const { folders } = listed.structuredContent.data as { folders: Array<{ id: string }> };
    expect(folders.map((folder) => folder.id)).toContain(folderId);

    expect((await callTool('deleteSavedFolder', ME, { folderId })).isError).toBe(false);
  });

  it("answers 404 for somebody else's folder, and refuses the default folder", async () => {
    const created = await callTool('createSavedFolder', ME, { name: 'Madrid' });
    const folderId = (created.structuredContent.data as { id: string }).id;
    expect(
      (await callTool('updateSavedFolder', STRANGER, { folderId, name: 'x' })).error,
    ).toMatchObject({ code: 'FOLDER_NOT_FOUND', status: 404 });
    expect((await callTool('deleteSavedFolder', STRANGER, { folderId })).error).toMatchObject({
      code: 'FOLDER_NOT_FOUND',
      status: 404,
    });

    const saved = await callTool('saveHome', ME, { propertyId: listingA });
    const defaultFolder = (saved.structuredContent.data as { folderId: string }).folderId;
    expect(
      (await callTool('deleteSavedFolder', ME, { folderId: defaultFolder })).error,
    ).toMatchObject({ code: 'CANNOT_DELETE_DEFAULT_FOLDER', status: 400 });
    const folders = await getDb()
      .select()
      .from(savedPropertyFolders)
      .where(eq(savedPropertyFolders.oxyUserId, ME));
    expect(folders).toHaveLength(2);
  });
});

describe('saved searches and alerts', () => {
  const place = {
    kind: 'place',
    source: { kind: 'homiio', entity: 'city', id: '01H8XQ7C2R9V6WQ2N4M0KJ3ZTA' },
    placeType: 'city',
    label: { primary: 'Barcelona', secondary: 'Catalonia, Spain', kind: 'place' },
    admin: { countryCode: 'ES', regionName: 'Catalonia', cityName: 'Barcelona' },
    center: { longitude: 2.1734, latitude: 41.3851 },
    precision: 'centroid',
  };

  it('saves, updates, toggles and deletes a watched search', async () => {
    const created = await callTool('createSavedSearch', ME, {
      name: 'Eixample',
      location: place,
      cadence: 'daily',
    });
    expect(created.isError).toBe(false);
    const search = created.structuredContent.data as { id: string; cadence: string };
    expect(search.cadence).toBe('daily');

    const updated = await callTool('updateSavedSearch', ME, {
      searchId: search.id,
      name: 'Gràcia',
    });
    expect(updated.structuredContent.data).toMatchObject({ id: search.id, name: 'Gràcia' });

    const off = await callTool('setSavedSearchAlerts', ME, {
      searchId: search.id,
      notificationsEnabled: false,
    });
    expect(off.structuredContent.data).toMatchObject({
      cadence: 'off',
      notificationsEnabled: false,
    });
    const on = await callTool('setSavedSearchAlerts', ME, {
      searchId: search.id,
      notificationsEnabled: true,
    });
    expect(on.structuredContent.data).toMatchObject({ cadence: 'instant' });

    const listed = await callTool('listSavedSearches', ME);
    expect((listed.structuredContent.data as Array<{ id: string }>).map((s) => s.id)).toEqual([
      search.id,
    ]);

    expect((await callTool('deleteSavedSearch', ME, { searchId: search.id })).isError).toBe(false);
  });

  it('refuses a search with nothing to search, and a location kind it does not store', async () => {
    expect((await callTool('createSavedSearch', ME, { name: 'Empty' })).error).toMatchObject({
      code: 'SEARCH_DATA_REQUIRED',
      status: 400,
    });
    expect(
      (
        await callTool('createSavedSearch', ME, {
          name: 'Here',
          location: { kind: 'current_location' },
        })
      ).error,
    ).toMatchObject({ code: 'INVALID_LOCATION', status: 400 });
  });

  it("answers 404 for somebody else's search and alert", async () => {
    const created = await callTool('createSavedSearch', ME, { name: 'Eixample', location: place });
    const searchId = (created.structuredContent.data as { id: string }).id;
    for (const [tool, input] of [
      ['updateSavedSearch', { searchId, name: 'x' }],
      ['deleteSavedSearch', { searchId }],
      ['setSavedSearchAlerts', { searchId, notificationsEnabled: false }],
    ] as const) {
      expect((await callTool(tool, STRANGER, input)).error).toMatchObject({
        code: 'SAVED_SEARCH_NOT_FOUND',
        status: 404,
      });
    }

    const explanation: AlertExplanation = {
      watchName: 'Eixample',
      watchId: searchId,
      ruleType: 'new_listing',
      ruleVersion: 1,
      detail: { kind: 'new_listing', listingTitle: 'A flat', offering: 'long_term_rent' },
    };
    const { alert } = await claimAlert(getDb(), {
      watchId: searchId,
      oxyUserId: ME,
      eventId: null,
      ruleType: 'new_listing',
      ruleVersion: 1,
      idempotencyKey: `alert-${searchId}`,
      subjectType: 'property',
      subjectId: listingA,
      cooldownBucket: null,
      explanation,
    });
    assertFound(alert, 'alert');

    const mine = await callTool('listHousingAlerts', ME, { watchId: searchId });
    expect(mine.structuredContent).toMatchObject({ total: 1, hasMore: false });
    expect((mine.structuredContent.data as Array<{ id: string }>)[0].id).toBe(alert.id);
    const one = await callTool('getHousingAlert', ME, { alertId: alert.id });
    expect(one.structuredContent.data).toMatchObject({
      alert: { id: alert.id },
      watch: { id: searchId },
      event: null,
    });

    expect((await callTool('listHousingAlerts', STRANGER)).structuredContent.total).toBe(0);
    expect(
      (await callTool('getHousingAlert', STRANGER, { alertId: alert.id })).error,
    ).toMatchObject({ code: 'ALERT_NOT_FOUND', status: 404 });
  });
});

describe('recently viewed', () => {
  it("lists and clears the person's own history only", async () => {
    await trackPropertyView(getDb(), ME, listingA);
    await trackPropertyView(getDb(), STRANGER, listingB);

    const mine = await callTool('listRecentlyViewedHomes', ME, { limit: 5 });
    expect((mine.structuredContent.data as Array<{ id: string }>).map((home) => home.id)).toEqual([
      listingA,
    ]);

    const cleared = await callTool('clearRecentlyViewedHomes', ME);
    expect(cleared.structuredContent.data).toEqual({ deletedCount: 1 });
    const [left] = await getDb().select({ total: count() }).from(recentlyViewed);
    expect(left.total).toBe(1);
  });
});

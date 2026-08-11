/**
 * `property_images` — the one-primary-per-listing constraint, and the
 * `has_images` derivation that depends on it.
 *
 * Mongo enforced "at most one primary photo" in a `pre('save')` hook that
 * walked the array and un-set every extra `isPrimary` — a hook `updateOne` and
 * `findOneAndUpdate` never ran. Here it is a partial unique index, so there is
 * no write path that can produce a second one.
 *
 * The constraint is safe to impose from day one, and that is MEASURED rather
 * than hoped: the census counted primaries per property across all 17,644
 * production listings and found exactly 1 on 16,585 and 0 on 1,059 — never
 * more than one. The migration plan expected to find violations to resolve;
 * there are none.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { UNIQUE_VIOLATION, constraintNameOf, sqlStateOf, uuidv7 } from '@oxyhq/db';
import { closePostgres, connectPostgres, type Database } from '../../db/postgres';
import { findHasImagesDisagreements, syncAllHasImages, syncHasImages } from '../../db/hasImages';
import { images, properties, propertyImages } from '../../db/schema';
import {
  createPropertyScaffold,
  dropPropertyScaffold,
  insertProperty,
  type PropertyScaffold,
} from './propertyFixtures';

let db: Database;
let scaffold: PropertyScaffold;
const createdProperties: string[] = [];
const createdImages: string[] = [];

/** A stored photo to reference. `property_images.image_id` is NOT NULL. */
async function createImage(entityId: string): Promise<string> {
  const key = uuidv7();
  const [row] = await db
    .insert(images)
    .values({
      entityType: 'property',
      entityId,
      keysOriginal: `${key}/o`,
      keysSmall: `${key}/s`,
      keysMedium: `${key}/m`,
      keysLarge: `${key}/l`,
      urlsOriginal: `https://cdn.test/${key}/o.jpg`,
      urlsSmall: `https://cdn.test/${key}/s.jpg`,
      urlsMedium: `https://cdn.test/${key}/m.jpg`,
      urlsLarge: `https://cdn.test/${key}/l.jpg`,
      format: 'jpeg',
      bytes: 1024,
    })
    .returning({ id: images.id });
  createdImages.push(row.id);
  return row.id;
}

async function createProperty(): Promise<string> {
  const id = await insertProperty(db, scaffold);
  createdProperties.push(id);
  return id;
}

/** Attach a photo to a listing, going through the ONE `has_images` writer. */
async function attachPhoto(
  propertyId: string,
  options: { isPrimary?: boolean; order?: number } = {},
): Promise<string> {
  const imageId = await createImage(propertyId);
  const [row] = await db
    .insert(propertyImages)
    .values({
      propertyId,
      imageId,
      isPrimary: options.isPrimary ?? false,
      order: options.order ?? 0,
    })
    .returning({ id: propertyImages.id });
  await syncHasImages(db, propertyId);
  return row.id;
}

beforeAll(async () => {
  db = await connectPostgres();
  scaffold = await createPropertyScaffold(db, 'images');
});

afterEach(async () => {
  // Reverse dependency order: `property_images.image_id` is ON DELETE RESTRICT,
  // so the refs have to go before the images they point at. That the images
  // survive a property delete is the point of the RESTRICT and is asserted
  // below, not worked around here.
  while (createdProperties.length > 0) {
    const id = createdProperties.pop();
    if (id) await db.delete(properties).where(eq(properties.id, id));
  }
  while (createdImages.length > 0) {
    const id = createdImages.pop();
    if (id) await db.delete(images).where(eq(images.id, id));
  }
});

afterAll(async () => {
  await dropPropertyScaffold(db, scaffold);
  await closePostgres();
});

describe('one primary photo per listing', () => {
  it('accepts a listing with one primary and several non-primaries', async () => {
    // The baseline. A `UNIQUE (property_id, is_primary)` — the tempting
    // non-partial spelling — would permit only ONE non-primary photo per
    // listing and fail here, which is the opposite of what a photo list is.
    const propertyId = await createProperty();
    await attachPhoto(propertyId, { isPrimary: true, order: 0 });
    await attachPhoto(propertyId, { isPrimary: false, order: 1 });
    await attachPhoto(propertyId, { isPrimary: false, order: 2 });

    const rows = await db
      .select({ id: propertyImages.id })
      .from(propertyImages)
      .where(eq(propertyImages.propertyId, propertyId));
    expect(rows).toHaveLength(3);
  });

  it('accepts a listing with photos and NO primary', async () => {
    // 1,059 production listings are in exactly this state. A constraint written
    // "exactly one" rather than "at most one" would reject every one of them
    // mid-copy.
    const propertyId = await createProperty();
    await attachPhoto(propertyId, { isPrimary: false });

    const rows = await db
      .select({ id: propertyImages.id })
      .from(propertyImages)
      .where(
        and(eq(propertyImages.propertyId, propertyId), eq(propertyImages.isPrimary, true)),
      );
    expect(rows).toEqual([]);
  });

  it('refuses a SECOND primary on the same listing, naming property_images_one_primary_key', async () => {
    const propertyId = await createProperty();
    await attachPhoto(propertyId, { isPrimary: true, order: 0 });

    let caught: unknown;
    try {
      await attachPhoto(propertyId, { isPrimary: true, order: 1 });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    expect(sqlStateOf(caught)).toBe(UNIQUE_VIOLATION);
    expect(constraintNameOf(caught)).toBe('property_images_one_primary_key');
  });

  it('refuses PROMOTING a second photo to primary — property_images_one_primary_key covers UPDATE too', async () => {
    // The path Mongo's `pre('save')` hook could not see: `updateOne` never ran
    // it, so a promotion produced a second primary silently. An index-backed
    // constraint covers the UPDATE as well as the INSERT, and a test that only
    // inserts cannot tell the two apart.
    const propertyId = await createProperty();
    await attachPhoto(propertyId, { isPrimary: true, order: 0 });
    const secondId = await attachPhoto(propertyId, { isPrimary: false, order: 1 });

    let caught: unknown;
    try {
      await db
        .update(propertyImages)
        .set({ isPrimary: true })
        .where(eq(propertyImages.id, secondId));
    } catch (error) {
      caught = error;
    }

    expect(sqlStateOf(caught)).toBe(UNIQUE_VIOLATION);
    expect(constraintNameOf(caught)).toBe('property_images_one_primary_key');
  });

  it('lets TWO DIFFERENT listings each have their own primary', async () => {
    // Vacuity floor on the constraint itself: an index on `is_primary` alone,
    // without `property_id`, would pass every assertion above and reject this.
    //
    // What makes it a floor is that the SECOND `attachPhoto` succeeds — under
    // the wrong index it raises `23505` and this test dies there. The read below
    // is the confirmation, and it is SCOPED to the two listings this case
    // created: an unscoped `where is_primary` reads every row in the worker's
    // database, so it also fails whenever a sibling FILE in the same worker
    // leaves a primary photo behind — a Postgres database outlives the file that
    // wrote to it, unlike the in-memory Mongo this replaced. That made the
    // assertion depend on how jest happened to distribute files across workers,
    // which is a property of the schedule and not of the index. Scoping loses
    // nothing, because the floor was never the unscoped read.
    const first = await createProperty();
    const second = await createProperty();
    await attachPhoto(first, { isPrimary: true });
    await attachPhoto(second, { isPrimary: true });

    const rows = await db
      .select({ propertyId: propertyImages.propertyId })
      .from(propertyImages)
      .where(and(eq(propertyImages.isPrimary, true), inArray(propertyImages.propertyId, [first, second])));
    expect(rows.map((row) => row.propertyId).sort()).toEqual([first, second].sort());
  });
});

describe('property_images referential rules', () => {
  it('refuses a photo row with no image', async () => {
    // `image_id` is NOT NULL because the census measured it as always present:
    // 169,223 embedded refs, 100% resolving, zero dangling. An earlier draft
    // made it nullable on the strength of a number (948) that measured the
    // OPPOSITE direction — orphaned `Image` documents left behind by the
    // property TTL.
    const propertyId = await createProperty();

    let caught: unknown;
    try {
      await db.execute(sql`
        insert into property_images (id, property_id)
        values (${uuidv7()}, ${propertyId})
      `);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
  });

  it('CASCADES photo rows when the listing is deleted', async () => {
    // The expiry sweep deletes listings continuously — all 17,644 production
    // rows carry a deadline — so without the cascade every reaped listing would
    // leave its refs behind.
    const propertyId = await createProperty();
    await attachPhoto(propertyId);

    await db.delete(properties).where(eq(properties.id, propertyId));
    createdProperties.splice(createdProperties.indexOf(propertyId), 1);

    const rows = await db
      .select({ id: propertyImages.id })
      .from(propertyImages)
      .where(eq(propertyImages.propertyId, propertyId));
    expect(rows).toEqual([]);
  });

  it('REFUSES deleting an image that a listing still references', async () => {
    // RESTRICT, not CASCADE, and the direction matters: a cascade here would
    // remove photo rows with no application code running, so `has_images` — a
    // denormalized flag whose only writer is `db/hasImages.ts` — would go stale
    // with nothing to notice.
    const propertyId = await createProperty();
    await attachPhoto(propertyId);
    const [ref] = await db
      .select({ imageId: propertyImages.imageId })
      .from(propertyImages)
      .where(eq(propertyImages.propertyId, propertyId));

    let caught: unknown;
    try {
      await db.delete(images).where(eq(images.id, ref.imageId));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
  });
});

describe('has_images', () => {
  it('is false for a listing with no photos, and true once one is attached', async () => {
    const propertyId = await createProperty();

    const before = await db
      .select({ hasImages: properties.hasImages })
      .from(properties)
      .where(eq(properties.id, propertyId));
    expect(before[0].hasImages).toBe(false);

    await attachPhoto(propertyId);

    const after = await db
      .select({ hasImages: properties.hasImages })
      .from(properties)
      .where(eq(properties.id, propertyId));
    expect(after[0].hasImages).toBe(true);
  });

  it('goes back to false when the last photo is removed', async () => {
    const propertyId = await createProperty();
    const photoId = await attachPhoto(propertyId);

    await db.delete(propertyImages).where(eq(propertyImages.id, photoId));
    await syncHasImages(db, propertyId);

    const rows = await db
      .select({ hasImages: properties.hasImages })
      .from(properties)
      .where(eq(properties.id, propertyId));
    expect(rows[0].hasImages).toBe(false);
  });

  it('stays true while OTHER photos remain', async () => {
    // The bug a `set hasImages = false on delete` shortcut would ship, and the
    // reason the helper re-DERIVES rather than toggling.
    const propertyId = await createProperty();
    const first = await attachPhoto(propertyId, { order: 0 });
    await attachPhoto(propertyId, { order: 1 });

    await db.delete(propertyImages).where(eq(propertyImages.id, first));
    await syncHasImages(db, propertyId);

    const rows = await db
      .select({ hasImages: properties.hasImages })
      .from(properties)
      .where(eq(properties.id, propertyId));
    expect(rows[0].hasImages).toBe(true);
  });

  it('does not touch a DIFFERENT listing', async () => {
    // The correlated-subquery trap, asserted rather than reasoned about. A
    // reference rendered BARE inside the `exists (…)` compares two of
    // `property_images`' own columns to each other, matches every row, and
    // would set `has_images = true` on every listing in the table — with no
    // error at all. This shipped once already in the sibling oxy-api port.
    const withPhoto = await createProperty();
    const withoutPhoto = await createProperty();
    await attachPhoto(withPhoto);

    const rows = await db
      .select({ id: properties.id, hasImages: properties.hasImages })
      .from(properties)
      .where(eq(properties.id, withoutPhoto));
    expect(rows[0].hasImages).toBe(false);
  });

  it('reports a disagreement, and repairs it', async () => {
    // The reconciliation half of the trade-off written on the column. A
    // denormalized value with no way to detect drift is a value that will
    // drift. The state forced here is the exact shape of the one production row
    // that already disagrees (`6a515dd9c196de4ad2a8550e`: flag false, twelve
    // photos), which is why the backfill must DERIVE the flag rather than copy
    // it.
    const propertyId = await createProperty();
    await attachPhoto(propertyId);
    await db.update(properties).set({ hasImages: false }).where(eq(properties.id, propertyId));

    const drifted = await findHasImagesDisagreements(db);
    expect(drifted).toContainEqual({ propertyId, stored: false, actual: true });

    const repaired = await syncAllHasImages(db);
    expect(repaired).toBeGreaterThanOrEqual(1);
    expect(await findHasImagesDisagreements(db)).toEqual([]);
  });

  it('reports nothing on a consistent database', async () => {
    // Vacuity floor for the assertion above: a `findHasImagesDisagreements`
    // that always returned `[]` would satisfy the repair half of that test and
    // detect nothing forever. This pins the other side — it really is empty
    // when nothing is wrong, so the non-empty result above was a finding.
    const withPhoto = await createProperty();
    await attachPhoto(withPhoto);
    await createProperty();

    expect(await findHasImagesDisagreements(db)).toEqual([]);
  });
});

/**
 * Postgres geo fixtures for the batch-1 suites.
 *
 * ## Ids are 24-char ObjectId hex, deliberately
 *
 * `generatedId()` mints a uuid v7 for a row created by the application, and the
 * backfill copies each Mongo `_id` VERBATIM — so after the cutover both shapes
 * are live in the same column, permanently. Seeding 24-hex ids is therefore not
 * a convenience: it is the shape the overwhelming majority of production rows
 * carry, and the one an `isLiveEntityId` guard, a `.toHexString()` call or an
 * id-versus-name branch behaves differently on. A fixture that seeded only uuids
 * would exercise the post-cutover half of every such site and none of the other.
 * Suites that want the uuid half ask for it explicitly — see `seedProperty`'s
 * `idShape`.
 *
 * ## The minter is LOCAL, and does not go through mongoose
 *
 * {@link objectIdHex} composes the BSON ObjectId layout itself (4-byte
 * big-endian seconds, 5 random bytes fixed per process, a 3-byte counter)
 * instead of calling `new mongoose.Types.ObjectId()`. The point is that these
 * fixtures seed POSTGRES: reaching mongoose for a *string format* pulled the
 * driver — and, through the root setup, the in-memory replica set — into 26 test
 * files that do not otherwise touch Mongo at all, which is what kept `mongoose`
 * un-removable from `package.json` long after the domains under test had moved.
 *
 * ### Two things measured about the layout, so neither is re-derived
 *
 *  - **Nothing in the suite currently depends on the timestamp prefix.**
 *    Mutating this function to a bare `randomBytes(12).toString('hex')` — which
 *    destroys the property that two ids minted in order sort in that order —
 *    leaves all 125 suites and all 1,625 tests green. So the layout is kept
 *    because it is what a real backfilled id looks like (a suite that orders by
 *    id, the way Mongo code routinely used `_id` as a creation proxy, would then
 *    behave here as it does in production), NOT because a test catches it today.
 *    Do not read the structure as protected — if you come to rely on that
 *    ordering, pin it.
 *  - **The uniqueness IS load-bearing, and widely.** Mutating this function to a
 *    constant turns 21 suites and 113 tests red. That is also the anti-vacuity
 *    check on the paragraph above: the two mutations run against the same tree,
 *    so "M1 changed nothing" is a fact about what is asserted, not about whether
 *    this function is reached.
 *
 * ## Truncation, not per-file uniqueness
 *
 * `resetGeoTables` empties the five tables these suites touch. Jest runs one
 * test FILE at a time per worker and each worker owns its own throwaway
 * database, so a truncate cannot race a sibling file — but it WOULD wipe
 * fixtures another file created in its own `beforeAll`, which is why it is
 * called from `beforeEach` in the files that want it rather than installed
 * globally in `jest.setup.ts`.
 */

import { randomBytes } from 'node:crypto';

import { getDb } from '../../db/postgres';
import { syncHasImages } from '../../db/hasImages';
import {
  addresses,
  agencies,
  commissions,
  partners,
  cities,
  countries,
  images,
  leases,
  neighborhoods,
  properties,
  propertyAvailabilityWindows,
  reservations,
  propertyDocuments,
  propertyImages,
  regions,
  reviews,
} from '../../db/schema';

/**
 * Five bytes identifying this process, per the ObjectId layout.
 *
 * Per PROCESS, not per call: jest forks a worker per database and two workers
 * minting ids in the same second must not collide. Re-rolling it per call would
 * still be unique, but would put randomness ABOVE the counter in the string and
 * so destroy the ordering the layout otherwise gives.
 */
const PROCESS_RANDOM = randomBytes(5);

/** Seeded randomly, per the spec, so two processes do not start in step. */
let objectIdCounter = randomBytes(3).readUIntBE(0, 3);

/**
 * A fresh 24-char ObjectId hex — the id shape every pre-cutover row carries.
 *
 * Composed here rather than obtained from mongoose; see the module comment for
 * why, and for what is and is not asserted about the byte layout.
 */
export function objectIdHex(): string {
  const buffer = Buffer.alloc(12);
  buffer.writeUInt32BE(Math.floor(Date.now() / 1000), 0);
  PROCESS_RANDOM.copy(buffer, 4);
  objectIdCounter = (objectIdCounter + 1) % 0x1000000;
  buffer.writeUIntBE(objectIdCounter, 9, 3);
  return buffer.toString('hex');
}

/**
 * Empty every table these suites write, child-first so the RESTRICT foreign
 * keys are satisfied.
 */
export async function resetGeoTables(): Promise<void> {
  const db = getDb();
  // Leases before listings: `leases.property_id` is ON DELETE **RESTRICT** — a
  // signed tenancy contract is not a copy of an advertisement, so deleting the
  // listing under one RAISES. Same class as the `address_id` note below, and it
  // has to come first because a lease is what holds the listing down. The six
  // lease child tables need no line of their own: every one of them CASCADEs
  // from `leases`, so this single statement takes the co-tenants, the payment
  // schedule, the documents, the inspections and their findings with it.
  await db.delete(leases);
  // Reservations are the same shape as leases above and RESTRICT for the same
  // reason: a booking is a commitment against a listing, not a copy of it, so
  // deleting the listing under one RAISES. Any suite that seeds a reservation
  // would otherwise fail here rather than in its own fixture, which reads as a
  // mysterious teardown error two files away from the cause.
  await db.delete(reservations);
  // Listings next: `properties.address_id` is ON DELETE RESTRICT, so an
  // address delete with a listing still on it RAISES rather than cascading —
  // which is the constraint working, and would read here as a mysterious
  // teardown failure. The three property child tables go first in turn, because
  // `property_images.image_id` is RESTRICT against `images`.
  await db.delete(propertyImages);
  await db.delete(propertyDocuments);
  await db.delete(propertyAvailabilityWindows);
  await db.delete(properties);
  // Reviews before agencies AND before addresses. `reviews.address_id` is ON
  // DELETE RESTRICT too — the same class as `properties.address_id` above — and
  // a review is now a real row in several suites rather than a Mongo document,
  // so an address delete under one RAISES. Its two child tables
  // (`review_reports`, `review_helpful_votes`) both CASCADE from `reviews`, so
  // this single statement takes them with it.
  //
  // The failure this prevents is worth naming, because it does NOT look like a
  // missing delete: it surfaces in whichever OTHER file happens to share the
  // worker database and call `resetGeoTables` next, as a foreign-key error on a
  // table that file never touched. It is also invisible at high worker counts
  // and appears in CI at low ones, purely by how jest distributes files.
  await db.delete(reviews);
  await db.delete(agencies);
  await db.delete(addresses);
  await db.delete(neighborhoods);
  // `cities.cover_image_id` / `regions.cover_image_id` are ON DELETE SET NULL,
  // so images have to go before the rows that point at them only to avoid
  // leaving those columns pointing at nothing mid-cleanup; the order below
  // deletes the referencing rows first, which needs no such care.
  await db.delete(cities);
  await db.delete(regions);
  await db.delete(countries);
  await db.delete(images);
}

/**
 * Clear the partner program's own tables.
 *
 * SEPARATE from {@link resetGeoTables} rather than folded into it, because the
 * two answer different questions and a suite should say which it needs.
 *
 * **Call this BEFORE `resetGeoTables()`, not after.** Both of `commissions`'
 * references are ON DELETE **RESTRICT**, so a commission still standing makes
 * `delete from properties` RAISE — a commission is a booked payout, not a copy
 * of the listing that earned it. `partners` can go in the same breath because
 * `properties.sourced_by_partner_id` is SET NULL, which is the whole point of
 * that action: attribution is not ownership.
 *
 * The reason a suite needs this at all is worth stating: Postgres persists for
 * the whole jest WORKER, where the in-memory Mongo this replaced was wiped
 * between tests by a global `afterEach`. A partner-program suite that re-joins
 * the same Oxy user in two tests therefore meets the row the previous test
 * created — measured, as a points total of 200 where the test asserted 100,
 * which reads exactly like a broken idempotency guard and is not one.
 */
export async function resetPartnerTables(): Promise<void> {
  const db = getDb();
  await db.delete(commissions);
  await db.delete(partners);
}

export interface GeoChain {
  countryId: string;
  regionId: string;
  cityId: string;
}

/** Insert a country → region → city chain and return its ids. */
export async function seedGeoChain(options: {
  countryCode?: string;
  countryName?: string;
  regionName?: string;
  cityName?: string;
  propertiesCount?: number;
  latitude?: number;
  longitude?: number;
}): Promise<GeoChain> {
  const db = getDb();
  const [country] = await db
    .insert(countries)
    .values({
      id: objectIdHex(),
      code: options.countryCode ?? 'ES',
      name: options.countryName ?? 'Spain',
    })
    .returning({ id: countries.id });
  const [region] = await db
    .insert(regions)
    .values({ id: objectIdHex(), countryId: country.id, name: options.regionName ?? 'Catalonia' })
    .returning({ id: regions.id });
  const [city] = await db
    .insert(cities)
    .values({
      id: objectIdHex(),
      countryId: country.id,
      regionId: region.id,
      name: options.cityName ?? 'Barcelona',
      propertiesCount: options.propertiesCount ?? 0,
      latitude: options.latitude ?? null,
      longitude: options.longitude ?? null,
    })
    .returning({ id: cities.id });
  return { countryId: country.id, regionId: region.id, cityId: city.id };
}

/** Insert an `entityType: 'city'` image and return its id. */
export async function seedCityImage(cityId: string): Promise<string> {
  const url = 'https://api.homiio.test/api/images/file/test/medium.webp';
  const [image] = await getDb()
    .insert(images)
    .values({
      id: objectIdHex(),
      entityType: 'city',
      entityId: cityId,
      keysOriginal: 'city/o.jpg',
      keysSmall: 'city/s.webp',
      keysMedium: 'city/m.webp',
      keysLarge: 'city/l.webp',
      urlsOriginal: url,
      urlsSmall: url,
      urlsMedium: url,
      urlsLarge: url,
      format: 'webp',
      bytes: 1024,
      isPrimary: true,
    })
    .returning({ id: images.id });
  return image.id;
}

/** Insert an address in a geo chain and return its id. */
export async function seedAddress(options: {
  chain: GeoChain;
  street?: string;
  postalCode?: string;
  longitude?: number;
  latitude?: number;
  neighborhoodId?: string;
  countryCode?: string;
  number?: string;
  floor?: string;
}): Promise<string> {
  const [address] = await getDb()
    .insert(addresses)
    .values({
      id: objectIdHex(),
      countryId: options.chain.countryId,
      regionId: options.chain.regionId,
      cityId: options.chain.cityId,
      neighborhoodId: options.neighborhoodId ?? null,
      countryCode: options.countryCode ?? 'ES',
      street: options.street ?? 'Carrer de Test',
      postalCode: options.postalCode ?? '08001',
      number: options.number ?? null,
      floor: options.floor ?? null,
      longitude: options.longitude ?? 2.17,
      latitude: options.latitude ?? 41.38,
    })
    .returning({ id: addresses.id });
  return address.id;
}

/** Insert a neighborhood in a city and return its id. */
export async function seedNeighborhood(options: {
  cityId: string;
  name: string;
  latitude?: number;
  longitude?: number;
}): Promise<string> {
  const [neighborhood] = await getDb()
    .insert(neighborhoods)
    .values({
      id: objectIdHex(),
      cityId: options.cityId,
      name: options.name,
      latitude: options.latitude ?? null,
      longitude: options.longitude ?? null,
    })
    .returning({ id: neighborhoods.id });
  return neighborhood.id;
}

// ── Listings ──
//
// Both halves of the listing path — the catalogue read AND the write behind
// `controllers/property/` — are Postgres, so this is the only store a listing
// fixture has. It was not always: suites used to seed a listing on BOTH sides
// against one id, and a fixture doing that today would be writing a document
// nothing reads.

/**
 * Insert a listing on an address and return its id.
 *
 * `idShape` decides which of the two live id shapes the row gets, and BOTH are
 * needed by tests: `objectId` is what every pre-cutover row carries (copied
 * verbatim from Mongo, and addressable from a Mongo-side write), `generated`
 * lets the column default mint a uuid v7 — what a listing created after the
 * cutover will carry, and the shape the deleted `ObjectId.isValid` guards used
 * to silently drop.
 */
export async function seedProperty(options: {
  addressId: string;
  id?: string;
  idShape?: 'objectId' | 'generated';
  overrides?: Partial<typeof properties.$inferInsert>;
}): Promise<string> {
  const id = options.id ?? (options.idShape === 'generated' ? undefined : objectIdHex());
  const [row] = await getDb()
    .insert(properties)
    .values({
      ...(id === undefined ? {} : { id }),
      addressId: options.addressId,
      ...options.overrides,
    })
    .returning({ id: properties.id });
  return row.id;
}

/**
 * Attach a photo to a listing.
 *
 * Inserts the canonical `images` row too: `property_images.image_id` is
 * `NOT NULL` with an `ON DELETE RESTRICT` foreign key, so a photo reference
 * cannot exist without one. `has_images` is then re-derived rather than passed
 * in, because `db/hasImages.ts` is the only writer of that column and a fixture
 * that set it by hand could seed a listing whose flag disagrees with its rows —
 * which is the exact defect production already holds one of.
 */
export async function seedPropertyImage(options: {
  propertyId: string;
  url?: string;
  isPrimary?: boolean;
  order?: number;
}): Promise<string> {
  const db = getDb();
  const url = options.url ?? 'https://api.homiio.test/api/images/file/listing/medium.webp';
  const [image] = await db
    .insert(images)
    .values({
      id: objectIdHex(),
      entityType: 'property',
      entityId: options.propertyId,
      keysOriginal: 'listing/o.jpg',
      keysSmall: 'listing/s.webp',
      keysMedium: 'listing/m.webp',
      keysLarge: 'listing/l.webp',
      urlsOriginal: url,
      urlsSmall: url,
      urlsMedium: url,
      urlsLarge: url,
      format: 'webp',
      bytes: 2048,
    })
    .returning({ id: images.id });

  const [reference] = await db
    .insert(propertyImages)
    .values({
      id: objectIdHex(),
      propertyId: options.propertyId,
      imageId: image.id,
      url,
      urlsOriginal: url,
      urlsSmall: url,
      urlsMedium: url,
      urlsLarge: url,
      isPrimary: options.isPrimary ?? false,
      order: options.order ?? 0,
    })
    .returning({ id: propertyImages.id });

  await syncHasImages(db, options.propertyId);
  return reference.id;
}

/**
 * The whole chain a listing needs, in one call: country → region → city →
 * address → property.
 *
 * Most suites want a listing SOMEWHERE and do not care where; this saves them
 * three lines each and keeps the coordinates in one place, so a suite that DOES
 * care about position states it explicitly and stands out.
 */
export async function seedListingWithGeo(options: {
  cityName?: string;
  regionName?: string;
  countryCode?: string;
  longitude?: number;
  latitude?: number;
  street?: string;
  overrides?: Partial<typeof properties.$inferInsert>;
} = {}): Promise<{ chain: GeoChain; addressId: string; propertyId: string }> {
  const chain = await seedGeoChain({
    cityName: options.cityName,
    regionName: options.regionName,
    countryCode: options.countryCode,
  });
  const addressId = await seedAddress({
    chain,
    street: options.street,
    countryCode: options.countryCode,
    longitude: options.longitude,
    latitude: options.latitude,
  });
  const propertyId = await seedProperty({ addressId, overrides: options.overrides });
  return { chain, addressId, propertyId };
}

/**
 * Mirror an agency into Postgres under a given id.
 *
 * `properties.agency_id` is a REAL foreign key (migration 0003), so a listing
 * cannot name an agency that only exists in Mongo. Suites that create an agency
 * through `Agency.findOrCreateByName` — still the WRITE path — pass its `_id`
 * here so the same id resolves on both sides, which is exactly what the
 * verbatim-id rule buys.
 */
export async function seedAgency(options: {
  id: string;
  name: string;
  normalizedName?: string;
  slug?: string;
}): Promise<string> {
  const [row] = await getDb()
    .insert(agencies)
    .values({
      id: options.id,
      name: options.name,
      normalizedName: options.normalizedName ?? options.name.toLowerCase(),
      slug: options.slug ?? options.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    })
    .returning({ id: agencies.id });
  return row.id;
}

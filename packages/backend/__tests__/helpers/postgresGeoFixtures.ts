/**
 * Postgres geo fixtures for the batch-1 suites.
 *
 * ## Ids are 24-char ObjectId hex, deliberately
 *
 * `generatedId()` mints a uuid v7 for a row created by the application, and the
 * backfill copies each Mongo `_id` VERBATIM — so after the cutover both shapes
 * are live in the same column. During the migration there is a third fact these
 * fixtures have to respect: the property WRITE path is still Mongoose, and a
 * Mongo `ObjectId` path cannot hold a uuid. Seeding 24-hex ids is therefore not
 * a convenience, it is the only shape that reproduces what production will
 * actually contain when a Postgres address id meets a Mongo `Property.addressId`
 * — and it is what lets a suite seed a listing HERE and still address it by the
 * same id through a Mongo-side write.
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

import { Types } from 'mongoose';

import { getDb } from '../../db/postgres';
import { syncHasImages } from '../../db/hasImages';
import {
  addresses,
  agencies,
  cities,
  countries,
  images,
  leases,
  neighborhoods,
  properties,
  propertyAvailabilityWindows,
  propertyDocuments,
  propertyImages,
  regions,
} from '../../db/schema';

/** A fresh 24-char ObjectId hex — the id shape every pre-cutover row carries. */
export function objectIdHex(): string {
  return new Types.ObjectId().toHexString();
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
  // Listings next: `properties.address_id` is ON DELETE RESTRICT, so an
  // address delete with a listing still on it RAISES rather than cascading —
  // which is the constraint working, and would read here as a mysterious
  // teardown failure. The three property child tables go first in turn, because
  // `property_images.image_id` is RESTRICT against `images`.
  await db.delete(propertyImages);
  await db.delete(propertyDocuments);
  await db.delete(propertyAvailabilityWindows);
  await db.delete(properties);
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
// The catalogue read path reads Postgres, so a suite that asserts what an
// endpoint RETURNS has to seed here. Suites that assert what a WRITE does still
// seed Mongo, because writes have not moved — several files legitimately do
// both, against the same id.

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

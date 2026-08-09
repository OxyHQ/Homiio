/**
 * The predicates every property read is assembled from.
 *
 * Six controllers used to build the same clauses independently as Mongo filter
 * objects, and the duplication cost real bugs — the `excludeIds` filter alone
 * had been copy-pasted into four places, each silently dropping any id that was
 * not a 24-char hex, which post-cutover means every uuid v7 in an exclude list
 * (see `db/ids.ts`). Here each clause is written once and the id-shape test is
 * simply gone: a `text` column takes any string, so an id that matches nothing
 * excludes nothing, which is what the filter meant all along.
 *
 * Everything returns `SQL | undefined`, so a caller can build its list with the
 * same one-clause-at-a-time style the Mongo code used and hand the result to
 * `allOf`.
 *
 * ## Two ports that are NOT literal, and why each is better
 *
 *  - **`hasPhotos`** was `{ 'images.url': { $exists: true, $nin: [null, ''] } }`
 *    — a probe into a denormalized copy of the photo list. It is now
 *    `has_images`, the column the schema keeps precisely to answer this
 *    question and the leading column of the feed's index. They differ only for a
 *    listing whose every photo row carries a NULL url, and having the FILTER and
 *    the SORT read the same fact is worth more than reproducing a `$exists` on a
 *    copy.
 *  - **Free text** was a Mongo `$text` search, which ORs its terms: "apartment
 *    barcelona" returned every apartment anywhere. {@link matchesText} uses
 *    `websearch_to_tsquery`, which ANDs them and understands quoted phrases and
 *    an explicit `or`. This is a deliberate narrowing of a search box that was
 *    too broad to be useful, not an accident of the port.
 */

import { and, eq, gte, inArray, isNull, lte, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { qualified } from '../casing';
import { escapeLikePattern } from '../likePattern';
import { TEXT_SEARCH_CONFIGURATION } from '../extensions';
import { addresses, properties, propertyAvailabilityWindows, reservations } from '../schema';

/** Never surface a soft-deleted (archived) listing. */
export function notDeleted(): SQL {
  return isNull(properties.deletedAt);
}

/**
 * Never surface a listing a community jury has restricted.
 *
 * Mongo needed `$ne: true` here, because `moderation` was a late addition and is
 * absent on 17,642 of 17,644 rows — `{ restricted: false }` would have matched a
 * stored `false` and NOT a missing field, hiding the entire catalogue. The
 * column is `NOT NULL DEFAULT false`, so absence is not representable and plain
 * equality is exact. The trap did not survive the port; the rule did.
 */
export function notModerationRestricted(): SQL {
  return eq(properties.moderationRestricted, false);
}

export function ownedBy(oxyUserId: string): SQL {
  return eq(properties.oxyUserId, oxyUserId);
}

export function statusIs(status: string): SQL {
  return sql`${properties.status} = ${status}`;
}

export function statusIsNot(status: string): SQL {
  return sql`${properties.status} <> ${status}`;
}

export function isAvailable(available: boolean): SQL {
  return eq(properties.availabilityIsAvailable, available);
}

/**
 * One type, or any of several.
 *
 * The list is BOUND as a parameter, never interpolated into the statement text.
 * These values reach here from a query string; a `sql.raw` array literal built
 * from them would be an injection point, and quoting it by hand would be a
 * second escaping implementation to get wrong.
 *
 * **`sql.param` is required and is not decoration.** A bare `${array}` inside a
 * `sql` template renders as a ROW CONSTRUCTOR — `($1, $2)` — not as an array
 * parameter, so `${array}::text[]` emits `($1, $2)::text[]`, which Postgres
 * rejects outright (a record cannot be cast to `text[]`). `sql.param` binds the
 * whole array as ONE parameter, `$1`, which postgres.js serializes as a real
 * Postgres array. The same applies to every array predicate below; it is a
 * runtime error rather than a type error, which is why the integration suite
 * exercises each of them against a real server.
 */
export function typeIn(types: readonly string[]): SQL | undefined {
  if (types.length === 0) return undefined;
  if (types.length === 1) return sql`${properties.type} = ${types[0]}`;
  return sql`${properties.type} = any(${sql.param([...types])}::text[])`;
}

/** A listing carrying this offering. `offerings` is an array, so this is membership. */
export function hasOffering(offering: string): SQL {
  return sql`${offering} = any(${properties.offerings})`;
}

/**
 * An exchange listing offering any of these modes.
 *
 * A `both` listing matches a swap request and a host request alike, which is
 * why the caller passes a LIST rather than a single mode.
 */
export function exchangeModeIn(modes: readonly string[]): SQL | undefined {
  if (modes.length === 0) return undefined;
  return sql`${properties.exchangeMode} = any(${sql.param([...modes])}::text[])`;
}

/**
 * `column = value` on a boolean column.
 *
 * `= false` deliberately does NOT match a NULL, and three of the columns this is
 * applied to are genuinely three-state: `short_term_rent_instant_book` is null
 * when there is no short-term block, and `price_ethics_is_fair_price` is null
 * until the listing has been scored. A caller asking for `instantBook=false`
 * wants listings that say so, not listings nobody has answered for.
 */
export function booleanIs(column: AnyPgColumn, value: boolean): SQL {
  return sql`${column} = ${value}`;
}

/** Any of the requested amenities (the list feed's `$in`). */
export function hasAnyAmenity(amenities: readonly string[]): SQL | undefined {
  if (amenities.length === 0) return undefined;
  return sql`${properties.amenities} && ${sql.param([...amenities])}::text[]`;
}

/** All of the requested amenities (the search endpoint's `$all`). */
export function hasAllAmenities(amenities: readonly string[]): SQL | undefined {
  if (amenities.length === 0) return undefined;
  return sql`${properties.amenities} @> ${sql.param([...amenities])}::text[]`;
}

/** An inclusive range on a numeric column; `undefined` when neither bound is set. */
export function inRange(
  column: AnyPgColumn,
  min: number | undefined,
  max: number | undefined,
): SQL | undefined {
  const bounds: SQL[] = [];
  if (min !== undefined) bounds.push(gte(column, min));
  if (max !== undefined) bounds.push(lte(column, max));
  if (bounds.length === 0) return undefined;
  return bounds.length === 1 ? bounds[0] : and(...bounds);
}

/** An inclusive range on a timestamp column. */
export function inDateRange(
  column: AnyPgColumn,
  after: Date | undefined,
  before: Date | undefined,
): SQL | undefined {
  const bounds: SQL[] = [];
  if (after !== undefined) bounds.push(gte(column, after));
  if (before !== undefined) bounds.push(lte(column, before));
  if (bounds.length === 0) return undefined;
  return bounds.length === 1 ? bounds[0] : and(...bounds);
}

export function idIn(ids: readonly string[]): SQL | undefined {
  if (ids.length === 0) return undefined;
  return inArray(properties.id, [...ids]);
}

/**
 * Exclude a set of listings.
 *
 * No id-shape filter, deliberately — that is the fail-open bug this port
 * deletes. An id of any shape that matches no row excludes no row, which is
 * exactly what the caller asked for.
 */
export function idNotIn(ids: readonly string[]): SQL | undefined {
  if (ids.length === 0) return undefined;
  return notInArray(properties.id, [...ids]);
}

/** At least one photo. See the module doc for why this reads `has_images`. */
export function hasPhotos(): SQL {
  return eq(properties.hasImages, true);
}

/** Listings furnished to the given degree — the room feed's own filter. */
export function furnishedStatusIs(furnishedStatus: string): SQL {
  return eq(properties.furnishedStatus, furnishedStatus as 'furnished');
}

/**
 * The rooms (or sub-listings) belonging to one parent listing.
 *
 * `parent_property_id` is a SELF reference, so this is the predicate behind
 * both the room feed and the parent listing's own room statistics.
 */
export function childrenOf(parentPropertyId: string): SQL {
  return eq(properties.parentPropertyId, parentPropertyId);
}

// ── Address-scoped predicates ──
//
// These reference `addresses`, which every read in `propertyReads` inner-joins.
// They are what the two-phase `Address.find(...).select('_id')` → `$in` became.

export function addressIs(addressId: string): SQL {
  return eq(properties.addressId, addressId);
}

/** Listings the given agency manages. */
export function ofAgency(agencyId: string): SQL {
  return eq(properties.agencyId, agencyId);
}

export function inCity(cityId: string): SQL {
  return eq(addresses.cityId, cityId);
}

export function inRegion(regionId: string): SQL {
  return eq(addresses.regionId, regionId);
}

export function inNeighborhood(neighborhoodId: string): SQL {
  return eq(addresses.neighborhoodId, neighborhoodId);
}

export function inCountry(countryCode: string): SQL {
  return eq(addresses.countryCode, countryCode.toUpperCase());
}

// ── Free text ──

/** The parsed query a text search matches and ranks against. */
function textQuery(term: string): SQL {
  return sql`websearch_to_tsquery(${TEXT_SEARCH_CONFIGURATION}, ${term})`;
}

/**
 * Match a free-text term against the listing text OR the place it is in.
 *
 * The location half used to resolve to an address-id list and match
 * `addressId IN (…)` — the same uncapped materialization `propertyGeo.ts`
 * describes, run once per term. Here the caller resolves the term to a CITY and
 * REGION id (two indexed single-row lookups through `geoQueryService`) and the
 * membership becomes an ordinary column comparison on the already-joined
 * address.
 *
 * `street` stays an `ILIKE` because it is free text on the address itself, and
 * it goes through {@link escapeLikePattern} — a user typing `100%` must match
 * the literal string, not "anything after 100".
 */
export function matchesText(
  term: string,
  place: { cityId?: string | null; regionId?: string | null } = {},
): SQL {
  const branches: SQL[] = [
    sql`${properties.searchVector} @@ ${textQuery(term)}`,
    sql`${addresses.street} ilike ${`%${escapeLikePattern(term)}%`}`,
  ];
  if (place.cityId) branches.push(eq(addresses.cityId, place.cityId));
  if (place.regionId) branches.push(eq(addresses.regionId, place.regionId));
  // `or` over a non-empty list always returns a clause; the non-null assertion
  // the compiler would otherwise want is avoided by the explicit fallback.
  return or(...branches) ?? branches[0];
}

/** Relevance score for a text term — the port of Mongo's `{ $meta: 'textScore' }`. */
export function textRank(term: string): SQL<number> {
  return sql<number>`ts_rank(${properties.searchVector}, ${textQuery(term)})`;
}

// ── Calendar availability ──

/**
 * Exclude listings whose host calendar blocks the requested stay.
 *
 * The port of `$nor: [{ availabilityWindows: { $elemMatch: { status != available,
 * start < checkOut, end > checkIn } } }]`. `tstzrange(a, b)` defaults to `[)`
 * bounds — inclusive start, exclusive end — which is both the contract in
 * `shared-types` and exactly the `start < checkOut AND end > checkIn` test Mongo
 * spelled out, so adjacent stays still do not collide. The GiST index over that
 * expression answers `&&` directly.
 *
 * `qualified` on the correlated reference is not optional: a drizzle column
 * interpolated into a subquery renders BARE when its table is not in the
 * subquery's own `FROM`, so `${properties.id}` would emit `"id"` and resolve
 * against `property_availability_windows` — comparing two of its own columns,
 * matching nothing, and raising no error at all.
 *
 * **`.toISOString()` on the bounds is load-bearing, and the cast alone is not
 * enough.** A `Date` interpolated into a `sql` template inside `tstzrange()`
 * never reaches Postgres: postgres.js has no column to infer the type from,
 * falls back to serializing the value as text, and throws
 * `The "string" argument must be of type string ... Received an instance of
 * Date` in Node. That made EVERY dated availability request a 500 — measured
 * against a real server, and adding `::timestamptz` did NOT fix it, because the
 * failure happens in the driver before any cast is parsed. No test covered the
 * dated path, so nothing reported it. An explicit ISO string plus the cast is
 * what makes the bound unambiguous on both sides.
 */
/**
 * Listings with no CONFIRMED reservation overlapping the stay.
 *
 * The other half of availability, and the half that fails DANGEROUSLY. The
 * Mongo version this replaces read `Reservation.find({...}).select('propertyId')`
 * into an id list and pushed `idNotIn(...)` — but only `if (ids.length > 0)`.
 * Once `reservations` moved to Postgres that read returned nothing, the guard
 * skipped the exclusion entirely, and every booked listing was reported free.
 * An availability check that sees no bookings does not error, it APPROVES: the
 * wrong answer is the successful-looking one, and a double booking is the
 * result.
 *
 * A `NOT EXISTS` rather than an id list, matching {@link calendarIsFree}. The
 * id-list form also loaded EVERY confirmed reservation in the system into an
 * uncapped `$in` to answer a question about one page of listings.
 *
 * `[)` bounds via `tstzrange`, so a checkout and the next checkin on the same
 * day do not collide — the same `checkIn < checkOut AND checkOut > checkIn`
 * test Mongo spelled out, and the same convention the calendar half uses.
 *
 * `qualified` on the correlated reference is not optional, for the reason
 * {@link calendarIsFree} records: a drizzle column interpolated into a subquery
 * renders BARE when its table is not in the subquery's own `FROM`, so
 * `${properties.id}` would emit `"id"`, resolve against `reservations`, compare
 * that table's own id to itself, match every row, and exclude every listing —
 * silently and with no error.
 */
export function noConfirmedReservationOverlaps(checkIn: Date, checkOut: Date): SQL {
  return sql`not exists (
    select 1 from ${reservations}
    where ${reservations.propertyId} = ${qualified(properties.id)}
      and ${reservations.status} = 'confirmed'
      and tstzrange(${reservations.checkIn}, ${reservations.checkOut})
          && tstzrange(${checkIn.toISOString()}::timestamptz, ${checkOut.toISOString()}::timestamptz)
  )`;
}

export function calendarIsFree(checkIn: Date, checkOut: Date): SQL {
  return sql`not exists (
    select 1 from ${propertyAvailabilityWindows}
    where ${propertyAvailabilityWindows.propertyId} = ${qualified(properties.id)}
      and ${propertyAvailabilityWindows.scope} = 'listing'
      and ${propertyAvailabilityWindows.status} <> 'available'
      and tstzrange(${propertyAvailabilityWindows.startsAt}, ${propertyAvailabilityWindows.endsAt})
          && tstzrange(${checkIn.toISOString()}::timestamptz, ${checkOut.toISOString()}::timestamptz)
  )`;
}

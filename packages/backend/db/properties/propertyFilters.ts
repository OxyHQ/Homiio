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

import { and, eq, gt, gte, inArray, isNull, lte, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import type { HousingFeature } from '@homiio/shared-types';

import { qualified } from '../casing';
import { escapeLikePattern } from '@oxy.so/utils/sql';
import { TEXT_SEARCH_CONFIGURATION } from '../extensions';
import { addresses, exchangeRequests, properties, propertyAvailabilityWindows, reservations } from '../schema';

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

/**
 * The two statuses that hide a listing from everybody except its owner.
 *
 * Neither is redundant with {@link notDeleted}, and the second is the one that
 * surprises: `softDeleteProperty` sets `status = 'archived'` AND stamps
 * `deleted_at`, so a user-deleted listing is caught by either clause — but
 * `expireExternalProperty` archives a lapsed portal listing by STATUS ALONE,
 * leaving `deleted_at` null. A read that gated only on `deleted_at` would
 * therefore keep serving every expired external listing in the catalogue.
 *
 * `draft` is the other half and the more obvious one: a listing its owner has
 * never published is theirs alone to see.
 *
 * The remaining five (`published`, `reserved`, `rented`, `sold`, `inactive`)
 * are all states of a listing that really was published, so a caller that
 * already holds the id may see it — see the header of
 * `controllers/property/batch.ts` for why a hydration read wants that and a
 * discovery feed does not.
 */
export function statusVisibleToNonOwner(): SQL {
  return notInArray(properties.status, ['draft', 'archived']);
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

/**
 * All of the requested amenities — the ONE amenity reading of every catalogue
 * feed. The list feed and `/rooms` used to match ANY (Mongo's `$in`), so a
 * multi-select widened with each chip instead of narrowing.
 */
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

/**
 * An inclusive price range, IN ONE CURRENCY.
 *
 * ## Why the currency is not optional
 *
 * `inRange` compares a bare number against a price column, and the column holds
 * whatever the listing was advertised in. Homiio ingests from portals across
 * several markets and production carries six different codes in
 * `long_term_rent_currency` alone, so `priceMax=1200` was matching 1,200 zł and
 * 1,200 RON beside 1,200 euros as though they were one amount. Nothing threw;
 * the results just quietly answered a different question from the one asked.
 *
 * There is no conversion here and there must not be: a rate Homiio cannot cite
 * or version turns a filter into an invented price, which is what ADR 0004
 * forbids (the histogram has refused to mix currencies since it shipped, for
 * the same reason). A bound applies to the listings priced in the currency it
 * was expressed in, and the caller is told which one that was.
 *
 * ## A missing currency is not a match
 *
 * `currency is null` means the listing has a price and nobody recorded its
 * unit. That is EXCLUDED rather than assumed, the same rule `areaInRange` uses
 * for an area stored as `0`: "unknown" is not an answer to a question about an
 * amount, and guessing turns one unfilled column into a wrong result.
 */
export function priceInRange(
  priceColumn: AnyPgColumn,
  currencyColumn: AnyPgColumn,
  min: number | undefined,
  max: number | undefined,
  currency: string,
): SQL | undefined {
  const range = inRange(priceColumn, min, max);
  if (!range) return undefined;
  return and(eq(currencyColumn, currency), range);
}

/**
 * Listings on a given floor — and only those that PUBLISH one.
 *
 * ## Two rules, and the second is the one that is easy to miss
 *
 * **Unknown is not a match.** `floor` is NULL when nobody said, so a bound over
 * it excludes those rows for free: `floor = 0` is NULL for a NULL floor, which
 * is not TRUE. That works only because the column stopped being
 * `NOT NULL DEFAULT 0` (migration 0024) — before it, every listing nobody had
 * filled in claimed the ground floor, and "ground floor" matched the catalogue.
 *
 * **A floor that is not published may not be filtered on either.** The
 * serializer withholds `floor` below `exact` precision because the floor is
 * part of the address (ADR 0003). A filter with no such rule would hand the
 * same fact back through a different door: ask for floor 3 inside a small
 * enough area and the RESULT SET tells you the floor of a listing whose payload
 * refused to. Narrowing the query to what the row publishes is what keeps the
 * two doors agreeing.
 *
 * The predicate mirrors `publishedAddressPrecision` in
 * `db/properties/propertySerializer.ts`, which resolves the public ceiling from
 * BOTH columns — `show_address_number = false` caps it at `street`, which is
 * coarser than `exact`. One rule in two languages is the shape a rule drifts
 * in, and drift is silent both ways: too permissive starts revealing floors the
 * payload withholds, too strict starts dropping listings from a filter with
 * nothing to show for it.
 *
 * `__tests__/integration/floorFilter.test.ts` holds it still by seeding a
 * listing for each combination that matters — including one at `exact`
 * precision whose street number is hidden, which is the case a predicate
 * reading only the precision column would get wrong while every other
 * assertion still passed.
 */
export function publishesFloor(): SQL {
  return and(
    eq(properties.addressPublishedPrecision, 'exact'),
    eq(properties.showAddressNumber, true),
  ) as SQL;
}

/**
 * An inclusive floor range over the listings that publish their floor.
 *
 * `undefined` on both sides is no filter at all — including no precision
 * narrowing, because a search nobody asked to narrow must not quietly lose
 * every listing that keeps its floor to itself.
 */
export function floorInRange(min: number | undefined, max: number | undefined): SQL | undefined {
  const range = inRange(properties.floor, min, max);
  if (!range) return undefined;
  return and(publishesFloor(), range);
}

/**
 * One housing feature, as a predicate over the column that records it.
 *
 * Only the five with a column reach here — `HOUSING_FEATURE_SOURCE` in
 * `shared-types` decides which those are, and the other six become amenity
 * slugs the caller folds into `hasAllAmenities`. The split is made there so
 * this function and the chip list cannot disagree about what "garden" means.
 *
 * `parking` and `furnished` are not booleans and each has a value that means
 * "no": `parking_type = 'none'` and the two furnishing states that are an
 * absence or a silence. Treating either as a mere non-null would return every
 * listing, which is the shape of an unfiltered result wearing a filter's name.
 */
export function featureColumnCondition(feature: HousingFeature): SQL | undefined {
  switch (feature) {
    case 'elevator':
      return eq(properties.hasElevator, true);
    case 'garden':
      return eq(properties.hasGarden, true);
    case 'pets':
      return eq(properties.petFriendly, true);
    case 'parking':
      // Any arrangement that is not "there is none" — street, assigned, garage.
      return ne(properties.parkingType, 'none');
    case 'furnished':
      // `partially_furnished` counts: somebody filtering for furnished wants a
      // home they can move into, and a half-furnished one is an answer they can
      // judge. `not_specified` does NOT — an unstated fact is not a yes.
      return inArray(properties.furnishedStatus, ['furnished', 'partially_furnished']);
    default:
      // The amenity-backed six. Reaching here means the mapping and this switch
      // have drifted, and answering `undefined` would silently widen the search
      // rather than narrow it — so it is the caller's job never to ask.
      return undefined;
  }
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
 * Exclude listings whose host calendar blocks the requested stay, in EITHER
 * scope — a fortnight the host closed on their exchange calendar is a fortnight
 * nobody sleeps there, and `db/availability/occupancy.ts` refuses a booking in
 * it, so a feed that still offered it would be advertising a 409.
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
      and ${propertyAvailabilityWindows.status} <> 'available'
      and tstzrange(${propertyAvailabilityWindows.startsAt}, ${propertyAvailabilityWindows.endsAt})
          && tstzrange(${checkIn.toISOString()}::timestamptz, ${checkOut.toISOString()}::timestamptz)
  )`;
}

/**
 * Listings with no CONFIRMED home exchange over the stay, in EITHER role.
 *
 * The third thing that occupies a home, and until now the one the feed could
 * not see: a dated search excluded booked homes and blocked calendars and
 * happily offered a home already committed to a swap — which the booking path
 * then refuses with a 409, after somebody has chosen it.
 *
 * BOTH roles, for the reason `db/exchanges/exchangeReads.ts` records: a swap
 * commits the home being visited AND the home offered in return, and a scan
 * that checked only `property_id` would show the second as free.
 *
 * `qualified` on the correlated reference is not optional, for the reason
 * {@link calendarIsFree} records.
 */
export function noConfirmedExchangeOverlaps(checkIn: Date, checkOut: Date): SQL {
  const start = checkIn.toISOString();
  const end = checkOut.toISOString();
  return sql`not exists (
    select 1 from ${exchangeRequests}
    where ${exchangeRequests.status} = 'confirmed'
      and (
        (
          ${exchangeRequests.propertyId} = ${qualified(properties.id)}
          and tstzrange(${exchangeRequests.requestedWindowStart}, ${exchangeRequests.requestedWindowEnd})
              && tstzrange(${start}::timestamptz, ${end}::timestamptz)
        )
        or (
          ${exchangeRequests.offeredPropertyId} = ${qualified(properties.id)}
          and tstzrange(${exchangeRequests.offeredWindowStart}, ${exchangeRequests.offeredWindowEnd})
              && tstzrange(${start}::timestamptz, ${end}::timestamptz)
        )
      )
  )`;
}

/**
 * A floor-area range in SQUARE METRES, where "unknown" never matches.
 *
 * ## The column's name lies, and the unit is worth stating twice
 *
 * `properties.square_footage` holds SQUARE METRES. The name is a legacy
 * misnomer carried through the Mongo port; every reader confirms the unit —
 * `PropertyCard` and `RoomList` render it with `formatArea(..., 'sqm', ...)`,
 * and `pricePerSqm` is derived from it. A filter that assumed square feet would
 * return homes three times the size somebody asked for, and nothing would throw.
 *
 * ## Why a maximum has to exclude zero
 *
 * The column is `NOT NULL DEFAULT 0`, so a listing whose area nobody filled in
 * is stored as `0` — indistinguishable from a genuine zero, which does not
 * exist. A bare `square_footage <= 120` therefore matches EVERY listing with no
 * area at all, and "homes up to 120 m²" silently becomes "homes up to 120 m²,
 * plus everything we do not know the size of", which is most of an ingested
 * feed. That is the plausible-looking failure: the results look like results.
 *
 * So a maximum also requires `> 0`. A MINIMUM needs no such guard — `0 >= 40`
 * is already false — but the guard is applied to both ends anyway, because
 * "unknown is not an answer to a question about size" is one rule and a reader
 * should not have to work out that one end enforces it accidentally.
 */
export function areaInRange(
  min: number | undefined,
  max: number | undefined,
): SQL | undefined {
  if (min === undefined && max === undefined) return undefined;
  const bounds: SQL[] = [gt(properties.squareFootage, 0)];
  if (min !== undefined) bounds.push(gte(properties.squareFootage, min));
  if (max !== undefined) bounds.push(lte(properties.squareFootage, max));
  return and(...bounds);
}

/**
 * Free to move into by a given day.
 *
 * ## Which of the two availability columns this reads, and why it is a decision
 *
 * `properties` carries BOTH `available_from` and `availability_available_from`,
 * and the schema records that they disagree on 1,630 rows (9.2%) and that which
 * one wins "is a code reading, not a schema decision, and it has not been made
 * yet".
 *
 * This makes it, for the search path, by reading `available_from` — the column
 * `controllers/property/commonFilters.ts` already filters on for `/properties`.
 * The choice is consistency rather than a claim that this column is the better
 * fact: two filter paths reading different columns would answer the same
 * question differently depending on which endpoint a screen happened to call,
 * and 1,630 listings would move between them for no reason a user could see.
 *
 * Collapsing the two columns remains open. When it is decided, this function
 * and `commonFilters` change together, which is the point of them agreeing now.
 */
export function availableBy(date: Date): SQL {
  return lte(properties.availableFrom, date);
}

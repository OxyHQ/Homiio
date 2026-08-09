/**
 * The filter block the list feed and the two proximity feeds share.
 *
 * These ~30 clauses were written out THREE times — once in `list.ts` and twice
 * in `geospatial.ts` — as byte-identical copies. That is where two of the four
 * copies of the `excludeIds` id-shape bug lived (`db/ids.ts`), and it is why a
 * fix to one feed historically did not reach the others.
 *
 * ## What is deliberately NOT here
 *
 * **Status, and the price range.** They look shared and are not:
 *
 *  - `list.ts` lets a `status` query value through for any spelling and then
 *    OVERWRITES it with `status <> 'draft'` whenever no explicit `status` was
 *    given — so `?available=true` yields "available, not a draft".
 *    `geospatial.ts` maps only seven known spellings and KEEPS the mapped value
 *    — so the same `?available=true` yields "available, published".
 *  - `list.ts` applies `minRent`/`maxRent` to the price column of the REQUESTED
 *    offering; `geospatial.ts` always applies it to monthly rent.
 *
 * Both differences are real and observable, and neither is this port's to
 * resolve. Sharing the clauses that genuinely agree and leaving these two with
 * their callers is what keeps that visible instead of silently picking one.
 */

import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { properties } from '../../db/schema';
import {
  booleanIs,
  hasAnyAmenity,
  hasPhotos,
  idNotIn,
  inDateRange,
  inRange,
  notDeleted,
  notModerationRestricted,
  typeIn,
} from '../../db/properties/propertyFilters';
import { getQueryString } from '../queryParams';

type RawQuery = Record<string, unknown>;

/** A finite number from a query param, or undefined. */
function num(value: unknown): number | undefined {
  const raw = getQueryString(value);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** A `Date` from a query param, or undefined when absent or unparseable. */
function date(value: unknown): Date | undefined {
  const raw = getQueryString(value);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * The literal `'true'` only.
 *
 * Three of these params were written `x === 'true'` in the original and three
 * were written `String(x) === 'true'`; both mean the same thing, and both mean
 * that any other value reads as ABSENT rather than as false.
 */
function isTrue(value: unknown): boolean {
  return getQueryString(value) === 'true';
}

/** A tri-state flag: `'true'`/`'false'` decide, anything else leaves the filter off. */
function tristate(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  return getQueryString(value) === 'true';
}

/**
 * `column = value` for a closed-vocabulary text column.
 *
 * These six columns carry CHECK-constrained vocabularies, so a value outside the
 * set matches nothing — the same answer Mongo gave for an unknown value, and
 * without the enum-literal friction `eq` would impose on a value that arrives as
 * a bare query string.
 */
function textColumnIs(column: AnyPgColumn, value: string): SQL {
  return sql`${column} = ${value}`;
}

/** Build the clauses every one of these feeds applies identically. */
export function buildCommonPropertyFilters(query: RawQuery): (SQL | undefined)[] {
  const conditions: (SQL | undefined)[] = [
    // Public feed: never a soft-deleted listing, never one a jury restricted.
    notDeleted(),
    notModerationRestricted(),
  ];

  const type = getQueryString(query.type);
  if (type) conditions.push(typeIn([type]));

  // `minBedrooms`/`maxBedrooms` win over a bare `bedrooms`, which is an EXACT
  // match rather than a minimum — the one place in this file where a bare
  // parameter is not a lower bound.
  const minBedrooms = num(query.minBedrooms);
  const maxBedrooms = num(query.maxBedrooms);
  if (minBedrooms !== undefined || maxBedrooms !== undefined) {
    conditions.push(inRange(properties.bedrooms, minBedrooms, maxBedrooms));
  } else {
    const bedrooms = num(query.bedrooms);
    if (bedrooms !== undefined) conditions.push(inRange(properties.bedrooms, bedrooms, bedrooms));
  }

  const minBathrooms = num(query.minBathrooms);
  const maxBathrooms = num(query.maxBathrooms);
  if (minBathrooms !== undefined || maxBathrooms !== undefined) {
    conditions.push(inRange(properties.bathrooms, minBathrooms, maxBathrooms));
  } else {
    const bathrooms = num(query.bathrooms);
    if (bathrooms !== undefined) conditions.push(inRange(properties.bathrooms, bathrooms, bathrooms));
  }

  conditions.push(inRange(properties.squareFootage, num(query.minSquareFootage), num(query.maxSquareFootage)));
  conditions.push(inRange(properties.yearBuilt, num(query.minYearBuilt), num(query.maxYearBuilt)));

  const amenities = getQueryString(query.amenities);
  if (amenities) {
    conditions.push(hasAnyAmenity(amenities.split(',').map((a) => a.trim()).filter(Boolean)));
  }

  if (isTrue(query.hasPhotos)) conditions.push(hasPhotos());
  if (isTrue(query.verified)) conditions.push(booleanIs(properties.isVerified, true));
  if (isTrue(query.eco)) conditions.push(booleanIs(properties.isEcoFriendly, true));
  if (isTrue(query.fairPrice)) conditions.push(booleanIs(properties.priceEthicsIsFairPrice, true));

  const housingType = getQueryString(query.housingType);
  if (housingType) conditions.push(textColumnIs(properties.housingType, housingType));
  const layoutType = getQueryString(query.layoutType);
  if (layoutType) conditions.push(textColumnIs(properties.layoutType, layoutType));
  const furnishedStatus = getQueryString(query.furnishedStatus);
  if (furnishedStatus) conditions.push(textColumnIs(properties.furnishedStatus, furnishedStatus));
  const petPolicy = getQueryString(query.petPolicy);
  if (petPolicy) conditions.push(textColumnIs(properties.petPolicy, petPolicy));
  const leaseTerm = getQueryString(query.leaseTerm);
  if (leaseTerm) conditions.push(textColumnIs(properties.leaseTerm, leaseTerm));
  const parkingType = getQueryString(query.parkingType);
  if (parkingType) conditions.push(textColumnIs(properties.parkingType, parkingType));

  const petFriendly = tristate(query.petFriendly);
  if (petFriendly !== undefined) conditions.push(booleanIs(properties.petFriendly, petFriendly));
  const utilitiesIncluded = tristate(query.utilitiesIncluded);
  if (utilitiesIncluded !== undefined) conditions.push(booleanIs(properties.utilitiesIncluded, utilitiesIncluded));
  const proximityToTransport = tristate(query.proximityToTransport);
  if (proximityToTransport !== undefined) conditions.push(booleanIs(properties.proximityToTransport, proximityToTransport));
  const proximityToSchools = tristate(query.proximityToSchools);
  if (proximityToSchools !== undefined) conditions.push(booleanIs(properties.proximityToSchools, proximityToSchools));
  const proximityToShopping = tristate(query.proximityToShopping);
  if (proximityToShopping !== undefined) conditions.push(booleanIs(properties.proximityToShopping, proximityToShopping));

  conditions.push(inDateRange(properties.availableFrom, date(query.availableFromAfter), date(query.availableFromBefore)));

  const excludeIds = getQueryString(query.excludeIds);
  if (excludeIds) {
    // No id-SHAPE filter — see `db/properties/propertyFilters.idNotIn`. The two
    // copies of this that used to live in `geospatial.ts` each dropped anything
    // that was not a 24-char hex, so an excluded listing silently reappeared.
    conditions.push(idNotIn(excludeIds.split(',').map((id) => id.trim()).filter(Boolean)));
  }

  return conditions;
}


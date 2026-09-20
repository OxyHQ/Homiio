/**
 * Which clock does a viewing time refer to? (#518 §7.5, #519 §7.5)
 *
 * A viewing is agreed as "Tuesday at 10:00", which is a CIVIL time and not a
 * moment until some zone anchors it. `viewingController` used to anchor it with
 * `new Date(\`${date}T${time}\`)` — no offset, so parsed in whatever zone the
 * process runs in — and the client then rendered the result in the DEVICE's.
 * Three zones, none of them the home's, nothing reconciling them.
 *
 * ## What was actually checked before depending on anything
 *
 * `cities.timezone` is the only timezone column in the repository, so the
 * obvious fix is to read it. It was checked rather than assumed, and it does
 * not hold up as a basis:
 *
 *  - `services/addressService.ts#upsertCity` is the path a city is created by
 *    during ordinary address resolution — every listing whose city did not
 *    already exist — and its `insert(cities)` names `region_id`, `country_id`,
 *    `name`, `currency`, `is_active`, `longitude` and `latitude`. Not
 *    `timezone`.
 *  - The only two writers that DO set it are `scripts/seedGeo.ts`, which seeds
 *    six Spanish cities with `Europe/Madrid` hard-coded, and
 *    `cityController.createCity`, which copies it from the request body when an
 *    operator happens to send one.
 *
 * So the column is REAL where it is set and absent almost everywhere else. That
 * makes it a fallback and disqualifies it as the answer: a resolver that
 * silently returned the device's zone, or the server's, whenever the city had
 * none would be back to the bug, wearing a column name.
 *
 * Deriving the zone from `latitude`/`longitude` was also considered and
 * refused. It needs a timezone-boundary shapefile this repository does not
 * carry, and anything cheaper — a longitude band, a country guess — is a
 * plausible wrong answer of exactly the kind ADR 0002 forbids: it would place
 * a Madrid viewing in `Europe/Lisbon` for a listing 20 km west and nothing
 * would look wrong.
 *
 * ## So the owner states it, and the answer always says where it came from
 *
 * `properties.viewing_timezone` is the basis, `cities.timezone` the fallback,
 * and UTC the floor — and {@link ViewingTimeZoneResolution.source} travels all
 * the way to the wire. A surface can then say "times are shown in
 * Europe/Madrid", or admit that nobody has told Homiio which clock this home
 * runs on, instead of printing an unqualified "10:00" that means three
 * different moments to three readers.
 *
 * UTC as the floor is a CONVENTION, not a claim about the home: it is stated,
 * it is the same on every host and every device, and both sides of a request
 * agree on it. That is strictly more than the previous behaviour offered, where
 * the anchor was a property of the container.
 */

import { eq, inArray } from 'drizzle-orm';
import { isSupportedTimeZone, type ViewingTimeZoneSource } from '@homiio/shared-types';

import type { DatabaseOrTransaction } from '../postgres';
import { addresses, cities, properties } from '../schema';

/** The zone a listing's viewing times are expressed in, and who said so. */
export interface ViewingTimeZoneResolution {
  readonly timeZone: string;
  readonly source: ViewingTimeZoneSource;
}

/** The stated convention when nothing in the system knows. */
export const FALLBACK_VIEWING_TIME_ZONE = 'UTC';

/**
 * The zone `propertyId`'s viewing times are expressed in.
 *
 * One statement: the property, left-joined through its address to its city, so
 * a listing with no resolved city (or no city timezone) costs the same single
 * round trip as one that has both.
 *
 * A stored value that `Intl` does not recognise is treated as absent rather
 * than propagated. The column is validated on the way in, but a row written
 * before that validation existed — or by hand — must not be able to make every
 * slot query throw.
 */
export async function resolveViewingTimeZone(
  db: DatabaseOrTransaction,
  propertyId: string,
): Promise<ViewingTimeZoneResolution> {
  const [row] = await db
    .select({
      propertyTimeZone: properties.viewingTimezone,
      cityTimeZone: cities.timezone,
    })
    .from(properties)
    .leftJoin(addresses, eq(addresses.id, properties.addressId))
    .leftJoin(cities, eq(cities.id, addresses.cityId))
    .where(eq(properties.id, propertyId))
    .limit(1);

  return pick(row);
}

/**
 * The same answer for several listings at once.
 *
 * A viewings LIST spans whatever properties the person asked about, and
 * resolving each one separately would put a query per row behind a page. An
 * id that names nothing is simply absent from the map, exactly as it is in
 * `lockPropertyBookingBases`; a caller with no answer for an id must fall back
 * to sending no civil reading rather than to a convenient zone.
 */
export async function resolveViewingTimeZones(
  db: DatabaseOrTransaction,
  propertyIds: readonly string[],
): Promise<Map<string, ViewingTimeZoneResolution>> {
  const unique = [...new Set(propertyIds)];
  const resolved = new Map<string, ViewingTimeZoneResolution>();
  if (unique.length === 0) return resolved;

  const rows = await db
    .select({
      propertyId: properties.id,
      propertyTimeZone: properties.viewingTimezone,
      cityTimeZone: cities.timezone,
    })
    .from(properties)
    .leftJoin(addresses, eq(addresses.id, properties.addressId))
    .leftJoin(cities, eq(cities.id, addresses.cityId))
    .where(inArray(properties.id, unique));

  for (const row of rows) resolved.set(row.propertyId, pick(row));
  return resolved;
}

/** Owner, then city, then the stated convention. */
function pick(
  row: { propertyTimeZone: string | null; cityTimeZone: string | null } | undefined,
): ViewingTimeZoneResolution {
  if (row && isSupportedTimeZone(row.propertyTimeZone)) {
    return { timeZone: row.propertyTimeZone, source: 'property' };
  }
  if (row && isSupportedTimeZone(row.cityTimeZone)) {
    return { timeZone: row.cityTimeZone, source: 'city' };
  }
  return { timeZone: FALLBACK_VIEWING_TIME_ZONE, source: 'fallback' };
}

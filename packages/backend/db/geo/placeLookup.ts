/**
 * Deterministic place lookup (#295).
 *
 * ## What was wrong
 *
 * `/api/cities/lookup` matched a normalized name, applied `.limit(1)` and
 * defined no `ORDER BY`, so which Barcelona a caller got was a property of the
 * query PLAN and could change with no code change. `searchCities` ordered by
 * `properties_count desc`, which is deterministic and still arbitrary from a
 * user's point of view — and it flips as listings arrive. Neither is a bug in a
 * line of SQL; both are the consequence of a contract that had no way to say
 * "there are two of these".
 *
 * ## The contract
 *
 * A lookup answers one of four things and never silently picks among equally
 * valid matches: a single resolved place, an ORDERED list of candidates, nothing
 * at all, or a validation error (the caller's, raised in the controller).
 *
 * The identity of a place is its `id`. A name and a slug are LABELS: they are
 * how a human or an old URL refers to a place, they are not unique, and this
 * module's whole job is to stop treating them as though they were.
 *
 * ## Discriminators are FILTERS; relevance is ORDER — and they are different
 *
 * The reference ordering in #295 lists "requested country" and "requested
 * region" as ranking steps 2 and 3. This implementation deviates, deliberately:
 * an explicitly supplied `countryCode` / `regionId` / country or region NAME is
 * applied as a HARD FILTER, not as a ranking boost. A caller who said "in
 * Venezuela" has not expressed a mild preference for Venezuela, and a ranking
 * that can be outvoted by listing count would hand them Spain. `bounds` is a
 * filter for the same reason.
 *
 * `near` is the one geographic input that is NOT a filter. A proximity bias says
 * "I am here", which is a hint about likelihood and not an assertion about the
 * answer, so it orders the candidate list and never removes a row from it.
 *
 * ## What decides AMBIGUITY, and what only decides ORDER
 *
 * Ambiguity is settled by the IDENTITY-grade signals alone — an id match, and
 * then an exact-name/slug match — never by the ranking tail. Two rows that both
 * match the label the caller typed are ambiguous even when one has a thousand
 * listings and the other has none, because "the bigger city" is not a fact about
 * what the user meant. `properties_count` therefore appears in the ORDER BY, so
 * the list a human is offered leads with the likelier answer, and appears
 * nowhere in the decision to answer at all. That is the documented bias #295
 * asks for: it biases PRESENTATION, and the user still chooses.
 *
 * ## Every ordering ends in `id`
 *
 * A complete tie — same match kind, same distance, same coordinate
 * completeness, same listing count — is still deterministic, because `id` is
 * unique and is the last key. Without it, two rows that tie on everything come
 * back in whatever order the plan produced, which is the original bug in a
 * smaller costume.
 */

import { and, asc, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { CityPlaceCandidate, PlaceGeometry } from '@homiio/shared-types';

import { getDb } from '../postgres';
import { cities, countries, regions } from '../schema';
import { placeSlugSql, slugifyPlaceName } from './placeSlug';

/** Candidates returned when the caller does not ask for a different number. */
export const DEFAULT_LOOKUP_LIMIT = 10;
/** The most candidates any caller may ask for. A picker cannot use more. */
export const MAX_LOOKUP_LIMIT = 25;
/**
 * The longest inbound token this will even attempt to resolve.
 *
 * A slug's segment count decides how many `slug = …` probes the query issues, so
 * an unbounded token is an unbounded query. No real place slug approaches this.
 */
export const MAX_TOKEN_LENGTH = 200;
/** The most `city-slug` prefixes a qualified token is split into. */
export const MAX_SLUG_PREFIXES = 8;

export interface PlaceLookupInput {
  /** The token the caller has: an id, a name, or a slug. */
  token?: string;
  /** ISO-3166-1 alpha-2. A hard filter. */
  countryCode?: string;
  /** A country id. A hard filter. */
  countryId?: string;
  /** Legacy: a country NAME or ISO-2 code, resolved to an id. A hard filter. */
  country?: string;
  /** A region id. A hard filter. */
  regionId?: string;
  /** Legacy: a region NAME, resolved within the country when one is given. */
  region?: string;
  /** Ranking bias only — never removes a candidate. */
  near?: { longitude: number; latitude: number };
  /** A hard filter on the city centre. `west > east` crosses the antimeridian. */
  bounds?: { west: number; south: number; east: number; north: number };
  limit?: number;
}

export type PlaceLookupOutcome =
  | { status: 'resolved'; place: CityPlaceCandidate }
  | { status: 'ambiguous'; candidates: CityPlaceCandidate[] }
  | { status: 'not_found' };

function trimmed(value: string | undefined): string | undefined {
  const out = value?.trim();
  return out && out.length > 0 ? out : undefined;
}

/**
 * Every `city-slug` prefix of a token, longest first, paired with what is left
 * over.
 *
 * `barcelona-catalonia-es` yields `barcelona-catalonia-es`/``,
 * `barcelona-catalonia`/`es` and `barcelona`/`catalonia-es`. The caller then
 * requires the remainder to be one of the qualifiers the row actually has, which
 * is what makes a context-carrying slug resolve to exactly one city while the
 * bare `barcelona` stays honestly ambiguous.
 *
 * Longest first so the most specific probe is the cheapest to satisfy; the SQL
 * is an `OR` so the order is presentational, not semantic.
 */
export function slugPrefixes(slug: string): Array<{ prefix: string; remainder: string }> {
  const segments = slug.split('-').filter((segment) => segment.length > 0);
  const out: Array<{ prefix: string; remainder: string }> = [];
  for (let take = segments.length; take >= 1 && out.length < MAX_SLUG_PREFIXES; take -= 1) {
    out.push({
      prefix: segments.slice(0, take).join('-'),
      remainder: segments.slice(take).join('-'),
    });
  }
  return out;
}

/** `slug`-`region`-`countryCode`, the context-carrying public form. */
export function qualifiedSlugOf(citySlug: string, regionName: string, countryCode: string): string {
  return `${citySlug}-${slugifyPlaceName(regionName)}-${countryCode.toLowerCase()}`;
}

/**
 * A slug probe that also checks the leftover segments against the row's own
 * region and country.
 *
 * `barcelona-catalonia-es` reaches this as `prefix='barcelona'`,
 * `remainder='catalonia-es'`, and only a row whose region slugs to `catalonia`
 * and whose country code is `ES` satisfies it. The accepted qualifier forms are
 * the empty string (a bare slug), the country code, the region slug, and both.
 *
 * **This runs in SQL rather than over the fetched rows, and the difference is
 * not stylistic.** A post-filter would sit behind the `LIMIT`, so in a table
 * with thirty Barcelonas the one the caller actually named could be cut before
 * the qualification ever looked at it — a lookup that answers `not_found` for a
 * place it holds. The predicate has to be part of what the LIMIT is applied to.
 */
function slugMatcher(prefix: string, remainder: string): SQL {
  const probe = eq(cities.slug, prefix);
  if (remainder.length === 0) return probe;
  const regionSlug = placeSlugSql(regions.name);
  const countryCode = sql`lower(${countries.code})`;
  return sql`(${probe} and ${remainder} in (${countryCode}, ${regionSlug}, ${regionSlug} || '-' || ${countryCode}))`;
}

/**
 * A bounding-box predicate over the city centre.
 *
 * `west > east` is LEGAL and means the box crosses the antimeridian — the same
 * reading `docs/adr/0002` §9.3 measured against PostGIS for `addresses`. It is
 * spelled out here rather than delegated to `ST_Intersects` because `cities` has
 * no `geography` column and no spatial index (see `db/schema/geo.ts`), so this
 * is two plain comparisons on a handful of already-narrowed rows.
 *
 * A city with no coordinates cannot satisfy a box and is excluded — which is
 * correct and worth stating, because it is the one filter here that drops a row
 * for missing data rather than for disagreeing.
 */
function withinBounds(box: NonNullable<PlaceLookupInput['bounds']>): SQL {
  const latitude = sql`${cities.latitude} between ${box.south} and ${box.north}`;
  const longitude =
    box.west <= box.east
      ? sql`${cities.longitude} between ${box.west} and ${box.east}`
      : sql`(${cities.longitude} >= ${box.west} or ${cities.longitude} <= ${box.east})`;
  return sql`(${cities.latitude} is not null and ${cities.longitude} is not null and ${latitude} and ${longitude})`;
}

/** Great-circle metres from the city centre to the bias, or NULL without one. */
function distanceToBias(bias: NonNullable<PlaceLookupInput['near']>): SQL {
  return sql`case
    when ${cities.latitude} is null or ${cities.longitude} is null then null
    else ST_Distance(
      ST_MakePoint(${cities.longitude}, ${cities.latitude})::geography,
      ST_MakePoint(${bias.longitude}, ${bias.latitude})::geography
    )
  end`;
}

/**
 * What a discriminator resolved to.
 *
 *  - `undefined` — the caller did not supply this discriminator. No filter.
 *  - `null`      — supplied, and it names nothing. The whole lookup is
 *                  `not_found`; answering anyway would ignore a constraint the
 *                  caller stated.
 *  - `string[]`  — one or MORE matching ids, and the plural is the point.
 */
type DiscriminatorIds = readonly string[] | null | undefined;

/**
 * Resolve a country id, an ISO-2 code or a country NAME to EVERY matching id.
 *
 * ## Why this returns a set and not a row
 *
 * It used to end in `.orderBy(asc(id)).limit(1)`, which is the homonym bug moved
 * one level up — into the discriminator instead of the answer, where it is
 * WORSE. A discriminator that picks arbitrarily does not produce a visibly odd
 * candidate list; it produces a confident `resolved` for a city in the wrong
 * country, or a `not_found` that a user reads as "there is no such city" rather
 * than "I could not tell which one you meant". A lookup whose whole subject is
 * refusing to choose among equally valid matches cannot choose here.
 *
 * Returning the SET pushes the ambiguity into the city query, where the existing
 * four-outcome contract already handles it: matching cities across all matching
 * countries become candidates, each carrying its own `admin` hierarchy, so a
 * human can tell them apart. No fifth outcome and no new error shape.
 *
 * ## Code beats name, and that is a rule rather than a pick
 *
 * When the token matches a country CODE, only code matches are used. A code is
 * an identifier and a name is a label, so this discriminates on the KIND of
 * match — which is the same principle as `matchedOn` in the city query, and is
 * not the same thing as choosing between two matches of equal kind.
 *
 * The result is not capped. It is bounded by how many countries share one name
 * case-insensitively, which is a property of reference data rather than of user
 * input; a cap would introduce a silent truncation where there is nothing to
 * truncate.
 */
async function resolveCountryIds(input: PlaceLookupInput): Promise<DiscriminatorIds> {
  const byId = trimmed(input.countryId);
  if (byId) {
    // A PRIMARY KEY equality. At most one row can match, so `.limit(1)` here
    // caps nothing that could have been ambiguous.
    const rows = await getDb().select({ id: countries.id }).from(countries).where(eq(countries.id, byId)).limit(1);
    return rows[0] ? [rows[0].id] : null;
  }
  const code = trimmed(input.countryCode);
  if (code) {
    // `countries_code_key` is UNIQUE. Same reasoning as the primary key above.
    const rows = await getDb()
      .select({ id: countries.id })
      .from(countries)
      .where(eq(countries.code, code.toUpperCase()))
      .limit(1);
    return rows[0] ? [rows[0].id] : null;
  }
  const named = trimmed(input.country);
  if (!named) return undefined;

  const rows = await getDb()
    .select({ id: countries.id, isCode: sql<boolean>`(${countries.code} = ${named.toUpperCase()})` })
    .from(countries)
    .where(or(eq(countries.code, named.toUpperCase()), sql`lower(${countries.name}) = lower(${named})`))
    .orderBy(asc(countries.id));
  if (rows.length === 0) return null;
  const byCode = rows.filter((row) => row.isCode);
  return (byCode.length > 0 ? byCode : rows).map((row) => row.id);
}

/**
 * Resolve a region id or a region NAME to EVERY matching id, scoped to the
 * resolved countries when the caller named one.
 *
 * Same reasoning as {@link resolveCountryIds}, and this is where it bites in
 * practice: region names collide across countries BY DESIGN — `db/schema/geo.ts`
 * scopes `regions_country_name_key` to the country precisely because "Valencia"
 * is a province in Spain and a state in Venezuela. An unscoped `?state=Valencia`
 * therefore matches two real regions, and the previous `.limit(1)` answered as
 * though it matched one.
 */
async function resolveRegionIds(
  input: PlaceLookupInput,
  countryIds: DiscriminatorIds,
): Promise<DiscriminatorIds> {
  const byId = trimmed(input.regionId);
  if (byId) {
    // Primary key again: one row at most.
    const rows = await getDb().select({ id: regions.id }).from(regions).where(eq(regions.id, byId)).limit(1);
    return rows[0] ? [rows[0].id] : null;
  }
  const named = trimmed(input.region);
  if (!named) return undefined;

  const nameMatches = sql`lower(${regions.name}) = lower(${named})`;
  const rows = await getDb()
    .select({ id: regions.id })
    .from(regions)
    .where(countryIds ? and(nameMatches, inArray(regions.countryId, [...countryIds])) : nameMatches)
    .orderBy(asc(regions.id));
  return rows.length > 0 ? rows.map((row) => row.id) : null;
}

/**
 * Look a city up by id, name or slug, with the discriminators the caller had.
 *
 * @param input The token plus any discriminators. See {@link PlaceLookupInput}.
 * @returns `resolved` with one place, `ambiguous` with an ordered candidate
 *   list, or `not_found`. Never a silently chosen row.
 */
export async function lookupCityPlaces(input: PlaceLookupInput): Promise<PlaceLookupOutcome> {
  const token = trimmed(input.token);
  if (!token || token.length > MAX_TOKEN_LENGTH) return { status: 'not_found' };

  // A named country or region that resolves to nothing is a HARD no. It is not
  // "ignore the constraint and answer anyway", which is how a lookup for
  // "Barcelona in Atlantis" would otherwise return Spain.
  //
  // One that resolves to SEVERAL is not a failure and not a pick: the ids all
  // become the filter, and whatever cities they contain become candidates the
  // caller chooses between. See `resolveCountryIds`.
  const countryIds = await resolveCountryIds(input);
  if (countryIds === null) return { status: 'not_found' };
  const regionIds = await resolveRegionIds(input, countryIds);
  if (regionIds === null) return { status: 'not_found' };

  const slug = slugifyPlaceName(token);
  const prefixes = slug.length > 0 ? slugPrefixes(slug) : [];

  const matchers: SQL[] = [
    // Identity first. An id is not a label and cannot be shared.
    eq(cities.id, token),
    sql`lower(${cities.name}) = lower(${token})`,
    ...prefixes.map(({ prefix, remainder }) => slugMatcher(prefix, remainder)),
  ];

  const filters: SQL[] = [eq(cities.isActive, true), or(...matchers) as SQL];
  // `inArray` rather than a hand-built `= any(…)`: an array interpolated into a
  // raw `sql` template renders as a ROW CONSTRUCTOR, which Postgres rejects at
  // RUNTIME and `tsc` cannot see (`~/Oxy/AGENTS.md` §"Drizzle `sql` templates").
  if (countryIds) filters.push(inArray(cities.countryId, [...countryIds]));
  if (regionIds) filters.push(inArray(cities.regionId, [...regionIds]));
  if (input.bounds) filters.push(withinBounds(input.bounds));

  const isIdMatch = sql<boolean>`(${cities.id} = ${token})`;
  const isNameMatch = sql<boolean>`(lower(${cities.name}) = lower(${token}))`;
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? DEFAULT_LOOKUP_LIMIT), 1), MAX_LOOKUP_LIMIT);

  // THE DOCUMENTED ORDERING. Every clause is here for a stated reason and the
  // last one is `id`, so a complete tie is still one answer rather than the
  // plan's answer.
  //
  //   1. an exact id match — identity beats every label
  //   2. an exact name match — the label the user typed, over a slug that merely
  //      normalises to the same thing (`Barcelona` over `barcelona-2`)
  //   3. distance to the proximity bias, nearest first, NULLs last
  //   4. coordinate completeness — a place we cannot put on a map is a worse
  //      answer than one we can, all else equal
  //   5. `properties_count` — the documented relevance bias. It orders the list
  //      a human is offered and never decides between candidates; see the module
  //      comment
  //   6. `id` — the stable final tiebreak
  const ordering: SQL[] = [
    desc(isIdMatch),
    desc(isNameMatch),
    ...(input.near ? [sql`${distanceToBias(input.near)} asc nulls last`] : []),
    desc(sql`(${cities.latitude} is not null and ${cities.longitude} is not null)`),
    desc(cities.propertiesCount),
    asc(cities.id),
  ];

  const rows = await getDb()
    .select({
      id: cities.id,
      name: cities.name,
      slug: cities.slug,
      latitude: cities.latitude,
      longitude: cities.longitude,
      bboxWest: cities.bboxWest,
      bboxSouth: cities.bboxSouth,
      bboxEast: cities.bboxEast,
      bboxNorth: cities.bboxNorth,
      propertiesCount: cities.propertiesCount,
      countryId: countries.id,
      countryCode: countries.code,
      countryName: countries.name,
      regionId: regions.id,
      regionCode: regions.code,
      regionName: regions.name,
      isIdMatch,
      isNameMatch,
    })
    .from(cities)
    .innerJoin(countries, eq(cities.countryId, countries.id))
    .innerJoin(regions, eq(cities.regionId, regions.id))
    .where(and(...filters))
    .orderBy(...ordering)
    // `limit` is applied AFTER the ordering above and only ever with it, and it
    // is never 1: a lookup that can be ambiguous has to see the second row to
    // know that it is.
    //
    // The precise claim, because the imprecise one was wrong and sat here
    // reassuringly for a while: the only `.limit(1)` calls in this file are on a
    // PRIMARY KEY or on the UNIQUE `countries_code_key`, where at most one row
    // can match and the cap therefore truncates nothing. No predicate that could
    // match several rows is capped at one anywhere here — that was the whole bug
    // (#295), and it was reintroduced once in the DISCRIMINATOR resolvers, where
    // it is harder to see because the wrong answer still looks like a confident
    // `resolved`. The behavioural pin is the two-same-named-regions case in
    // `__tests__/integration/cityPlaceLookup.test.ts`, not this comment.
    .limit(limit);

  const candidates: CityPlaceCandidate[] = rows.map((row) => {
    const center =
      typeof row.latitude === 'number' && typeof row.longitude === 'number'
        ? { longitude: row.longitude, latitude: row.latitude }
        : undefined;
    const bounds =
      typeof row.bboxWest === 'number' &&
      typeof row.bboxSouth === 'number' &&
      typeof row.bboxEast === 'number' &&
      typeof row.bboxNorth === 'number'
        ? { west: row.bboxWest, south: row.bboxSouth, east: row.bboxEast, north: row.bboxNorth }
        : undefined;
    const geometry: PlaceGeometry = center
      ? { precision: 'centroid', center, ...(bounds ? { bounds } : {}) }
      : { precision: 'area', ...(bounds ? { bounds } : {}) };
    return {
      id: row.id,
      source: { kind: 'homiio', entity: 'city', id: row.id },
      placeType: 'city',
      label: {
        // Verbatim. No re-casing and no transliteration — `getCityBySlug`
        // title-cased a slug back into a "name", which is wrong for every locale
        // where case is not decorative (ADR §9.4).
        primary: row.name,
        secondary: `${row.regionName}, ${row.countryName}`,
        kind: 'place',
      },
      admin: {
        countryCode: row.countryCode,
        ...(row.regionCode ? { regionCode: row.regionCode } : {}),
        regionName: row.regionName,
        cityName: row.name,
      },
      countryId: row.countryId,
      regionId: row.regionId,
      slug: row.slug,
      qualifiedSlug: qualifiedSlugOf(row.slug, row.regionName, row.countryCode),
      propertiesCount: row.propertiesCount,
      matchedOn: row.isIdMatch ? 'id' : row.isNameMatch ? 'name' : 'slug',
      // A city centre is a `centroid` and never an `exact` point; without one
      // the row describes an AREA we cannot frame, which is a different fact
      // from "we have a point" and is said rather than papered over.
      //
      // Built as a `PlaceGeometry` VALUE and spread, rather than as three
      // sibling fields, because the union is what makes the contradiction
      // unrepresentable — a spread of `...(center ? { center } : {})` beside an
      // independently computed `precision` type-checks even when the two
      // disagree, which is precisely the shape #392 removed from the contract.
      ...geometry,
    };
  });

  if (candidates.length === 0) return { status: 'not_found' };
  // An id is an identity, so a row that matched by id answers on its own even
  // when a different row happens to carry the same string as its name.
  if (candidates[0].matchedOn === 'id') return { status: 'resolved', place: candidates[0] };
  if (candidates.length === 1) return { status: 'resolved', place: candidates[0] };
  return { status: 'ambiguous', candidates };
}

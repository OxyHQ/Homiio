/**
 * Home's sections, computed under ONE geographic scope (#353).
 *
 * ## The scope is applied once, and that is the whole design
 *
 * The failure this replaces is not a slow page — it is a Madrid band rendering
 * beside a Barcelona one. That is reachable whenever two components issue two
 * requests with two scopes, which is what the issue means by "evitar que cada
 * componente haga una consulta independiente con parámetros ligeramente
 * distintos". Here the scope predicates are built once, from one request, and
 * every rule is ANDed onto the SAME list. Two sections disagreeing about where
 * they are is not a bug that can be introduced by a race; it is not expressible.
 *
 * ## An unresolvable place answers EMPTY, never global
 *
 * `?city=nowhere` returns no sections and a `location.status = 'unresolved'`
 * echo, mirroring `controllers/property/search.ts`. The distinction the echo
 * carries is the point: "there are no homes here" and "we did not understand
 * where" are different sentences and the UI has to be able to pick one. ADR 0002
 * decision 5 — a failed resolution never runs a location-less query — is
 * enforced here on the server as well as on the client, because a client is not
 * the only thing that can call this endpoint.
 *
 * ## Empty sections do not exist
 *
 * A rule that matched nothing produces no section, rather than a section with an
 * empty `items`. The issue forbids a section rendered with invented content; the
 * structural way to honour that is to make "a heading with nothing under it"
 * unrepresentable, so nobody is ever tempted to fill one.
 */

import { and, type SQL } from 'drizzle-orm';
import { OfferingType, type HomeLocationSummary, type HomeSection } from '@homiio/shared-types';

import {
  hasOffering,
  inCity,
  inCountry,
  inNeighborhood,
  inRegion,
  notDeleted,
  notModerationRestricted,
} from '../properties/propertyFilters';
import { withinBoundingBox, withinCircle } from '../properties/propertyGeo';
import { allOf, findProperties, propertyOrderBy } from '../properties/propertyReads';
import { serializeProperty } from '../properties/propertySerializer';
import { rulesForOffering, type HomeSectionRule } from './homeSectionRules';

/**
 * How many listings one section carries.
 *
 * Finite by construction. Home is no longer an endless feed, and a section that
 * could grow without bound would put the infinite scroll back one layer down.
 * Eight fills a carousel on the widest breakpoint with one card of overhang, so
 * the row reads as scrollable without a second page.
 */
export const HOME_SECTION_ITEM_LIMIT = 8;

/**
 * A listing as it goes on the wire.
 *
 * `serializeProperty` is typed `Record<string, unknown>` — the convention every
 * read in this package follows, including the search endpoint, which hands its
 * page out as `unknown[]`. The wire shape IS `Property`, and the frontend types
 * the parsed response as `HomeSection<Property>`; asserting that here would be a
 * cast rather than a check, so the honest server-side type is the serializer's
 * own. Narrowing it properly means typing the serializer, which is shared with
 * the search read and is not this change's to alter.
 */
type SerializedProperty = Record<string, unknown>;

/** The geographic scope, already parsed and validated by the controller. */
export interface HomeScope {
  readonly boundingBox?: { swLat: number; swLng: number; neLat: number; neLng: number };
  readonly centerRadius?: { lat: number; lng: number; radiusMeters: number };
  /** Canonical Homiio ids, already resolved. A NAME never reaches this module. */
  readonly cityId?: string;
  readonly regionId?: string;
  readonly neighborhoodId?: string;
  /**
   * ISO-3166-1 alpha-2, for a whole-country scope.
   *
   * A CODE rather than a bounding box, and that is the point: a country's extent
   * is a terrible scope for exactly the countries people search (France reaches
   * the Pacific; the United States reaches the Aleutians), so framing one by its
   * box would be a global feed under a country's name. `addresses.country_code`
   * is NOT NULL and indexed, so the equality is both exact and cheap.
   */
  readonly countryCode?: string;
}

export interface HomeSectionsQuery {
  readonly offering: OfferingType;
  readonly scope: HomeScope;
  readonly location: HomeLocationSummary;
  /**
   * The response's timestamp, supplied by the caller.
   *
   * Passed IN rather than taken here so the envelope's `generatedAt` and every
   * section's are the same string by construction. Two `new Date()` calls a few
   * milliseconds apart would give a client two answers to "how old is this?",
   * and the whole point of the field is that the offline banner can trust it.
   */
  readonly generatedAt: string;
  /** Per-section cap; defaults to {@link HOME_SECTION_ITEM_LIMIT}. */
  readonly limit?: number;
}

/**
 * The predicates every section shares: visibility, offering and scope.
 *
 * Built fresh per call. `propertyFilters.ts` states the rule in its own header
 * and it is not stylistic — a `SQL` fragment carries state and handing one
 * object to eight statements is how two of them end up sharing a parameter.
 */
function scopeConditions(query: HomeSectionsQuery): SQL[] {
  const conditions: SQL[] = [notDeleted(), notModerationRestricted(), hasOffering(query.offering)];

  const { scope } = query;
  // A box and a centre+radius are mutually exclusive at the parse layer, so this
  // is an `else if` for readability rather than as a tiebreak — the controller
  // rejects a request carrying both, exactly as the search endpoint does.
  if (scope.boundingBox) {
    conditions.push(withinBoundingBox(scope.boundingBox));
  } else if (scope.centerRadius) {
    conditions.push(
      withinCircle({
        longitude: scope.centerRadius.lng,
        latitude: scope.centerRadius.lat,
        radiusMeters: scope.centerRadius.radiusMeters,
      }),
    );
  }

  if (scope.cityId) conditions.push(inCity(scope.cityId));
  if (scope.regionId) conditions.push(inRegion(scope.regionId));
  if (scope.neighborhoodId) conditions.push(inNeighborhood(scope.neighborhoodId));
  if (scope.countryCode) conditions.push(inCountry(scope.countryCode));

  return conditions;
}

/** Run one rule under the shared scope. Returns `null` when it matched nothing. */
async function buildSection(
  rule: HomeSectionRule,
  query: HomeSectionsQuery,
): Promise<HomeSection<SerializedProperty> | null> {
  const where = allOf([...scopeConditions(query), rule.predicate(query.offering)]);
  const rows = await findProperties({
    where,
    orderBy: propertyOrderBy(...rule.orderBy()),
    limit: query.limit ?? HOME_SECTION_ITEM_LIMIT,
  });

  if (rows.length === 0) return null;

  return {
    id: rule.id,
    reason: rule.reason,
    source: rule.source,
    location: query.location,
    generatedAt: query.generatedAt,
    items: rows.map((row) => serializeProperty(row)),
  };
}

/**
 * Every section that has something to show, in render order.
 *
 * The rules run CONCURRENTLY because they are independent reads against one
 * connection pool and the surface is a single page load; running them in
 * sequence would multiply the slowest section's latency by the number of rules.
 * `Promise.all` rejects on the first failure rather than returning a partial
 * page, which is correct here: a Home missing one band silently is a page that
 * lies about what is in the area, and the caller's error state is honest.
 */
export async function findHomeSections(
  query: HomeSectionsQuery,
): Promise<readonly HomeSection<SerializedProperty>[]> {
  // An unresolvable place is EMPTY, never global. Returning before any query is
  // built is what makes that structural: there is no code path here that can run
  // a rule without the scope, so a future edit cannot reintroduce the fallback.
  if (query.location.status === 'unresolved') return [];

  const sections = await Promise.all(
    rulesForOffering(query.offering).map((rule) => buildSection(rule, query)),
  );
  return sections.filter((section): section is HomeSection<SerializedProperty> => section !== null);
}

/**
 * Combine scope predicates for a caller that needs the same visibility rules.
 *
 * Exported for the integration suite, which asserts that a section's SQL and a
 * plain scoped count agree — a section returning listings a scoped count does
 * not see would mean the shared conditions had drifted from the rule's.
 */
export function homeScopeWhere(query: HomeSectionsQuery): SQL | undefined {
  const conditions = scopeConditions(query);
  return conditions.length > 1 ? and(...conditions) : conditions[0];
}

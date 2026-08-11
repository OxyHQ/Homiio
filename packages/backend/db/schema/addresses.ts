/**
 * `addresses` — a BUILDING-level record, and the anchor of every spatial query
 * in Homiio.
 *
 * Ported from `models/Address.ts`. Administrative geo is NOT free text here: an
 * address references `countries` / `regions` / `cities` / `neighborhoods` by id
 * (`geoResolutionService` resolves the chain), and the only denormalized geo
 * field is `country_code`, kept for filtering without a join.
 *
 * Two things in this table are `GENERATED ALWAYS ... STORED` rather than
 * application-maintained, and both replace something a hook or a method did in
 * Mongo. That is the substantive change in this file; see the columns
 * themselves.
 *
 * See `CONVENTIONS.md` for the rules every other decision follows.
 */

import {
  check,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, geography, inList, updatedAt } from '@oxyhq/db';
import { cities, countries, neighborhoods, regions } from './geo';

/**
 * How specific an address is, derived from which identifying fields it carries.
 *
 * The whole street → building → unit review hierarchy is built on this: a review
 * of a unit rolls up to its building and its street, and `reviews` will carry
 * `street_level_id` / `building_level_id` / `unit_level_id` referencing rows at
 * each level. Getting the derivation wrong mis-files a review permanently.
 */
export const ADDRESS_LEVELS = ['STREET', 'BUILDING', 'UNIT'] as const;

export const addresses = pgTable(
  'addresses',
  {
    id: generatedId(),

    // ── Relational geo references ──
    //
    // RESTRICT on all three required parents. An address whose city has been
    // deleted is not an address with a missing city — it is a data-loss event
    // that would silently take every property at that address with it. Refusing
    // the delete is the answer; nothing in Homiio deletes a city today, and if
    // anything ever does it must reassign first.
    countryId: text()
      .notNull()
      .references(() => countries.id, { onDelete: 'restrict' }),
    regionId: text()
      .notNull()
      .references(() => regions.id, { onDelete: 'restrict' }),
    cityId: text()
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    /**
     * The resolved neighborhood, when geo-resolution found one.
     *
     * SET NULL rather than RESTRICT, because this is the one geo reference that
     * is genuinely OPTIONAL: NULL already means "no neighborhood resolved", so
     * the action introduces no second meaning for the value — which is the test
     * CONVENTIONS.md sets for `ON DELETE SET NULL`.
     */
    neighborhoodId: text().references(() => neighborhoods.id, { onDelete: 'set null' }),
    /** ISO-2 country code — the only denormalized geo field. */
    countryCode: text().notNull(),

    // ── Building-level fields ──
    street: text().notNull(),
    postalCode: text().notNull(),
    number: text(),
    buildingName: text(),
    block: text(),
    entrance: text(),
    floor: text(),
    unit: text(),
    subunit: text(),
    district: text(),
    /**
     * Free-form extra lines. A native `text[]`, not a child table: it is a
     * scalar list that is only ever read whole and never queried by element.
     */
    addressLines: text().array().notNull().default([]),
    poBox: text(),
    reference: text(),

    // Mongo's `land_plot: { block, lot, parcel }` — a subdocument with a KNOWN,
    // closed shape that nothing queries. Three flattened columns, not `jsonb`:
    // jsonb is for genuinely shape-less data (see `extras` below), and using it
    // for a fixed triple would make three typed strings untyped for no gain.
    landPlotBlock: text(),
    landPlotLot: text(),
    landPlotParcel: text(),

    /**
     * Ingest-supplied extras.
     *
     * `jsonb`, and the ONE column in this migration that earns it: `extras` is
     * declared `Schema.Types.Mixed` in Mongo precisely because its shape is
     * whatever a portal happened to send. Shapelessness is its purpose, not an
     * accident to be normalized away.
     */
    extras: jsonb().notNull().default({}),

    // ── Location ──
    //
    // NAMED coordinate columns, and the point GENERATED from them.
    //
    // Mongo stored `coordinates: { type: 'Point', coordinates: [lng, lat] }` —
    // a positional pair a `2dsphere` index reads by INDEX, so a transposition is
    // both easy to write and impossible to see: swapping Barcelona's pair yields
    // a perfectly valid point in the Indian Ocean. Naming the two scalars fixes
    // half of that; generating the point from them fixes the rest, because it
    // means there is no write path — route, service, backfill or `psql` — that
    // can produce a row whose point disagrees with its coordinates. An attempt
    // fails with SQLSTATE 428C9.
    longitude: doublePrecision().notNull(),
    latitude: doublePrecision().notNull(),
    // The range CHECK below is not optional decoration — see it for the measured
    // reason PostGIS cannot be relied on to enforce this itself.

    /**
     * The PostGIS point, generated from the pair above and never written.
     *
     * `ST_MakePoint` and the `geometry → geography` cast are both IMMUTABLE in
     * PostGIS 3.5, which is what a generated column requires — checked against
     * `pg_proc.provolatile` rather than assumed.
     *
     * Declared BARE rather than as `geography(Point, 4326)`: drizzle-kit 0.31.10
     * cannot emit the typmod (its `parseType` quotes any type name outside a
     * hardcoded list, and `geography` is not on it). The typmod would only
     * constrain WRITES and this column has none, so nothing is lost — that the
     * stored value really is a POINT at SRID 4326 is asserted against real rows
     * in `__tests__/db/postgis.test.ts` instead.
     */
    geo: geography().generatedAlwaysAs(sql`ST_MakePoint(longitude, latitude)::geography`),

    /**
     * STREET / BUILDING / UNIT, derived from which identifying fields are set.
     *
     * This was `AddressSchema.methods.getAddressLevel()` — and a method is
     * BYPASSABLE. Every `.lean()` read skips it, every raw update sidesteps it,
     * and the review hierarchy that depends on it has no way to tell. As a
     * generated column the derivation is a property of the ROW, so a lean read
     * and a populated document cannot disagree about what level an address is.
     *
     * The predicate is `coalesce(x, '') <> ''`, not `x is not null`, and the
     * difference is load-bearing: the Mongo method tested TRUTHINESS
     * (`if (this.floor || this.unit || ...)`), so an empty-string `floor`
     * counted as ABSENT there. `is not null` would count it as present and
     * promote a street-level address to UNIT. Both `coalesce` and `<>` are
     * IMMUTABLE.
     *
     * Column names are written literally rather than interpolated: this is raw
     * SQL evaluated in the table's own scope, and it is the same spelling the
     * emitted DDL carries.
     */
    addressLevel: text({ enum: ADDRESS_LEVELS }).generatedAlwaysAs(sql`
      case
        when coalesce(floor, '') <> '' or coalesce(unit, '') <> ''
          or coalesce(subunit, '') <> '' then 'UNIT'
        when coalesce(number, '') <> '' or coalesce(building_name, '') <> ''
          or coalesce(block, '') <> '' or coalesce(entrance, '') <> '' then 'BUILDING'
        else 'STREET'
      end
    `),

    /**
     * The deterministic building dedup key (sha1 of the normalized building
     * fields plus `city_id` and `country_code`).
     *
     * Written NULL when absent, NEVER `''`. An empty string is a VALUE, so under
     * the partial unique index below two unkeyed addresses would collide for
     * real — turning a non-problem into a live 500 on the create path. Mongo's
     * `sparse: true` had the same requirement and the same trap.
     *
     * The backfill copies this VERBATIM and never recomputes it: the `pre('save')`
     * hook that derives it has already changed shape once, so recomputing during
     * the copy would silently re-key every existing building and break the
     * dedup that `findOrCreateCanonical` depends on.
     */
    normalizedKey: text(),

    /**
     * The LEVEL-AWARE identity key — ADR 0001 §5.1, written only by
     * `materializeHousingCandidate`.
     *
     * It exists BESIDE {@link normalizedKey} and never replaces it, because the
     * v1 key is copied verbatim from the source and re-keying it would re-create
     * 11,734 existing buildings on their next ingest. Both columns are live; a
     * row may carry one, the other, or both.
     *
     * ## Why a second key was unavoidable
     *
     * The v1 key hashes `street|number|unit|building_name|block|postal_code|
     * city_id|country_code` while {@link addressLevel} derives from `floor`,
     * `unit`, `subunit`, `number`, `building_name`, `block` and `entrance`.
     * `floor`, `entrance` and `subunit` therefore DECIDE the level and are
     * ABSENT from the key, so a building and the flat on its third floor hash
     * identically and — under the partial unique index above — become one row
     * whose level depends on which advertisement was ingested first (ADR 0001
     * §1.3, measured). Nothing that dedupes on the v1 key can create the
     * street → building → unit chain this column exists to serve.
     *
     * v2 hashes the level itself plus every field that discriminates it, with
     * internal whitespace collapsed and diacritics stripped
     * (`computeAddressIdentityKey`).
     *
     * **NULL on every row written by any other path**, which is the honest state
     * rather than an omission: the ADR's plan is forward-only, and back-filling
     * this column for existing rows is phase 2, gated on a census that has not
     * run. A NULL here means "no v2 identity has been computed for this row",
     * never "this row has no identity".
     */
    identityKey: text(),

    /**
     * The row one level up: a UNIT's building, a BUILDING's street.
     *
     * NULL for a STREET row, and NULL on every row that predates
     * `materializeHousingCandidate` — the hierarchy is a projection
     * `resolveAddressHierarchy` recomputes per review today, and this column
     * stores it once so every other domain can read it. Populating it for
     * existing rows is ADR 0001 phase 2.
     *
     * RESTRICT rather than CASCADE or SET NULL. CASCADE would delete every flat
     * in a block along with the block; SET NULL would silently promote a unit to
     * a street-level orphan, and NULL already means "this is a STREET row", so
     * the action would introduce a second meaning for the value — the test
     * `CONVENTIONS.md` sets for `ON DELETE SET NULL`, failed. Nothing in Homiio
     * deletes an address; anything that ever does must re-parent first.
     */
    parentAddressId: text().references((): AnyPgColumn => addresses.id, { onDelete: 'restrict' }),

    /**
     * The survivor of a merge, when this row lost one — ADR 0001 §8.1.
     *
     * A merge NEVER deletes the losing row: reviews, leases and occupancies
     * point at it, and a wrong merge publishes one household's reviews under
     * another's address. Setting a pointer instead is what makes the operation
     * reversible, and reversibility is the requirement rather than a nicety.
     *
     * Nothing performs a merge yet — that workflow is the second half of #360.
     * The column and its FK land here because the MATCHER has to honour it from
     * its first line: `materializeHousingCandidate` follows this pointer before
     * returning any match, so a redirect that lands later cannot silently start
     * handing callers a row the merge retired. A matcher written without it
     * would have to be re-audited path by path when merge arrives, which is
     * exactly the "bolt it on later" this column exists to avoid.
     *
     * RESTRICT: a survivor may not be deleted while something redirects to it.
     */
    mergedIntoAddressId: text().references((): AnyPgColumn => addresses.id, {
      onDelete: 'restrict',
    }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // Mongo's `{ normalizedKey: 1 }, { unique: true, sparse: true }`. Postgres
    // treats NULLs as DISTINCT so a plain UNIQUE would already behave
    // correctly — the partial form is used anyway because it keeps the index the
    // size of the real set and states the "only keyed addresses are deduped"
    // rule at the constraint, where a reader will find it.
    uniqueIndex('addresses_normalized_key_key')
      .on(table.normalizedKey)
      .where(sql`${table.normalizedKey} is not null`),

    // The v2 key's own partial unique index — the same shape and the same
    // reason, on a column that is NULL for every row written before
    // `materializeHousingCandidate` existed. Partial is REQUIRED here rather
    // than merely tidy: a total unique index over a column that is NULL on
    // 11,734 rows would be correct in Postgres (NULLs are distinct) and would
    // still index all of them, and the predicate is what any `ON CONFLICT`
    // against it must repeat verbatim to name this index as its arbiter.
    uniqueIndex('addresses_identity_key_key')
      .on(table.identityKey)
      .where(sql`${table.identityKey} is not null`),

    // "Every child of this row", the read the hierarchy exists for.
    index('addresses_parent_address_id_idx').on(table.parentAddressId),
    // Partial: a merged-away row is the rare case by construction, so indexing
    // only the rows that carry a redirect keeps this the size of the real set.
    index('addresses_merged_into_address_id_idx')
      .on(table.mergedIntoAddressId)
      .where(sql`${table.mergedIntoAddressId} is not null`),

    // The spatial index. Every `$near` / `$geoWithin` / `$centerSphere` property
    // search resolves through this table, so this is the index the whole search
    // surface stands on.
    index('addresses_geo_gist').using('gist', table.geo),

    // The four parent lookups Mongo indexed individually. All four are ported:
    // none of them is a prefix of another, and each serves a real "everything in
    // this place" query.
    index('addresses_city_id_idx').on(table.cityId),
    index('addresses_region_id_idx').on(table.regionId),
    index('addresses_country_id_idx').on(table.countryId),
    index('addresses_neighborhood_id_idx').on(table.neighborhoodId),
    index('addresses_postal_code_country_idx').on(table.postalCode, table.countryCode),

    // `addressController.searchAddresses` matches the building-level street with
    // an UNANCHORED, case-insensitive term (`{ $regex: q, $options: 'i' }` in
    // Mongo, `ILIKE '%q%'` here). Mongo had no index for it at all — an
    // unanchored `/i` regex is a collection scan — and `ILIKE '%…%'` only uses
    // an index with `gin_trgm_ops`. Without this, every keystroke of the address
    // typeahead sequentially scans every address in the product.
    index('addresses_street_trgm_idx').using('gin', sql`${table.street} gin_trgm_ops`),

    check(
      'addresses_address_level_check',
      sql`${table.addressLevel} in (${sql.raw(inList(ADDRESS_LEVELS))})`,
    ),

    // Mongo validated this range on the coordinate pair and REJECTED a document
    // outside it. Postgres will not do that for us, and the reason this CHECK
    // exists is that the obvious assumption — "geography validates its own
    // input" — is FALSE, measured against PostGIS 3.5 rather than reasoned
    // about:
    //
    //   select ST_AsText(ST_MakePoint(0, 100)::geography);
    //   NOTICE:  Coordinate values were coerced into range [-180 -90, 180 90]
    //   POINT(0 80)
    //
    // It is a NOTICE and the insert SUCCEEDS. And the coercion is not a clamp to
    // the nearest valid value — latitude 100 becomes **80**, wrapping over the
    // pole — so a bad coordinate silently becomes a DIFFERENT, entirely
    // plausible location rather than an obviously broken one. Dropping Mongo's
    // validator without replacing it would convert a loud rejection into a
    // listing quietly pinned to the wrong place, which no test asserting "a row
    // came back" would ever catch.
    //
    // Safe to apply during the backfill precisely because Mongo enforced it:
    // every stored pair passed the same test on the way in.
    check(
      'addresses_coordinates_range_check',
      sql`${table.longitude} between -180 and 180 and ${table.latitude} between -90 and 90`,
    ),

    // No row is its own parent and no row is its own merge survivor. Both are
    // one-row cycles a self-referencing foreign key cannot see: the constraint
    // is satisfied by `id` existing, and `id` always exists on the row being
    // written. Longer cycles are not expressible as a CHECK and are refused by
    // the writer instead.
    //
    // Both admit NULL, deliberately: a NULL parent is a STREET row and a NULL
    // survivor is a row nobody merged, which are the ordinary states rather than
    // the ones being forbidden.
    check('addresses_parent_not_self_check', sql`${table.parentAddressId} <> ${table.id}`),
    check('addresses_merge_not_self_check', sql`${table.mergedIntoAddressId} <> ${table.id}`),
  ],
);

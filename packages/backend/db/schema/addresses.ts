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

import { check, doublePrecision, index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
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
  ],
);

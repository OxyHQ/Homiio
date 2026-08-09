/**
 * The rest of the data — images, addresses, agencies, properties and profiles —
 * mapped from Mongo documents to candidate rows.
 *
 * The geo reference data landed first (`geoPlan.ts`) to close a live regression.
 * This is everything else: 171,976 images, 11,734 addresses, 2,627 agencies,
 * 17,644 properties with three child tables, and the five profiles.
 *
 * Same rules as `geoPlan`, and they are not restated here: ids travel verbatim,
 * a value of the wrong shape is PRESERVED so `rowAudit` refuses it rather than
 * being coerced away, and every departure from what the source holds is a NAMED,
 * COUNTED resolution.
 *
 * ## The order is a foreign key graph, not a preference
 *
 * `images` → `property_images.image_id` (NOT NULL, RESTRICT) and
 * `cities/regions.cover_image_id`; `addresses` → `properties.address_id`
 * (NOT NULL, RESTRICT); `agencies` → `properties.agency_id`. **`agencies` before
 * `properties` is the edge that is easy to miss**, because the issue and the
 * census both list agencies after properties by row count — migration 0003
 * promoted `agency_id` from the deferred-foreign-key ledger to a real reference,
 * which is what turned a harmless ordering into a fatal one. 8,374 listings
 * carry an agency.
 *
 * `profiles` is last, and its position carries no FK argument at all: nothing
 * references a profile and a profile references nothing (Oxy owns identity, so
 * `oxy_user_id` has no foreign key by design). It is last because it is the only
 * IRREPLACEABLE data here — properties, addresses and images are regenerable by
 * the ingestion worker from the portals — so it runs once every mechanical
 * failure the other four could expose has been exposed.
 *
 * ## What is NOT copied, and why each is deliberate
 *
 * | field | reason |
 * |---|---|
 * | `properties.hasImages` | DERIVED after the copy by `db/hasImages.ts`, the column's one writer. Production holds a row whose stored flag disagrees with its own array, so copying it would import a known-wrong answer into the primary sort key of every discovery feed. |
 * | `properties.coverImageIndex` | `-1` on all 17,644 rows; the meaning moved to `property_images.is_primary`. |
 * | `properties.title` / `views` | Absent from `PropertySchema`, so mongoose strict mode has been dropping them from every write. There is nothing to copy — see `schema/unmappedColumns.ts`. |
 * | `profiles.settings_roommate_preferences_location` / `_interests` | The same discard one schema over: `personalProfileSchema` declares neither, so `updateRoommatePreferences` has never been able to store what its own allow-list accepts. Nothing to copy — see `schema/unmappedColumns.ts`. |
 * | `Region.imageIds[]` / `City.imageIds[]` | Dropped with the column: the relation already exists as `images.(entity_type, entity_id)`. |
 */

import { createHash } from 'node:crypto';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
  addresses,
  agencies,
  cities,
  countries,
  images,
  neighborhoods,
  partners,
  regions,
  profileChatMessages,
  profilePreferredLocations,
  profileReferences,
  profileRentalHistory,
  profileRoommateHistory,
  profiles,
  properties,
  propertyAvailabilityWindows,
  propertyDocuments,
  propertyImages,
} from '../schema';
import { OFFERING_TYPES } from '../schema/properties';
import {
  createdAtValue,
  idValue,
  optional,
  readPath,
  ResolutionLog,
  toImageRow,
  updatedAtValue,
  withSchemaDefault,
  type SourceDocument,
} from './geoPlan';
import type { CandidateRow, RowRule } from './rowAudit';

/**
 * Every rule under which this copy writes something other than what the source
 * holds, with the production figure the census froze it at.
 *
 * Reported and compared, never enforced: production moves between the census and
 * the window (external listings carry a TTL that reaps them continuously), so a
 * drifting count is information and an equal count is confirmation. Neither is a
 * reason to refuse.
 */
export const DATA_RESOLUTIONS = {
  /**
   * The `moderation` sub-object is absent → `moderation_restricted` is `false`.
   *
   * Frozen at **17,642 of 17,644**. The column is `NOT NULL DEFAULT false`, so
   * this could have been an omission — it is written explicitly because a
   * decision that is counted is a decision somebody can audit, and this one
   * rests on three measured facts rather than on convenience: the field was
   * added to `PropertySchema` after the newest document was created, re-ingesting
   * does not add it (the rows WITHOUT it have a later max `updatedAt` than the
   * two with it), and `moderation.restricted` is written only by
   * `ModerationEnforcementService`, which is switched off in production. Absent
   * therefore means "no jury has restricted this listing".
   */
  MODERATION_ABSENT: 'MODERATION_ABSENT',
  /**
   * `listingFlags` is absent → all eleven columns NULL.
   *
   * Frozen at **9,594 of 17,644**, and this one must NOT copy
   * {@link MODERATION_ABSENT}'s answer. Those booleans are THREE-state: `true`
   * (the classifier fired), `false` (it looked and said no), NULL (it never
   * ran). Defaulting 9,594 rows to `false` would manufacture a claim about them
   * that nobody made.
   */
  LISTING_FLAGS_ABSENT: 'LISTING_FLAGS_ABSENT',
  /** `externalContact` is absent → all six columns NULL. Frozen at **5,174**. */
  EXTERNAL_CONTACT_ABSENT: 'EXTERNAL_CONTACT_ABSENT',
  /** `priceEthics` is absent → all eight columns NULL. Frozen at **133**. */
  PRICE_ETHICS_ABSENT: 'PRICE_ETHICS_ABSENT',
  /**
   * The stored `hasImages` disagreed with its own `images[]` — counted, and the
   * stored value discarded either way.
   *
   * Census: **1 row** (`6a515dd9c196de4ad2a8550e`, `hasImages: false` with
   * twelve images). The flag is re-derived for the whole table after the copy,
   * so this count is not a correction — it is the evidence that deriving rather
   * than copying was the right call. That id carries `expiresAt: 2026-08-09`, so
   * the TTL may have reaped it; a count of zero here is expected once it has.
   */
  HAS_IMAGES_DISAGREED: 'HAS_IMAGES_DISAGREED',
  /**
   * `normalizedKey` was stored as an EMPTY STRING → written NULL.
   *
   * The unique index is partial on `normalized_key is not null`, and an empty
   * string is a VALUE: two unkeyed addresses would collide for real, and under
   * `ON CONFLICT DO NOTHING` one of them would silently never arrive. Mongo's
   * `sparse: true` had the same requirement and the same trap.
   */
  NORMALIZED_KEY_EMPTY: 'NORMALIZED_KEY_EMPTY',
  /**
   * An embedded subdocument had no `_id` → a uuid v7 was minted for its row.
   *
   * Not a remap: there was no id to preserve and nothing references these rows.
   * `availabilityWindowSchema` declares `{ _id: false }`, so every calendar
   * window is one of these; `Property.images[]`, `documents[]` and the five
   * profile arrays keep their own ids.
   */
  SUBDOCUMENT_ID_MINTED: 'SUBDOCUMENT_ID_MINTED',
} as const;

/** The Mongo collection each copy step reads. */
export const DATA_SOURCE_COLLECTIONS = {
  images: 'images',
  addresses: 'addresses',
  agencies: 'agencies',
  properties: 'properties',
  profiles: 'profiles',
} as const;

export type DataCollectionName = keyof typeof DATA_SOURCE_COLLECTIONS;

/** Copy in this order or fail `23503`. See the module doc for every edge. */
export const DATA_COPY_ORDER = [
  'images',
  'addresses',
  'agencies',
  'properties',
  'profiles',
] as const satisfies readonly DataCollectionName[];

/** A foreign key this copy must resolve before it writes the child row. */
export interface ReferenceSpec {
  /** The SQL table the child row goes into. */
  readonly table: string;
  /** The constraint's own name, so a finding is greppable against the schema. */
  readonly constraint: string;
  /** The column on the child row. */
  readonly column: string;
  /** The Postgres table it references. */
  readonly parentTable: string;
  /**
   * The Mongo collection the parents come from, or `null` when the parents live
   * ONLY in Postgres.
   *
   * A parent may legitimately be in either store: `addresses.city_id` points at
   * geo rows already copied, `properties.address_id` at rows THIS run is about
   * to write. Resolving against only one of them is wrong in both directions —
   * Postgres alone reports every property as an orphan, Mongo alone misses a geo
   * row that never arrived.
   */
  readonly parentCollection: string | null;
  /** Whether NULL is acceptable. */
  readonly nullable: boolean;
}

/** A unique index `ON CONFLICT DO NOTHING` would absorb rather than report. */
export interface UniqueKeySpec {
  readonly table: string;
  readonly constraint: string;
  /** The composite key, or `null` for a row a PARTIAL index does not cover. */
  readonly key: (row: CandidateRow) => string | null;
}

/** One collection's copy: what it reads, what it writes, and what must hold. */
export interface DataCollectionPlan {
  readonly name: DataCollectionName;
  readonly sourceCollection: string;
  /** Target tables, PARENT FIRST — a child's FK must resolve against a row already in. */
  readonly tables: readonly string[];
  /** One document → the rows it becomes, keyed by SQL table name. */
  readonly map: (
    document: SourceDocument,
    log: ResolutionLog,
  ) => Readonly<Record<string, readonly CandidateRow[]>>;
  /** Table-level CHECKs the column metadata cannot express, keyed by table. */
  readonly rules: Readonly<Record<string, readonly RowRule[]>>;
  /**
   * Tables whose rows carry a MINTED id, so a re-map produces a different one.
   *
   * The verifier re-runs the mapper against the live source document and matches
   * what it produces against what is stored — by id, because that is the only
   * thing the two share. For a row minted from a `{ _id: false }` subdocument
   * there IS no shared id: `uuidv7()` returns something new every call, so an
   * id-matched comparison reports every such row as "absent from the target" on
   * a flawless copy. Those tables are compared as a SET of rows with the id
   * excluded instead, which checks every field that was actually copied and
   * claims nothing about the one that was not.
   */
  readonly mintsIds: readonly string[];
  readonly uniqueKeys: readonly UniqueKeySpec[];
  readonly references: readonly ReferenceSpec[];
}

// ── images ─────────────────────────────────────────────────────────

/**
 * `images` ← the WHOLE collection this time.
 *
 * The geo copy took only `city`/`region`/`country` photos; `property_images
 * .image_id` is `NOT NULL` with `ON DELETE RESTRICT`, so every one of the
 * 169,223 referenced property photos has to be here before a listing is written.
 *
 * `entity_id` gets no reference rule and never will: one column referencing five
 * tables cannot be a foreign key, which is why it is the one permanent entry in
 * `deferredForeignKeys.ts`'s `ID_COLUMNS_WITHOUT_FOREIGN_KEY`. A dangling one is
 * also not a copy failure — the census found 948 orphaned image documents left
 * behind by the `properties` TTL, and refusing to migrate because of a defect
 * the migration did not cause would be refusing for the wrong reason.
 */
const imagesPlan: DataCollectionPlan = {
  mintsIds: [],
  name: 'images',
  sourceCollection: DATA_SOURCE_COLLECTIONS.images,
  tables: ['images'],
  map: (document, log) => ({ images: [toImageRow(document, log)] }),
  rules: {},
  uniqueKeys: [],
  references: [],
};

// ── addresses ──────────────────────────────────────────────────────

/**
 * `addresses` ← `models/Address.ts`. MANY-TO-ONE with properties, 0.67 per
 * listing, and that ratio is the point: `findOrCreateCanonical` collapses
 * listings onto a canonical building by `normalizedKey`. The copy preserves that
 * mapping by copying ids verbatim and nothing else — it never regenerates a key,
 * never dedupes, and never creates an address a property points at.
 *
 * ## The coordinate pair is the most dangerous read in the whole backfill
 *
 * Mongo stores `coordinates: { type: 'Point', coordinates: [lng, lat] }` — a
 * POSITIONAL pair, and transposing it produces a valid point in the wrong
 * hemisphere with no error at any layer: still two numbers, still inside the
 * range CHECK for most European latitudes, still indexable. The target removes
 * the class of bug permanently (named columns, `geo` GENERATED from them), so
 * this function is the last place the order still matters — and the verifier
 * measures a real-world DISTANCE rather than asserting the column is non-null,
 * because non-null is exactly what a transposed pair also is.
 *
 * ## `normalized_key` is copied verbatim, and `''` becomes NULL
 *
 * Verbatim because the `pre('save')` hook that derives it has already changed
 * shape once, so recomputing during the copy would re-key every building and
 * break the dedup `findOrCreateCanonical` depends on.
 */
const addressesPlan: DataCollectionPlan = {
  mintsIds: [],
  name: 'addresses',
  sourceCollection: DATA_SOURCE_COLLECTIONS.addresses,
  tables: ['addresses'],
  map: (document, log) => ({ addresses: [toAddressRow(document, log)] }),
  rules: {
    addresses: [
      {
        // Mongo REJECTED an out-of-range pair on the way in, so this holds on
        // every stored row — and it is checked anyway because PostGIS does NOT
        // enforce it: `ST_MakePoint(0, 100)::geography` raises a NOTICE, coerces
        // latitude 100 to **80**, and the insert SUCCEEDS. A bad pair becomes a
        // different, entirely plausible place rather than an error.
        name: 'addresses_coordinates_range_check',
        reason:
          'longitude must be within ±180 and latitude within ±90 (23514) — ' +
          'PostGIS would COERCE an out-of-range pair into a plausible wrong place ' +
          'rather than refuse it',
        holds: (row) =>
          inRange(row.longitude, -180, 180) && inRange(row.latitude, -90, 90),
        offendingValue: (row) => [row.longitude, row.latitude],
      },
    ],
  },
  uniqueKeys: [
    {
      table: 'addresses',
      constraint: 'addresses_normalized_key_key',
      // PARTIAL: `where normalized_key is not null`. Two unkeyed addresses do
      // not collide, and treating them as if they did would report thousands of
      // findings on a healthy collection.
      key: (row) => (typeof row.normalizedKey === 'string' ? row.normalizedKey : null),
    },
  ],
  references: [
    reference('addresses', 'addresses_country_id_countries_id_fk', 'countryId', 'countries', 'countries', false),
    reference('addresses', 'addresses_region_id_regions_id_fk', 'regionId', 'regions', 'regions', false),
    reference('addresses', 'addresses_city_id_cities_id_fk', 'cityId', 'cities', 'cities', false),
    reference('addresses', 'addresses_neighborhood_id_neighborhoods_id_fk', 'neighborhoodId', 'neighborhoods', 'neighborhoods', true),
  ],
};

/** `addresses` ← `models/Address.ts`. */
export function toAddressRow(document: SourceDocument, log: ResolutionLog): CandidateRow {
  const createdAt = createdAtValue(document, log);

  // `[longitude, latitude]`, written out because the ORDER is the entire
  // meaning. Anything that is not exactly two elements is handed to the audit
  // UNCHANGED rather than salvaged: a one-element array or a `{ lat, lng }`
  // object would otherwise silently produce a row at longitude 0.
  const pair = readPath(document, 'coordinates.coordinates');
  const point = Array.isArray(pair) && pair.length === 2 ? pair : null;

  const normalizedKey = readPath(document, 'normalizedKey');
  if (normalizedKey === '') log.applied(DATA_RESOLUTIONS.NORMALIZED_KEY_EMPTY);

  return {
    id: idValue(document._id),

    countryId: idValue(readPath(document, 'countryId')),
    regionId: idValue(readPath(document, 'regionId')),
    cityId: idValue(readPath(document, 'cityId')),
    neighborhoodId: idValue(readPath(document, 'neighborhoodId')),
    countryCode: optional(document, 'countryCode'),

    street: optional(document, 'street'),
    postalCode: optional(document, 'postal_code'),
    number: optional(document, 'number'),
    buildingName: optional(document, 'building_name'),
    block: optional(document, 'block'),
    entrance: optional(document, 'entrance'),
    floor: optional(document, 'floor'),
    unit: optional(document, 'unit'),
    subunit: optional(document, 'subunit'),
    district: optional(document, 'district'),
    addressLines: withSchemaDefault(document, 'address_lines', [], log),
    poBox: optional(document, 'po_box'),
    reference: optional(document, 'reference'),

    landPlotBlock: optional(document, 'land_plot.block'),
    landPlotLot: optional(document, 'land_plot.lot'),
    landPlotParcel: optional(document, 'land_plot.parcel'),

    extras: withSchemaDefault(document, 'extras', {}, log),

    longitude: point === null ? (pair ?? null) : point[0],
    latitude: point === null ? (pair ?? null) : point[1],
    // `geo` and `address_level` are GENERATED ALWAYS. Writing either raises
    // 428C9 — which is the point of generating them: no write path, this copy
    // included, can produce a row whose point disagrees with its pair.

    normalizedKey: normalizedKey === '' ? null : (normalizedKey ?? null),

    createdAt,
    updatedAt: updatedAtValue(document, createdAt, log),
  };
}

// ── agencies ───────────────────────────────────────────────────────

/**
 * `agencies` ← `models/schemas/AgencySchema.ts`. 2,627 rows, and it MUST land
 * before `properties`.
 *
 * `normalizedName` and `slug` are copied VERBATIM and never recomputed:
 * `utils/agencyName` is ordinary application code that can change, and
 * recomputing during the copy would re-key every existing agency and split
 * reviews across two rows that used to be one. Same rule, same reason, as
 * `addresses.normalized_key`.
 *
 * Both unique keys are declared because `ON CONFLICT DO NOTHING` would ABSORB a
 * collision rather than raise it — and the 8,374 listings pointing at the loser
 * would then fail their own foreign key later, in a different table, with
 * nothing connecting the two facts.
 */
const agenciesPlan: DataCollectionPlan = {
  mintsIds: [],
  name: 'agencies',
  sourceCollection: DATA_SOURCE_COLLECTIONS.agencies,
  tables: ['agencies'],
  map: (document, log) => ({ agencies: [toAgencyRow(document, log)] }),
  rules: {
    agencies: [
      notEmptyRule('agencies_normalized_name_not_empty_check', 'normalizedName'),
      notEmptyRule('agencies_slug_not_empty_check', 'slug'),
    ],
  },
  uniqueKeys: [
    {
      table: 'agencies',
      constraint: 'agencies_normalized_name_key',
      key: (row) => (typeof row.normalizedName === 'string' ? row.normalizedName : null),
    },
    {
      table: 'agencies',
      constraint: 'agencies_slug_key',
      key: (row) => (typeof row.slug === 'string' ? row.slug : null),
    },
  ],
  references: [],
};

/** `agencies` ← `models/schemas/AgencySchema.ts`. */
export function toAgencyRow(document: SourceDocument, log: ResolutionLog): CandidateRow {
  const createdAt = createdAtValue(document, log);
  return {
    id: idValue(document._id),
    name: optional(document, 'name'),
    normalizedName: optional(document, 'normalizedName'),
    slug: optional(document, 'slug'),
    createdAt,
    updatedAt: updatedAtValue(document, createdAt, log),
  };
}

/**
 * `('<offering>' = any(offerings)) = (<discriminator> is not null)`, per
 * offering.
 *
 * Written per-offering rather than as one combined constraint so a violation
 * NAMES which offering is incoherent; a single check would report the same
 * constraint for any of the four and say nothing a reader could act on. Each
 * direction catches a different bug: `offerings` naming a block that is not
 * there (a listing advertising a price it does not have), and a block present
 * without its offering (a price nothing can find).
 */
const OFFERING_COHERENCE_RULES: readonly RowRule[] = [
  offeringRule('long_term_rent', 'longTermRentMonthlyAmount'),
  offeringRule('short_term_rent', 'shortTermRentNightlyRate'),
  offeringRule('sale', 'salePrice'),
  offeringRule('exchange', 'exchangeMode'),
];

function offeringRule(offering: string, discriminator: string): RowRule {
  return {
    name: `properties_offering_${offering}_check`,
    reason:
      `offerings must name '${offering}' exactly when ${discriminator} is set (23514)`,
    holds: (row) => {
      // A non-array `offerings` is already refused by the column scan; reporting
      // it here too would double-count one defect under two names.
      if (!Array.isArray(row.offerings)) return true;
      return row.offerings.includes(offering) === !isAbsent(row[discriminator]);
    },
    offendingValue: (row) => ({ offerings: row.offerings, [discriminator]: row[discriminator] }),
  };
}

/**
 * The four block-INTEGRITY CHECKs: a satellite column may only be populated when
 * its block's discriminator is.
 *
 * The coherence rules above are written over PRICE null-ness;
 * `offeringValidation.ts` writes the same invariant over BLOCK PRESENCE, and the
 * two diverge in exactly one direction — `sale: { currency: 'EUR' }` with
 * `offerings: []` is rejected by Mongo and invisible to a coherence check, which
 * only sees `false = false`.
 */
const BLOCK_INTEGRITY_RULES: readonly RowRule[] = [
  blockRule('long_term_rent', 'longTermRentMonthlyAmount', [
    'longTermRentCurrency',
    'longTermRentDeposit',
    'longTermRentApplicationFee',
    'longTermRentLateFee',
    'longTermRentUtilities',
  ]),
  blockRule('short_term_rent', 'shortTermRentNightlyRate', [
    'shortTermRentCurrency',
    'shortTermRentCleaningFee',
    'shortTermRentServiceFee',
    'shortTermRentTaxesPercent',
    'shortTermRentMinNights',
    'shortTermRentMaxNights',
    'shortTermRentInstantBook',
    'shortTermRentDeposit',
  ]),
  blockRule('sale', 'salePrice', [
    'saleCurrency',
    'salePricePerSqm',
    'saleEstimatedYield',
    'saleIsPriceReduced',
    'saleChainStatus',
  ]),
  blockRule('exchange', 'exchangeMode', [
    'exchangeMinStay',
    'exchangeMaxStay',
    'exchangeWelcomeNote',
    'exchangeLanguages',
    'exchangeMealsIncluded',
    'exchangeRequiresReciprocity',
  ]),
];

function blockRule(
  block: string,
  discriminator: string,
  satellites: readonly string[],
): RowRule {
  return {
    name: `properties_${block}_block_check`,
    reason: `a ${block} column may only be set when ${discriminator} is (23514)`,
    holds: (row) =>
      !isAbsent(row[discriminator]) || satellites.every((column) => isAbsent(row[column])),
    offendingValue: (row) => satellites.filter((column) => !isAbsent(row[column])),
  };
}

// ── properties ─────────────────────────────────────────────────────

/**
 * `properties` ← `models/schemas/PropertySchema.ts`, plus its three child
 * tables. 135 columns and the last table in the dependency order.
 *
 * ## Four absent sub-objects, four different answers
 *
 * Flattening an optional sub-document makes every one of its columns nullable,
 * so "the block was absent" has to be represented by the columns themselves.
 * Only `moderation` gets a VALUE, and it is the only one that can — see
 * {@link DATA_RESOLUTIONS} for the measured reason each of the four differs.
 *
 * ## The offering CHECKs are the largest correctness win in this port
 *
 * `services/offeringValidation.ts` states one invariant — `offerings`
 * equals exactly the set of present priced blocks — and Mongo has TWO
 * enforcement paths for it that do not agree: the path validator runs on
 * `save()`, and EXPLICITLY SKIPS ITSELF on `findOneAndUpdate` (a Query `this`
 * cannot see sibling blocks), while `scraperService.ts:285` reaches the
 * collection through `updateOne` with no `runValidators` at all — the
 * steady-state path for all 17,644 external listings. Here it is one rule the
 * database enforces on every write path there is or will be, which is exactly
 * why the audit has to check it before the copy: a row that has drifted is a
 * `23514` mid-run otherwise.
 */
const propertiesPlan: DataCollectionPlan = {
  // `availabilityWindowSchema` declares `{ _id: false }`; `Property.images[]`
  // and `documents[]` are implicit `{ _id: true }` subdocuments and keep theirs.
  mintsIds: ['property_availability_windows'],
  name: 'properties',
  sourceCollection: DATA_SOURCE_COLLECTIONS.properties,
  tables: ['properties', 'property_images', 'property_documents', 'property_availability_windows'],
  map: (document, log) => ({
    properties: [toPropertyRow(document, log)],
    property_images: toPropertyImageRows(document, log),
    property_documents: toPropertyDocumentRows(document, log),
    property_availability_windows: toPropertyWindowRows(document, log),
  }),
  rules: {
    properties: [
      ...OFFERING_COHERENCE_RULES,
      ...BLOCK_INTEGRITY_RULES,
      {
        name: 'properties_offerings_check',
        reason: `every element must be one of ${OFFERING_TYPES.join(', ')} (23514)`,
        holds: (row) =>
          !Array.isArray(row.offerings) ||
          row.offerings.every((offering) =>
            (OFFERING_TYPES as readonly string[]).includes(String(offering)),
          ),
        offendingValue: (row) => row.offerings,
      },
      {
        // One-directional on purpose: an internal listing MAY carry a source
        // URL, so only the external half is asserted. A blanket `NOT NULL` would
        // encode the external path — `source_url` is absent from both
        // `CREATABLE_PROPERTY_FIELDS` and `EDITABLE_PROPERTY_FIELDS`, so no
        // user-created listing can ever have one.
        name: 'properties_external_source_url_check',
        reason: 'an external listing must carry the source_url it came from (23514)',
        holds: (row) => row.isExternal !== true || !isAbsent(row.sourceUrl),
        offendingValue: (row) => row.sourceUrl,
      },
    ],
    property_availability_windows: [
      {
        name: 'property_availability_windows_order_check',
        reason: 'ends_at must be after starts_at (23514)',
        holds: (row) =>
          !(row.startsAt instanceof Date) ||
          !(row.endsAt instanceof Date) ||
          row.endsAt.getTime() > row.startsAt.getTime(),
        offendingValue: (row) => [row.startsAt, row.endsAt],
      },
    ],
  },
  uniqueKeys: [
    {
      table: 'properties',
      constraint: 'properties_source_source_id_key',
      // Mongo's partial unique `{ source, sourceId }`. `source` is `NOT NULL
      // DEFAULT 'internal'`, so the default is spelled out here: a row that
      // omits it still occupies the `internal` key space.
      //
      // `JSON.stringify` rather than a separator character. A composite key
      // needs one neither half can contain, and both halves are portal-supplied
      // strings — the obvious unambiguous choice is a NUL byte, which is what
      // #296 removed from this directory: a single NUL makes git classify the
      // file as BINARY, and a binary file has no diff for anyone to review.
      key: (row) =>
        typeof row.sourceId === 'string'
          ? JSON.stringify([typeof row.source === 'string' ? row.source : 'internal', row.sourceId])
          : null,
    },
    {
      table: 'property_images',
      constraint: 'property_images_one_primary_key',
      // PARTIAL: `where is_primary`. A plain unique on
      // `(property_id, is_primary)` would also permit only one NON-primary photo
      // per listing, which is the opposite of a photo list.
      key: (row) => (row.isPrimary === true ? String(row.propertyId) : null),
    },
  ],
  references: [
    reference('properties', 'properties_address_id_addresses_id_fk', 'addressId', 'addresses', 'addresses', false),
    reference('properties', 'properties_agency_id_agencies_id_fk', 'agencyId', 'agencies', 'agencies', true),
    reference('properties', 'properties_sourced_by_partner_id_partners_id_fk', 'sourcedByPartnerId', 'partners', 'partners', true),
    reference('properties', 'properties_parent_property_id_properties_id_fk', 'parentPropertyId', 'properties', 'properties', true),
    reference('property_images', 'property_images_property_id_properties_id_fk', 'propertyId', 'properties', 'properties', false),
    reference('property_images', 'property_images_image_id_images_id_fk', 'imageId', 'images', 'images', false),
    reference('property_documents', 'property_documents_property_id_properties_id_fk', 'propertyId', 'properties', 'properties', false),
    reference('property_availability_windows', 'property_availability_windows_property_id_properties_id_fk', 'propertyId', 'properties', 'properties', false),
  ],
};

/** `properties` ← `models/schemas/PropertySchema.ts`. */
export function toPropertyRow(document: SourceDocument, log: ResolutionLog): CandidateRow {
  const createdAt = createdAtValue(document, log);

  if (readPath(document, 'moderation') === undefined) {
    log.applied(DATA_RESOLUTIONS.MODERATION_ABSENT);
  }
  if (readPath(document, 'listingFlags') === undefined) {
    log.applied(DATA_RESOLUTIONS.LISTING_FLAGS_ABSENT);
  }
  if (readPath(document, 'externalContact') === undefined) {
    log.applied(DATA_RESOLUTIONS.EXTERNAL_CONTACT_ABSENT);
  }
  if (readPath(document, 'priceEthics') === undefined) {
    log.applied(DATA_RESOLUTIONS.PRICE_ETHICS_ABSENT);
  }
  // The stored flag is never written — `db/hasImages.ts` re-derives the column
  // for the whole table after the copy. Counting where the two disagree is what
  // makes "deriving was the right call" a measurement rather than an assertion.
  const embedded = subdocuments(document, 'images');
  if (readPath(document, 'hasImages') !== (embedded.length > 0)) {
    log.applied(DATA_RESOLUTIONS.HAS_IMAGES_DISAGREED);
  }

  return {
    id: idValue(document._id),
    oxyUserId: optional(document, 'oxyUserId'),

    source: withSchemaDefault(document, 'source', 'internal', log),
    sourceId: optional(document, 'sourceId'),
    sourceUrl: optional(document, 'sourceUrl'),
    isExternal: withSchemaDefault(document, 'isExternal', false, log),
    expiresAt: optional(document, 'expiresAt'),

    // RENAMED from Mongo's `sourcedByPartner`: the old name was invisible to
    // `idShapedColumns`, whose `_id` suffix test classifies every id-shaped
    // column in the schema, and a column no gate can see is one that ships
    // unconstrained.
    sourcedByPartnerId: idValue(readPath(document, 'sourcedByPartner')),
    sourcedByReferralCode: optional(document, 'sourcedByReferralCode'),
    agencyId: idValue(readPath(document, 'agencyId')),

    externalContactPhone: optional(document, 'externalContact.phone'),
    externalContactEmail: optional(document, 'externalContact.email'),
    externalContactWhatsapp: optional(document, 'externalContact.whatsapp'),
    externalContactName: optional(document, 'externalContact.name'),
    externalContactAgencyName: optional(document, 'externalContact.agencyName'),
    externalContactKind: optional(document, 'externalContact.kind'),

    listingFlagsStudentsOnly: optional(document, 'listingFlags.studentsOnly'),
    listingFlagsRoomNotFullUnit: optional(document, 'listingFlags.roomNotFullUnit'),
    listingFlagsTemporaryOnly: optional(document, 'listingFlags.temporaryOnly'),
    listingFlagsGenderRestricted: optional(document, 'listingFlags.genderRestricted'),
    listingFlagsWorkersOnly: optional(document, 'listingFlags.workersOnly'),
    listingFlagsAgencyFeePayable: optional(document, 'listingFlags.agencyFeePayable'),
    listingFlagsNoPets: optional(document, 'listingFlags.noPets'),
    listingFlagsNoSmoking: optional(document, 'listingFlags.noSmoking'),
    listingFlagsNoCouples: optional(document, 'listingFlags.noCouples'),
    // `noDSS` in Mongo, `no_dss` here — the one place in this mapping where the
    // source spelling and the column name differ by more than case.
    listingFlagsNoDss: optional(document, 'listingFlags.noDSS'),
    listingFlagsDetectedLanguage: optional(document, 'listingFlags.detectedLanguage'),

    description: optional(document, 'description'),

    addressId: idValue(readPath(document, 'addressId')),
    showAddressNumber: withSchemaDefault(document, 'showAddressNumber', true, log),

    type: withSchemaDefault(document, 'type', 'apartment', log),
    housingType: withSchemaDefault(document, 'housingType', 'private', log),
    layoutType: withSchemaDefault(document, 'layoutType', 'traditional', log),

    bedrooms: withSchemaDefault(document, 'bedrooms', 0, log),
    bathrooms: withSchemaDefault(document, 'bathrooms', 0, log),
    squareFootage: withSchemaDefault(document, 'squareFootage', 0, log),
    floor: withSchemaDefault(document, 'floor', 0, log),
    yearBuilt: optional(document, 'yearBuilt'),

    hasElevator: withSchemaDefault(document, 'hasElevator', false, log),
    hasBalcony: withSchemaDefault(document, 'hasBalcony', false, log),
    hasGarden: withSchemaDefault(document, 'hasGarden', false, log),
    utilitiesIncluded: withSchemaDefault(document, 'utilitiesIncluded', false, log),
    petFriendly: withSchemaDefault(document, 'petFriendly', false, log),
    proximityToTransport: withSchemaDefault(document, 'proximityToTransport', false, log),
    proximityToSchools: withSchemaDefault(document, 'proximityToSchools', false, log),
    proximityToShopping: withSchemaDefault(document, 'proximityToShopping', false, log),
    isVerified: withSchemaDefault(document, 'isVerified', false, log),
    isEcoFriendly: withSchemaDefault(document, 'isEcoFriendly', false, log),

    offerings: withSchemaDefault(document, 'offerings', [], log),
    amenities: withSchemaDefault(document, 'amenities', [], log),

    furnishedStatus: withSchemaDefault(document, 'furnishedStatus', 'not_specified', log),
    petPolicy: withSchemaDefault(document, 'petPolicy', 'not_specified', log),
    petFee: withSchemaDefault(document, 'petFee', 0, log),
    parkingType: withSchemaDefault(document, 'parkingType', 'none', log),
    parkingSpaces: withSchemaDefault(document, 'parkingSpaces', 0, log),
    leaseTerm: withSchemaDefault(document, 'leaseTerm', 'monthly', log),
    cancellationPolicy: optional(document, 'cancellationPolicy'),

    // Carried ALONGSIDE `availability_available_from`, which DISAGREES with it
    // on 1,630 of 17,644 rows while both are present on every one. They are read
    // by different filter paths, so collapsing them would silently change what a
    // filter matches for those listings.
    availableFrom: withSchemaDefault(document, 'availableFrom', createdAt, log),

    smokingAllowed: withSchemaDefault(document, 'smokingAllowed', false, log),
    partiesAllowed: withSchemaDefault(document, 'partiesAllowed', false, log),
    guestsAllowed: withSchemaDefault(document, 'guestsAllowed', true, log),
    maxGuests: withSchemaDefault(document, 'maxGuests', 1, log),

    longTermRentMonthlyAmount: optional(document, 'longTermRent.monthlyAmount'),
    longTermRentCurrency: optional(document, 'longTermRent.currency'),
    longTermRentDeposit: optional(document, 'longTermRent.deposit'),
    longTermRentApplicationFee: optional(document, 'longTermRent.applicationFee'),
    longTermRentLateFee: optional(document, 'longTermRent.lateFee'),
    longTermRentUtilities: optional(document, 'longTermRent.utilities'),

    shortTermRentNightlyRate: optional(document, 'shortTermRent.nightlyRate'),
    shortTermRentCurrency: optional(document, 'shortTermRent.currency'),
    shortTermRentCleaningFee: optional(document, 'shortTermRent.cleaningFee'),
    shortTermRentServiceFee: optional(document, 'shortTermRent.serviceFee'),
    shortTermRentTaxesPercent: optional(document, 'shortTermRent.taxesPercent'),
    shortTermRentMinNights: optional(document, 'shortTermRent.minNights'),
    shortTermRentMaxNights: optional(document, 'shortTermRent.maxNights'),
    shortTermRentInstantBook: optional(document, 'shortTermRent.instantBook'),
    shortTermRentDeposit: optional(document, 'shortTermRent.deposit'),

    salePrice: optional(document, 'sale.price'),
    saleCurrency: optional(document, 'sale.currency'),
    salePricePerSqm: optional(document, 'sale.pricePerSqm'),
    saleEstimatedYield: optional(document, 'sale.estimatedYield'),
    saleIsPriceReduced: optional(document, 'sale.isPriceReduced'),
    saleChainStatus: optional(document, 'sale.chainStatus'),

    exchangeMode: optional(document, 'exchange.mode'),
    exchangeMinStay: optional(document, 'exchange.minStay'),
    exchangeMaxStay: optional(document, 'exchange.maxStay'),
    exchangeWelcomeNote: optional(document, 'exchange.welcomeNote'),
    exchangeLanguages: optional(document, 'exchange.languages'),
    exchangeMealsIncluded: optional(document, 'exchange.mealsIncluded'),
    exchangeRequiresReciprocity: optional(document, 'exchange.requiresReciprocity'),

    accommodationDetailsSleepingArrangement: optional(document, 'accommodationDetails.sleepingArrangement'),
    accommodationDetailsHostelRoomType: optional(document, 'accommodationDetails.hostelRoomType'),
    accommodationDetailsCampsiteType: optional(document, 'accommodationDetails.campsiteType'),
    accommodationDetailsMaxStay: optional(document, 'accommodationDetails.maxStay'),
    accommodationDetailsMinAge: optional(document, 'accommodationDetails.minAge'),
    accommodationDetailsMaxAge: optional(document, 'accommodationDetails.maxAge'),
    accommodationDetailsCulturalExchange: withSchemaDefault(document, 'accommodationDetails.culturalExchange', false, log),
    accommodationDetailsMealsIncluded: withSchemaDefault(document, 'accommodationDetails.mealsIncluded', false, log),
    // PROTECTED — `schema/protectedColumns.ts`. A credential for a real network,
    // on the most-read table in the product; mongoose hid it only by accident.
    accommodationDetailsWifiPassword: optional(document, 'accommodationDetails.wifiPassword'),
    accommodationDetailsRoommatePreferences: withSchemaDefault(document, 'accommodationDetails.roommatePreferences', [], log),
    accommodationDetailsColivingFeatures: withSchemaDefault(document, 'accommodationDetails.colivingFeatures', [], log),
    accommodationDetailsLanguages: withSchemaDefault(document, 'accommodationDetails.languages', [], log),
    accommodationDetailsHouseRules: withSchemaDefault(document, 'accommodationDetails.houseRules', [], log),

    availabilityIsAvailable: withSchemaDefault(document, 'availability.isAvailable', true, log),
    availabilityAvailableFrom: withSchemaDefault(document, 'availability.availableFrom', createdAt, log),
    availabilityMinimumStay: withSchemaDefault(document, 'availability.minimumStay', 1, log),
    availabilityMaximumStay: withSchemaDefault(document, 'availability.maximumStay', 12, log),

    rulesPets: withSchemaDefault(document, 'rules.pets', false, log),
    rulesSmoking: withSchemaDefault(document, 'rules.smoking', false, log),
    rulesParties: withSchemaDefault(document, 'rules.parties', false, log),
    rulesGuests: withSchemaDefault(document, 'rules.guests', true, log),
    rulesMaxOccupancy: withSchemaDefault(document, 'rules.maxOccupancy', 1, log),

    // The `NOT NULL` column of the four absent sub-objects, and the only one
    // that gets a value. See DATA_RESOLUTIONS.MODERATION_ABSENT.
    moderationRestricted: withSchemaDefault(document, 'moderation.restricted', false, log),
    moderationRestrictedAt: optional(document, 'moderation.restrictedAt'),
    moderationRestrictedByDecisionId: optional(document, 'moderation.restrictedByDecisionId'),

    priceEthicsEthicalSuggested: optional(document, 'priceEthics.ethicalSuggested'),
    priceEthicsEthicalMax: optional(document, 'priceEthics.ethicalMax'),
    priceEthicsWithinEthical: optional(document, 'priceEthics.withinEthical'),
    priceEthicsMarketVerdict: optional(document, 'priceEthics.marketVerdict'),
    priceEthicsPercentDiffFromAvg: optional(document, 'priceEthics.percentDiffFromAvg'),
    priceEthicsIsFairPrice: optional(document, 'priceEthics.isFairPrice'),
    priceEthicsFairnessScore: optional(document, 'priceEthics.fairnessScore'),
    priceEthicsScoredAt: optional(document, 'priceEthics.scoredAt'),

    ratingAverage: withSchemaDefault(document, 'rating.average', 0, log),
    ratingCount: withSchemaDefault(document, 'rating.count', 0, log),

    lastSaved: withSchemaDefault(document, 'lastSaved', createdAt, log),
    parentPropertyId: idValue(readPath(document, 'parentPropertyId')),
    status: withSchemaDefault(document, 'status', 'draft', log),
    deletedAt: optional(document, 'deletedAt'),

    createdAt,
    updatedAt: updatedAtValue(document, createdAt, log),
  };
}

/** `property_images` ← `Property.images[]`. */
export function toPropertyImageRows(
  document: SourceDocument,
  log: ResolutionLog,
): readonly CandidateRow[] {
  const propertyId = idValue(document._id);
  const createdAt = createdAtValue(document, log);
  return subdocuments(document, 'images').map((child, index) => ({
    id: mintedSubdocumentId(child, propertyId, 'images', index, createdAt, log),
    propertyId,
    imageId: idValue(readPath(child, 'imageId')),
    url: optional(child, 'url'),
    caption: optional(child, 'caption'),
    isPrimary: withSchemaDefault(child, 'isPrimary', false, log),
    order: withSchemaDefault(child, 'order', 0, log),
    // The `urls` sub-document, flattened. Nullable because Mongo declared it
    // `default: undefined` precisely so pre-Image entries still validate.
    urlsOriginal: optional(child, 'urls.original'),
    urlsSmall: optional(child, 'urls.small'),
    urlsMedium: optional(child, 'urls.medium'),
    urlsLarge: optional(child, 'urls.large'),
  }));
}

/** `property_documents` ← `Property.documents[]`. */
export function toPropertyDocumentRows(
  document: SourceDocument,
  log: ResolutionLog,
): readonly CandidateRow[] {
  const propertyId = idValue(document._id);
  const createdAt = createdAtValue(document, log);
  return subdocuments(document, 'documents').map((child, index) => ({
    id: mintedSubdocumentId(child, propertyId, 'documents', index, createdAt, log),
    propertyId,
    name: optional(child, 'name'),
    url: optional(child, 'url'),
    type: withSchemaDefault(child, 'type', 'other', log),
  }));
}

/**
 * `property_availability_windows` ← BOTH calendars.
 *
 * Mongo declared `availabilityWindowSchema` twice — on the listing and inside
 * the exchange block — so "does anything overlap this range?" had to be asked
 * against two arrays with two sets of indexes. One table plus a `scope`
 * discriminator makes it one question answered by one GiST index over
 * `tstzrange(starts_at, ends_at)`.
 *
 * Every window here mints its id: the sub-schema declares `{ _id: false }`, so
 * there is none to preserve.
 */
export function toPropertyWindowRows(
  document: SourceDocument,
  log: ResolutionLog,
): readonly CandidateRow[] {
  const propertyId = idValue(document._id);
  const createdAt = createdAtValue(document, log);
  // The path is part of the natural key, so the two calendars cannot collide
  // even at the same index — `availabilityWindows[0]` and
  // `exchange.availabilityWindows[0]` are different rows of the same table.
  const windows = (path: string, scope: 'listing' | 'exchange') =>
    subdocuments(document, path).map((child, index) => ({
      id: mintedSubdocumentId(child, propertyId, path, index, createdAt, log),
      propertyId,
      scope,
      // Mongo's `start` / `end`. Renamed because `end` is a reserved word and
      // the pair reads better together.
      startsAt: optional(child, 'start'),
      endsAt: optional(child, 'end'),
      status: withSchemaDefault(child, 'status', 'available', log),
    }));

  return [
    ...windows('availabilityWindows', 'listing'),
    ...windows('exchange.availabilityWindows', 'exchange'),
  ];
}

// ── profiles ───────────────────────────────────────────────────────

/**
 * `profiles` ← `models/schemas/ProfileSchema.ts`. Five rows, and the ONLY
 * irreplaceable data in this backfill.
 *
 * Properties, addresses and images are regenerable — the ingestion worker
 * rebuilds them from the portals. A tenant's profile is not: nobody re-enters an
 * income, a rental history, a set of references or a Sindi transcript, and there
 * is no upstream to re-scrape it from. Five rows is small enough that `data.ts`
 * verifies them exhaustively rather than by sample.
 *
 * ## The `personalProfile` wrapper is DROPPED from every column name
 *
 * A hard limit, not a style choice:
 * `personalProfile.settings.roommate.preferences.lifestyle.cleanliness` spells
 * out to 68 bytes and Postgres truncates an identifier at 63 SILENTLY, so two
 * paths differing only past byte 63 would collide into one column.
 *
 * ## Every column is NULLABLE, including the ones with a Mongoose default
 *
 * `personalProfile` is declared with no `default`, so mongoose never
 * materialises it and none of its defaults are ever written. Column nullness is
 * the only representation of the block being absent once it is flattened away —
 * which is why nothing here uses `withSchemaDefault`.
 */
const profilesPlan: DataCollectionPlan = {
  // Every profile array is an implicit `{ _id: true }` subdocument.
  mintsIds: [],
  name: 'profiles',
  sourceCollection: DATA_SOURCE_COLLECTIONS.profiles,
  tables: [
    'profiles',
    'profile_references',
    'profile_rental_history',
    'profile_preferred_locations',
    'profile_roommate_history',
    'profile_chat_messages',
  ],
  map: (document, log) => ({
    profiles: [toProfileRow(document, log)],
    profile_references: toProfileReferenceRows(document, log),
    profile_rental_history: toProfileRentalHistoryRows(document, log),
    profile_preferred_locations: toProfilePreferredLocationRows(document, log),
    profile_roommate_history: toProfileRoommateHistoryRows(document, log),
    profile_chat_messages: toProfileChatMessageRows(document, log),
  }),
  rules: {
    profile_rental_history: [dateOrderRule('profile_rental_history_order_check')],
    profile_roommate_history: [dateOrderRule('profile_roommate_history_order_check')],
  },
  uniqueKeys: [
    {
      table: 'profiles',
      constraint: 'profiles_oxy_user_id_key',
      key: (row) => (typeof row.oxyUserId === 'string' ? row.oxyUserId : null),
    },
  ],
  references: [
    reference('profile_references', 'profile_references_profile_id_profiles_id_fk', 'profileId', 'profiles', 'profiles', false),
    reference('profile_rental_history', 'profile_rental_history_profile_id_profiles_id_fk', 'profileId', 'profiles', 'profiles', false),
    reference('profile_preferred_locations', 'profile_preferred_locations_profile_id_profiles_id_fk', 'profileId', 'profiles', 'profiles', false),
    reference('profile_roommate_history', 'profile_roommate_history_profile_id_profiles_id_fk', 'profileId', 'profiles', 'profiles', false),
    reference('profile_chat_messages', 'profile_chat_messages_profile_id_profiles_id_fk', 'profileId', 'profiles', 'profiles', false),
  ],
};

/** `profiles` ← `models/schemas/ProfileSchema.ts`, wrapper dropped. */
export function toProfileRow(document: SourceDocument, log: ResolutionLog): CandidateRow {
  const createdAt = createdAtValue(document, log);
  const field = (path: string) => optional(document, `personalProfile.${path}`);

  return {
    id: idValue(document._id),
    oxyUserId: optional(document, 'oxyUserId'),

    personalInfoBio: field('personalInfo.bio'),
    personalInfoOccupation: field('personalInfo.occupation'),
    personalInfoEmployer: field('personalInfo.employer'),
    // PROTECTED — `schema/protectedColumns.ts`. `showIncome` defaults to false,
    // so this has never been part of a public profile.
    personalInfoAnnualIncome: field('personalInfo.annualIncome'),
    personalInfoEmploymentStatus: field('personalInfo.employmentStatus'),
    personalInfoMoveInDate: field('personalInfo.moveInDate'),
    personalInfoLeaseDuration: field('personalInfo.leaseDuration'),

    preferencesPropertyTypes: field('preferences.propertyTypes'),
    preferencesMaxRent: field('preferences.maxRent'),
    preferencesPriceUnit: field('preferences.priceUnit'),
    preferencesMinBedrooms: field('preferences.minBedrooms'),
    preferencesMinBathrooms: field('preferences.minBathrooms'),
    preferencesPreferredAmenities: field('preferences.preferredAmenities'),
    preferencesPetFriendly: field('preferences.petFriendly'),
    preferencesSmokingAllowed: field('preferences.smokingAllowed'),
    preferencesFurnished: field('preferences.furnished'),
    preferencesParkingRequired: field('preferences.parkingRequired'),
    preferencesAccessibility: field('preferences.accessibility'),

    verificationIdentity: field('verification.identity'),
    verificationIncome: field('verification.income'),
    verificationBackground: field('verification.background'),
    verificationRentalHistory: field('verification.rentalHistory'),
    verificationReferences: field('verification.references'),

    settingsNotificationsEmail: field('settings.notifications.email'),
    settingsNotificationsPush: field('settings.notifications.push'),
    settingsNotificationsSms: field('settings.notifications.sms'),
    settingsNotificationsPropertyAlerts: field('settings.notifications.propertyAlerts'),
    settingsNotificationsViewingReminders: field('settings.notifications.viewingReminders'),
    settingsNotificationsLeaseUpdates: field('settings.notifications.leaseUpdates'),

    settingsPrivacyProfileVisibility: field('settings.privacy.profileVisibility'),
    settingsPrivacyShowContactInfo: field('settings.privacy.showContactInfo'),
    settingsPrivacyShowIncome: field('settings.privacy.showIncome'),
    settingsPrivacyShowRentalHistory: field('settings.privacy.showRentalHistory'),
    settingsPrivacyShowReferences: field('settings.privacy.showReferences'),

    settingsRoommateEnabled: field('settings.roommate.enabled'),
    settingsRoommatePreferencesAgeRangeMin: field('settings.roommate.preferences.ageRange.min'),
    settingsRoommatePreferencesAgeRangeMax: field('settings.roommate.preferences.ageRange.max'),
    settingsRoommatePreferencesGender: field('settings.roommate.preferences.gender'),
    settingsRoommatePreferencesLifestyleSmoking: field('settings.roommate.preferences.lifestyle.smoking'),
    settingsRoommatePreferencesLifestylePets: field('settings.roommate.preferences.lifestyle.pets'),
    settingsRoommatePreferencesLifestylePartying: field('settings.roommate.preferences.lifestyle.partying'),
    settingsRoommatePreferencesLifestyleCleanliness: field('settings.roommate.preferences.lifestyle.cleanliness'),
    settingsRoommatePreferencesLifestyleSchedule: field('settings.roommate.preferences.lifestyle.schedule'),
    settingsRoommatePreferencesBudgetMin: field('settings.roommate.preferences.budget.min'),
    settingsRoommatePreferencesBudgetMax: field('settings.roommate.preferences.budget.max'),
    settingsRoommatePreferencesMoveInDate: field('settings.roommate.preferences.moveInDate'),
    settingsRoommatePreferencesLeaseDuration: field('settings.roommate.preferences.leaseDuration'),

    settingsLanguage: field('settings.language'),
    settingsTimezone: field('settings.timezone'),
    settingsCurrency: field('settings.currency'),

    createdAt,
    updatedAt: updatedAtValue(document, createdAt, log),
  };
}

/** `profile_references` ← `personalProfile.references[]`. */
export function toProfileReferenceRows(
  document: SourceDocument,
  log: ResolutionLog,
): readonly CandidateRow[] {
  const profileId = idValue(document._id);
  const createdAt = createdAtValue(document, log);
  return subdocuments(document, 'personalProfile.references').map((child, index) => ({
    id: mintedSubdocumentId(child, profileId, 'personalProfile.references', index, createdAt, log),
    profileId,
    name: optional(child, 'name'),
    relationship: optional(child, 'relationship'),
    phone: optional(child, 'phone'),
    email: optional(child, 'email'),
    verified: withSchemaDefault(child, 'verified', false, log),
  }));
}

/** `profile_rental_history` ← `personalProfile.rentalHistory[]`. */
export function toProfileRentalHistoryRows(
  document: SourceDocument,
  log: ResolutionLog,
): readonly CandidateRow[] {
  const profileId = idValue(document._id);
  const createdAt = createdAtValue(document, log);
  return subdocuments(document, 'personalProfile.rentalHistory').map((child, index) => ({
    id: mintedSubdocumentId(child, profileId, 'personalProfile.rentalHistory', index, createdAt, log),
    profileId,
    address: optional(child, 'address'),
    startDate: optional(child, 'startDate'),
    endDate: optional(child, 'endDate'),
    monthlyRent: optional(child, 'monthlyRent'),
    reasonForLeaving: optional(child, 'reasonForLeaving'),
    landlordContactName: optional(child, 'landlordContact.name'),
    landlordContactPhone: optional(child, 'landlordContact.phone'),
    landlordContactEmail: optional(child, 'landlordContact.email'),
    verified: withSchemaDefault(child, 'verified', false, log),
  }));
}

/**
 * `profile_preferred_locations` ← `personalProfile.preferences.preferredLocations[]`.
 *
 * `radius` keeps Mongo's units, which are MILES (the validator reads "Radius
 * must be at least 1 mile"). Nothing converts it and the column does not claim
 * otherwise.
 */
export function toProfilePreferredLocationRows(
  document: SourceDocument,
  log: ResolutionLog,
): readonly CandidateRow[] {
  const profileId = idValue(document._id);
  const createdAt = createdAtValue(document, log);
  return subdocuments(document, 'personalProfile.preferences.preferredLocations').map((child, index) => ({
    id: mintedSubdocumentId(child, profileId, 'personalProfile.preferences.preferredLocations', index, createdAt, log),
    profileId,
    city: optional(child, 'city'),
    state: optional(child, 'state'),
    radius: optional(child, 'radius'),
  }));
}

/** `profile_roommate_history` ← `personalProfile.settings.roommate.history[]`. */
export function toProfileRoommateHistoryRows(
  document: SourceDocument,
  log: ResolutionLog,
): readonly CandidateRow[] {
  const profileId = idValue(document._id);
  const createdAt = createdAtValue(document, log);
  return subdocuments(document, 'personalProfile.settings.roommate.history').map((child, index) => ({
    id: mintedSubdocumentId(child, profileId, 'personalProfile.settings.roommate.history', index, createdAt, log),
    profileId,
    startDate: optional(child, 'startDate'),
    endDate: optional(child, 'endDate'),
    location: optional(child, 'location'),
    roommateCount: optional(child, 'roommateCount'),
    reason: optional(child, 'reason'),
  }));
}

/**
 * `profile_chat_messages` ← `personalProfile.chatHistory[]`.
 *
 * `position` is the ARRAY INDEX, and it is the transcript's meaning. `timestamp`
 * cannot substitute: it defaults to `Date.now` at millisecond resolution, so two
 * messages appended in the same tick sort arbitrarily.
 */
export function toProfileChatMessageRows(
  document: SourceDocument,
  log: ResolutionLog,
): readonly CandidateRow[] {
  const profileId = idValue(document._id);
  const createdAt = createdAtValue(document, log);
  return subdocuments(document, 'personalProfile.chatHistory').map((child, position) => ({
    id: mintedSubdocumentId(child, profileId, 'personalProfile.chatHistory', position, createdAt, log),
    profileId,
    role: optional(child, 'role'),
    content: optional(child, 'content'),
    timestamp: withSchemaDefault(child, 'timestamp', createdAt, log),
    position,
  }));
}

// ── the plans, and the rules that could not be derived ─────────────

/** Every collection, in the ONE order that satisfies the foreign-key graph. */
export const DATA_PLANS: Readonly<Record<DataCollectionName, DataCollectionPlan>> = {
  images: imagesPlan,
  addresses: addressesPlan,
  agencies: agenciesPlan,
  properties: propertiesPlan,
  profiles: profilesPlan,
};

/**
 * The drizzle table each SQL name refers to.
 *
 * It carries the PARENT tables too — `countries`, `regions`, `cities`,
 * `neighborhoods`, `partners` — even though nothing here writes them. The
 * foreign-key audit resolves a reference against the parent table by name, so a
 * parent missing from this map is not a silent skip: `requireTable` refuses,
 * because a reference check that cannot find its table resolves nothing and
 * reports success exactly as loudly as one that passed.
 */
export const DATA_TABLES: Readonly<Record<string, PgTable>> = {
  countries,
  regions,
  cities,
  neighborhoods,
  partners,
  images,
  addresses,
  agencies,
  properties,
  property_images: propertyImages,
  property_documents: propertyDocuments,
  property_availability_windows: propertyAvailabilityWindows,
  profiles,
  profile_references: profileReferences,
  profile_rental_history: profileRentalHistory,
  profile_preferred_locations: profilePreferredLocations,
  profile_roommate_history: profileRoommateHistory,
  profile_chat_messages: profileChatMessages,
};

/** `end is null or end >= start`, as both profile history tables spell it. */
function dateOrderRule(constraint: string): RowRule {
  return {
    name: constraint,
    reason: 'end_date must be null or on/after start_date (23514)',
    holds: (row) => {
      const start = row.startDate;
      const end = row.endDate;
      if (!(start instanceof Date) || !(end instanceof Date)) return true;
      return end.getTime() >= start.getTime();
    },
    offendingValue: (row) => [row.startDate, row.endDate],
  };
}

/** `length(x) > 0`. An absent value fails NOT NULL first, and is not re-reported. */
function notEmptyRule(constraint: string, column: string): RowRule {
  return {
    name: constraint,
    reason: `${column} must not be an empty string (23514)`,
    holds: (row) => typeof row[column] !== 'string' || row[column].length > 0,
    offendingValue: (row) => row[column],
  };
}

function reference(
  table: string,
  constraint: string,
  column: string,
  parentTable: string,
  parentCollection: string | null,
  nullable: boolean,
): ReferenceSpec {
  return { table, constraint, column, parentTable, parentCollection, nullable };
}

/** A column that will be NULL in Postgres. */
function isAbsent(value: unknown): boolean {
  return value === undefined || value === null;
}

/**
 * A present value within bounds.
 *
 * An ABSENT one passes: it fails `NOT NULL` instead, which the column scan
 * reports — and one defect reported under two names reads as two defects.
 */
function inRange(value: unknown, low: number, high: number): boolean {
  if (typeof value !== 'number') return true;
  return value >= low && value <= high;
}

/**
 * The elements of an embedded array, or none.
 *
 * A non-array is handed to the audit rather than salvaged, exactly as every
 * other reader here does: the mappers PRESERVE what was stored so `rowAudit`
 * reports it.
 */
function subdocuments(document: SourceDocument, path: string): readonly SourceDocument[] {
  const value = readPath(document, path);
  if (!Array.isArray(value)) return [];
  return value.filter(
    (element): element is SourceDocument =>
      typeof element === 'object' && element !== null && !Array.isArray(element),
  );
}

/**
 * A subdocument's id: its own `_id` when it has one, else a DETERMINISTIC uuid
 * v7 derived from where it sits.
 *
 * The DOCUMENT is asked rather than a hand-written list of which arrays declare
 * `{ _id: false }` — that is one word in a schema file, and
 * `availabilityWindowSchema` carries it while `MIGRATION-CONTRACT.md`'s table
 * (now corrected) did not list it.
 *
 * ## Why the minted id may not be random
 *
 * A random primary key and `ON CONFLICT DO NOTHING` cannot both hold. Every
 * insert here is `ON CONFLICT DO NOTHING` precisely so a run that died half way
 * is a POSITION rather than a mess — and a freshly-random key never conflicts,
 * so a second run would not skip those rows, it would DUPLICATE every one of
 * them. That is the resumed-partial-run case the idempotence rule exists for,
 * so the two rules met head-on and the random mint lost.
 *
 * Deterministic from the position the row occupies — parent, path, index — so
 * the same source document produces the same id on every run. Same reasoning
 * that already makes `moderation_outbox.id` deterministic: where the id IS the
 * deduplication mechanism, minting a fresh one deletes it.
 *
 * Latent rather than active when written: production holds ZERO availability
 * windows, so no row has ever taken this path. It would have fired the first
 * time a listing grew a calendar and the copy was re-run — which is the shape of
 * bug that ships because nothing exercises it.
 */
function mintedSubdocumentId(
  child: SourceDocument,
  parentId: unknown,
  path: string,
  index: number,
  parentCreatedAt: unknown,
  log: ResolutionLog,
): unknown {
  const stored = child._id;
  if (stored !== undefined && stored !== null) return idValue(stored);
  log.applied(DATA_RESOLUTIONS.SUBDOCUMENT_ID_MINTED);
  return deterministicUuidV7(parentCreatedAt, `${String(parentId)}|${path}|${index}`);
}

/**
 * A uuid v7 that is a pure function of its inputs.
 *
 * The 74 random bits become the leading bytes of `sha256(naturalKey)`; the
 * 48-bit timestamp prefix is the PARENT's own `created_at`, so the ids stay
 * k-sortable and the primary-key btree stays append-mostly instead of scattering
 * inserts across the keyspace. The version and variant nibbles are pinned
 * exactly as `@oxyhq/db`'s `uuidv7` pins them, which is what keeps
 * `isLiveEntityId` accepting the result.
 *
 * **The fallback for an unusable timestamp is the Unix epoch, never
 * `Date.now()`.** `Date.now()` there would silently reintroduce the entire bug
 * for exactly the rows whose timestamps are broken — their ids would differ
 * between two runs and duplicate on a re-run — and it is the hardest version to
 * notice, because it only affects rows already known to be odd.
 *
 * Derived from the implementation `homiio-backfill-2` wrote and verified
 * against the real `isLiveEntityId`.
 */
export function deterministicUuidV7(timestamp: unknown, naturalKey: string): string {
  const digest = createHash('sha256').update(naturalKey).digest();
  const bytes = new Uint8Array(UUID_BYTES);
  bytes.set(digest.subarray(0, UUID_BYTES));

  const instant =
    timestamp instanceof Date && !Number.isNaN(timestamp.getTime()) ? timestamp.getTime() : 0;
  let milliseconds = Math.max(0, Math.floor(instant));
  for (let index = UUID_V7_TIMESTAMP_BYTES - 1; index >= 0; index -= 1) {
    bytes[index] = milliseconds & 0xff;
    milliseconds = Math.floor(milliseconds / 256);
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Bytes in a UUID, and how many of them the v7 timestamp occupies. */
const UUID_BYTES = 16;
const UUID_V7_TIMESTAMP_BYTES = 6;

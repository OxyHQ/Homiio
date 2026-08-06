/**
 * `properties` and its three child tables — the listing, and the largest table
 * in the migration.
 *
 * Ported from `models/schemas/PropertySchema.ts` (1,207 lines) and
 * `models/schemas/offeringValidation.ts`. A property has no coordinates of its
 * own: it reaches its place through `address_id`, which is why `addresses` had
 * to land first.
 *
 * See `CONVENTIONS.md` for the rules every decision follows. What is decided
 * HERE, and could not be decided there, is below.
 *
 * ## Flattening, and what it costs
 *
 * Twelve Mongo subdocuments become columns rather than child tables:
 * `longTermRent`, `shortTermRent`, `sale`, `exchange`, `externalContact`,
 * `listingFlags`, `accommodationDetails`, `availability`, `rules`,
 * `moderation`, `priceEthics`, `rating`. Every one has a KNOWN, CLOSED shape
 * and a 1:0..1 cardinality, and — the deciding property — they are FILTER AND
 * SORT targets. `long_term_rent_monthly_amount` is the price sort of the
 * primary feed; a child table would put a join in front of it.
 *
 * Column names keep the Mongo path (`longTermRent.monthlyAmount` →
 * `long_term_rent_monthly_amount`), the same rule `images.keys_medium` follows,
 * because it is what lets the backfill's column-coverage check map source to
 * target mechanically rather than through a hand-written table of exceptions.
 *
 * **Flattening an OPTIONAL subdocument makes every one of its columns
 * NULLABLE, including the ones whose sub-schema declares a default.** Column
 * nullness is the only representation of block ABSENCE once the block is gone,
 * so `long_term_rent_currency` (Mongo default `'EUR'`) and
 * `exchange_meals_included` (Mongo default `false`) are nullable even though a
 * present block always carries them. Measured on this repository's mongoose
 * 8.24.1 rather than assumed: a sub-schema declared `default: undefined` does
 * not materialize, so none of its defaults are ever written; a sub-schema
 * declared `default: {}` (`availability`, `rules`) DOES, and so does a NESTED
 * PATH carrying at least one default (`moderation`, `rating`,
 * `accommodationDetails`) — including empty arrays for its array members. Those
 * are the ones that get `NOT NULL DEFAULT`.
 *
 * That nullability is not a compromise: it is exactly what makes the four
 * offering CHECKs at the bottom of this file expressible.
 *
 * ## Four sub-objects are SPARSE in production, and each gets a different answer
 *
 * The mongoose probe above says what a document CONSTRUCTED today carries. It
 * does not say what production holds, and for four sub-objects those differ —
 * measured, after the first draft of this file assumed they agreed:
 *
 * | sub-object | absent on | answer |
 * |---|--:|---|
 * | `moderation` | **17,642 of 17,644** | `NOT NULL DEFAULT false` + a NAMED backfill derivation |
 * | `listingFlags` | 9,594 | every column NULLABLE — the flags are THREE-state |
 * | `externalContact` | 5,174 | every column NULLABLE |
 * | `priceEthics` | 133 | every column NULLABLE |
 *
 * `rating`, `accommodationDetails`, `availability` and `rules` are present on
 * all 17,644 and keep their `NOT NULL DEFAULT`s.
 *
 * The rule this is an instance of: **a `NOT NULL` on a subfield is only safe
 * when the SUB-OBJECT is present on every row, not when the FIELD has a default
 * in the schema.** A default only fires when mongoose materializes the parent,
 * and three of the four above show it did not. Where the column still takes
 * `NOT NULL DEFAULT`, the backfill must supply the value under a named rule or
 * OMIT the column and let the DEFAULT fire — it must never write NULL.
 *
 * `listingFlags` is the one that must NOT copy `moderation`'s answer, and the
 * reason is semantic rather than statistical: those booleans distinguish `true`
 * (the classifier fired), `false` (it looked and said no) and NULL (it never
 * ran). Defaulting 9,594 rows to `false` would manufacture a claim about them
 * that nobody made.
 *
 * ## Numbers
 *
 * Every ported Mongo `Number` is `double precision`, including the ones that
 * look integral (`bedrooms`, `max_guests`, `year_built`). A Mongo `Number` is
 * an unconstrained double, portals write `bathrooms: 1.5` and
 * `square_footage: 85.5`, and `integer` is a NARROWING — the same class of
 * change as a range validator, which CONVENTIONS.md defers until the census has
 * measured the real values. Three exceptions, each a value the APPLICATION
 * generates rather than one a portal sends: `rating_count` (a counter
 * `updateRating` increments), `property_images.order` (a loop index), and
 * `views` (see below).
 */

import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  pgTable,
  text,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  createdAt,
  generatedId,
  inList,
  textArrayLiteral,
  timestamptz,
  tsvector,
  updatedAt,
} from '@oxyhq/db';
import {
  AvailabilityWindowStatus,
  CancellationPolicy,
  ExchangeMode,
  HousingType,
  LayoutType,
  LeaseDuration,
  LISTING_CURRENCIES,
  OfferingType,
  PROVIDER_IDS,
  PropertyStatus,
  PropertyType,
  UtilitiesIncluded,
} from '@homiio/shared-types';
import { TEXT_SEARCH_CONFIGURATION } from '../extensions';
import { addresses } from './addresses';
import { images } from './images';

/**
 * ## How every vocabulary below was derived
 *
 * `code_union ∪ distinct(production)`, never the code alone — because
 * `services/scraperService.ts:285` upserts external listings with `updateOne`,
 * which runs NO validators and is the STEADY-STATE path for all 17,644 rows in
 * production. Portal values arrive behind nothing but `??`
 * (`type: raw.type || 'apartment'`, `currency: raw.rent?.currency ?? 'EUR'`,
 * `furnishedStatus: raw.furnishedStatus ?? 'unfurnished'`,
 * `status: raw.status ?? 'published'`), and the provider package's own
 * `normalizeCurrency` accepts any non-empty string. Four fields can therefore
 * hold arbitrary portal strings today: `type`, `*_currency`, `furnished_status`
 * and `status`.
 *
 * The Phase-0 census swept `distinct()` over all 45 enum-bearing paths on the
 * ten populated collections and found **zero undeclared values**, by two
 * independent methods (a `$sortByCount` facet and a `distinct()` sweep, 45/45
 * in agreement). So the code union and the data agree TODAY — but the CHECK is
 * still written from the union, because it has to accept the markets already
 * wired in `AGENTS.md` and not yet ingested. `long_term_rent_currency` observes
 * six codes in production and `LISTING_CURRENCIES` declares fifteen; a CHECK
 * built from the observed six would reject the first Romanian (`RON`) or
 * Colombian (`COP`) listing the worker ingests.
 *
 * ``satisfies readonly `${Enum}`[]`` on each tuple makes a renamed or deleted
 * member of the shared enum a compile error here. It does NOT catch a member
 * ADDED to the enum — that direction belongs to the pre-backfill audit, which
 * reads the real values rather than guessing at compile time.
 *
 * The template-literal spelling is required, not stylistic: `PropertyType` and
 * friends are TypeScript `enum`s rather than string-literal unions, and a bare
 * `'apartment'` is NOT assignable to an enum type — so
 * `satisfies readonly PropertyType[]` fails to compile on every member and
 * would tempt whoever hits it into deleting the check. `` `${PropertyType}` ``
 * resolves the enum to the union of its VALUES, which is what these tuples
 * actually hold and what `text({ enum: … })` needs. `LISTING_CURRENCIES` needs
 * none of this: it is already a `const` tuple.
 */
export const PROPERTY_TYPES = [
  'apartment',
  'house',
  'room',
  'studio',
  'couchsurfing',
  'roommates',
  'coliving',
  'hostel',
  'guesthouse',
  'campsite',
  'boat',
  'treehouse',
  'yurt',
  'other',
] as const satisfies readonly `${PropertyType}`[];

/**
 * Deliberately WITHOUT `restricted`, and that is not an omission.
 *
 * `PropertySchema.ts:686-702` explains it: `status` is user-editable, so a
 * `restricted` status would both stay visible in listings AND be clearable by
 * the very owner whose listing a jury restricted. The moderation path writes
 * the separate boolean `moderation_restricted` instead. Adding `restricted`
 * here would legitimize a value no write path produces and one the product
 * design specifically rejects.
 */
export const PROPERTY_STATUSES = [
  'draft',
  'published',
  'reserved',
  'rented',
  'sold',
  'inactive',
  'archived',
] as const satisfies readonly `${PropertyStatus}`[];

/**
 * Where a listing came from.
 *
 * The census found this to be a REAL closed vocabulary that no Mongoose `enum`
 * declares — 15 distinct values across 17,644 rows, and it is half of the
 * `(source, source_id)` unique key. It is written from the registered-provider
 * union rather than from those 15, because the observed set is the history of
 * what has ever been ingested, not the domain: freezing it would break the
 * first `PROVIDER_*_ENABLED` anyone turns on.
 *
 * Two members are load-bearing and neither is obvious:
 *
 *  - **`fixture`** is `PROVIDER_IDS`' local-JSON test provider, and there are
 *    real rows carrying it IN PRODUCTION. A CHECK without it kills the copy.
 *    Purging them is a separate decision, taken with the count in front of you.
 *  - **`internal`** is the Mongoose DEFAULT (`PropertySchema.ts:244`) and is
 *    therefore what every user-created listing carries. The census observed
 *    zero of them only because production holds zero user-created listings
 *    (`oxy_user_id` is absent on all 17,644 rows). A CHECK built from the
 *    observed values would reject the first property a user ever creates —
 *    which is the exact shape of failure that makes "derive from the union, not
 *    from the data" the rule rather than a preference.
 */
export const PROPERTY_SOURCES = ['internal', ...PROVIDER_IDS] as const;

export const HOUSING_TYPES = ['private', 'public'] as const satisfies readonly `${HousingType}`[];

export const LAYOUT_TYPES = [
  'open',
  'shared',
  'partitioned',
  'traditional',
  'studio',
  'other',
] as const satisfies readonly `${LayoutType}`[];

export const OFFERING_TYPES = [
  'long_term_rent',
  'short_term_rent',
  'sale',
  'exchange',
] as const satisfies readonly `${OfferingType}`[];

export const UTILITIES_INCLUDED = [
  'included',
  'excluded',
  'partial',
] as const satisfies readonly `${UtilitiesIncluded}`[];

export const LEASE_TERMS = [
  'monthly',
  '3_months',
  '6_months',
  'yearly',
  'flexible',
] as const satisfies readonly `${LeaseDuration}`[];

export const CANCELLATION_POLICIES = [
  'flexible',
  'moderate',
  'strict',
  'super_strict',
] as const satisfies readonly `${CancellationPolicy}`[];

export const EXCHANGE_MODES = ['swap', 'host', 'both'] as const satisfies readonly `${ExchangeMode}`[];

export const AVAILABILITY_WINDOW_STATUSES = [
  'available',
  'blocked',
  'booked',
] as const satisfies readonly `${AvailabilityWindowStatus}`[];

/**
 * The four vocabularies below are declared INLINE in the Mongoose schema and
 * have no `shared-types` counterpart at all, so there is nothing to `satisfies`
 * them against. That absence is itself the drift risk the enum audit flagged:
 * the frontend and the backend each spell them out separately today.
 */
export const FURNISHED_STATUSES = [
  'furnished',
  'unfurnished',
  'partially_furnished',
  'not_specified',
] as const;

export const PET_POLICIES = [
  'allowed',
  'not_allowed',
  'case_by_case',
  'not_specified',
] as const;

export const PARKING_TYPES = ['none', 'street', 'assigned', 'garage'] as const;

export const SALE_CHAIN_STATUSES = ['no_chain', 'chain', 'unknown'] as const;

/** Whether the advertiser is a private owner or an agency, when the portal says. */
export const EXTERNAL_CONTACT_KINDS = ['owner', 'agency', 'private', 'unknown'] as const;

/**
 * The language `classifyListingContent` detected in the listing's free text.
 *
 * Provider-written, and the census confirms the seven declared values are
 * exactly what production holds (`de` 3,797 · `es` 2,168 · `en` 1,530 ·
 * `fr` 163 · `nl` 55 · `it` 9 · `ca` 1) — with 9,921 of 17,644 rows carrying no
 * detection at all. That distribution is also why the text-search configuration
 * is `homiio_simple` and not a stemmer: the corpus is multilingual with GERMAN
 * in front, so both `'english'` and `'spanish'` would be wrong for most of it.
 */
export const DETECTED_LANGUAGES = ['es', 'ca', 'en', 'fr', 'nl', 'de', 'it'] as const;

export const PROPERTY_DOCUMENT_TYPES = ['lease', 'inspection', 'insurance', 'other'] as const;

export const MARKET_VERDICTS = [
  'good_deal',
  'below_average',
  'average',
  'above_average',
] as const;

export const SLEEPING_ARRANGEMENTS = [
  'couch',
  'air_mattress',
  'floor',
  'tent',
  'hammock',
] as const;

export const HOSTEL_ROOM_TYPES = [
  'dormitory',
  'private_room',
  'mixed_dorm',
  'female_dorm',
  'male_dorm',
] as const;

export const CAMPSITE_TYPES = [
  'tent_site',
  'rv_site',
  'cabin',
  'glamping',
  'backcountry',
] as const;

/**
 * Which calendar a window belongs to.
 *
 * Mongo declared `availabilityWindowSchema` TWICE — once on
 * `Property.availabilityWindows` and once inside `Property.exchange
 * .availabilityWindows` — with the identical sub-schema. One table with a
 * discriminator means one calendar-overlap query instead of two, and it is why
 * the GiST index below can serve both.
 */
export const AVAILABILITY_WINDOW_SCOPES = ['listing', 'exchange'] as const;

export const properties = pgTable(
  'properties',
  {
    id: generatedId(),

    /**
     * The owner, when there is one.
     *
     * NULLABLE, and measured: `oxy_user_id` is ABSENT on all 17,644 production
     * rows — every listing in production today is an external aggregator
     * listing with no owner. Mongoose declared it
     * `required: !this.isExternal`, a conditional that Postgres could express
     * as a CHECK — and deliberately does not, because that CHECK would also
     * have to encode `isExternal`'s own write rule (the `pre('save')` hook
     * CLEARS `oxyUserId` whenever `isExternal` is true), and encoding half of a
     * two-sided invariant is worse than encoding none of it.
     *
     * No foreign key, ever: Oxy owns identity and this is a foreign service's
     * primary key. See `deferredForeignKeys.ts`.
     */
    oxyUserId: text(),

    // ── External sourcing ──
    /** Which portal (or `internal`) this listing came from. */
    source: text({ enum: PROPERTY_SOURCES }).notNull().default('internal'),
    /** The portal's OWN identifier for the ad. Half of the dedup key. */
    sourceId: text(),
    /**
     * The ad's canonical URL on the portal. The only CTA an external listing
     * offers.
     *
     * **NULLABLE, and deliberately not `NOT NULL` — despite being present and
     * non-empty on 17,644 of 17,644 production rows.** That measurement is real
     * and its POPULATION IS BIASED: production contains only external
     * aggregator listings (`oxy_user_id` absent on every row). `source_url` has
     * exactly one writer, `scraperService.ts:276` (plus `IngestionService`), and
     * it is absent from BOTH `CREATABLE_PROPERTY_FIELDS` and
     * `EDITABLE_PROPERTY_FIELDS` — so no user-created listing can ever carry
     * one, and a blanket `NOT NULL` would turn `POST /api/properties` into a
     * guaranteed `23502` the first time a human used it.
     *
     * What the measurement DOES support is the conditional the product actually
     * states, and `properties_external_source_url_check` below is exactly that.
     *
     * NO `UNIQUE`, either: two habitaclia rows (`52795000011615`,
     * `39875000001003`) share
     * `https://www.habitaclia.com/alquiler-madrid.htm` — the Madrid
     * search-results page, from a parser that fell back to the results `href`.
     * Their `(source, source_id)` is still distinct, so the real dedup key is
     * unaffected and a UNIQUE here would reject two real rows for a parser bug.
     */
    sourceUrl: text(),
    isExternal: boolean().notNull().default(false),
    /**
     * When this listing is reaped.
     *
     * Mongo carried `index: { expireAfterSeconds: 0 }` here, and it covers
     * **100% of production** — all 17,644 rows have a date in this column, so
     * the entire inventory is under an active scythe. Postgres has no TTL
     * index; `db/expiry.ts` carries the registry entry that replaces it, and
     * the btree below is what that sweep's range scan needs. Without BOTH,
     * external listings grow forever with no error and no failing test.
     */
    expiresAt: timestamptz(),

    /**
     * The partner whose referral link produced this listing.
     *
     * RENAMED from Mongo's `sourcedByPartner`. Its three sibling references on
     * this same schema (`addressId`, `agencyId`, `parentPropertyId`) all end in
     * `Id`; this one did not, which made it the odd one out in its own model
     * AND invisible to `idShapedColumns`, whose `_id` suffix test is what
     * classifies every id-shaped column in this schema. A column no gate can
     * see is a column that can ship unconstrained. Free of data risk: the
     * census found the field ABSENT on all 17,644 rows.
     */
    sourcedByPartnerId: text(),
    /** Audit copy of the referral code at create time (a partner may rotate codes). */
    sourcedByReferralCode: text(),
    /** The managing agency, resolved server-side from portal contact AJAX. */
    agencyId: text(),

    // ── Advertiser contact, captured from portal AJAX ──
    //
    // Flattened from a single-nested sub-schema with no default, so the whole
    // block is absent on the 8,458 listings whose portal never exposed a
    // contact — every column nullable.
    externalContactPhone: text(),
    externalContactEmail: text(),
    externalContactWhatsapp: text(),
    externalContactName: text(),
    externalContactAgencyName: text(),
    externalContactKind: text({ enum: EXTERNAL_CONTACT_KINDS }),

    // ── Restriction flags derived from the listing free text at ingest ──
    //
    // **These booleans stay NULLABLE. They are not `NOT NULL DEFAULT false`.**
    //
    // `classifyListingContent` stores only the flags that FIRE, on a
    // sub-schema whose members declare no default at all — so the source
    // distinguishes three states and Postgres must too: true (the text says
    // students only), false (the classifier looked and said no), and NULL (the
    // classifier never ran, or the portal gave it nothing to read). Defaulting
    // to `false` would collapse "not examined" into "examined and negative",
    // which is a claim about a listing that nobody made.
    listingFlagsStudentsOnly: boolean(),
    listingFlagsRoomNotFullUnit: boolean(),
    listingFlagsTemporaryOnly: boolean(),
    listingFlagsGenderRestricted: boolean(),
    listingFlagsWorkersOnly: boolean(),
    listingFlagsAgencyFeePayable: boolean(),
    listingFlagsNoPets: boolean(),
    listingFlagsNoSmoking: boolean(),
    listingFlagsNoCouples: boolean(),
    listingFlagsNoDss: boolean(),
    listingFlagsDetectedLanguage: text({ enum: DETECTED_LANGUAGES }),

    // ── The listing itself ──
    /**
     * The listing headline.
     *
     * Declared with NO Mongo source, and that is the point: `title` is absent
     * from `PropertySchema` entirely, so mongoose strict mode drops it from
     * every write, and the census confirms it is missing on all 17,644 rows —
     * while a 43.51 MiB Mongo text index has been indexing it. See
     * `unmappedColumns.ts`; the consequence for `search_vector` is recorded on
     * that column.
     */
    title: text(),
    description: text(),
    /**
     * Full-text search over the listing.
     *
     * **`description` only.** Mongo's text index named `{ title, description }`
     * and `title` does not exist on a single document, so weighting it would
     * copy a 43.51 MiB phantom index into Postgres. When `title` starts
     * carrying data, this becomes
     * `setweight(to_tsvector(…, title), 'A') || setweight(…, 'B')` and the
     * column is regenerated — a `post`-phase migration, not a guess made now.
     *
     * The configuration is a LITERAL, and it has to be: the one-argument
     * `to_tsvector(x)` reads `default_text_search_config` at runtime and is
     * therefore STABLE, which Postgres refuses in a generated column. See
     * `db/extensions.ts` for why the configuration is `homiio_simple` and how
     * it reaches every ephemeral test database.
     */
    searchVector: tsvector().generatedAlwaysAs(
      sql.raw(`to_tsvector('${TEXT_SEARCH_CONFIGURATION}', coalesce(description, ''))`),
    ),

    /**
     * The building this listing is in.
     *
     * RESTRICT, matching the geo chain above it: a listing whose address
     * vanished is not a listing with a missing address, it is a listing nobody
     * can find. The census measured this edge as PERFECT — 17,644 of 17,644
     * resolve, zero orphans — so the constraint costs the backfill nothing.
     */
    addressId: text()
      .notNull()
      .references(() => addresses.id, { onDelete: 'restrict' }),
    /** Whether the street number may be shown publicly. */
    showAddressNumber: boolean().notNull().default(true),

    type: text({ enum: PROPERTY_TYPES }).notNull().default('apartment'),
    housingType: text({ enum: HOUSING_TYPES }).notNull().default('private'),
    layoutType: text({ enum: LAYOUT_TYPES }).notNull().default('traditional'),

    bedrooms: doublePrecision().notNull().default(0),
    bathrooms: doublePrecision().notNull().default(0),
    squareFootage: doublePrecision().notNull().default(0),
    floor: doublePrecision().notNull().default(0),
    yearBuilt: doublePrecision(),

    hasElevator: boolean().notNull().default(false),
    hasBalcony: boolean().notNull().default(false),
    hasGarden: boolean().notNull().default(false),
    utilitiesIncluded: boolean().notNull().default(false),
    petFriendly: boolean().notNull().default(false),
    proximityToTransport: boolean().notNull().default(false),
    proximityToSchools: boolean().notNull().default(false),
    proximityToShopping: boolean().notNull().default(false),
    isVerified: boolean().notNull().default(false),
    isEcoFriendly: boolean().notNull().default(false),

    /**
     * Which offerings this listing carries — the single source of truth the
     * four coherence CHECKs at the bottom of this table are written against.
     *
     * A native `text[]` with a GIN index, not a child table: Mongo's `$in`
     * membership test becomes the array overlap operator `&&`, which GIN
     * answers directly, and the set is read whole on every serialization.
     */
    offerings: text().array().notNull().default([]),

    /**
     * Free-text amenity tokens.
     *
     * `text[]` + GIN, and **deliberately WITHOUT a containment CHECK** — twice
     * over. Mongo declares no `enum` on this path at all (only
     * `trim`/`lowercase`), so there is no vocabulary to check against; and the
     * production data carries measured encoding corruption — hex-escaped UTF-8
     * bytes (`calefacci_xf3_n` ×592, `1_ba_xf1_o` ×324, `2_ba_xf1_os` ×280,
     * `cerca_de_transporte_p_xfa_blico` ×143, ≥40 distinct tokens over ≥1,688
     * of 36,983 elements) — so a CHECK built from any clean vocabulary would
     * reject those rows outright, mid-copy.
     *
     * The corruption is a real, user-visible search bug and it is NOT this
     * table's to fix: under GIN each mangled token is its own index entry, so a
     * filter for `calefacción` finds none of the 592 rows stored as
     * `calefacci_xf3_n`. Repairing it is a data decision with its own count in
     * front of it, and fixing the ingest upstream does not help the rows
     * already written.
     *
     * `NOT NULL DEFAULT '{}'` is measured, not assumed: the census found the
     * field an ARRAY on 100% of rows, never null and never absent, with all
     * 36,983 elements strings and zero nulls among them. (A `null` DID appear
     * in the raw `distinct()` output — an artifact of `DISTINCT_SCAN` over the
     * non-sparse `amenities_1` index, which stores a null key for an empty
     * array. Cross-checked against `$type` before being believed.)
     */
    amenities: text().array().notNull().default([]),

    furnishedStatus: text({ enum: FURNISHED_STATUSES }).notNull().default('not_specified'),
    petPolicy: text({ enum: PET_POLICIES }).notNull().default('not_specified'),
    petFee: doublePrecision().notNull().default(0),
    parkingType: text({ enum: PARKING_TYPES }).notNull().default('none'),
    parkingSpaces: doublePrecision().notNull().default(0),
    leaseTerm: text({ enum: LEASE_TERMS }).notNull().default('monthly'),
    cancellationPolicy: text({ enum: CANCELLATION_POLICIES }),

    /**
     * When the listing becomes available.
     *
     * **Both this and `availability_available_from` are carried, and they are
     * NOT the same fact.** The census compared them across all 17,644 rows and
     * found **1,630 (9.2%) that DISAGREE** — while both are present on every
     * row. They are read by different filter paths, so collapsing them would
     * silently change what a filter matches for those 1,630 listings. Which one
     * wins on each path is a code reading, not a schema decision, and it has
     * not been made yet.
     */
    availableFrom: timestamptz().notNull().default(sql`date_trunc('milliseconds', now())`),

    smokingAllowed: boolean().notNull().default(false),
    partiesAllowed: boolean().notNull().default(false),
    guestsAllowed: boolean().notNull().default(true),
    maxGuests: doublePrecision().notNull().default(1),

    // ── Priced block: long-term rent (offering `long_term_rent`) ──
    longTermRentMonthlyAmount: doublePrecision(),
    longTermRentCurrency: text({ enum: LISTING_CURRENCIES }),
    longTermRentDeposit: doublePrecision(),
    longTermRentApplicationFee: doublePrecision(),
    longTermRentLateFee: doublePrecision(),
    longTermRentUtilities: text({ enum: UTILITIES_INCLUDED }),

    // ── Priced block: short-term rent (offering `short_term_rent`) ──
    shortTermRentNightlyRate: doublePrecision(),
    shortTermRentCurrency: text({ enum: LISTING_CURRENCIES }),
    shortTermRentCleaningFee: doublePrecision(),
    shortTermRentServiceFee: doublePrecision(),
    shortTermRentTaxesPercent: doublePrecision(),
    shortTermRentMinNights: doublePrecision(),
    shortTermRentMaxNights: doublePrecision(),
    shortTermRentInstantBook: boolean(),
    shortTermRentDeposit: doublePrecision(),

    // ── Priced block: sale (offering `sale`) ──
    salePrice: doublePrecision(),
    saleCurrency: text({ enum: LISTING_CURRENCIES }),
    salePricePerSqm: doublePrecision(),
    saleEstimatedYield: doublePrecision(),
    saleIsPriceReduced: boolean(),
    saleChainStatus: text({ enum: SALE_CHAIN_STATUSES }),

    // ── Priced block: exchange (offering `exchange`) ──
    //
    // `exchange.availabilityWindows[]` is NOT here — it shares
    // `property_availability_windows` with the listing calendar, under
    // `scope = 'exchange'`.
    exchangeMode: text({ enum: EXCHANGE_MODES }),
    exchangeMinStay: doublePrecision(),
    exchangeMaxStay: doublePrecision(),
    exchangeWelcomeNote: text(),
    /**
     * Languages the host speaks.
     *
     * NULLABLE, unlike the four `accommodation_details_*` arrays below, and the
     * asymmetry is the flattening rule at work: this array lives inside an
     * OPTIONAL sub-schema, so its `[]` only exists when the exchange block
     * does. NULL here means "no exchange offering"; `{}` would mean "an
     * exchange offering with no languages", and those are different listings.
     */
    exchangeLanguages: text().array(),
    exchangeMealsIncluded: boolean(),
    exchangeRequiresReciprocity: boolean(),

    // ── Accommodation details (couchsurfing / hostel / campsite listings) ──
    //
    // A NESTED PATH carrying defaults, so mongoose materializes it on every
    // document and the defaulted members really are stored — which is why the
    // two booleans and the four arrays are NOT NULL here while the priced
    // blocks above are nullable.
    accommodationDetailsSleepingArrangement: text({ enum: SLEEPING_ARRANGEMENTS }),
    accommodationDetailsHostelRoomType: text({ enum: HOSTEL_ROOM_TYPES }),
    accommodationDetailsCampsiteType: text({ enum: CAMPSITE_TYPES }),
    accommodationDetailsMaxStay: doublePrecision(),
    accommodationDetailsMinAge: doublePrecision(),
    accommodationDetailsMaxAge: doublePrecision(),
    accommodationDetailsCulturalExchange: boolean().notNull().default(false),
    accommodationDetailsMealsIncluded: boolean().notNull().default(false),
    /**
     * The wifi password for the accommodation.
     *
     * **A PROTECTED COLUMN** (`schema/protectedColumns.ts`) — a credential for
     * a real network, sitting on the most-read table in the product. Mongoose
     * hid it only by accident: it is not `select: false`, it simply never
     * appeared in a DTO's field list. Drizzle has no such accident —
     * `db.select().from(properties)` returns every column — so the exclusion is
     * made at the TYPE level, where a serializer that reads it fails `tsc`
     * instead of being caught in review.
     */
    accommodationDetailsWifiPassword: text(),
    accommodationDetailsRoommatePreferences: text().array().notNull().default([]),
    accommodationDetailsColivingFeatures: text().array().notNull().default([]),
    accommodationDetailsLanguages: text().array().notNull().default([]),
    accommodationDetailsHouseRules: text().array().notNull().default([]),

    // ── Availability (a sub-schema with `default: {}` — always materialized) ──
    availabilityIsAvailable: boolean().notNull().default(true),
    /** See `available_from` above: 1,630 rows disagree between the two. */
    availabilityAvailableFrom: timestamptz()
      .notNull()
      .default(sql`date_trunc('milliseconds', now())`),
    availabilityMinimumStay: doublePrecision().notNull().default(1),
    availabilityMaximumStay: doublePrecision().notNull().default(12),

    // ── House rules ──
    //
    // Five pairs that duplicate the top-level `pet_friendly` /
    // `smoking_allowed` / `parties_allowed` / `guests_allowed` / `max_guests`
    // columns. BOTH copies are carried. Unlike `available_from` they never
    // disagree — the census measured all five as equal on all 17,644 rows —
    // but "equal" here means "both at their default on every row", so the DATA
    // cannot elect an authoritative copy and neither can this file. Collapsing
    // them is a code reading with its own evidence, deliberately deferred
    // rather than guessed at.
    rulesPets: boolean().notNull().default(false),
    rulesSmoking: boolean().notNull().default(false),
    rulesParties: boolean().notNull().default(false),
    rulesGuests: boolean().notNull().default(true),
    rulesMaxOccupancy: doublePrecision().notNull().default(1),

    // ── Community moderation (SERVER-ONLY, never settable from a request) ──
    //
    // **`NOT NULL DEFAULT false`, and the DEFAULT is load-bearing — this column
    // would fail `23502` on 99.99% of production without it.** The `moderation`
    // sub-object is ABSENT on 17,642 of 17,644 rows, and that is a stable
    // steady state rather than a backlog:
    //
    //  - the field was added to `PropertySchema` on 2026-07-30 (`0bbc574`,
    //    PR #248), and the newest `createdAt` in the whole collection is
    //    2026-07-25 — every row predates the schema change;
    //  - the rows WITHOUT it have a max `updatedAt` four minutes LATER than the
    //    two that have it, across all twelve providers, so RE-INGESTING DOES NOT
    //    ADD IT;
    //  - the only two rows carrying it are the two `fixture` rows.
    //
    // So the backfill DERIVES `false` where the path is absent, under the named
    // resolution `MODERATION_ABSENT` with the count frozen at 17,642 (see
    // `db/MIGRATION-CONTRACT.md`) — never a silent coalesce. `false` is the
    // correct value and not merely the convenient one: `moderation.restricted`
    // is written ONLY by `ModerationEnforcementService`, CrowdSource is switched
    // off in production entirely, and the schema's own default says the same
    // thing. Absent here unambiguously means "no jury has restricted this".
    moderationRestricted: boolean().notNull().default(false),
    moderationRestrictedAt: timestamptz(),
    /** The CrowdSource decision revision that restricted it. Audit only. */
    moderationRestrictedByDecisionId: text(),

    // ── Server-computed ethical + market price score ──
    //
    // Every column nullable, and that matches the source exactly: the Mongoose
    // nested path declares NO defaults on ANY member ("written atomically on
    // score — no subfield defaults (avoids partial subdocs on save)"), so it
    // never materializes until `priceEthicsService` scores the listing.
    priceEthicsEthicalSuggested: doublePrecision(),
    priceEthicsEthicalMax: doublePrecision(),
    priceEthicsWithinEthical: boolean(),
    priceEthicsMarketVerdict: text({ enum: MARKET_VERDICTS }),
    priceEthicsPercentDiffFromAvg: doublePrecision(),
    priceEthicsIsFairPrice: boolean(),
    priceEthicsFairnessScore: doublePrecision(),
    priceEthicsScoredAt: timestamptz(),

    // ── Rating ──
    ratingAverage: doublePrecision().notNull().default(0),
    /** A counter the application increments — the one integral `Number` here. */
    ratingCount: bigint({ mode: 'number' }).notNull().default(0),

    /**
     * Detail-page view count.
     *
     * Declared with NO Mongo source. `views` is absent from `PropertySchema`,
     * so mongoose strict mode silently strips it from
     * `findByIdAndUpdate(id, { $inc: { views: 1 } })` — the census confirms the
     * field is missing on all 17,644 rows, i.e. every `$inc` this product has
     * ever issued was an empty update. There is nothing to copy: the column
     * starts at zero for every listing and a later batch restores the writer as
     * `UPDATE … SET views = views + 1`. Counting starting from zero after the
     * cutover is an EXPECTED condition, not a defect. See `unmappedColumns.ts`.
     *
     * `bigint`, not `integer`: a counter with no ceiling in the domain should
     * not have one in the column.
     */
    views: bigint({ mode: 'number' }).notNull().default(0),

    /**
     * Whether this listing has at least one photo.
     *
     * **A denormalized counter, kept DELIBERATELY, against the rule in
     * CONVENTIONS.md that says Mongo's join-less workarounds do not travel.**
     * The trade-off, written down so nobody has to re-derive it:
     *
     * It is the PRIMARY SORT KEY of every discovery feed —
     * `{ hasImages: -1, createdAt: -1 }` — and the honest relational
     * alternative, `ORDER BY EXISTS (SELECT 1 FROM property_images …) DESC`, is
     * a correlated subquery in an `ORDER BY`, which Postgres cannot serve from
     * an index any more than Mongo could. Every page of the main feed would
     * become a full sort. So the column stays, and pays for itself with a
     * maintenance obligation instead:
     *
     *  1. It is DERIVED, never copied — including by the backfill. Production
     *     already holds one row where the flag disagrees with its array
     *     (`6a515dd9c196de4ad2a8550e`, `hasImages: false` with 12 images), so
     *     copying the stored value would import a known-wrong answer. That id
     *     carries `expiresAt: 2026-08-09`, so it is useful for VERIFYING the
     *     derivation ran and useless as a hand-coded exception.
     *  2. It is maintained by exactly ONE helper, `db/hasImages.ts`, called by
     *     every `property_images` write. Nothing else may assign it.
     *  3. It is never settable from a request body — it must stay out of
     *     `CREATABLE_PROPERTY_FIELDS` / `EDITABLE_PROPERTY_FIELDS`, exactly as
     *     it is out of them today.
     *  4. A reconciliation check (`findHasImagesDisagreements`) exists and is
     *     asserted, because a denormalized value with no way to detect drift is
     *     a value that will drift.
     */
    hasImages: boolean().notNull().default(false),

    /** When the owner last saved the listing (distinct from `updated_at`). */
    lastSaved: timestamptz().notNull().default(sql`date_trunc('milliseconds', now())`),

    /**
     * The property this room belongs to, for `type = 'room'` listings.
     *
     * The schema's ONLY self-reference. SET NULL rather than CASCADE: deleting
     * a building must not delete the rooms in it — a room outlives its parent
     * as a standalone listing, and NULL already means "not part of a larger
     * property", so the action introduces no second meaning.
     *
     * Census: ABSENT on all 17,644 rows — there is not one room in production.
     * That is what lets the backfill skip the second pass a self-reference
     * would otherwise force.
     *
     * The return type on the reference callback is not decoration: a
     * self-reference is circular, so TypeScript cannot infer it and the
     * annotation is what breaks the cycle.
     */
    parentPropertyId: text().references((): AnyPgColumn => properties.id, {
      onDelete: 'set null',
    }),

    status: text({ enum: PROPERTY_STATUSES }).notNull().default('draft'),

    /** Soft-delete timestamp, set when the owner archives the listing. */
    deletedAt: timestamptz(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // ── The dedup key ──
    //
    // Mongo's `{ source: 1, sourceId: 1 }` unique index with
    // `partialFilterExpression: { sourceId: { $type: 'string' } }`. A `text`
    // column can hold nothing but text, so `is not null` is the exact
    // equivalent of the `$type` test. Census: 17,644 distinct `source_id`
    // values over 17,644 rows — no violation to resolve.
    uniqueIndex('properties_source_source_id_key')
      .on(table.source, table.sourceId)
      .where(sql`${table.sourceId} is not null`),

    // ── Feed and search ordering ──
    //
    // The default sort of the whole discovery surface. See `has_images`.
    index('properties_has_images_created_at_idx').on(
      sql`${table.hasImages} desc`,
      sql`${table.createdAt} desc`,
    ),
    // `created_at desc` alone: NOT a prefix of the composite above (its leading
    // column differs), and it backs the plain newest-first listings.
    index('properties_created_at_idx').on(sql`${table.createdAt} desc`),
    // The replacement for Mongo's `{ title: 'text', description: 'text' }`.
    index('properties_search_vector_gin').using('gin', table.searchVector),

    // ── Ownership and place ──
    index('properties_oxy_user_id_status_idx').on(table.oxyUserId, table.status),
    index('properties_oxy_user_id_created_at_idx').on(
      table.oxyUserId,
      sql`${table.createdAt} desc`,
    ),
    index('properties_address_id_idx').on(table.addressId),

    // ── Filters ──
    index('properties_type_available_idx').on(table.type, table.availabilityIsAvailable),
    index('properties_status_available_idx').on(table.status, table.availabilityIsAvailable),
    index('properties_bedrooms_bathrooms_idx').on(table.bedrooms, table.bathrooms),
    // Mongo's `{ amenities: 1 }` was a MULTIKEY index; GIN is its Postgres
    // equivalent, and it is what makes `&&` (the port of `$in`) index-backed.
    index('properties_amenities_gin').using('gin', table.amenities),
    // Mongo's `{ offerings: 1, status: 1 }` cannot be reproduced as one index
    // without the `btree_gin` extension, which would be a new infrastructure
    // precondition on three shared databases for one compound. The GIN alone
    // answers the selective half (the offering membership); `status` is served
    // by the composite above it.
    index('properties_offerings_gin').using('gin', table.offerings),

    // ── Price range + price sort, per offering ──
    index('properties_long_term_rent_amount_idx').on(table.longTermRentMonthlyAmount),
    index('properties_short_term_rent_rate_idx').on(table.shortTermRentNightlyRate),
    index('properties_sale_price_idx').on(table.salePrice),

    // ── Price ethics ──
    index('properties_price_ethics_is_fair_idx').on(table.priceEthicsIsFairPrice),
    index('properties_price_ethics_score_idx').on(sql`${table.priceEthicsFairnessScore} desc`),

    // ── Sparse references ──
    //
    // Both partial, matching Mongo's `sparse: true`, and both kept the size of
    // the real set: 8,374 of 17,644 listings name an agency and none names a
    // partner.
    index('properties_agency_id_idx')
      .on(table.agencyId)
      .where(sql`${table.agencyId} is not null`),
    index('properties_sourced_by_partner_id_idx')
      .on(table.sourcedByPartnerId)
      .where(sql`${table.sourcedByPartnerId} is not null`),
    index('properties_parent_property_id_idx')
      .on(table.parentPropertyId)
      .where(sql`${table.parentPropertyId} is not null`),

    // ── The expiry sweep's range scan ──
    //
    // Required, not optional: `db/expiry.ts` registers `expires_at`, and
    // `findUnsupportedExpiryColumns` fails the build without a supporting
    // btree. Partial, because the sweep only ever looks at rows that have a
    // deadline.
    index('properties_expires_at_idx')
      .on(table.expiresAt)
      .where(sql`${table.expiresAt} is not null`),

    // ── Vocabularies ──
    check('properties_source_check', sql`${table.source} in (${sql.raw(inList(PROPERTY_SOURCES))})`),
    check('properties_type_check', sql`${table.type} in (${sql.raw(inList(PROPERTY_TYPES))})`),
    check('properties_status_check', sql`${table.status} in (${sql.raw(inList(PROPERTY_STATUSES))})`),
    check(
      'properties_housing_type_check',
      sql`${table.housingType} in (${sql.raw(inList(HOUSING_TYPES))})`,
    ),
    check(
      'properties_layout_type_check',
      sql`${table.layoutType} in (${sql.raw(inList(LAYOUT_TYPES))})`,
    ),
    check(
      'properties_furnished_status_check',
      sql`${table.furnishedStatus} in (${sql.raw(inList(FURNISHED_STATUSES))})`,
    ),
    check(
      'properties_pet_policy_check',
      sql`${table.petPolicy} in (${sql.raw(inList(PET_POLICIES))})`,
    ),
    check(
      'properties_parking_type_check',
      sql`${table.parkingType} in (${sql.raw(inList(PARKING_TYPES))})`,
    ),
    check(
      'properties_lease_term_check',
      sql`${table.leaseTerm} in (${sql.raw(inList(LEASE_TERMS))})`,
    ),
    check(
      'properties_cancellation_policy_check',
      sql`${table.cancellationPolicy} in (${sql.raw(inList(CANCELLATION_POLICIES))})`,
    ),
    check(
      'properties_external_contact_kind_check',
      sql`${table.externalContactKind} in (${sql.raw(inList(EXTERNAL_CONTACT_KINDS))})`,
    ),
    check(
      'properties_detected_language_check',
      sql`${table.listingFlagsDetectedLanguage} in (${sql.raw(inList(DETECTED_LANGUAGES))})`,
    ),
    check(
      'properties_long_term_rent_currency_check',
      sql`${table.longTermRentCurrency} in (${sql.raw(inList(LISTING_CURRENCIES))})`,
    ),
    check(
      'properties_long_term_rent_utilities_check',
      sql`${table.longTermRentUtilities} in (${sql.raw(inList(UTILITIES_INCLUDED))})`,
    ),
    check(
      'properties_short_term_rent_currency_check',
      sql`${table.shortTermRentCurrency} in (${sql.raw(inList(LISTING_CURRENCIES))})`,
    ),
    check(
      'properties_sale_currency_check',
      sql`${table.saleCurrency} in (${sql.raw(inList(LISTING_CURRENCIES))})`,
    ),
    check(
      'properties_sale_chain_status_check',
      sql`${table.saleChainStatus} in (${sql.raw(inList(SALE_CHAIN_STATUSES))})`,
    ),
    check(
      'properties_exchange_mode_check',
      sql`${table.exchangeMode} in (${sql.raw(inList(EXCHANGE_MODES))})`,
    ),
    check(
      'properties_market_verdict_check',
      sql`${table.priceEthicsMarketVerdict} in (${sql.raw(inList(MARKET_VERDICTS))})`,
    ),
    check(
      'properties_sleeping_arrangement_check',
      sql`${table.accommodationDetailsSleepingArrangement} in (${sql.raw(inList(SLEEPING_ARRANGEMENTS))})`,
    ),
    check(
      'properties_hostel_room_type_check',
      sql`${table.accommodationDetailsHostelRoomType} in (${sql.raw(inList(HOSTEL_ROOM_TYPES))})`,
    ),
    check(
      'properties_campsite_type_check',
      sql`${table.accommodationDetailsCampsiteType} in (${sql.raw(inList(CAMPSITE_TYPES))})`,
    ),

    /**
     * Every element of `offerings` is a real offering type.
     *
     * Written as CONTAINMENT (`<@`) and it has to be: a CHECK constraint may
     * not contain a subquery, so the natural spelling —
     * `not exists (select 1 from unnest(offerings) …)` — is rejected outright
     * by Postgres. `<@` says "every element of the left array appears in the
     * right", which is the same claim with no subquery in it. It is trivially
     * satisfied by the empty array, which is correct: an empty `offerings` is
     * caught by the four coherence CHECKs below, not by this one.
     */
    check(
      'properties_offerings_check',
      sql`${table.offerings} <@ ${sql.raw(textArrayLiteral(OFFERING_TYPES))}`,
    ),

    /**
     * ── The four offering-coherence CHECKs ──
     *
     * These are the largest correctness win in the Property port, and they are
     * the reason the priced blocks are flattened into nullable columns rather
     * than pushed into child tables.
     *
     * `models/schemas/offeringValidation.ts` states one invariant: `offerings`
     * must equal EXACTLY the set of priced blocks present on the document. In
     * Mongo that rule has TWO enforcement paths for one invariant, and they do
     * not agree:
     *
     *  - on `save()`, the path validator on `offerings` runs `validateOfferings`;
     *  - on `findOneAndUpdate` the same validator EXPLICITLY SKIPS ITSELF (the
     *    `isPropertyDocument` guard returns true for a Query `this`, because a
     *    Query cannot see sibling blocks), leaving the rule to a controller
     *    helper — and `services/scraperService.ts:285` reaches the collection
     *    through `updateOne` with no `runValidators` at all, which is the
     *    steady-state path for every external listing.
     *
     * Here it is ONE rule, enforced by the database, on every write path there
     * is or will be. Each direction of the biconditional catches a different
     * bug: `offerings` naming a block that is not there (a listing that
     * advertises a price it does not have), and a block present without its
     * offering (a price nothing can find).
     *
     * Written per-offering rather than as one combined constraint so that a
     * violation NAMES which offering is incoherent. One constraint covering all
     * four would report `properties_offerings_check` for any of them, and the
     * error would say nothing a reader could act on.
     *
     * **What these deliberately do NOT express**: `validateOfferings` also
     * requires each present price to be POSITIVE. `> 0` is a RANGE constraint
     * over data nobody has measured, and CONVENTIONS.md defers every `min`/`max`
     * to a `post`-phase migration after the census — so the positivity half
     * stays with the application until then. Presence is the half that carries
     * the relational meaning, and it is the half that is safe today.
     */
    check(
      'properties_offering_long_term_rent_check',
      sql`('long_term_rent' = any(${table.offerings})) = (${table.longTermRentMonthlyAmount} is not null)`,
    ),
    check(
      'properties_offering_short_term_rent_check',
      sql`('short_term_rent' = any(${table.offerings})) = (${table.shortTermRentNightlyRate} is not null)`,
    ),
    check(
      'properties_offering_sale_check',
      sql`('sale' = any(${table.offerings})) = (${table.salePrice} is not null)`,
    ),
    check(
      'properties_offering_exchange_check',
      sql`('exchange' = any(${table.offerings})) = (${table.exchangeMode} is not null)`,
    ),

    /**
     * ── The four block-INTEGRITY CHECKs ──
     *
     * The coherence CHECKs above are written over PRICE NULL-NESS.
     * `offeringValidation.ts` writes the same invariant over BLOCK PRESENCE
     * (`isPresent` = a non-null object) and only then demands a price. Those two
     * readings diverge in exactly one direction, and it is a real semantic loss
     * if left alone: a block present, carrying no price, with the offering not
     * declared — `sale: { currency: 'EUR' }` and `offerings: []` — is REJECTED
     * by Mongo ("Pricing block for sale is present but the offering is not
     * declared") and ACCEPTED by the coherence CHECK alone, because all it sees
     * is `false = false`.
     *
     * Zero production rows are in that state, so nothing here can block the
     * copy. It is restored anyway rather than documented as a narrowing,
     * because the flattened form CAN express it: after flattening, "the block is
     * present" is "any of its columns is non-null", so each of these says a
     * satellite column may only be populated when its block's discriminator is.
     *
     * **The one residual, which genuinely cannot be represented and is therefore
     * written down instead:** an EMPTY block (`sale: {}`) counts as present to
     * `isPresent`, and flattens to exactly the same all-NULL row as no block at
     * all. Mongo rejects `sale: {}` with `offerings: []`; no CHECK here can see
     * it, because there is nothing left to see. That is a strictly smaller loss
     * than the one these four close, and it is the irreducible cost of
     * flattening a subdocument whose mere existence carried meaning.
     */
    check(
      'properties_long_term_rent_block_check',
      sql`${table.longTermRentMonthlyAmount} is not null or (
        ${table.longTermRentCurrency} is null and ${table.longTermRentDeposit} is null
        and ${table.longTermRentApplicationFee} is null and ${table.longTermRentLateFee} is null
        and ${table.longTermRentUtilities} is null
      )`,
    ),
    check(
      'properties_short_term_rent_block_check',
      sql`${table.shortTermRentNightlyRate} is not null or (
        ${table.shortTermRentCurrency} is null and ${table.shortTermRentCleaningFee} is null
        and ${table.shortTermRentServiceFee} is null and ${table.shortTermRentTaxesPercent} is null
        and ${table.shortTermRentMinNights} is null and ${table.shortTermRentMaxNights} is null
        and ${table.shortTermRentInstantBook} is null and ${table.shortTermRentDeposit} is null
      )`,
    ),
    check(
      'properties_sale_block_check',
      sql`${table.salePrice} is not null or (
        ${table.saleCurrency} is null and ${table.salePricePerSqm} is null
        and ${table.saleEstimatedYield} is null and ${table.saleIsPriceReduced} is null
        and ${table.saleChainStatus} is null
      )`,
    ),
    check(
      'properties_exchange_block_check',
      sql`${table.exchangeMode} is not null or (
        ${table.exchangeMinStay} is null and ${table.exchangeMaxStay} is null
        and ${table.exchangeWelcomeNote} is null and ${table.exchangeLanguages} is null
        and ${table.exchangeMealsIncluded} is null and ${table.exchangeRequiresReciprocity} is null
      )`,
    ),

    /**
     * An external listing must carry the URL it came from.
     *
     * The conditional form of what `AGENTS.md` states ("External properties have
     * `isExternal: true`, no `oxyUserId`, `status: 'published'`, and a mandatory
     * `sourceUrl`") and the strongest constraint the data actually supports.
     * `source_url` is present and non-empty on all 17,644 production rows, so
     * this holds today with nothing to resolve — but every one of those rows is
     * EXTERNAL, so a blanket `NOT NULL` would encode the external path and break
     * the internal one, where no write path can supply a URL at all. See the
     * column.
     *
     * One-directional on purpose: an internal listing MAY carry a `source_url`
     * (nothing forbids it), so the converse is not asserted.
     */
    check(
      'properties_external_source_url_check',
      sql`not ${table.isExternal} or ${table.sourceUrl} is not null`,
    ),
  ],
);

/**
 * `property_images` — a listing's photos, in order.
 *
 * Mongo kept these as an embedded array on the property, each entry holding a
 * reference to the canonical `Image` document plus a denormalized copy of the
 * medium variant's URL. The array becomes a child table; the `urls` subdocument
 * (four fixed variants) becomes four named columns, exactly as `images.urls_*`
 * does, for the same reason: `jsonb` would make the most-read URL in the
 * product untyped and unindexable.
 */
export const propertyImages = pgTable(
  'property_images',
  {
    id: generatedId(),

    /**
     * CASCADE: a photo reference has no meaning without its listing, and the
     * `properties` expiry sweep deletes listings continuously. Without the
     * cascade every reaped listing would leave its refs behind — which is
     * exactly the shape of the 948 orphaned `Image` documents the census found
     * on the other side of this relation.
     */
    propertyId: text()
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),

    /**
     * The canonical image.
     *
     * **`NOT NULL`, and this is measured rather than assumed.** The census
     * unwound all 169,223 embedded refs: 100% are `objectId`, 100% resolve to a
     * real `Image` document, 100% ALSO carry the matching
     * `entityType: 'property'` / `entityId` back-reference to the owning
     * listing, and there are ZERO dangling refs and zero nulls. CONVENTIONS.md
     * puts `NOT NULL` where the data really is always present, and it is.
     *
     * An earlier draft made it nullable "for legacy entries predating the Image
     * collection". That was a hypothesis invented to fit a number that meant
     * something else — the 948 figure is orphaned `Image` DOCUMENTS
     * (`images.entity_id → properties`, TTL leftovers), which is the opposite
     * direction and says nothing about this column. If a future ingest path
     * ever tries to write a ref with no `Image` row, failing the write is the
     * correct behaviour.
     *
     * RESTRICT rather than CASCADE, unlike `property_id` above. A `property_images`
     * row whose image vanished is a broken photo, not an absent one, and nothing
     * in Homiio deletes an `Image` document today (`imageController.deleteImage`
     * removes the S3 OBJECT by key, never the row). Refusing also keeps
     * `properties.has_images` honest: a CASCADE would delete refs without any
     * application code running, and `db/hasImages.ts` — the only thing allowed
     * to move that flag — would never be called.
     */
    imageId: text()
      .notNull()
      .references(() => images.id, { onDelete: 'restrict' }),

    /**
     * The medium variant's URL, denormalized at write time.
     *
     * Nullable, matching the source: Mongo declared no `required` here, and
     * legacy/external entries that predate the `Image` collection carry the
     * reference without the copy.
     */
    url: text(),
    caption: text(),
    /** See the partial unique index below — at most one per property. */
    isPrimary: boolean().notNull().default(false),
    /** Position in the listing's photo list, ascending. A loop index, so `bigint`. */
    order: bigint({ mode: 'number' }).notNull().default(0),

    // The `urls` subdocument, flattened. Nullable because Mongo declared it
    // `default: undefined` precisely so pre-Image entries still validate.
    urlsOriginal: text(),
    urlsSmall: text(),
    urlsMedium: text(),
    urlsLarge: text(),
  },
  (table) => [
    index('property_images_property_order_idx').on(table.propertyId, table.order),
    /**
     * At most ONE primary photo per listing.
     *
     * Mongo enforced this in a `pre('save')` hook that walked the array and
     * un-set every extra `isPrimary` — a hook that `updateOne` and
     * `findOneAndUpdate` never ran. Here it is a constraint, so no write path
     * can produce a second one.
     *
     * Safe from day one, measured: the census counted primaries per property
     * and found **1 on 16,585 listings and 0 on 1,059 — never more than one**.
     * The plan expected to find violations to resolve; there are none.
     *
     * PARTIAL, on purpose. A plain `UNIQUE (property_id, is_primary)` would
     * also permit only one NON-primary photo per listing, which is the opposite
     * of what a photo list is.
     */
    uniqueIndex('property_images_one_primary_key')
      .on(table.propertyId)
      .where(sql`${table.isPrimary}`),
    /**
     * Not speculative: this is the index the DATABASE ITSELF uses. The RESTRICT
     * on `image_id` makes Postgres scan this table on every `images` delete, and
     * Postgres does not index a foreign key's child column for you.
     */
    index('property_images_image_id_idx').on(table.imageId),
  ],
);

/**
 * `property_documents` — lease, inspection and insurance files attached to a
 * listing.
 *
 * Deliberately WITHOUT `created_at` / `updated_at`, as are the two child tables
 * around it. The Mongo subdocuments carried no timestamps, so a backfill would
 * have to fabricate one — and a fabricated `created_at` that reads as the
 * migration's own clock is worse than an absent column, because it looks like a
 * fact.
 */
export const propertyDocuments = pgTable(
  'property_documents',
  {
    id: generatedId(),
    propertyId: text()
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    url: text().notNull(),
    type: text({ enum: PROPERTY_DOCUMENT_TYPES }).notNull().default('other'),
  },
  (table) => [
    index('property_documents_property_id_idx').on(table.propertyId),
    check(
      'property_documents_type_check',
      sql`${table.type} in (${sql.raw(inList(PROPERTY_DOCUMENT_TYPES))})`,
    ),
  ],
);

/**
 * `property_availability_windows` — half-open calendar windows, for BOTH the
 * listing calendar and the exchange calendar.
 *
 * ## One table, two scopes
 *
 * Mongo declared the identical `availabilityWindowSchema` twice —
 * `Property.availabilityWindows[]` and `Property.exchange.availabilityWindows[]`
 * — so a "does anything overlap this range?" question had to be asked twice,
 * against two arrays, with two sets of indexes. One table plus a `scope`
 * discriminator makes it one query and one index.
 *
 * ## The GiST index is the point of this table
 *
 * Mongo indexed `availabilityWindows.start` and `availabilityWindows.end`
 * separately, and **two independent btrees cannot answer an overlap query**:
 * the planner can use one of them to narrow by start OR by end, then filters the
 * rest by hand. Those two indexes are NOT ported. A GiST index over
 * `tstzrange(starts_at, ends_at)` answers `&&` directly, which is the actual
 * question every calendar asks.
 *
 * `[)` bounds — inclusive start, exclusive end — because that is what the
 * `AvailabilityWindow` contract in `shared-types` specifies, and it is what
 * makes adjacent windows (one ending exactly where the next begins) NOT
 * overlap. `tstzrange(a, b)` defaults to `[)`, so the default is the contract.
 */
export const propertyAvailabilityWindows = pgTable(
  'property_availability_windows',
  {
    id: generatedId(),
    propertyId: text()
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    /** Which calendar this window belongs to. */
    scope: text({ enum: AVAILABILITY_WINDOW_SCOPES }).notNull(),
    /** Mongo's `start`. Renamed: `end` is a reserved word and the pair reads better together. */
    startsAt: timestamptz().notNull(),
    endsAt: timestamptz().notNull(),
    status: text({ enum: AVAILABILITY_WINDOW_STATUSES }).notNull().default('available'),
  },
  (table) => [
    /**
     * The overlap index. `tstzrange(timestamptz, timestamptz)` is IMMUTABLE,
     * which an expression index requires — checked against `pg_proc.provolatile`
     * rather than assumed, in `__tests__/db/propertyCalendar.test.ts`.
     */
    index('property_availability_windows_range_gist').using(
      'gist',
      sql`tstzrange(${table.startsAt}, ${table.endsAt})`,
    ),
    // Backs both the per-listing calendar read and the CASCADE delete check
    // Postgres runs when a property is reaped.
    index('property_availability_windows_property_scope_idx').on(table.propertyId, table.scope),
    check(
      'property_availability_windows_scope_check',
      sql`${table.scope} in (${sql.raw(inList(AVAILABILITY_WINDOW_SCOPES))})`,
    ),
    check(
      'property_availability_windows_status_check',
      sql`${table.status} in (${sql.raw(inList(AVAILABILITY_WINDOW_STATUSES))})`,
    ),
    /**
     * Mongo enforced this with a sub-schema validator on `end`
     * (`value > this.start`) — which, like every other Mongoose validator in
     * this package, did not run on an update.
     */
    check(
      'property_availability_windows_order_check',
      sql`${table.endsAt} > ${table.startsAt}`,
    ),
  ],
);

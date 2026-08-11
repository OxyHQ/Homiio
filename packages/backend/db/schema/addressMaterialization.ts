/**
 * The candidate → canonical boundary — issue #360, ADR 0001 §2.2 and §5.3.
 *
 * Three tables, and the reason they are one file is that they are one sentence:
 * a {@link addressCandidates | candidate} is what somebody typed or a geocoder
 * returned, an {@link addressMaterializations | materialization} is the durable
 * act of turning one into a canonical `addresses` row, and an
 * {@link addressExternalRefs | external ref} is the provider identifier that act
 * attached to the place.
 *
 * They are a SEPARATE file from `addresses.ts` for the reason `watches.ts` is
 * separate from `saved.ts`: the lifetimes differ. A candidate EXPIRES — it is a
 * transient observation and carries its own deadline and its own sweep entry. An
 * address is permanent. A materialization is an audit record and outlives both.
 *
 * ## The rule these tables exist to make structural
 *
 * **An autocomplete query must never create a permanent row.** A candidate is
 * cheap, internal and disposable, so a preview can record one freely; only
 * {@link addressMaterializations} names a DURABLE ACTION, and only the
 * materialization service writes an `addresses` row. Nothing here can be reached
 * by a read path, and `__tests__/db/addressMaterialization.test.ts` fails if the
 * read paths acquire the ability.
 *
 * ## Visibility
 *
 * All three are INTERNAL (ADR 0001 §2.2). No public DTO carries a candidate, a
 * materialization or an external ref; a candidate holds the free text a person
 * typed, and the whole purpose of the boundary is to keep that out of identity
 * and off the wire.
 */

import { check, doublePrecision, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, inList, timestamptz, updatedAt } from '@oxyhq/db';
import { addresses } from './addresses';

/**
 * How precise the SOURCE of a candidate's coordinates was.
 *
 * The four values of ADR 0002's `LocationPrecision`, restated as a tuple so the
 * column type and the CHECK derive from one list. Kept in the same spelling as
 * the shared type on purpose — a candidate arriving from
 * `GET /api/geo/search` carries exactly this value, and a second vocabulary
 * would need a translation table whose only job would be to go wrong.
 *
 * It is NOT ADR 0003's publication ladder (`exact | building | street |
 * neighborhood | city | approximate_radius | hidden`). That one is the ceiling a
 * READER may be served; this one is a fact about the observation. They are
 * different questions and conflating them is how a row ends up stored at the
 * precision it was published at, which ADR 0001 §2.1.5 forbids.
 */
export const CANDIDATE_PRECISIONS = ['exact', 'approximate', 'centroid', 'area'] as const;

export type CandidatePrecision = (typeof CANDIDATE_PRECISIONS)[number];

/**
 * How the candidate came to exist — the "evidencia/origen de la selección" the
 * issue requires, as a closed set rather than free text.
 *
 * It is what a later audit reads to answer "why does Homiio believe this place
 * is here", and it is also the input to the precision rules in
 * `materializeHousingCandidate`: a `map_pin` a person dropped is evidence about
 * a point, while a `listing_ingest` centroid is evidence about a city.
 */
export const CANDIDATE_ORIGINS = [
  /** Free text a person typed, with no provider behind it. */
  'user_typed',
  /** A row the person picked out of an autocomplete list. */
  'autocomplete_selection',
  /** A point a person placed on a map. */
  'map_pin',
  /** A geocoder's answer to a forward or reverse lookup. */
  'geocoder',
  /** A portal listing's address block, arriving through ingestion. */
  'listing_ingest',
  /** An official or open dataset (cadastre, INE, OSM extract). */
  'public_dataset',
  /** A correction somebody proposed and the community approved. */
  'approved_correction',
] as const;

export type CandidateOrigin = (typeof CANDIDATE_ORIGINS)[number];

/**
 * The durable actions that MAY materialize an address — issue #360's list,
 * closed, and the single most load-bearing value set in this file.
 *
 * Materialization is permitted only as a side effect of one of these. There is
 * no `preview`, no `search` and no `autocomplete` member, and their absence is
 * the enforcement: {@link addressMaterializations.durableAction} is NOT NULL
 * with a CHECK, so a read path that reached the service would have to invent an
 * action value the database refuses. A rule stated only in a service is a rule
 * one refactor away from being untrue.
 */
export const DURABLE_MATERIALIZATION_ACTIONS = [
  /** Creating or updating a listing. */
  'listing_upsert',
  /** Writing a review. */
  'review',
  /** Following a dwelling. */
  'follow_dwelling',
  /** Linking a public dataset record to a place. */
  'public_data_link',
  /** Creating an event that needs a canonical identity (an eviction notice). */
  'canonical_event',
  /** An approved community correction. */
  'approved_correction',
] as const;

export type DurableMaterializationAction = (typeof DURABLE_MATERIALIZATION_ACTIONS)[number];

/**
 * How the canonical row was arrived at — the "explicación de match" the service
 * returns, stored so the explanation survives the request that produced it.
 *
 * `adopted_v1_key` is the member that will read as odd in a year, so: an
 * address written before this service existed carries a v1 `normalized_key` and
 * no `identity_key`. When a candidate resolves to such a row AND the row's level
 * and identity fields agree with the candidate's, the service ADOPTS it —
 * stamping the v2 key onto the existing row rather than creating a second one.
 * That is a different fact from `exact_identity_key` (which matched a row this
 * service itself wrote) and from `created`, and a merge audit needs to tell them
 * apart.
 */
export const MATERIALIZATION_MATCH_KINDS = [
  /** No match; the row was created by this materialization. */
  'created',
  /** An existing row carried the same v2 identity key. */
  'exact_identity_key',
  /** An existing row was found through `(source, external_id)`. */
  'exact_external_ref',
  /** A pre-v2 row matched on the v1 key and was stamped with a v2 identity. */
  'adopted_v1_key',
  /** A probable match a caller explicitly confirmed. */
  'confirmed_probable',
] as const;

export type MaterializationMatchKind = (typeof MATERIALIZATION_MATCH_KINDS)[number];

/**
 * What somebody typed, or a geocoder returned, before anybody decided it is a
 * place — ADR 0001 §5.3.
 *
 * ## Deliberately NOT deduped globally
 *
 * ADR 0001 §2.2 gives this table the natural key
 * `(submitted_by, raw_text_hash, created_at)` and states in the same breath that
 * it is not deduped globally, because **two people typing the same wrong thing
 * is two events**. That is a description of what identifies a row, not a
 * constraint to enforce, and enforcing it would be actively wrong twice over:
 * `created_at` is truncated to milliseconds (`CONVENTIONS.md`), so a retried
 * submit inside one millisecond would be refused as a duplicate; and a unique
 * violation on a candidate would abort the enclosing transaction of whatever
 * durable action was being attempted. There is therefore a plain index on
 * `(submitted_by_oxy_user_id, raw_text_hash)` for the "show me my own
 * candidates" read and no unique index anywhere on this table.
 *
 * ## Free text lives HERE, and only here
 *
 * ADR 0001 invariant 6 forbids copying administrative geo as text. The
 * `proposed_*` columns below are exactly that — free text — and they do not
 * violate the invariant, they are what makes it keepable: a candidate is the
 * quarantine that keeps free text OUT of `addresses`, whose geo is referenced by
 * id and resolved at materialization. A proposed name is a claim awaiting
 * resolution; a resolved id is identity. Reading one of these columns to
 * populate anything but a resolution attempt is the mistake this docblock exists
 * to name.
 *
 * ## Expiry
 *
 * `expires_at` is the issue's "caducidad" and is registered in `db/expiry.ts`.
 * A candidate is evidence for a decision that has already been taken, never the
 * decision itself: {@link addressMaterializations} copies everything an audit
 * needs off the candidate at materialization time, which is why the sweep costs
 * the audit trail nothing. Registered at BIRTH rather than ported, for the
 * reason `housing_domain_events` was — a table that grows with every keystroke
 * in an autocomplete is precisely the shape the registry exists to catch.
 */
export const addressCandidates = pgTable(
  'address_candidates',
  {
    id: generatedId(),

    /**
     * The Oxy account that submitted it, or NULL for the ingestion worker.
     *
     * No foreign key: Oxy owns identity and Homiio reaches it over HTTP
     * (`deferredForeignKeys.ts`). NULL means "no human submitted this", which is
     * the ingest case and is a genuinely different fact from any account id —
     * so the column carries no sentinel.
     */
    submittedByOxyUserId: text(),

    // ── Provider ──
    //
    // Free `text`, with NO check constraint, and that is a decision rather than
    // an omission. The set spans three open registries at once: the listing
    // providers in `PROVIDER_IDS`, the geocoding providers registered by
    // configuration (`GEOCODING_PROVIDER_ORDER`, so the set is not knowable at
    // schema time at all), and Homiio's own `user` for free text with nobody
    // behind it. `properties.source` can afford a CHECK because it is exactly
    // one of those registries; this column cannot, and a CHECK built from
    // today's union would reject the first provider anybody registers — the
    // same failure `PROPERTY_SOURCES` documents from the other direction.
    provider: text().notNull(),
    /**
     * The provider's own ref for this RESULT.
     *
     * Note the difference from {@link addressExternalRefs.externalId}, which is
     * the provider's ref for an ENTITY: a geocoder's result ref identifies one
     * answer to one query and is not a stable name for a building, so it is
     * never treated as identity. Nullable, because free text has no ref.
     */
    providerRef: text(),

    /** What was typed or received, verbatim. Never normalized in place. */
    rawText: text().notNull(),
    /**
     * sha256 over the NORMALIZED raw text — part of ADR 0001's natural key.
     *
     * Hashed rather than indexed directly because the raw text is unbounded and
     * this column exists to answer "has this person already submitted this
     * string", never to be read back.
     */
    rawTextHash: text().notNull(),

    /**
     * The provider's normalized payload.
     *
     * `jsonb`, and it earns it by `CONVENTIONS.md`'s own test: the shape is
     * whatever the provider sent, which is the same argument that makes
     * `addresses.extras` the one jsonb column in that table. Flattening it would
     * mean a migration per provider.
     */
    normalizedPayload: jsonb().notNull().default({}),
    /**
     * Which normalization produced {@link normalizedPayload} and the
     * `proposed_*` columns.
     *
     * The issue asks for a "versión de normalización" and this is why it
     * matters: the normalization rules decide the identity key, so a candidate
     * normalized by an older version may resolve differently from an identical
     * one normalized today. Recording the version is what lets a later audit
     * tell a genuine disagreement from a rules change.
     */
    normalizationVersion: integer().notNull(),

    // ── Coordinates and precision ──
    //
    // BOTH NULLABLE, unlike `addresses`: a candidate may be pure free text with
    // no location at all, and that is the ordinary state of a half-typed
    // autocomplete query. The all-or-none CHECK below is what stops a half of a
    // pair being stored, which is the shape that produces a point at
    // (0, latitude).
    longitude: doublePrecision(),
    latitude: doublePrecision(),
    /**
     * How precise the observation was — see {@link CANDIDATE_PRECISIONS}.
     *
     * The service refuses to materialize a BUILDING or a UNIT from a `centroid`
     * or `area` candidate. That rule is not a CHECK because it constrains the
     * relationship between this row and the LEVEL of the row being created,
     * which lives elsewhere; it is enforced in `materializeHousingCandidate` and
     * pinned by a test that supplies a centroid candidate with a street number.
     */
    precision: text({ enum: CANDIDATE_PRECISIONS }).notNull(),

    // ── Proposed administrative geo, as NAMES ──
    proposedCountryCode: text(),
    proposedCountry: text(),
    proposedRegion: text(),
    proposedCity: text(),
    proposedNeighborhood: text(),

    // ── Proposed address, as free text ──
    proposedStreet: text(),
    /**
     * NULL when the source supplied none — never `''` and never `'00000'`.
     *
     * ADR 0001 §3.2 decision 6, and the reason is that both of those are VALUES:
     * they enter the identity hash and make two unpostcoded places look like one
     * postcoded place. `IngestionService` substitutes `'00000'` today, which is
     * exactly the fabrication this column refuses to accept.
     */
    proposedPostalCode: text(),
    proposedNumber: text(),
    proposedBuildingName: text(),
    proposedBlock: text(),
    proposedEntrance: text(),
    proposedFloor: text(),
    proposedUnit: text(),
    proposedSubunit: text(),

    // ── Evidence ──
    origin: text({ enum: CANDIDATE_ORIGINS }).notNull(),
    /** Where the observation can be seen, when the provider exposes a URL. */
    sourceUrl: text(),
    /**
     * The provider's own confidence, 0..1, when it reports one.
     *
     * Nullable and NOT defaulted: `0` is a provider saying "I am certain this is
     * wrong" and absence is a provider saying nothing, and a default would erase
     * the difference. The service treats absence as absence, never as zero.
     */
    confidence: doublePrecision(),

    /**
     * When this observation stops being worth keeping. Swept by `db/expiry.ts`.
     */
    expiresAt: timestamptz().notNull(),

    /**
     * The canonical row this candidate produced, once it produced one.
     *
     * RESTRICT, NOT `SET NULL`, and this is the case `CONVENTIONS.md` warns
     * about: NULL here ALREADY means "not materialized", so `SET NULL` would
     * give the value a second meaning and turn "this address was deleted out
     * from under its candidate" into "this candidate was never materialized" —
     * silently, and in the direction that hides the loss. Nothing deletes an
     * address, and a merge sets `addresses.merged_into_address_id` rather than
     * deleting the loser, so RESTRICT refuses only the operation that would
     * destroy the link.
     */
    materializedAddressId: text().references(() => addresses.id, { onDelete: 'restrict' }),
    materializedAt: timestamptz(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // ADR 0001's natural key, minus `created_at`, and NOT unique — see the
    // docblock. It serves "my own candidates" and the duplicate-submission
    // diagnostics, both of which want the whole group rather than one row.
    index('address_candidates_submitter_raw_text_idx').on(
      table.submittedByOxyUserId,
      table.rawTextHash,
    ),
    // Non-unique BY DESIGN. One geocoder result ref legitimately appears on many
    // candidates — the same building typed by ten people resolves to one OSM
    // ref — and making this unique would refuse nine of them. Uniqueness of a
    // provider ref is a property of the ENTITY, and it is enforced exactly once,
    // on `address_external_refs`.
    index('address_candidates_provider_ref_idx').on(table.provider, table.providerRef),
    // Required by the expiry registry: the sweep's predicate is a range scan.
    index('address_candidates_expires_at_idx').on(table.expiresAt),
    index('address_candidates_materialized_address_id_idx').on(table.materializedAddressId),

    check(
      'address_candidates_precision_check',
      sql`${table.precision} in (${sql.raw(inList(CANDIDATE_PRECISIONS))})`,
    ),
    check(
      'address_candidates_origin_check',
      sql`${table.origin} in (${sql.raw(inList(CANDIDATE_ORIGINS))})`,
    ),

    // All-or-none, with the range folded in. Written with `is not null` spelled
    // out on BOTH columns of the positive branch rather than as
    // `(lng is null and lat is null) or (lng between … and lat between …)`,
    // because a CHECK rejects only an explicit FALSE: with one side NULL the
    // first branch is false, the comparison is NULL, and `false or NULL` is
    // NULL — so the tidier spelling ADMITS exactly the half-a-pair it exists to
    // refuse. `CONVENTIONS.md` records the same trap shipping once already in
    // `exchange_requests_offered_window_check`.
    check(
      'address_candidates_coordinates_check',
      sql`(${table.longitude} is null and ${table.latitude} is null)
          or (${table.longitude} is not null and ${table.latitude} is not null
              and ${table.longitude} between -180 and 180
              and ${table.latitude} between -90 and 90)`,
    ),

    // A materialized candidate names both the row and the instant, or neither.
    // Same `is not null` discipline, same reason.
    check(
      'address_candidates_materialized_coherence_check',
      sql`(${table.materializedAddressId} is null and ${table.materializedAt} is null)
          or (${table.materializedAddressId} is not null and ${table.materializedAt} is not null)`,
    ),
  ],
);

/**
 * A provider's identifier for a PLACE — ADR 0001 §3.4.
 *
 * ## An external identifier is an attribute, never identity
 *
 * The place's identity is its `addresses.id` and its `identity_key`. A portal's
 * building id is a second name for it, held so that the next listing carrying
 * that id resolves to the same place without re-deriving anything from text —
 * "un match exacto por provider id" in the issue's matching table. If the portal
 * disappears, the place is unaffected, which is the property that makes this a
 * separate table rather than a column.
 *
 * ## Shape, reconciled between the ADR and the issue
 *
 * ADR 0001 §3.4 specifies `(address_id, source, external_id, first_seen_at,
 * last_seen_at)` unique on `(source, external_id)`; issue #360 sketches a
 * `HousingEntitySourceRef` with `entityType: 'street' | 'building' | 'unit'`,
 * `entityId`, `provider`, `providerEntityId`, `sourceUrl`, `confidence` and
 * `rawLabel`. The ADR is the authority and it is closed, so the ADR's names and
 * key are used; the issue's three extra ATTRIBUTES are carried because the ADR
 * does not exclude them and the issue requires them.
 *
 * **`entityType` is deliberately absent.** Street, building and unit are three
 * LEVELS of `addresses` (ADR 0001 invariant 2), so the level is
 * `addresses.address_level` — a `GENERATED ALWAYS` column. Copying it here would
 * create a denormalized second copy that can disagree with the generated one,
 * and the disagreement would be invisible: nothing recomputes a copy. One FK,
 * and the level is read from the row it names.
 *
 * ## The unique key is what makes a conflict a CONFLICT
 *
 * `(source, external_id)` unique is the issue's "provider ref unique por
 * provider/id", and it is the mechanism behind "provider ref ya vinculado a otra
 * entidad" being a refusal rather than a silent rewrite: the second address
 * claiming a ref cannot take it, so the service reports the conflict instead of
 * moving the pointer. Both columns are NOT NULL, so `NULLS DISTINCT` never
 * arises and the index is total rather than partial.
 */
export const addressExternalRefs = pgTable(
  'address_external_refs',
  {
    id: generatedId(),

    /**
     * The place this identifier names.
     *
     * CASCADE, and it is the one CASCADE in this file. An external ref is a
     * second NAME for a row and has no meaning without it — the same reasoning
     * every `*_id` on a child table in this schema follows. It is safe in a way
     * the candidate's pointer is not, because nothing else references an
     * external ref, so cascading it loses no relation and no audit: the
     * materialization log records the ref it attached, by value.
     */
    addressId: text()
      .notNull()
      .references(() => addresses.id, { onDelete: 'cascade' }),

    /** The provider registry id — `idealista`, `osm`, `catastro`. */
    source: text().notNull(),
    /** That provider's own stable id for the place. */
    externalId: text().notNull(),

    /** Where the identifier was seen, when the provider exposes a URL. */
    sourceUrl: text(),
    /** The label the provider used, kept for audit rather than for matching. */
    rawLabel: text(),
    /** The provider's own confidence, 0..1, when it reports one. */
    confidence: doublePrecision(),

    firstSeenAt: timestamptz().notNull(),
    lastSeenAt: timestamptz().notNull(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('address_external_refs_source_external_id_key').on(table.source, table.externalId),
    index('address_external_refs_address_id_idx').on(table.addressId),
    check(
      'address_external_refs_confidence_range_check',
      sql`${table.confidence} between 0 and 1`,
    ),
    check(
      'address_external_refs_seen_order_check',
      sql`${table.lastSeenAt} >= ${table.firstSeenAt}`,
    ),
  ],
);

/**
 * One row per act of materialization — the provenance record, and the audit
 * trail a merge or a split will read.
 *
 * ## Why it is an event log and not a set of columns on `addresses`
 *
 * ADR 0001 §2.1.7: *a duplicate is recorded, never discarded.* One place is
 * routinely materialized many times — three portals advertising one flat, a
 * review written years after the listing that first created the building — and
 * every one of those is a separate fact about how Homiio came to believe what it
 * believes. Columns on `addresses` would keep the last one and silently discard
 * the rest, which is the shape of loss the invariant forbids.
 *
 * ## It copies what it needs off the candidate, because the candidate expires
 *
 * `candidate_id` carries **no foreign key**, and the reason is the one
 * `moderation_outbox.event_id` already records in this schema: the two rows are
 * under independent expiry regimes, so CASCADE would let the candidate sweep
 * delete the audit trail and RESTRICT would make the candidate sweep fail. The
 * classification is registered in `ID_COLUMNS_WITHOUT_FOREIGN_KEY` with that
 * reason. Everything an audit needs — the provider, the ref, the raw text, its
 * hash, the normalization version — is therefore copied here BY VALUE at
 * materialization time, so the record is complete once the candidate is gone.
 *
 * ## Idempotency
 *
 * `idempotency_key` carries a PARTIAL unique index (`where … is not null`),
 * which is what makes "el mismo candidato confirmado dos veces devuelve la misma
 * entidad" structural rather than a read-then-write with a window. Two concurrent
 * requests carrying one key converge: the loser's `ON CONFLICT DO NOTHING`
 * returns nothing and it reads the winner's row back.
 *
 * **A partial index is not inferable from its columns**, so every `ON CONFLICT`
 * naming it must repeat the predicate verbatim (`onConflictDoNothing({ target,
 * where })`) or Postgres answers `42P10 there is no unique or exclusion
 * constraint matching the ON CONFLICT specification` — at runtime, with a clean
 * `tsc`. The service does; `__tests__/db/addressMaterialization.test.ts`
 * mutation-tests it by dropping the predicate and asserting the SQLSTATE.
 */
export const addressMaterializations = pgTable(
  'address_materializations',
  {
    id: generatedId(),

    /**
     * The canonical row this act produced or resolved to.
     *
     * RESTRICT: the audit trail is the thing that makes a merge reversible, so
     * an address may not be deleted while a record says it was materialized.
     */
    addressId: text()
      .notNull()
      .references(() => addresses.id, { onDelete: 'restrict' }),

    /** The `address_candidates` row. NO foreign key — see the docblock. */
    candidateId: text().notNull(),

    // ── Copied off the candidate, so the record survives its expiry ──
    provider: text().notNull(),
    providerRef: text(),
    rawText: text().notNull(),
    rawTextHash: text().notNull(),
    normalizationVersion: integer().notNull(),

    // ── The explanation of the match ──
    matchKind: text({ enum: MATERIALIZATION_MATCH_KINDS }).notNull(),
    /**
     * One line naming what actually matched — which key, which ref, which row.
     *
     * Free text on purpose: it is read by a human auditing a merge, never
     * parsed. A structured version would have to enumerate the reasons in
     * advance, and the reasons are exactly what a correction workflow is trying
     * to learn.
     */
    matchDetail: text(),
    /**
     * The v2 identity key this act resolved to.
     *
     * Copied rather than joined because a merge REWRITES which row a key belongs
     * to, and the audit has to record the key as it was at the time. Nullable
     * only for the paths that resolve without one (an external-ref hit on a
     * pre-v2 row).
     */
    identityKey: text(),

    // ── The durable action that authorised it ──
    /**
     * NOT NULL with a CHECK, and this pair is the enforcement of "autocomplete
     * does not materialize": there is no action value for a read.
     */
    durableAction: text({ enum: DURABLE_MATERIALIZATION_ACTIONS }).notNull(),
    /**
     * The id of the thing the action produced — a listing, a review, a case.
     *
     * Polymorphic across several nouns, so it carries no foreign key, following
     * `images.entity_id` and `housing_domain_events.subject_id`. Nullable
     * because the action frequently produces its row AFTER the address it needs
     * (a listing insert must name an `address_id`), so the reference is
     * back-filled by the caller when it can be and honestly absent when it
     * cannot.
     */
    durableActionRef: text(),
    /** The Oxy account that performed it, or NULL for the ingestion worker. */
    actorOxyUserId: text(),
    /**
     * The caller's idempotency key for this durable action, when it has one.
     *
     * NULLABLE and that is load-bearing rather than lax: Postgres unique
     * indexes are `NULLS DISTINCT`, so any number of rows may hold NULL, which
     * is exactly what a caller with no key needs. A sentinel value would collapse
     * every keyless materialization onto one row — the opposite of what absence
     * means. `__tests__/db` carries the explicit-NULL fixture, because a suite
     * whose cases all supply a key cannot tell this index from a total one.
     */
    idempotencyKey: text(),

    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('address_materializations_idempotency_key')
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    index('address_materializations_address_id_idx').on(table.addressId),
    index('address_materializations_candidate_id_idx').on(table.candidateId),

    check(
      'address_materializations_match_kind_check',
      sql`${table.matchKind} in (${sql.raw(inList(MATERIALIZATION_MATCH_KINDS))})`,
    ),
    check(
      'address_materializations_durable_action_check',
      sql`${table.durableAction} in (${sql.raw(inList(DURABLE_MATERIALIZATION_ACTIONS))})`,
    ),
  ],
);

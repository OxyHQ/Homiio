/**
 * `materializeHousingCandidate` — the ONE place an address candidate becomes a
 * canonical Homiio place. Issue #360, ADR 0001 §2.2 / §3 / §5.
 *
 * ## The rule this module exists to make true
 *
 * **An autocomplete query never creates a permanent row.** Materialization
 * happens only as a side effect of a DURABLE ACTION — creating or updating a
 * listing, writing a review, following a dwelling, linking public data, creating
 * an event that needs canonical identity, or an approved correction. There is no
 * action value meaning "a read": `address_materializations.durable_action` is
 * NOT NULL with a CHECK over that closed set, and this function is the only
 * writer of `addresses.identity_key` and `addresses.parent_address_id`.
 *
 * A preview or a typeahead may record an `address_candidates` row freely. A
 * candidate is internal, expiring and disposable, which is what lets a read path
 * keep its evidence without acquiring the ability to mint identity.
 *
 * ## What it does NOT change
 *
 * `findOrCreateCanonicalAddress` is untouched, and every existing caller
 * (`POST /api/addresses`, `reviewController`, `property/updateDelete`,
 * `seedProperties`, ingestion) keeps its exact current behaviour — the v1
 * `normalized_key` dedup and the `Unknown` region fallback included. Migrating
 * those call sites onto this chokepoint is a separate change: landing both at
 * once would alter what every listing in the catalogue resolves to in the same
 * commit that introduces the mechanism.
 *
 * ## The order of the match, and why each step is where it is
 *
 * 0. **An idempotency key already used** → replay the recorded result, write
 *    nothing. The only step that can answer without resolving geo.
 * 1. **A caller-CONFIRMED address** → use it. This is how an `ambiguous` result
 *    is settled, and the only path that accepts a probable match.
 * 2. **The v2 identity key** → the ordinary exact hit.
 * 3. **The v1 `normalized_key`** → ADOPT the pre-v2 row when every v2 identity
 *    field agrees. This step exists only because 11,734 rows predate the v2 key,
 *    and it is BEFORE the probable search on purpose: without it, every address
 *    already in the catalogue would come back as an ambiguity the first time
 *    anybody materialized it.
 * 4. **A provider external ref, reconciled against the probable set.** A ref is a
 *    portal's stable id, so it must survive that portal RELABELLING a place and
 *    must never silently RELOCATE one. A ref pointing at a row this candidate
 *    could plausibly be is label drift and the ref wins; a ref pointing anywhere
 *    else is a `conflict`, decided before anything is created.
 * 5. **Probable matches** → return `ambiguous`. Never merged automatically.
 * 6. **Nothing** → create, in order: street, then building, then unit.
 *
 * ## Everything from step 0 onwards runs in ONE transaction
 *
 * Geo upserts included, which is why `addressService` grew
 * `upsertGeoChain(db, …)`. The geocoder is consulted BEFORE `BEGIN`, so no HTTP
 * round trip is ever held open inside the transaction.
 *
 * No statement inside is allowed to fail on a constraint: every insert that can
 * conflict is `ON CONFLICT DO NOTHING` plus a read-back, never
 * INSERT-and-catch. In PostgreSQL a failed statement aborts the WHOLE
 * transaction (`25P02`), so the Mongo idiom — let the duplicate raise, then read
 * the row that already existed — does not port: the recovery read is the
 * statement that dies. `db/postgres.ts`'s `inSavepoint` is the escape hatch for
 * a failure that genuinely must happen; nothing here needs one, which is better
 * than needing one and remembering it.
 *
 * ## What is deliberately NOT here
 *
 * Merge and split (#360's second half). The schema leaves room for both —
 * `addresses.merged_into_address_id` is the reversible redirect,
 * `address_materializations` is the audit trail — and this module HONOURS the
 * redirect from its first line ({@link followMergeRedirect} runs on every match),
 * so a merge landing later cannot start handing callers a row it retired.
 * Performing one is a follow-up.
 */

import * as crypto from 'crypto';
import { and, eq, inArray, isNull, sql, type AnyColumn } from 'drizzle-orm';

import { getDb, type DatabaseOrTransaction } from '../db/postgres';
import {
  addressCandidates,
  addressExternalRefs,
  addressMaterializations,
  addresses,
} from '../db/schema';
import type {
  CandidateOrigin,
  CandidatePrecision,
  DurableMaterializationAction,
  MaterializationMatchKind,
} from '../db/schema/addressMaterialization';
import {
  ADDRESS_NORMALIZATION_VERSION,
  computeAddressIdentityKey,
  deriveAddressLevel,
  identityValueOrNull,
  normalizeIdentityValue,
  type AddressIdentityFields,
  type AddressLevel,
} from './addressIdentity';
import {
  UNRESOLVED_REGION_NAME,
  computeAddressNormalizedKey,
  resolveGeoNames,
  upsertGeoChain,
  type ResolvedGeo,
} from './addressService';
import { GeoResolutionError, type GeoNames } from './geoResolutionService';

/**
 * How long a candidate is kept when the caller does not say.
 *
 * Thirty days: long enough that an `ambiguous` result can still be confirmed
 * days later by somebody who had to go and check, short enough that a table fed
 * by autocomplete does not accumulate a year of keystrokes. Swept by
 * `db/expiry.ts`.
 */
export const CANDIDATE_TTL_DAYS = 30;

/**
 * How similar two street names must be before they are even considered the same
 * street, by `pg_trgm`'s `similarity()`.
 *
 * **Measured against a real server rather than chosen**, on Barcelona and Madrid
 * street pairs (2026-08-11, PostgreSQL 17 / pg_trgm, normalized as this module
 * normalizes — lowercased, unaccented):
 *
 * | pair | similarity | should be |
 * |---|---|---|
 * | `carrer de provenca 42` / `carrer de provenca` | 0.864 | same |
 * | `gran via de les corts catalanes` / `…catalanas` | 0.848 | same (typo) |
 * | `carrer de provenca` / `carrer de provenza` | 0.727 | same (typo) |
 * | **`carrer de mallorca` / `carrer de menorca`** | **0.609** | **DIFFERENT** |
 * | `carrer de arago` / `carrer de aribau` | 0.571 | different |
 * | `calle de alcala` / `calle de atocha` | 0.476 | different |
 * | `avinguda diagonal` / `avinguda meridiana` | 0.370 | different |
 *
 * So 0.7 sits in the gap between the closest measured typo (0.727) and the
 * closest measured pair of genuinely different streets (0.609). The gap is
 * NARROW and worth stating rather than hiding: Mallorca and Menorca really are
 * two streets whose names differ by one letter, and no threshold separates that
 * case from a typo by construction.
 *
 * It errs toward ASKING, because the two errors are not symmetric: a false
 * ambiguity costs one confirmation prompt, while a false merge publishes one
 * household's reviews under another household's address. Nothing above this
 * floor is ever merged automatically — it only decides what a human is asked
 * about.
 */
export const STREET_SIMILARITY_FLOOR = 0.7;

/**
 * How far apart two rows may be and still be proposed as the same place, in
 * metres.
 *
 * Coordinates are the WEAKEST identity signal Homiio has — 94-100% of habitaclia
 * and fotocasa listings geocode to the city centroid, and rural geocodes
 * routinely differ by tens of metres between portals (ADR 0001 §1.4, §10.8). So
 * distance only ever EXCLUDES: two rows further apart than this are not proposed
 * as one place, and being close is never evidence that two rows ARE one place.
 */
export const PROBABLE_MATCH_RADIUS_METERS = 400;

/** The most probable matches offered for confirmation. A human cannot use more. */
export const MAX_PROBABLE_MATCHES = 5;

/** The longest merge-redirect chain that is followed before it is called a cycle. */
const MAX_MERGE_REDIRECTS = 8;

/** What a caller may submit as a candidate. Free text; nothing is identity yet. */
export interface HousingCandidateDraft {
  readonly provider: string;
  readonly providerRef?: string | null;
  readonly rawText: string;
  readonly origin: CandidateOrigin;
  readonly precision: CandidatePrecision;
  readonly longitude?: number | null;
  readonly latitude?: number | null;
  readonly submittedByOxyUserId?: string | null;
  readonly sourceUrl?: string | null;
  readonly confidence?: number | null;
  readonly normalizedPayload?: Record<string, unknown>;
  readonly expiresAt?: Date;

  readonly proposedCountryCode?: string | null;
  readonly proposedCountry?: string | null;
  readonly proposedRegion?: string | null;
  readonly proposedCity?: string | null;
  readonly proposedNeighborhood?: string | null;

  readonly proposedStreet?: string | null;
  readonly proposedPostalCode?: string | null;
  readonly proposedNumber?: string | null;
  readonly proposedBuildingName?: string | null;
  readonly proposedBlock?: string | null;
  readonly proposedEntrance?: string | null;
  readonly proposedFloor?: string | null;
  readonly proposedUnit?: string | null;
  readonly proposedSubunit?: string | null;
}

export interface MaterializeHousingCandidateInput {
  /** An `address_candidates` row a preview already recorded. */
  readonly candidateId?: string;
  /** Or the candidate itself, recorded as part of this materialization. */
  readonly candidate?: HousingCandidateDraft;
  /**
   * The address a caller picked out of a previous `ambiguous` result.
   *
   * The ONLY way a probable match is ever accepted. Supplying it skips the
   * probable search entirely — the ambiguity has been settled by whoever is
   * calling, which is the point — and the CONFIRMED row's own fields become
   * authoritative, so no rival row is created beside it.
   */
  readonly confirmedAddressId?: string;
}

/** Who is materializing, and under what authority. */
export interface MaterializationActorContext {
  /** The durable action. There is deliberately no value meaning "a read". */
  readonly action: DurableMaterializationAction;
  readonly actorOxyUserId?: string | null;
  /** The id of the row the action produced, when it exists yet. */
  readonly actionRef?: string | null;
  /**
   * The caller's idempotency key for this action.
   *
   * Two calls carrying one key converge on one materialization and one address,
   * whether they arrive in sequence or at the same instant.
   */
  readonly idempotencyKey?: string | null;
}

/** Why a candidate could not become a permanent row at all. */
export type MaterializationRejection =
  /** `centroid` or `area` — the observation is about an area, not a dwelling. */
  | 'imprecise_location'
  /** No street: there is nothing for an identity to be about. */
  | 'missing_street'
  /** No coordinates: `addresses.longitude` / `latitude` are NOT NULL. */
  | 'missing_coordinates'
  /** No city could be resolved. */
  | 'unresolved_city'
  /** No region could be resolved, and a bucket is not an identity. */
  | 'unresolved_region';

/** Why a materialization refused to write rather than overwrite something. */
export type MaterializationConflictKind = 'provider_ref_bound_elsewhere';

export interface MaterializationConflict {
  readonly kind: MaterializationConflictKind;
  /** The place the evidence currently points at. */
  readonly existingAddressId: string;
  /** The place this candidate resolved to. */
  readonly proposedAddressId: string | null;
  readonly detail: string;
}

/** One row a human is being asked to choose between. */
export interface ProbableMatch {
  readonly addressId: string;
  readonly addressLevel: AddressLevel;
  readonly street: string;
  readonly number: string | null;
  readonly buildingName: string | null;
  readonly entrance: string | null;
  readonly streetSimilarity: number;
  readonly distanceMeters: number;
  /** Why it is a candidate, in terms a person can check. */
  readonly reason: string;
}

export interface MaterializationExplanation {
  readonly matchKind: MaterializationMatchKind;
  readonly detail: string;
  readonly identityKey: string;
}

export type MaterializationResult =
  | {
      readonly status: 'materialized';
      readonly candidateId: string;
      /** The row the durable action should reference. */
      readonly addressId: string;
      readonly addressLevel: AddressLevel;
      readonly streetAddressId: string;
      readonly buildingAddressId: string | null;
      readonly unitAddressId: string | null;
      readonly materializationId: string;
      readonly match: MaterializationExplanation;
    }
  | {
      readonly status: 'ambiguous';
      readonly candidateId: string;
      readonly candidates: readonly ProbableMatch[];
    }
  | {
      readonly status: 'conflict';
      readonly candidateId: string;
      readonly conflicts: readonly MaterializationConflict[];
    }
  | {
      readonly status: 'rejected';
      readonly candidateId: string;
      readonly reason: MaterializationRejection;
      readonly detail: string;
    };

type CandidateRow = typeof addressCandidates.$inferSelect;
type AddressRow = typeof addresses.$inferSelect;

/** A resolved row plus how it was arrived at. */
interface ResolvedAddress {
  readonly row: AddressRow;
  readonly matchKind: MaterializationMatchKind;
  readonly detail: string;
}

/** sha256 over the NORMALIZED raw text — ADR 0001 §2.2's `raw_text_hash`. */
export function rawTextHashOf(rawText: string): string {
  return crypto.createHash('sha256').update(normalizeIdentityValue(rawText)).digest('hex');
}

/**
 * Follow `merged_into_address_id` to the surviving row.
 *
 * Called on EVERY match before it is returned. Nothing performs a merge today,
 * so this is a no-op in every current test — which is exactly why it is here
 * now rather than added later: retrofitting it would mean auditing each match
 * path separately, and the one that was missed would silently hand callers a
 * row a merge had retired.
 *
 * Bounded rather than looped until NULL. A CHAIN of redirects is legitimate (A
 * merged into B, B later into C); a CYCLE is not, and a cycle here would hang a
 * request rather than fail it. The one-row case is refused by
 * `addresses_merge_not_self_check`; a longer cycle is not expressible as a
 * CHECK, so this bound is the defence.
 */
async function followMergeRedirect(
  db: DatabaseOrTransaction,
  start: AddressRow,
): Promise<AddressRow> {
  let current = start;
  for (let hop = 0; hop < MAX_MERGE_REDIRECTS; hop += 1) {
    const next = current.mergedIntoAddressId;
    if (!next) return current;
    const [row] = await db.select().from(addresses).where(eq(addresses.id, next)).limit(1);
    if (!row) {
      throw new Error(
        `Address ${current.id} redirects to ${next}, which does not exist. The redirect is a ` +
        'foreign key, so this means the row was removed by something that bypassed it.',
      );
    }
    current = row;
  }
  throw new Error(
    `Address ${start.id} did not resolve to a survivor within ${MAX_MERGE_REDIRECTS} redirects — ` +
    'the merge chain contains a cycle.',
  );
}

/** The identity fields as they will be STORED: normalized, or NULL when empty. */
function identityFieldsOfCandidate(
  candidate: CandidateRow,
  geo: ResolvedGeo,
): AddressIdentityFields {
  return {
    // Asserted non-empty by `validateCandidate` before this runs.
    street: normalizeIdentityValue(candidate.proposedStreet),
    postalCode: identityValueOrNull(candidate.proposedPostalCode),
    cityId: geo.cityId,
    countryCode: geo.countryCode,
    number: identityValueOrNull(candidate.proposedNumber),
    buildingName: identityValueOrNull(candidate.proposedBuildingName),
    block: identityValueOrNull(candidate.proposedBlock),
    entrance: identityValueOrNull(candidate.proposedEntrance),
    floor: identityValueOrNull(candidate.proposedFloor),
    unit: identityValueOrNull(candidate.proposedUnit),
    subunit: identityValueOrNull(candidate.proposedSubunit),
  };
}

/**
 * The same fields under V1's normalization — lowercase and trim only, NO
 * diacritic stripping and no whitespace collapsing.
 *
 * Used exclusively to compute a v1 LOOKUP key, so an accented row written by
 * `findOrCreateCanonicalAddress` can still be found. See
 * {@link legacyKeyCandidates} for why this cannot be skipped.
 */
function legacyFieldsOf(
  source: {
    street: string | null;
    postalCode: string | null;
    number: string | null;
    buildingName: string | null;
    block: string | null;
    entrance: string | null;
    floor: string | null;
    unit: string | null;
    subunit: string | null;
  },
  geo: { cityId: string; countryCode: string },
): AddressIdentityFields {
  const v1 = (value: string | null): string | null => {
    const trimmed = (value ?? '').toLowerCase().trim();
    return trimmed === '' ? null : trimmed;
  };
  return {
    street: v1(source.street) ?? '',
    postalCode: v1(source.postalCode),
    cityId: geo.cityId,
    countryCode: geo.countryCode,
    number: v1(source.number),
    buildingName: v1(source.buildingName),
    block: v1(source.block),
    entrance: v1(source.entrance),
    floor: v1(source.floor),
    unit: v1(source.unit),
    subunit: v1(source.subunit),
  };
}

/** The v1-shaped fields of a candidate. */
function legacyFieldsOfCandidate(candidate: CandidateRow, geo: ResolvedGeo): AddressIdentityFields {
  return legacyFieldsOf(
    {
      street: candidate.proposedStreet,
      postalCode: candidate.proposedPostalCode,
      number: candidate.proposedNumber,
      buildingName: candidate.proposedBuildingName,
      block: candidate.proposedBlock,
      entrance: candidate.proposedEntrance,
      floor: candidate.proposedFloor,
      unit: candidate.proposedUnit,
      subunit: candidate.proposedSubunit,
    },
    geo,
  );
}

/** The v1-shaped fields of an existing row, for ancestor projection. */
function legacyFieldsOfRow(row: AddressRow): AddressIdentityFields {
  return legacyFieldsOf(row, { cityId: row.cityId, countryCode: row.countryCode });
}

/** The same shape read back off a row, for adoption and for ancestor projection. */
function identityFieldsOfRow(row: AddressRow): AddressIdentityFields {
  return {
    street: normalizeIdentityValue(row.street),
    postalCode: identityValueOrNull(row.postalCode),
    cityId: row.cityId,
    countryCode: row.countryCode,
    number: identityValueOrNull(row.number),
    buildingName: identityValueOrNull(row.buildingName),
    block: identityValueOrNull(row.block),
    entrance: identityValueOrNull(row.entrance),
    floor: identityValueOrNull(row.floor),
    unit: identityValueOrNull(row.unit),
    subunit: identityValueOrNull(row.subunit),
  };
}

/**
 * The v1 key for a projection, computed with the SAME field mapping
 * `findOrCreateCanonicalAddress` uses.
 *
 * It must agree byte for byte, because this value is the LOOKUP into rows
 * written under those rules — including their defect, which is reproduced
 * faithfully rather than corrected: v1 hashes `unit` and neither `floor` nor
 * `subunit` nor `entrance`.
 */
function legacyKeyOf(fields: AddressIdentityFields, level: AddressLevel): string {
  return computeAddressNormalizedKey({
    street: fields.street,
    number: level === 'STREET' ? undefined : fields.number ?? undefined,
    unit: level === 'UNIT' ? fields.unit ?? undefined : undefined,
    buildingName: level === 'STREET' ? undefined : fields.buildingName ?? undefined,
    block: level === 'STREET' ? undefined : fields.block ?? undefined,
    postalCode: fields.postalCode ?? undefined,
    cityId: fields.cityId,
    countryCode: fields.countryCode,
  });
}

/**
 * The v1 keys a pre-v2 row for this place could be carrying — usually two.
 *
 * **The reason there is more than one is the whole point, and it is the common
 * case in this corpus rather than an edge.** v1 lowercases and trims; v2 also
 * STRIPS DIACRITICS. So a building stored as `Carrer de Provença 42` has a v1
 * key over `carrer de provença`, while the same candidate normalized for v2
 * hashes `carrer de provenca` — different strings, different v1 keys, no match.
 * Looking up only the v2-normalized form would fail to adopt every accented
 * street in Spain, Catalonia, Portugal and Italy, and would create a rival row
 * beside each one. Measured: the adoption case failed exactly this way on its
 * first run.
 *
 * So both forms are looked up. The set is deduped, because for an unaccented
 * street they are the same string.
 */
function legacyKeyCandidates(
  normalized: AddressIdentityFields,
  raw: AddressIdentityFields,
  level: AddressLevel,
): string[] {
  return [...new Set([legacyKeyOf(normalized, level), legacyKeyOf(raw, level)])];
}

/** The columns a new `addresses` row gets at `level`. */
function addressValuesFor(
  geo: ResolvedGeo,
  fields: AddressIdentityFields,
  level: AddressLevel,
  point: { longitude: number; latitude: number },
  keys: { identityKey: string; normalizedKey: string | null },
  parentAddressId: string | null,
): typeof addresses.$inferInsert {
  const atBuildingOrBelow = level === 'BUILDING' || level === 'UNIT';
  return {
    countryId: geo.countryId,
    regionId: geo.regionId,
    cityId: geo.cityId,
    neighborhoodId: geo.neighborhoodId ?? null,
    countryCode: geo.countryCode,
    street: fields.street,
    // `postal_code` is NOT NULL on the table, so an unpostcoded place stores
    // `''` — the column's existing contract, which
    // `findOrCreateCanonicalAddress` also follows. It is safe HERE in a way it
    // is not in the key: `identity_key` receives NULL for an absent postcode, so
    // `''` never enters an identity. ADR 0001 §3.2's "a missing postcode is
    // NULL" needs the column to become nullable, which is a separate migration
    // and a separate decision about 11,734 existing rows.
    postalCode: fields.postalCode ?? '',
    number: atBuildingOrBelow ? fields.number ?? null : null,
    buildingName: atBuildingOrBelow ? fields.buildingName ?? null : null,
    block: atBuildingOrBelow ? fields.block ?? null : null,
    entrance: atBuildingOrBelow ? fields.entrance ?? null : null,
    floor: level === 'UNIT' ? fields.floor ?? null : null,
    unit: level === 'UNIT' ? fields.unit ?? null : null,
    subunit: level === 'UNIT' ? fields.subunit ?? null : null,
    longitude: point.longitude,
    latitude: point.latitude,
    identityKey: keys.identityKey,
    normalizedKey: keys.normalizedKey,
    parentAddressId,
  };
}

/**
 * Find, adopt or create the row at `level`.
 *
 * The three-step lookup — v2 key, then v1 key, then insert — is what lets this
 * module run BESIDE `findOrCreateCanonicalAddress` rather than instead of it.
 */
async function resolveLevel(
  db: DatabaseOrTransaction,
  geo: ResolvedGeo,
  fields: AddressIdentityFields,
  legacyFields: AddressIdentityFields,
  level: AddressLevel,
  point: { longitude: number; latitude: number },
  parentAddressId: string | null,
): Promise<ResolvedAddress> {
  const identityKey = computeAddressIdentityKey(fields, level);

  const byIdentity = await findByIdentityKey(db, identityKey);
  if (byIdentity) return byIdentity;

  const adopted = await adoptLegacyRow(db, fields, legacyFields, level, identityKey);
  if (adopted) return adopted;

  // The key this row would CARRY is computed over the values it will STORE, so
  // the stored row stays self-consistent under v1's own rules. The keys it is
  // checked AGAINST include the raw form as well, so an accented pre-v2 row is
  // not overwritten by a rival carrying the stripped key.
  const legacyKey = legacyKeyOf(fields, level);
  const [legacyHolder] = await db
    .select({ id: addresses.id })
    .from(addresses)
    .where(inArray(addresses.normalizedKey, legacyKeyCandidates(fields, legacyFields, level)))
    .limit(1);

  // The v1 key is TAKEN by a different place (or by a row that already carries
  // another v2 identity), and `addresses_normalized_key_key` is UNIQUE — so this
  // row cannot carry one. NULL is the honest answer rather than a workaround: v1
  // hashes neither `floor` nor `entrance` nor `subunit`, so it genuinely cannot
  // represent a third-floor flat as distinct from its building. The v1 caller
  // keeps resolving to the row it already had; this row is reachable by its v2
  // identity. ADR 0001 §5.1's plan is forward-only and says so.
  const normalizedKey = legacyHolder ? null : legacyKey;
  const values = addressValuesFor(geo, fields, level, point, { identityKey, normalizedKey }, parentAddressId);

  const inserted = await db
    .insert(addresses)
    .values(values)
    // The index PREDICATE, not a row filter. `addresses_identity_key_key` is
    // PARTIAL (`where identity_key is not null`) and Postgres will not infer a
    // partial index from its columns alone: without the matching predicate this
    // fails at RUNTIME with `42P10 there is no unique or exclusion constraint
    // matching the ON CONFLICT specification`, while `tsc` stays clean.
    .onConflictDoNothing({
      target: addresses.identityKey,
      where: sql`${addresses.identityKey} is not null`,
    })
    .returning();
  if (inserted[0]) {
    return {
      row: inserted[0],
      matchKind: 'created',
      detail: legacyHolder
        ? `created at ${level}; normalized_key ${legacyKey.slice(0, 12)}… is held by ${legacyHolder.id}, which the v1 key cannot tell apart from this place`
        : `created at ${level}`,
    };
  }

  // Lost the race to a concurrent materialization of the same place. Reading the
  // winner is the same answer a moment later, and it is the only one available:
  // raising here would make two correct callers fight.
  const raced = await findByIdentityKey(db, identityKey);
  if (!raced) {
    throw new Error(
      `Address with identity_key ${identityKey} could not be resolved after an insert conflict`,
    );
  }
  return { ...raced, detail: `identity_key ${identityKey.slice(0, 12)}… created concurrently at ${level}` };
}

/** An exact v2 hit, redirected to its merge survivor. */
async function findByIdentityKey(
  db: DatabaseOrTransaction,
  identityKey: string,
): Promise<ResolvedAddress | null> {
  const [row] = await db
    .select()
    .from(addresses)
    .where(eq(addresses.identityKey, identityKey))
    .limit(1);
  if (!row) return null;
  const survivor = await followMergeRedirect(db, row);
  return {
    row: survivor,
    matchKind: 'exact_identity_key',
    detail:
      survivor.id === row.id
        ? `identity_key ${identityKey.slice(0, 12)}…`
        : `identity_key ${identityKey.slice(0, 12)}…, redirected from ${row.id}`,
  };
}

/**
 * Stamp a v2 identity onto a pre-v2 row that is the SAME place.
 *
 * Matching the v1 key proves only that the v1 SUBSET agrees, and adopting on
 * that basis alone is exactly how a building would acquire a flat's identity —
 * so every v2 identity field is compared, and the level follows from those
 * fields rather than being asserted.
 *
 * Returns NULL when there is no such row, when the row already carries a v2
 * identity (it is a different place that merely shares a v1 key), or when the
 * fields disagree.
 */
async function adoptLegacyRow(
  db: DatabaseOrTransaction,
  fields: AddressIdentityFields,
  legacyFields: AddressIdentityFields,
  level: AddressLevel,
  identityKey: string,
): Promise<ResolvedAddress | null> {
  const legacyKeys = legacyKeyCandidates(fields, legacyFields, level);
  const [candidateRow] = await db
    .select()
    .from(addresses)
    .where(inArray(addresses.normalizedKey, legacyKeys))
    .limit(1);
  if (!candidateRow) return null;
  const legacyKey = candidateRow.normalizedKey ?? legacyKeys[0];

  const survivor = await followMergeRedirect(db, candidateRow);
  if (survivor.identityKey !== null) return null;

  const rowFields = identityFieldsOfRow(survivor);
  if (computeAddressIdentityKey(rowFields, deriveAddressLevel(rowFields)) !== identityKey) {
    return null;
  }

  const [adopted] = await db
    .update(addresses)
    .set({ identityKey })
    .where(and(eq(addresses.id, survivor.id), isNull(addresses.identityKey)))
    .returning();
  if (adopted) {
    return {
      row: adopted,
      matchKind: 'adopted_v1_key',
      detail:
        `pre-v2 row ${survivor.id} matched normalized_key ${legacyKey.slice(0, 12)}… ` +
        'and every v2 identity field',
    };
  }

  // A concurrent adopter stamped it first; its answer is this answer.
  return findByIdentityKey(db, identityKey);
}

/**
 * Rows that MIGHT be this place but are not certainly it.
 *
 * Two rules decide the set, and the second is what stops a whole street being
 * ambiguous:
 *
 * - **Similar street, same city, same level, close enough.** Similarity is
 *   `pg_trgm`; distance only excludes.
 * - **Every discriminating field is COMPATIBLE**: for `number`,
 *   `building_name`, `block`, `entrance`, `floor`, `unit` and `subunit`, the two
 *   agree or at least one side is absent. Two rows that both name a number and
 *   name DIFFERENT numbers are different places, not an ambiguity — `42` and
 *   `43` on one street must materialize without asking anybody.
 *
 * So what comes back is the genuinely undecidable zone: `42` versus
 * `42, entrance A`; `Carrer de Provença 42` versus `Carrer de Provenza 42`.
 * Nothing in it is merged automatically (#360: *un match probable no debe
 * fusionar automáticamente*) — the caller settles it with `confirmedAddressId`.
 */
async function findProbableMatches(
  db: DatabaseOrTransaction,
  fields: AddressIdentityFields,
  level: AddressLevel,
  point: { longitude: number; latitude: number },
): Promise<ProbableMatch[]> {
  // A NULL side cannot contradict anything, so it is compatible with every row;
  // a non-null side is compatible with a row that agrees or says nothing.
  const compatible = (column: AnyColumn, value: string | null) =>
    value === null ? sql`true` : sql`(coalesce(${column}, '') = '' or lower(${column}) = ${value})`;

  const similarity = sql<number>`similarity(lower(${addresses.street}), ${fields.street})`;
  const distance = sql<number>`ST_Distance(${addresses.geo}, ST_MakePoint(${point.longitude}, ${point.latitude})::geography)`;

  const rows = await db
    .select({
      id: addresses.id,
      addressLevel: addresses.addressLevel,
      street: addresses.street,
      number: addresses.number,
      buildingName: addresses.buildingName,
      entrance: addresses.entrance,
      streetSimilarity: similarity,
      distanceMeters: distance,
    })
    .from(addresses)
    .where(
      and(
        eq(addresses.cityId, fields.cityId),
        eq(addresses.addressLevel, level),
        isNull(addresses.mergedIntoAddressId),
        sql`${similarity} >= ${STREET_SIMILARITY_FLOOR}`,
        sql`ST_DWithin(${addresses.geo}, ST_MakePoint(${point.longitude}, ${point.latitude})::geography, ${PROBABLE_MATCH_RADIUS_METERS})`,
        compatible(addresses.number, fields.number ?? null),
        compatible(addresses.buildingName, fields.buildingName ?? null),
        compatible(addresses.block, fields.block ?? null),
        compatible(addresses.entrance, fields.entrance ?? null),
        compatible(addresses.floor, fields.floor ?? null),
        compatible(addresses.unit, fields.unit ?? null),
        compatible(addresses.subunit, fields.subunit ?? null),
      ),
    )
    // Every ordering ends in `id`, so a complete tie is still deterministic —
    // the rule `db/geo/placeLookup.ts` states for place lookup, applied here.
    .orderBy(sql`${similarity} desc`, sql`${distance} asc`, addresses.id)
    .limit(MAX_PROBABLE_MATCHES);

  return rows.map((row) => ({
    addressId: row.id,
    addressLevel: (row.addressLevel ?? level) as AddressLevel,
    street: row.street,
    number: row.number,
    buildingName: row.buildingName,
    entrance: row.entrance,
    streetSimilarity: Number(row.streetSimilarity),
    distanceMeters: Number(row.distanceMeters),
    reason:
      `street similarity ${Number(row.streetSimilarity).toFixed(2)} at ` +
      `${Math.round(Number(row.distanceMeters))} m, and no identifying field contradicts this candidate`,
  }));
}

/**
 * The street / building / unit ids for a row, creating any ANCESTOR that does
 * not exist yet and stamping `parent_address_id` where it is missing.
 *
 * Projected from the ROW's own fields, never the candidate's. That is what makes
 * a confirmation safe: confirming means "this candidate IS that place", so the
 * place's own identity is authoritative and no rival row is created beside it.
 * A candidate for `42, entrance A` confirmed against `42` produces `42`'s
 * hierarchy, not a second building.
 */
async function ensureAncestors(
  db: DatabaseOrTransaction,
  row: AddressRow,
  geo: ResolvedGeo,
): Promise<{ streetId: string; buildingId: string | null; unitId: string | null }> {
  const fields = identityFieldsOfRow(row);
  const legacyFields = legacyFieldsOfRow(row);
  const level = deriveAddressLevel(fields);
  const point = { longitude: row.longitude, latitude: row.latitude };

  if (level === 'STREET') {
    return { streetId: row.id, buildingId: null, unitId: null };
  }

  const street = await resolveLevel(db, geo, fields, legacyFields, 'STREET', point, null);
  if (level === 'BUILDING') {
    await stampParent(db, row, street.row.id);
    return { streetId: street.row.id, buildingId: row.id, unitId: null };
  }

  const building = await resolveLevel(db, geo, fields, legacyFields, 'BUILDING', point, street.row.id);
  await stampParent(db, row, building.row.id);
  return { streetId: street.row.id, buildingId: building.row.id, unitId: row.id };
}

/**
 * Give a row its parent, but only if it does not have one.
 *
 * `is null` in the predicate rather than an unconditional write: a row that
 * already names a parent has one somebody decided about, and re-pointing it
 * would move a place in the hierarchy as a side effect of an unrelated
 * materialization.
 */
async function stampParent(
  db: DatabaseOrTransaction,
  row: AddressRow,
  parentAddressId: string,
): Promise<void> {
  if (row.parentAddressId || row.id === parentAddressId) return;
  await db
    .update(addresses)
    .set({ parentAddressId })
    .where(and(eq(addresses.id, row.id), isNull(addresses.parentAddressId)));
}

/** Everything a candidate must have before it can become a permanent row. */
function validateCandidate(
  candidate: CandidateRow,
): { reason: MaterializationRejection; detail: string } | null {
  if (candidate.precision === 'centroid' || candidate.precision === 'area') {
    return {
      reason: 'imprecise_location',
      detail:
        `precision is "${candidate.precision}", which describes an area rather than a dwelling. ` +
        'Materializing a building from a city centroid collapses every listing in that city onto ' +
        'one fabricated address (ADR 0001 §10.6); the candidate is kept instead, and the listing ' +
        'stays searchable at city scope.',
    };
  }
  if (normalizeIdentityValue(candidate.proposedStreet) === '') {
    return {
      reason: 'missing_street',
      detail: 'no proposed street — there is nothing for an identity key to be about',
    };
  }
  if (candidate.longitude === null || candidate.latitude === null) {
    return {
      reason: 'missing_coordinates',
      detail:
        'no coordinates. `addresses.longitude` / `latitude` are NOT NULL and the PostGIS point is ' +
        'generated from them, so an address without a location is unrepresentable rather than degraded.',
    };
  }
  return null;
}

/** The names a candidate proposes, in `resolveGeoNames`'s shape. */
function proposedNames(source: HousingCandidateDraft | CandidateRow): GeoNames {
  return {
    city: source.proposedCity ?? undefined,
    state: source.proposedRegion ?? undefined,
    country: source.proposedCountry ?? undefined,
    countryCode: source.proposedCountryCode ?? undefined,
    neighborhood: source.proposedNeighborhood ?? undefined,
  };
}

/** The coordinate pair, or undefined when the candidate has none. */
function coordinatesOf(
  source: HousingCandidateDraft | CandidateRow,
): [number, number] | undefined {
  const { longitude, latitude } = source;
  if (longitude === null || longitude === undefined) return undefined;
  if (latitude === null || latitude === undefined) return undefined;
  return [longitude, latitude];
}

/** Insert the candidate, or load the one a preview already recorded. */
async function recordCandidate(
  db: DatabaseOrTransaction,
  input: MaterializeHousingCandidateInput,
): Promise<CandidateRow> {
  if (input.candidateId) {
    const [existing] = await db
      .select()
      .from(addressCandidates)
      .where(eq(addressCandidates.id, input.candidateId))
      .limit(1);
    if (!existing) throw new Error(`Address candidate ${input.candidateId} does not exist`);
    return existing;
  }

  const draft = input.candidate;
  if (!draft) {
    throw new Error(
      'materializeHousingCandidate needs either `candidateId` or `candidate`. A materialization ' +
      'with no candidate has no provenance, which is the one thing this chokepoint exists to guarantee.',
    );
  }

  const [created] = await db
    .insert(addressCandidates)
    .values({
      submittedByOxyUserId: draft.submittedByOxyUserId ?? null,
      provider: draft.provider,
      providerRef: draft.providerRef ?? null,
      rawText: draft.rawText,
      rawTextHash: rawTextHashOf(draft.rawText),
      normalizedPayload: draft.normalizedPayload ?? {},
      normalizationVersion: ADDRESS_NORMALIZATION_VERSION,
      longitude: draft.longitude ?? null,
      latitude: draft.latitude ?? null,
      precision: draft.precision,
      proposedCountryCode: draft.proposedCountryCode ?? null,
      proposedCountry: draft.proposedCountry ?? null,
      proposedRegion: draft.proposedRegion ?? null,
      proposedCity: draft.proposedCity ?? null,
      proposedNeighborhood: draft.proposedNeighborhood ?? null,
      proposedStreet: draft.proposedStreet ?? null,
      // NULL, never `''` and never `'00000'`: both are VALUES and both would
      // enter an identity as though a real postcode had been observed.
      proposedPostalCode: identityValueOrNull(draft.proposedPostalCode) === null
        ? null
        : draft.proposedPostalCode ?? null,
      proposedNumber: draft.proposedNumber ?? null,
      proposedBuildingName: draft.proposedBuildingName ?? null,
      proposedBlock: draft.proposedBlock ?? null,
      proposedEntrance: draft.proposedEntrance ?? null,
      proposedFloor: draft.proposedFloor ?? null,
      proposedUnit: draft.proposedUnit ?? null,
      proposedSubunit: draft.proposedSubunit ?? null,
      origin: draft.origin,
      sourceUrl: draft.sourceUrl ?? null,
      confidence: draft.confidence ?? null,
      expiresAt:
        draft.expiresAt ?? new Date(Date.now() + CANDIDATE_TTL_DAYS * 24 * 60 * 60 * 1000),
    })
    .returning();
  return created;
}

/**
 * Turn a candidate confirmed by a durable action into canonical rows.
 *
 * @param input The candidate, by id or by value, plus an optional confirmation
 *   of a previously-returned ambiguous match.
 * @param actor The durable action authorising it, who performed it, and an
 *   optional idempotency key.
 * @param tx A transaction to JOIN. Supply it when the durable action's own write
 *   must be atomic with the materialization; omit it and this opens its own.
 * @throws {Error} When neither `candidateId` nor `candidate` is given, when a
 *   named candidate or confirmed address does not exist, or when a merge chain
 *   contains a cycle. Every OUTCOME a caller must handle — imprecise, ambiguous,
 *   conflicting — is RETURNED rather than thrown, because none of them is
 *   exceptional: an ingest producing a city centroid is the ordinary case.
 */
export async function materializeHousingCandidate(
  input: MaterializeHousingCandidateInput,
  actor: MaterializationActorContext,
  tx?: DatabaseOrTransaction,
): Promise<MaterializationResult> {
  // The geocoder is consulted BEFORE the transaction opens, so no HTTP round
  // trip is ever held between BEGIN and COMMIT. When the caller named an
  // existing candidate, the row is read here — outside any transaction — purely
  // to learn what names to resolve; it is read again inside.
  const source = input.candidate ?? (await loadCandidateForNames(input.candidateId));
  let names: GeoNames | null = null;
  let namesError: string | null = null;
  try {
    names = await resolveGeoNames({ coordinates: coordinatesOf(source), names: proposedNames(source) });
  } catch (error) {
    if (!(error instanceof GeoResolutionError)) throw error;
    namesError = error.message;
  }

  const run = async (db: DatabaseOrTransaction): Promise<MaterializationResult> => {
    // 0. An idempotency key already used answers without touching anything else.
    if (actor.idempotencyKey) {
      const [previous] = await db
        .select()
        .from(addressMaterializations)
        .where(eq(addressMaterializations.idempotencyKey, actor.idempotencyKey))
        .limit(1);
      if (previous) return replayMaterialization(db, previous);
    }

    const candidate = await recordCandidate(db, input);

    const invalid = validateCandidate(candidate);
    if (invalid) return { status: 'rejected', candidateId: candidate.id, ...invalid };
    if (!names) {
      return {
        status: 'rejected',
        candidateId: candidate.id,
        reason: 'unresolved_city',
        detail: namesError ?? 'no city could be resolved from this candidate',
      };
    }
    if (!names.state?.trim()) {
      return {
        status: 'rejected',
        candidateId: candidate.id,
        reason: 'unresolved_region',
        detail:
          `no administrative region resolved, and this chokepoint refuses the "${UNRESOLVED_REGION_NAME}" ` +
          'bucket: two genuinely different Santiagos both land in it and collapse into one city row ' +
          '(ADR 0001 §5.2 change 5, measured). The candidate is kept.',
      };
    }

    const point = {
      // Non-null by `validateCandidate` above.
      longitude: candidate.longitude ?? 0,
      latitude: candidate.latitude ?? 0,
    };
    const geo = await upsertGeoChain(db, names, [point.longitude, point.latitude]);
    const fields = identityFieldsOfCandidate(candidate, geo);
    const legacyFields = legacyFieldsOfCandidate(candidate, geo);
    const level = deriveAddressLevel(fields);
    const identityKey = computeAddressIdentityKey(fields, level);

    const providerRef = candidate.providerRef;
    const [existingRef] = providerRef
      ? await db
          .select()
          .from(addressExternalRefs)
          .where(
            and(
              eq(addressExternalRefs.source, candidate.provider),
              eq(addressExternalRefs.externalId, providerRef),
            ),
          )
          .limit(1)
      : [];

    // 1-3: confirmation, the v2 key, then adoption of a pre-v2 row. Each returns
    // the SURVIVING row.
    let resolved = await resolveExactly(db, {
      confirmedAddressId: input.confirmedAddressId,
      identityKey,
      fields,
      legacyFields,
      level,
    });

    // 4-5: what the provider ref says, and what the text says, reconciled.
    //
    // A ref is a portal's stable id for a place, so it must survive the portal
    // relabelling that place — but it must NEVER silently relocate one. The
    // discriminator is the probable-match set: a ref pointing at a row this
    // candidate could plausibly BE is label drift and the ref wins; a ref
    // pointing anywhere else is a conflict a human has to settle.
    let refConflict = false;
    if (existingRef) {
      if (resolved) {
        refConflict = existingRef.addressId !== resolved.row.id;
      } else {
        const probable = await findProbableMatches(db, fields, level, point);
        if (probable.some((match) => match.addressId === existingRef.addressId)) {
          const row = await loadAddress(db, existingRef.addressId);
          if (row) {
            resolved = {
              row: await followMergeRedirect(db, row),
              matchKind: 'exact_external_ref',
              detail:
                `${candidate.provider}:${providerRef} already names this place; the portal's ` +
                'label has drifted but every identifying field still agrees',
            };
          }
        } else {
          refConflict = true;
        }
      }
    } else if (!resolved) {
      const probable = await findProbableMatches(db, fields, level, point);
      if (probable.length > 0) {
        return { status: 'ambiguous', candidateId: candidate.id, candidates: probable };
      }
    }

    // The conflict is decided BEFORE anything is created, which is the whole
    // point of refusing: a check placed after the chain was built would leave
    // orphan rows behind whenever this function owns its own transaction, since
    // returning normally COMMITS.
    if (refConflict && existingRef) {
      return {
        status: 'conflict',
        candidateId: candidate.id,
        conflicts: [
          {
            kind: 'provider_ref_bound_elsewhere',
            existingAddressId: existingRef.addressId,
            proposedAddressId: resolved?.row.id ?? null,
            detail:
              `${candidate.provider}:${providerRef} is already bound to ${existingRef.addressId}, ` +
              `but this candidate resolves to ${resolved?.row.id ?? 'a place that does not exist yet'}. ` +
              'One of the two bindings is wrong, and moving the ref silently would republish one ' +
              'place\'s history under another.',
          },
        ],
      };
    }

    // 6. Create the chain, in order: street, then building, then unit. Each
    // level's parent is the row resolved immediately before it, which is what
    // makes the hierarchy a stored fact rather than a projection every reader
    // recomputes.
    if (!resolved) {
      const street = await resolveLevel(db, geo, fields, legacyFields, 'STREET', point, null);
      const building =
        level === 'STREET'
          ? null
          : await resolveLevel(db, geo, fields, legacyFields, 'BUILDING', point, street.row.id);
      resolved =
        level === 'UNIT'
          ? await resolveLevel(db, geo, fields, legacyFields, 'UNIT', point, (building ?? street).row.id)
          : building ?? street;
    }

    const hierarchy = await ensureAncestors(db, resolved.row, geo);
    const now = new Date();

    if (providerRef) {
      await db
        .insert(addressExternalRefs)
        .values({
          addressId: resolved.row.id,
          source: candidate.provider,
          externalId: providerRef,
          sourceUrl: candidate.sourceUrl,
          rawLabel: candidate.rawText,
          confidence: candidate.confidence,
          firstSeenAt: now,
          lastSeenAt: now,
        })
        // Seeing a ref again is the ordinary case, so this TOUCHES rather than
        // raising. `first_seen_at` is deliberately absent from the `set`: it
        // records when Homiio first saw the identifier, and re-stamping it would
        // erase exactly the fact it exists to hold.
        .onConflictDoUpdate({
          target: [addressExternalRefs.source, addressExternalRefs.externalId],
          set: { lastSeenAt: now, sourceUrl: candidate.sourceUrl, updatedAt: now },
        });
    }

    const [materialization] = await db
      .insert(addressMaterializations)
      .values({
        addressId: resolved.row.id,
        candidateId: candidate.id,
        provider: candidate.provider,
        providerRef: candidate.providerRef,
        rawText: candidate.rawText,
        rawTextHash: candidate.rawTextHash,
        normalizationVersion: candidate.normalizationVersion,
        matchKind: resolved.matchKind,
        matchDetail: resolved.detail,
        identityKey: resolved.row.identityKey ?? identityKey,
        durableAction: actor.action,
        durableActionRef: actor.actionRef ?? null,
        actorOxyUserId: actor.actorOxyUserId ?? null,
        idempotencyKey: actor.idempotencyKey ?? null,
      })
      // Partial index, so the predicate is repeated verbatim — the same
      // requirement as `addresses_identity_key_key` above, and the same `42P10`
      // at runtime if it is omitted.
      .onConflictDoNothing({
        target: addressMaterializations.idempotencyKey,
        where: sql`${addressMaterializations.idempotencyKey} is not null`,
      })
      .returning();

    if (!materialization) {
      // A concurrent call carrying the same idempotency key won. Its address is
      // the answer, so this call returns that one rather than its own.
      const [winner] = await db
        .select()
        .from(addressMaterializations)
        .where(eq(addressMaterializations.idempotencyKey, actor.idempotencyKey ?? ''))
        .limit(1);
      if (!winner) {
        throw new Error(
          'A materialization was refused by the idempotency index, but the winning row could not be read back',
        );
      }
      return replayMaterialization(db, winner);
    }

    await db
      .update(addressCandidates)
      .set({ materializedAddressId: resolved.row.id, materializedAt: now, updatedAt: now })
      .where(eq(addressCandidates.id, candidate.id));

    return {
      status: 'materialized',
      candidateId: candidate.id,
      addressId: resolved.row.id,
      addressLevel: deriveAddressLevel(identityFieldsOfRow(resolved.row)),
      streetAddressId: hierarchy.streetId,
      buildingAddressId: hierarchy.buildingId,
      unitAddressId: hierarchy.unitId,
      materializationId: materialization.id,
      match: {
        matchKind: resolved.matchKind,
        detail: resolved.detail,
        identityKey: resolved.row.identityKey ?? identityKey,
      },
    };
  };

  if (tx) return run(tx);
  return getDb().transaction(async (opened) => run(opened));
}

/**
 * Steps 1-3: confirmation, the v2 identity key, then adoption of a pre-v2 row —
 * in that order, and none of them creates anything.
 *
 * The provider ref is deliberately NOT here: deciding whether a ref agrees needs
 * the probable-match set, so it is reconciled by the caller where both are in
 * scope.
 */
async function resolveExactly(
  db: DatabaseOrTransaction,
  options: {
    confirmedAddressId?: string;
    identityKey: string;
    fields: AddressIdentityFields;
    legacyFields: AddressIdentityFields;
    level: AddressLevel;
  },
): Promise<ResolvedAddress | null> {
  if (options.confirmedAddressId) {
    const [confirmed] = await db
      .select()
      .from(addresses)
      .where(eq(addresses.id, options.confirmedAddressId))
      .limit(1);
    if (!confirmed) {
      throw new Error(`Confirmed address ${options.confirmedAddressId} does not exist`);
    }
    return {
      row: await followMergeRedirect(db, confirmed),
      matchKind: 'confirmed_probable',
      detail: `confirmed by the caller as ${options.confirmedAddressId}`,
    };
  }

  const byIdentity = await findByIdentityKey(db, options.identityKey);
  if (byIdentity) return byIdentity;

  // BEFORE the probable search on purpose: without this step every address
  // already in the catalogue would come back as an ambiguity the first time
  // anybody materialized it.
  return adoptLegacyRow(
    db,
    options.fields,
    options.legacyFields,
    options.level,
    options.identityKey,
  );
}

/**
 * The result a previously-recorded materialization stands for.
 *
 * Reads the hierarchy off the stored rows rather than recomputing it, so a
 * replay cannot disagree with what the first call returned — which is the
 * property "el mismo candidato confirmado dos veces devuelve la misma entidad"
 * actually needs.
 */
async function replayMaterialization(
  db: DatabaseOrTransaction,
  row: typeof addressMaterializations.$inferSelect,
): Promise<MaterializationResult> {
  const [address] = await db
    .select()
    .from(addresses)
    .where(eq(addresses.id, row.addressId))
    .limit(1);
  if (!address) {
    throw new Error(
      `Materialization ${row.id} names address ${row.addressId}, which does not exist`,
    );
  }

  const level = deriveAddressLevel(identityFieldsOfRow(address));
  const parent = address.parentAddressId ? await loadAddress(db, address.parentAddressId) : null;
  const grandparent = parent?.parentAddressId
    ? await loadAddress(db, parent.parentAddressId)
    : null;

  const streetId =
    level === 'STREET' ? address.id : level === 'BUILDING' ? parent?.id ?? address.id : grandparent?.id ?? address.id;

  return {
    status: 'materialized',
    candidateId: row.candidateId,
    addressId: address.id,
    addressLevel: level,
    streetAddressId: streetId,
    buildingAddressId:
      level === 'BUILDING' ? address.id : level === 'UNIT' ? parent?.id ?? null : null,
    unitAddressId: level === 'UNIT' ? address.id : null,
    materializationId: row.id,
    match: {
      matchKind: row.matchKind,
      detail: row.matchDetail ?? '',
      identityKey: row.identityKey ?? '',
    },
  };
}

async function loadAddress(db: DatabaseOrTransaction, id: string): Promise<AddressRow | null> {
  const [row] = await db.select().from(addresses).where(eq(addresses.id, id)).limit(1);
  return row ?? null;
}

/** Read a candidate outside any transaction, purely to learn what to geocode. */
async function loadCandidateForNames(candidateId: string | undefined): Promise<CandidateRow> {
  if (!candidateId) {
    throw new Error(
      'materializeHousingCandidate needs either `candidateId` or `candidate`. A materialization ' +
      'with no candidate has no provenance, which is the one thing this chokepoint exists to guarantee.',
    );
  }
  const [row] = await getDb()
    .select()
    .from(addressCandidates)
    .where(eq(addressCandidates.id, candidateId))
    .limit(1);
  if (!row) throw new Error(`Address candidate ${candidateId} does not exist`);
  return row;
}

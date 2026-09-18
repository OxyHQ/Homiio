/**
 * Correction PROPOSALS against a canonical address — the reads and writes
 * behind `/api/addresses/:id/corrections`.
 *
 * ADR 0001 §8.1 splits a correction in two, and the split is the whole design:
 * an attribute correction is an ordinary edit (`db/addresses/addressWrites.ts`),
 * and a correction that touches a KEY field is a merge PROPOSAL — because
 * re-keying a row silently changes which dwelling every listing, lease, review
 * and eviction attached to it is about, and because the corrected key may
 * already belong to another row, in which case the correction is a statement
 * that two identities are one rather than an edit at all.
 *
 * ## Nothing here applies anything
 *
 * ADR 0001 §15's open decision 5 leaves *who may propose a merge, and what
 * resolves it* explicitly undecided beyond "the community, and no admin queue".
 * So this module records and publishes proposals and stops there. Applying one
 * is `services/addressMerge.ts`, which is an operational act nothing in the
 * request path calls — and which stays that way until somebody picks the quorum.
 * Inventing a threshold here would be inventing the answer §15 says is open.
 *
 * ## The proposal is computed, never accepted
 *
 * A caller supplies a patch over the key fields; this module reads the CURRENT
 * row, applies the patch to it, and stores the resulting identity in full,
 * together with the level and the key derived from it by
 * `services/addressIdentity.ts`. The target row (`to_address_id`) is looked up
 * from that key. None of the four is ever taken from a request body: a proposer
 * who could name the target could point one household's history at another
 * household's address, which is the exact harm ADR 0001 §8.1 calls "a wrong
 * merge publishes one household's reviews under another's address".
 */

import { and, desc, eq } from 'drizzle-orm';
import type { ListingAddressPrecision } from '@homiio/shared-types';

import { getDb } from '../postgres';
import { addressMergeProposals, addresses } from '../schema';
import {
  ADDRESS_NORMALIZATION_VERSION,
  computeAddressIdentityKey,
  deriveAddressLevel,
  identityValueOrNull,
  type AddressIdentityFields,
} from '../../services/addressIdentity';
import type { AddressRow } from './addressSerializer';

/** One proposal row, as stored. */
export type AddressMergeProposalRow = typeof addressMergeProposals.$inferSelect;

/**
 * The eight identity fields, in the spellings the address wire already uses.
 *
 * `building_name` rather than `buildingName` because that is what
 * `serializeAddressRow` emits and what the address endpoints have always
 * accepted; a second spelling for one field is how a client ends up sending the
 * one nothing reads.
 */
export const PROPOSABLE_IDENTITY_FIELDS = [
  'street',
  'number',
  'building_name',
  'block',
  'entrance',
  'floor',
  'unit',
  'subunit',
] as const;

export type ProposableIdentityField = (typeof PROPOSABLE_IDENTITY_FIELDS)[number];

/** Wire field name → the `addresses` column it proposes a value for. */
const IDENTITY_FIELD_COLUMNS = {
  street: 'street',
  number: 'number',
  building_name: 'buildingName',
  block: 'block',
  entrance: 'entrance',
  floor: 'floor',
  unit: 'unit',
  subunit: 'subunit',
} as const satisfies Record<ProposableIdentityField, keyof AddressRow>;

/** A patch over the key fields: present means "propose this", absent means "leave". */
export type IdentityPatch = Partial<Record<ProposableIdentityField, string | null>>;

/** The full proposed identity, after the patch is applied to the current row. */
interface ProposedIdentity {
  readonly street: string;
  readonly number: string | null;
  readonly buildingName: string | null;
  readonly block: string | null;
  readonly entrance: string | null;
  readonly floor: string | null;
  readonly unit: string | null;
  readonly subunit: string | null;
}

/** Why a proposal could not be recorded. Each is a 400 the controller phrases. */
export type ProposalRefusal =
  /** Nothing in the patch changes the row's identity, so there is nothing to propose. */
  | { readonly kind: 'no_change' }
  /** `addresses.street` is NOT NULL, so a proposal may not clear it. */
  | { readonly kind: 'street_required' }
  /** A UNIT row must carry a floor, unit or subunit — ADR 0001 §3.2. */
  | { readonly kind: 'empty_unit' }
  /** This proposer already has this exact proposal open against this address. */
  | { readonly kind: 'duplicate' };

/** A supplied or stored value, trimmed, with "nothing" spelled NULL rather than `''`. */
function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Apply an identity patch to a row, keeping the values as a person wrote them.
 *
 * Stored RAW — trimmed, with `''` folded to NULL — rather than normalised, and
 * that asymmetry is the same one `address_candidates` already carries: the
 * proposed columns hold what somebody typed (so a reader sees `Torre Mapfre`,
 * not `torre mapfre`) while the KEY beside them is hashed over the normalised
 * form, which is what decides whether two proposals are the same correction.
 * Folding `''` to NULL is not cosmetic — `CONVENTIONS.md`: an empty string is a
 * VALUE, and here it would be a value that means "absent" in one column and
 * "present" to `deriveAddressLevel`.
 */
function proposedIdentityOf(row: AddressRow, patch: IdentityPatch): ProposedIdentity {
  const valueOf = (field: ProposableIdentityField): string | null => {
    const column = IDENTITY_FIELD_COLUMNS[field];
    return trimOrNull(field in patch ? patch[field] : (row[column] as string | null));
  };
  return {
    // `''` only when the proposal clears the street, which `street_required`
    // refuses before this value is ever stored.
    street: valueOf('street') ?? '',
    number: valueOf('number'),
    buildingName: valueOf('building_name'),
    block: valueOf('block'),
    entrance: valueOf('entrance'),
    floor: valueOf('floor'),
    unit: valueOf('unit'),
    subunit: valueOf('subunit'),
  };
}

/**
 * The identity-key input for a proposed identity at this row's place in the geo
 * chain — normalised by the SAME functions the materialization writer uses, so a
 * proposal's key is comparable with `addresses.identity_key` by construction.
 */
function identityFieldsOf(row: AddressRow, proposed: ProposedIdentity): AddressIdentityFields {
  return {
    street: proposed.street,
    // Geo is relational and is NOT proposable: a correction to which CITY a
    // place is in is a different act from a correction to its door number, and
    // this endpoint does not offer it.
    postalCode: identityValueOrNull(row.postalCode),
    cityId: row.cityId,
    countryCode: row.countryCode,
    number: identityValueOrNull(proposed.number),
    buildingName: identityValueOrNull(proposed.buildingName),
    block: identityValueOrNull(proposed.block),
    entrance: identityValueOrNull(proposed.entrance),
    floor: identityValueOrNull(proposed.floor),
    unit: identityValueOrNull(proposed.unit),
    subunit: identityValueOrNull(proposed.subunit),
  };
}

/**
 * The identity key the row itself carries right now, recomputed rather than read.
 *
 * `addresses.identity_key` is nullable — it is written by
 * `services/housingMaterialization.ts` and a row that predates it has none — so
 * comparing against the stored column would report "no change" as a change for
 * every legacy row, and "a change" for none of them. Recomputing is the only
 * comparison that answers the question actually being asked: would this patch
 * move the place?
 */
function currentIdentityKeyOf(row: AddressRow): string {
  const fields = identityFieldsOf(row, proposedIdentityOf(row, {}));
  return computeAddressIdentityKey(fields, deriveAddressLevel(fields));
}

/**
 * Record one correction proposal, or say why it was refused.
 *
 * The proposer is the SESSION's `oxyUserId` (`AGENTS.md`); there is no relation
 * requirement beyond being signed in, and that is deliberate. A proposal changes
 * nothing — it is the community-visible, appealable record ADR 0001 §8.1 asks
 * for — so gating it on a recorded relation to the place would mean only the
 * landlord advertising a flat could report that its number is wrong.
 */
export async function proposeAddressCorrection(input: {
  readonly address: AddressRow;
  readonly patch: IdentityPatch;
  readonly reason: string;
  readonly evidenceUrl: string | null;
  readonly proposedByOxyUserId: string;
}): Promise<AddressMergeProposalRow | ProposalRefusal> {
  const { address, patch } = input;
  const proposed = proposedIdentityOf(address, patch);

  if (proposed.street === '') return { kind: 'street_required' };

  const fields = identityFieldsOf(address, proposed);
  const level = deriveAddressLevel(fields);
  const identityKey = computeAddressIdentityKey(fields, level);

  if (identityKey === currentIdentityKeyOf(address)) return { kind: 'no_change' };
  // ADR 0001 §3.2: a UNIT row must carry at least one of floor/unit/subunit.
  // `deriveAddressLevel` cannot produce UNIT without one, so this is the
  // OPPOSITE case — a patch that clears all three off a UNIT row, which is not a
  // refusal at all but a proposal to move the review up to the building. It is
  // allowed, and stated here so the absence of a check reads as a decision.

  const db = getDb();
  // The row that already holds the corrected identity, if any. Excluding the
  // proposal's own row is what the `not_self` CHECK also refuses; the identity
  // key differs by construction at this point, but a legacy row whose stored key
  // is stale could still match, and a proposal to merge a place into itself is
  // noise rather than a correction.
  const [target] = await db
    .select({ id: addresses.id })
    .from(addresses)
    .where(eq(addresses.identityKey, identityKey))
    .limit(1);
  const toAddressId = target && target.id !== address.id ? target.id : null;

  const [created] = await db
    .insert(addressMergeProposals)
    .values({
      fromAddressId: address.id,
      toAddressId,
      proposedStreet: proposed.street,
      proposedNumber: proposed.number,
      proposedBuildingName: proposed.buildingName,
      proposedBlock: proposed.block,
      proposedEntrance: proposed.entrance,
      proposedFloor: proposed.floor,
      proposedUnit: proposed.unit,
      proposedSubunit: proposed.subunit,
      proposedAddressLevel: level,
      proposedIdentityKey: identityKey,
      normalizationVersion: ADDRESS_NORMALIZATION_VERSION,
      reason: input.reason,
      evidenceUrl: input.evidenceUrl,
      proposedByOxyUserId: input.proposedByOxyUserId,
    })
    // The partial unique index is the authority on "this proposer already said
    // this", so the duplicate is detected by the DATABASE rather than by a
    // preceding read — a read-then-write has a window two concurrent submissions
    // both pass. The `where` repeats the index's predicate VERBATIM; Postgres
    // answers 42P10 at runtime if it does not, with a clean `tsc`.
    .onConflictDoNothing({
      target: [
        addressMergeProposals.fromAddressId,
        addressMergeProposals.proposedByOxyUserId,
        addressMergeProposals.proposedIdentityKey,
      ],
      where: eq(addressMergeProposals.status, 'open'),
    })
    .returning();

  return created ?? { kind: 'duplicate' };
}

/** Every open proposal about one place, newest first. */
export async function findOpenCorrectionProposals(
  addressId: string,
): Promise<AddressMergeProposalRow[]> {
  return getDb()
    .select()
    .from(addressMergeProposals)
    .where(
      and(
        eq(addressMergeProposals.fromAddressId, addressId),
        eq(addressMergeProposals.status, 'open'),
      ),
    )
    .orderBy(desc(addressMergeProposals.createdAt));
}

/**
 * Withdraw one's OWN open proposal.
 *
 * The proposer id is a conjunct of the statement rather than a check before it,
 * so somebody else's proposal updates zero rows and the controller answers 404 —
 * the same shape every other ownership rule in this package takes (`AGENTS.md`).
 */
export async function withdrawCorrectionProposal(input: {
  readonly proposalId: string;
  readonly addressId: string;
  readonly proposedByOxyUserId: string;
}): Promise<AddressMergeProposalRow | undefined> {
  const [withdrawn] = await getDb()
    .update(addressMergeProposals)
    .set({ status: 'withdrawn', withdrawnAt: new Date() })
    .where(
      and(
        eq(addressMergeProposals.id, input.proposalId),
        eq(addressMergeProposals.fromAddressId, input.addressId),
        eq(addressMergeProposals.proposedByOxyUserId, input.proposedByOxyUserId),
        eq(addressMergeProposals.status, 'open'),
      ),
    )
    .returning();
  return withdrawn;
}

/**
 * One proposal on the wire, at a stated precision.
 *
 * Below `exact` the three dwelling labels are ABSENT, never null (ADR 0003
 * §4.1.3): a proposal is a second route to `floor` / `unit` / `subunit`, and a
 * precision rule that covered the address serializer and not this one would be a
 * rule with a door in it. `proposedIdentityKey` never leaves at all — it is the
 * same class of internal digest ADR 0001 §6.2 removed from the address wire.
 *
 * **The proposer is named to nobody but themselves.** ADR 0003 §2.1 classifies a
 * reporter's identity tier R, and §5.8 states the reason in one line: disclosing
 * who reported is a retaliation channel. Somebody saying "the number on this
 * building is wrong" is in exactly that position with respect to whoever
 * advertises it, so the id travels only back to its own author, and everybody
 * else is told `proposedByViewer: false` — which is what a client needs to know
 * whether to offer the withdraw action, and no more.
 */
export function serializeAddressCorrectionProposal(
  row: AddressMergeProposalRow,
  precision: ListingAddressPrecision,
  viewerOxyUserId: string | null | undefined,
): Record<string, unknown> {
  const proposedByViewer =
    typeof viewerOxyUserId === 'string' &&
    viewerOxyUserId.length > 0 &&
    row.proposedByOxyUserId === viewerOxyUserId;

  const dwelling =
    precision === 'exact'
      ? {
          proposedFloor: row.proposedFloor ?? undefined,
          proposedUnit: row.proposedUnit ?? undefined,
          proposedSubunit: row.proposedSubunit ?? undefined,
        }
      : {};

  const body: Record<string, unknown> = {
    id: row.id,
    addressId: row.fromAddressId,
    /**
     * The place the correction would merge into, when one already exists.
     *
     * An opaque address id, which is what ADR 0001 §2.1.8 allows a public URL to
     * carry — and what a reader needs to see that the correction is "this is the
     * same building as that one" rather than "rename this building".
     */
    mergesIntoAddressId: row.toAddressId ?? undefined,
    proposedStreet: row.proposedStreet,
    proposedNumber: row.proposedNumber ?? undefined,
    proposedBuildingName: row.proposedBuildingName ?? undefined,
    proposedBlock: row.proposedBlock ?? undefined,
    proposedEntrance: row.proposedEntrance ?? undefined,
    ...dwelling,
    proposedAddressLevel: row.proposedAddressLevel,
    reason: row.reason,
    evidenceUrl: row.evidenceUrl ?? undefined,
    proposedByViewer,
    proposedByOxyUserId: proposedByViewer ? row.proposedByOxyUserId : undefined,
    status: row.status,
    createdAt: row.createdAt,
  };

  for (const key of Object.keys(body)) {
    if (body[key] === undefined) delete body[key];
  }
  return body;
}

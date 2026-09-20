/**
 * "The version shown" — a lease's terms, canonicalized and digested (#518 §7.4).
 *
 * §7.4 requires a signature to bind to the version that was displayed. A lease
 * has no version number and no document of its own, so the only thing that can
 * stand for one is the TERMS THEMSELVES: the dates, the money, the utilities,
 * the rules, the co-tenants and the utility split — everything the contract
 * screen renders and everything an amendment can change.
 *
 * ## Derived on READ, never stored on the lease
 *
 * A `leases.terms_sha256` column would be a second representation of facts that
 * already have one, and `CONVENTIONS.md` answers that with a
 * `GENERATED ALWAYS … STORED` column no write path can contradict. That answer
 * is unavailable here for a reason worth stating rather than working around: a
 * generated column can only see ITS OWN ROW, and a lease's terms include its
 * co-tenants and its shared utility costs, which are child tables. A digest
 * that silently omitted them would go unchanged when a landlord added a
 * guarantor — the amendment a signature most needs to notice.
 *
 * Computing it on every read from the same rows the response is built from is
 * strictly stronger than storing it: there is no second copy, so there is
 * nothing to drift. The only copy that persists is the one written onto a
 * SIGNATURE, which is the point — that one is supposed to stop changing.
 *
 * ## The canonicalization is the contract, so it is versioned
 *
 * The preimage opens with `homiio.lease.terms.v1`. Every byte after it is
 * produced by the rules below and nothing else:
 *
 *  - Field order is the literal order of {@link canonicalTerms}, never
 *    `Object.keys` over a row — a column reordered in the schema would
 *    otherwise change every digest in the table.
 *  - Instants are ISO-8601 in UTC (`Date#toISOString`), so a session's
 *    `TimeZone` cannot enter the hash.
 *  - Numbers go through `JSON.stringify`, which renders `900` and `900.0`
 *    identically — the two spellings postgres.js and a request body can each
 *    produce for the same rent.
 *  - Arrays that are SETS are sorted (`utilities_included`); arrays that are
 *    LISTS are not (`rules_pets_restrictions`, where the landlord's order is
 *    the landlord's).
 *  - Child rows are sorted by a stable key of their own contents, because their
 *    row order is whatever Postgres returned and is not a fact about the lease.
 *
 * **Changing any of those rules changes every digest**, which would silently
 * re-read every existing signature as bound to stale terms. So a change is a
 * `v2` tag here AND a `lease_signatures.terms_version` column added in the same
 * migration with `DEFAULT 'v1'` — the default is exact, since every row that
 * exists before that migration was written by this function. It is not stored
 * today precisely because it can be backfilled exactly; a column with one value
 * and no reader is coverage nobody has.
 */

import { createHash } from 'node:crypto';

import type { HydratedLease } from './leaseSerializer';

/** The tag that opens the preimage. See the header before changing it. */
export const LEASE_TERMS_FINGERPRINT_VERSION = 'homiio.lease.terms.v1';

/** A JSON value the canonicalizer can render. */
type Canonical = string | number | boolean | null | Canonical[];

/**
 * The terms, as an ordered list of values.
 *
 * A LIST rather than an object: the order is then the code's, visibly, instead
 * of depending on a JavaScript engine's property ordering — and a field added
 * in the middle is a visible diff rather than a silent re-hash.
 */
function canonicalTerms(hydrated: HydratedLease): Canonical[] {
  const lease = hydrated.lease;
  return [
    // Identity. A digest that did not cover these would be equal across two
    // different leases with the same numbers, and a signature could be lifted
    // from one onto the other.
    lease.id,
    lease.propertyId,
    lease.roomId ?? null,
    lease.landlordOxyUserId,
    lease.tenantOxyUserId,

    // leaseTerms
    lease.leaseTermsStartDate.toISOString(),
    lease.leaseTermsEndDate.toISOString(),
    lease.leaseTermsRenewalOptions,
    lease.leaseTermsRenewalNoticeRequired,
    lease.leaseTermsTerminationNoticeRequired,

    // rentDetails
    lease.rentDetailsMonthlyRent,
    lease.rentDetailsCurrency,
    lease.rentDetailsDueDate,
    lease.rentDetailsLateFeeAmount,
    lease.rentDetailsLateFeeGracePeriod,
    lease.rentDetailsSecurityDeposit,
    lease.rentDetailsPetDeposit,

    // utilities — both are SETS (`<@` against a closed vocabulary), so sorted.
    [...lease.utilitiesIncluded].sort(),
    [...lease.utilitiesTenantResponsible].sort(),

    // rules
    lease.rulesPetsAllowed,
    [...lease.rulesPetsTypes].sort(),
    lease.rulesPetsMaxNumber,
    // A LIST: free text the landlord wrote, in the order they wrote it.
    [...lease.rulesPetsRestrictions],
    lease.rulesSmoking,
    lease.rulesGuestsOvernightAllowed,
    lease.rulesGuestsOvernightMaxConsecutiveDays,
    lease.rulesGuestsOvernightMaxDaysPerMonth,
    lease.rulesGuestsParties,
    lease.rulesSubletting,
    lease.rulesAlterations,

    // Notes are part of the contract: a landlord can put a condition there.
    lease.notes ?? null,

    // The other people on the lease. Sorted by account, because the row order
    // is Postgres's and the membership is the fact.
    hydrated.coTenants
      .map((coTenant): Canonical[] => [coTenant.oxyUserId, coTenant.role])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),

    // The utility split. Sorted by utility then percentage, for the same reason.
    hydrated.sharedUtilityCosts
      .map((cost): Canonical[] => [cost.utility ?? null, cost.splitPercentage ?? null])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  ];
}

/**
 * SHA-256 of the lease's terms, lowercase hex.
 *
 * The value `lease_signatures.terms_sha256` stores, and the value the lease DTO
 * publishes as `termsSha256` so a client can send back the version it displayed.
 */
export function leaseTermsFingerprint(hydrated: HydratedLease): string {
  const preimage = `${LEASE_TERMS_FINGERPRINT_VERSION}\n${JSON.stringify(canonicalTerms(hydrated))}`;
  return createHash('sha256').update(preimage, 'utf8').digest('hex');
}

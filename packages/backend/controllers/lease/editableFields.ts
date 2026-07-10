/**
 * Mass-assignment protection for lease write endpoints.
 *
 * `createLease`/`updateLease` must NEVER spread `req.body` straight into the
 * Lease model: that would let a client set owner/system-managed fields
 * (`landlordOxyUserId`, `status`, `signatures`, `paymentSchedule`, …) and
 * reassign ownership or force a lease active (IDOR / privilege escalation).
 * Instead the controllers pick ONLY the explicit, user-editable fields listed
 * here. Everything else is resolved server-side (`landlordOxyUserId`,
 * `propertyId`, `status`), managed by dedicated endpoints (`signatures` via
 * sign, `paymentSchedule` via payments, `documents` via upload,
 * `terminationNotice` via terminate), or simply rejected.
 *
 * Keep this list in sync with the user-facing fields of the Lease schema in
 * `models/schemas/LeaseSchema.ts`. Owner/system fields are intentionally absent.
 */

/**
 * Fields a user may set when CREATING a lease. `propertyId`, `landlordOxyUserId`
 * and `status` are resolved server-side and are intentionally absent — the
 * controller sets them explicitly after ownership is verified.
 */
export const CREATABLE_LEASE_FIELDS: readonly string[] = [
  'tenantOxyUserId',
  'roomId',
  'coTenants',
  'leaseTerms',
  'rentDetails',
  'utilities',
  'rules',
];

/**
 * Fields a user may change when UPDATING an existing draft lease. Mirrors the
 * creatable set — while a lease is still a draft the landlord may correct any of
 * the party/terms fields — plus `notes`, a free-text landlord annotation that is
 * only edited on an existing lease. Owner and lifecycle fields stay
 * server-controlled.
 */
export const EDITABLE_LEASE_FIELDS: readonly string[] = [...CREATABLE_LEASE_FIELDS, 'notes'];

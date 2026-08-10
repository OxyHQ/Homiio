/**
 * Mass-assignment protection for eviction-case write endpoints.
 *
 * `createEviction`/`updateEviction` must NEVER spread `req.body`: that would let
 * a client claim ownership (`oxyUserId`), forge the turnout, inject a fake
 * timeline, clear a precautionary hold, stamp a household authorisation, or set
 * the published coordinates directly — which would defeat the whole
 * server-side-approximation design in one field. Every write path picks ONLY the
 * fields listed here, and the nested objects (`location`, `contactInfo`,
 * `coverImage`, `helpNeeds`) are re-whitelisted key-by-key afterwards.
 *
 * ## Server-only forever, and why each one matters here
 *
 * | Field | Why a client may never set it |
 * |---|---|
 * | `oxyUserId` | Ownership is the session's, never the body's |
 * | `status` (on create) | Always `upcoming`; a case cannot be born executed |
 * | the timeline | It is an audit; a forged entry is a forged history |
 * | the roster, the followers | Derived from their own endpoints |
 * | `agencyId`, `organizationId` | Resolved from a NAME, so a body cannot point at an arbitrary row |
 * | `locationLongitude/Latitude/RadiusMeters` | The PUBLISHED disc is derived server-side; accepting it would let a client publish the true point |
 * | `precautionaryHoldAt`, `disputedAt` | Written by report thresholds, cleared by a named endpoint |
 * | `archivedAt`, `outcomeReminderSentAt` | The sweep's and the reminder's own bookkeeping |
 * | `contactUnlockMinTenureDays` | The organiser's bar, raised through its own endpoint, not smuggled through a case PUT |
 *
 * `location.coordinates` IS accepted, and it is the TRUE point — but it is
 * consumed by `derivePublicDisc` and never written to a column unless the
 * household authorised it. That is the one place a client-supplied coordinate
 * reaches this domain, and it leaves again in the same function.
 *
 * `agencyName` and `organizationName` are create-time conveniences resolved to
 * ids and then discarded; neither is persisted as a raw field.
 */

/** Fields a user may set when OPENING a case. */
export const CREATABLE_EVICTION_FIELDS: readonly string[] = [
  'title',
  'description',
  'location',
  'scheduledAt',
  'contactInfo',
  'coverImage',
  'agencyName',
  'organizationName',
  'helpNeeds',
  // The affected household's own authorisation. A boolean the organiser asserts
  // on the household's behalf is the weakest part of this design and it is
  // deliberate: ADR 0003 §7.2 refuses to STORE the household at all, so there is
  // nobody else to ask. What the flag buys is that the exact pair cannot be
  // stored without somebody recording that the household asked — and the CHECK
  // constraint enforces it even if a future controller forgets.
  'householdAuthorizedExact',
  'exactAddress',
];

/**
 * Fields the owner may change on an existing case. The creatable set PLUS
 * `status`, the lifecycle transition an owner drives from the case.
 */
export const EDITABLE_EVICTION_FIELDS: readonly string[] = [
  ...CREATABLE_EVICTION_FIELDS,
  'status',
];

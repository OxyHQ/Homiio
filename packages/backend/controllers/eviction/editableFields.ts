/**
 * Mass-assignment protection for eviction-case write endpoints.
 *
 * `createEviction`/`updateEviction` must NEVER spread `req.body` straight into
 * the EvictionCase model: that would let a client claim ownership
 * (`oxyUserId`), forge the RSVP count (`attendeeCount`/`attendees`), inject a
 * fake timeline (`updates`), or attach an arbitrary `agencyId` (IDOR / trust
 * abuse). Instead every write path picks ONLY the fields listed here. The
 * nested objects (`location`, `contactInfo`, `coverImage`) are additionally
 * re-whitelisted key-by-key in a sanitize step — the picked value is never
 * deep-spread into the document.
 *
 * Server-only forever (resolved / derived / system-managed, never client-set):
 *   oxyUserId, attendees, attendeeCount, updates, agencyId, status (on create).
 *
 * `agencyName` is a create-time convenience: it is resolved to an `agencyId`
 * only when the Agency model is registered, then discarded — it is never
 * persisted as a raw field.
 *
 * Keep this list in sync with the user-facing fields of `EvictionCaseSchema`.
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
];

/**
 * Fields the owner may change on an existing case. Identical to the creatable
 * set PLUS `status` (the lifecycle transition an owner drives from the case).
 */
export const EDITABLE_EVICTION_FIELDS: readonly string[] = [...CREATABLE_EVICTION_FIELDS, 'status'];

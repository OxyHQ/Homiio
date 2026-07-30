/**
 * The one definition of "a jury has taken this listing out of public view".
 *
 * Every public property read already excludes soft-deleted listings with
 * `deletedAt: null`; this is the second half of the same idea, and it lives in
 * one place because the predicate has a trap in it that is easy to get wrong
 * once and impossible to notice.
 *
 * **It must be `$ne: true`, never `false`.** `Property.moderation` is a new
 * subdocument, so every listing written before it existed has no `moderation`
 * key at all — and `{ 'moderation.restricted': false }` matches a stored `false`
 * but NOT a missing field. Written that way, the filter would hide the entire
 * existing catalogue the moment it shipped, and the failure would look like a
 * database problem rather than a query bug.
 *
 * Deliberately NOT applied to `getMyProperties`, which is scoped to the
 * session's own `oxyUserId`: an owner whose listing was restricted should still
 * be able to see it. `list.ts` DOES apply it even when an owner filter is
 * present, because that filter comes from a query parameter anybody can set —
 * scoping a feed to somebody else's id must not reveal what a jury withheld.
 */

/**
 * Exclude community-restricted listings from a filter being built for a public
 * read.
 *
 * Mutates rather than returns, to match how every call site already assembles
 * its filter object one clause at a time.
 */
export function excludeModerationRestricted(filter: Record<string, unknown>): void {
  filter['moderation.restricted'] = { $ne: true };
}

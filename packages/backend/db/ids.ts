/**
 * Entity Ids — the two shapes, and the ONE thing a guard on them may do
 *
 * Every primary key in `db/schema` is `text`. Older rows hold a 24-char hex id
 * and newer rows a uuid v7. Both shapes are live simultaneously and
 * permanently: an id never changes, which is how every foreign key holds
 * without a remapping table.
 *
 * ## This is for a 400, and nothing else
 *
 * `isLiveEntityId` exists to reject obviously-malformed input at a documented
 * API boundary. It is NEVER a precondition on a query. Using it to gate a lookup
 * re-introduces a fail-open bug in a new costume — it answers "no" for a
 * perfectly valid id of a shape it has not been taught about, while the query
 * itself already answers "no such row" for free and for every shape.
 *
 * ## Never branch on an id's FORMAT
 *
 * A test for "looks like a 24-char hex id" is `false` for every uuid v7, so a
 * site that BRANCHES on it silently changes behaviour rather than merely
 * rejecting:
 *
 *  - an `excludeIds` filter that drops what fails the test makes the excluded
 *    listings reappear in results — no error, no log, a wrong answer;
 *  - an id-versus-name switch looks a uuid v7 city id up as if the user had
 *    typed it as a search string;
 *  - a moderation effect that skips the subject reports "the reported listing
 *    no longer exists" while it sits there intact.
 *
 * ## The rule
 *
 * Where a route genuinely needs to reject malformed input before it reaches a
 * query, it uses {@link isLiveEntityId} and returns 400. Otherwise there is no
 * guard at all: a `text` column takes any string, and a lookup for a nonsense id
 * returns no rows and 404s.
 *
 * Owner-scoped write guards (`and(eq(id), eq(oxy_user_id))`) carry no shape
 * precondition, so a malformed id matches no row and 404s — the documented
 * intent. `middlewares/requireAdmin.ts` gates on an **Oxy** user id allowlist
 * and denies everyone when it is empty, i.e. it fails CLOSED.
 */

export { isLiveEntityId } from '@oxy.so/db';

/**
 * Entity Ids — the two shapes, and the ONE thing a guard on them may do
 *
 * Every primary key in `db/schema` is `text` holding a 24-char ObjectId hex for
 * rows that existed before the cutover, and a uuid v7 for rows created after it.
 * Both shapes are live simultaneously and permanently: the backfill copies each
 * `_id` verbatim, which is exactly how every foreign key survives the move
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
 * ## Homiio has 499 `isValidObjectId` references, and several BRANCH on the answer
 *
 * That is what makes this file worth its own module rather than a note in
 * CONVENTIONS.md. Post-cutover, `mongoose.isValidObjectId(uuidv7())` is `false`
 * for every row created from that day on, so an `isValidObjectId` guard left in
 * place does not merely reject — it silently changes behaviour:
 *
 *  - `controllers/property/geospatial.ts` filters an `excludeIds` list through
 *    `ObjectId.isValid` and **silently drops** the entries that fail. Every uuid
 *    v7 in an exclude list would be dropped, and the excluded listings would
 *    reappear in results. No error, no log, a wrong answer.
 *  - `services/geoQueryService.ts` branches id-versus-name on it: a value that
 *    fails the test is treated as a place NAME. A uuid v7 city id would be
 *    looked up as if the user had typed it as a search string.
 *
 * So an `isValidObjectId` call is **deleted**, not widened. Where a route
 * genuinely needs to reject malformed input before it reaches a query, it uses
 * {@link isLiveEntityId} and returns 400. Where the guard was only ever avoiding
 * a `CastError`, it goes away entirely: a `text` column takes any string, and a
 * lookup for a nonsense id returns no rows.
 */

export { isLiveEntityId } from '@oxyhq/db';

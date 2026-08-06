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
 * ## 48 guard sites, and several BRANCH on the answer
 *
 * That is what makes this file worth its own module rather than a note in
 * CONVENTIONS.md. Post-cutover, `mongoose.isValidObjectId(uuidv7())` is `false`
 * for every row created from that day on, so a guard left in place does not
 * merely reject — it silently changes behaviour.
 *
 * The counts, because a wrong one here would be re-derived by everyone who
 * follows and there is nothing in a build or a test that would ever contradict
 * it. Measured over GIT-TRACKED files only:
 *
 * ```
 * git grep -nE 'isValidObjectId|ObjectId\.isValid' -- '*.ts' '*.js'
 * ```
 *
 * | slice | sites |
 * |---|---|
 * | request-path source (this is the number that matters) | 46 |
 * | one-shot `scripts/` tooling, retired with its scripts | 4 |
 * | reached only through a local wrapper, invisible to the grep above | +2 |
 * | **logical decision sites** | **48** |
 *
 * **Two ways to get this number wrong, both of which have already happened:**
 *
 * 1. **A grep for the literal UNDERCOUNTS, because a local wrapper hides the
 *    call.** `routes/ai.ts:105` defines
 *    `const isObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id)`,
 *    and the two real decisions at `:572` and `:1120` contain neither literal.
 *    The grep sees one site in that file where there are three. Assume any
 *    figure derived this way is a floor, and look for wrappers before trusting
 *    it. This warning is worth more than the number beside it.
 * 2. **Counting `dist/` or matching bare `ObjectId` OVERCOUNTS, wildly.**
 *    `dist/` is untracked local build output (`git ls-files dist` is empty), so
 *    it does not exist on a fresh clone and counting it counts the same code
 *    twice — it alone adds 43. Matching bare `ObjectId` instead of the guard
 *    sweeps up every `Types.ObjectId` type annotation and takes the total past
 *    600. A figure of ~500 has been quoted from exactly that mistake; it is not
 *    the number of guards and never was.
 *
 * ## The sites that fail OPEN, which are the dangerous ones
 *
 *  - **The `excludeIds` filter, COPY-PASTED into four places** —
 *    `controllers/property/geospatial.ts` (twice), `searchQueryBuilder.ts:490`
 *    and `list.ts:302`. Each filters the list through `ObjectId.isValid` and
 *    **silently drops** what fails, so post-cutover every uuid v7 in an exclude
 *    list is dropped and the excluded listings reappear in results. No error, no
 *    log, a wrong answer — and these run on **every request behind no feature
 *    flag**, which makes them the live ones the day the cutover lands. Fixing
 *    one and missing the other three is the obvious failure mode.
 *  - `services/geoQueryService.ts` branches id-versus-name on it: a value that
 *    fails the test is treated as a place NAME, so a uuid v7 city id would be
 *    looked up as if the user had typed it as a search string.
 *  - `services/moderation/` holds four more, in two shapes:
 *    `ModerationEnforcementService.ts:125` and `:198` skip the subject, so an
 *    enforcement silently does not apply; `propertySubject.ts:286` and
 *    `reviewSubject.ts:197` `return null`, so a report is never filed. Latent
 *    ONLY because `CROWDSOURCE_ENABLED` is unset in production — a config
 *    change, not a code change, arms all four.
 *
 * ## The authorization surface is CLEAN — recorded so nobody re-audits it
 *
 * "I looked and found nothing" is a finding, and an unrecorded one gets
 * re-derived. Audited and clear:
 *
 *  - `utils/pickFields.ts` has zero ObjectId references.
 *  - `middlewares/requireAdmin.ts` gates on an **Oxy** user id allowlist and
 *    denies everyone when it is empty, i.e. it fails CLOSED.
 *  - The `Model.findOne({ _id, oxyUserId })` write guards carry no
 *    `isValidObjectId` precondition, so a malformed id already matches no row
 *    and 404s — which is the documented intent, and survives the port unchanged.
 *  - oxy-api's `mediaPrivacyService` shape does not exist in this package.
 *
 * ## The rule
 *
 * An `isValidObjectId` call is **deleted**, not widened. Where a route genuinely
 * needs to reject malformed input before it reaches a query, it uses
 * {@link isLiveEntityId} and returns 400 — 2 sites are that shape. Where the
 * guard only ever avoided a `CastError`, it goes away entirely: a `text` column
 * takes any string, and a lookup for a nonsense id returns no rows.
 *
 * Related, same cause, different symptom: **5 `.toHexString()` sites** (2 in
 * `services/moderation/subjects/propertySubject.ts`, 3 in `reviewSubject.ts`)
 * THROW on a plain string rather than degrading, so they surface loudly rather
 * than silently. They belong to their own batch, as do every call site above.
 */

export { isLiveEntityId } from '@oxyhq/db';

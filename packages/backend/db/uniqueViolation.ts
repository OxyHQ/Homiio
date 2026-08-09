/**
 * Recognising a unique-index violation, by CONSTRAINT and not by message.
 *
 * ## Why this exists at all
 *
 * `db/MIGRATION-CONTRACT.md` records a class of change this migration makes
 * repeatedly: idempotency that used to be a read-then-write with a window
 * (`SavedPropertyFolder.addProperty`, `reviewController`'s `alreadyVoted` and
 * `alreadyReported`, `evictionController`'s RSVP check,
 * `Agency.findOrCreateByName`) is now a unique KEY, and the ported code should
 * INSERT and handle `23505` rather than re-implement the read. That instruction
 * only pays off if "handle `23505`" is done precisely — which is what this
 * module is for.
 *
 * ## The two ways to get this wrong, and why the constraint name is required
 *
 * **Matching on the message.** `error.message` for a unique violation is
 * `duplicate key value violates unique constraint "..."`, and it is a
 * LOCALISED, version-dependent string. A `includes('duplicate key')` check
 * passes today and stops matching the first time the server runs under a
 * different `lc_messages` — silently, turning a converged idempotent write back
 * into a 500.
 *
 * **Matching on the CODE alone.** `23505` says "some unique index refused this
 * row", not "the index I was expecting refused it". A table with two unique
 * indexes — `saved_property_folder_items` has one, `saved_property_folders` has
 * another on `lower(name)`, and a write touches both — would report a
 * name-collision as "already in this folder" and converge on a row the caller
 * never asked for. Every caller here therefore names the constraint it is
 * prepared to treat as idempotent, and any OTHER violation propagates as the
 * genuine error it is.
 *
 * postgres.js surfaces both fields on the thrown error (`code`,
 * `constraint_name`), which is why this can be a property check rather than a
 * parse. Measured against this project's driver rather than assumed:
 *
 * ```
 * code= "23505"  constraint_name= "probe_unique_a_key"
 * keys= code,constraint_name,detail,file,line,name,routine,schema_name,…
 * ```
 *
 * ## But drizzle does NOT rethrow that error — it WRAPS it
 *
 * The one thing here that cannot be guessed from the driver's documentation.
 * drizzle-orm 0.45.2 throws a `DrizzleQueryError` whose own enumerable keys are
 * `cause,params,query` — it carries **no `code` and no `constraint_name` of its
 * own** — and the real `PostgresError` is its `cause`:
 *
 * ```
 * ctor= DrizzleQueryError  code= undefined  cname= undefined
 * causeCtor= PostgresError causeCode= 23505 causeCname= saved_searches_owner_name_key
 * ```
 *
 * So a check written against the driver's shape — which is what the driver's own
 * README describes — reads `undefined === '23505'`, answers `false` for every
 * real violation, and the idempotent path it guards silently becomes a 500. That
 * is not a hypothetical: the first version of this module did exactly that, and
 * it was caught only because the suite asserts the 409 rather than merely
 * asserting that the second insert failed somehow.
 *
 * The chain is therefore WALKED rather than unwrapped once, so this keeps
 * working if drizzle adds a layer, and it is depth-bounded so a cyclic `cause`
 * cannot spin.
 */

/** The SQLSTATE for `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

/** The SQLSTATE for `foreign_key_violation`. */
const FOREIGN_KEY_VIOLATION = '23503';

/**
 * How far down a `cause` chain to look.
 *
 * Two is enough for drizzle 0.45.2 (`DrizzleQueryError` → `PostgresError`); the
 * extra levels cost nothing and mean a future wrapper does not silently turn
 * every idempotent write back into a 500.
 */
const MAX_CAUSE_DEPTH = 5;

interface PostgresErrorLike {
  readonly code?: unknown;
  readonly constraint_name?: unknown;
  readonly cause?: unknown;
}

/**
 * Whether `error`, or anything in its `cause` chain, is a `23505` raised by the
 * NAMED constraint.
 *
 * @param constraintName The index or constraint the caller is prepared to treat
 *   as an idempotent repeat. A violation of any other one is not matched, so it
 *   keeps propagating.
 */
export function isUniqueViolation(error: unknown, constraintName: string): boolean {
  return hasConstraintViolation(error, UNIQUE_VIOLATION, constraintName);
}

/**
 * Whether `error`, or anything in its `cause` chain, is a `23503` raised by the
 * NAMED foreign key.
 *
 * The same reasoning as {@link isUniqueViolation}, one SQLSTATE over. It exists
 * because Mongo let a reference point at nothing and Postgres does not: writes
 * that accept an id from the CLIENT — saving a listing, recording that one was
 * viewed — used to store a dangling pointer silently and now raise `23503`. That
 * is a 404 the caller earned, not the 500 an unhandled driver error would be.
 *
 * Naming the constraint matters as much here as it does above: a statement can
 * touch several foreign keys, and treating any `23503` as "that listing is gone"
 * would report an unrelated integrity failure as a missing property.
 */
export function isForeignKeyViolation(error: unknown, constraintName: string): boolean {
  return hasConstraintViolation(error, FOREIGN_KEY_VIOLATION, constraintName);
}

/**
 * Walk the `cause` chain for a violation of `constraintName` carrying
 * `sqlState`.
 *
 * The walk is the part worth having once: drizzle WRAPS the driver's error (see
 * the header), so the check has to look past the outermost object, and it is
 * depth-bounded so a cyclic `cause` cannot spin.
 */
function hasConstraintViolation(
  error: unknown,
  sqlState: string,
  constraintName: string,
): boolean {
  let current = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (!current || typeof current !== 'object') return false;
    const candidate = current as PostgresErrorLike;
    if (candidate.code === sqlState && candidate.constraint_name === constraintName) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

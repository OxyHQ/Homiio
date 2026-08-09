/**
 * The outbound id serializer — the ONE place `_id` stops being part of Homiio's
 * wire contract.
 *
 * Every DTO in `@homiio/shared-types` names a document's identity `id`. Mongoose
 * still stores `_id` underneath and will keep doing so until the Postgres port
 * finishes, so something has to rename it on the way out. That rename cannot
 * live in the models, because the two response paths this API uses reach
 * `res.json` by different routes and only one of them passes through a model at
 * all:
 *
 *   - `res.json(doc)` on a Mongoose document calls the schema's `toJSON`, so a
 *     per-schema transform would cover it — and roughly a dozen schemas already
 *     carry one.
 *   - `res.json(await Query.lean())` does NOT. A lean result is a plain object
 *     that never sees `toJSON`, and there are ~90 `.lean()` reads behind these
 *     routers. Those emit `_id` and no `id` whatsoever.
 *
 * So the cut is made here, at the boundary both paths share, rather than in ~100
 * call sites where the next `.lean()` added would silently reopen it.
 *
 * ## What it does, precisely
 *
 * Rebuilds the outgoing body and, on every object carrying `_id`, moves that
 * value to `id` (stringified — an `ObjectId` reaching a consumer as an object
 * rather than a string is the bug this exists to prevent) and drops `_id`. An
 * `id` already present WINS: a schema transform or a DTO mapper that set one
 * made the more specific decision and this must not overwrite it.
 *
 * It rebuilds rather than mutates. The input may be a cached object or a
 * Mongoose document, and a serializer that edits its argument would corrupt the
 * first and try to `delete` a schema path on the second.
 *
 * ## Exactly what it touches, and what it leaves alone
 *
 * The walk is RECURSIVE and reaches every object and array element in the body,
 * at any depth. That breadth is the point — a nested populated document is
 * precisely where a top-level-only rename leaves `_id` behind — but it is also
 * the whole risk surface, so what it does to each kind of payload is stated
 * rather than left to be discovered:
 *
 *   - **Entity documents, nested or not.** `_id` → `id`. This is the job.
 *   - **Envelopes.** `successResponse` and `paginationResponse` wrap data in
 *     `{ success, message, data, meta }` / `{ … pagination }`. Those keys carry
 *     no `_id`, so the envelope is rebuilt field-for-field and reaches the client
 *     unchanged; only the entities inside `data` are rewritten.
 *   - **Error bodies.** `errorHandler` runs after these routers, on a response
 *     whose `res.json` this middleware has already replaced, so error payloads
 *     pass through it too. They carry no `_id` and are unaffected — but they DO
 *     pass through, which is worth knowing before adding a field to one.
 *   - **A non-entity `id`.** Never touched. Only `_id` is removed, and an `id`
 *     already present always wins, whatever its type.
 *   - **`Date` and `Buffer`.** Returned as-is rather than walked, so they still
 *     serialize the way `res.json` would render them.
 *
 * ## Why a whole-body walk is safe HERE and would not be in general
 *
 * Nothing this API returns is legitimately named `_id` — checked, not assumed,
 * and pinned by `__tests__/integration/wireIdContract.test.ts`, which sweeps the
 * public endpoints and fails on `"_id"` anywhere in any body.
 *
 * The two shapes that could have been a problem are both absent:
 *
 *   - **A raw `$group` result**, whose `_id` is the grouping key and not an
 *     entity id, never reaches a client. Every aggregation behind these routers
 *     maps it into a named field first — `analyticsController` emits `cityId`
 *     and `bucket`, `partnerController` folds it into a status total.
 *   - **A third-party payload relayed verbatim.** There is none. The only
 *     upstream bodies this service parses are Nominatim (`lat`/`lon`/
 *     `display_name`), Overpass (`id`/`lat`/`lon`/`tags`) and Wikimedia
 *     (`pageid`) — none of which uses `_id` — plus `routes/ai.ts` calling
 *     Homiio's OWN `/api/properties*` endpoints, whose bodies this middleware
 *     already serialized once, and on which a second pass is a no-op. Oxy's
 *     `/users/by-ids` is read in `controllers/roommate/serialize.ts` but its
 *     payload is projected into Homiio's own shape and never reaches `res.json`.
 *
 * If a future endpoint DOES need to relay a third-party payload verbatim, it
 * must not acquire this behaviour by accident: give it a route that serializes
 * explicitly, rather than widening this.
 *
 * ## Where it is mounted, and why not in `server.ts`
 *
 * At the top of `routes()` and `publicRoutes()`, the two routers that carry every
 * `/api` response. NOT in `server.ts`, even though that is the one place the
 * production app is assembled: the integration suites build their own `express()`
 * and mount these routers directly, so a `server.ts`-only wrapper would be
 * invisible to every test that asserts a response shape. The suite would then go
 * on passing against a wire format production no longer serves — a gate that
 * cannot see the thing it guards.
 */

import type { NextFunction, Request, Response } from 'express';

/** Depth ceiling. Response bodies here nest a handful deep; this only stops a cycle. */
const MAX_DEPTH = 16;

interface JsonSerializable {
  toJSON(): unknown;
}

/**
 * Reduce a Mongoose document (or `ObjectId`, or anything else defining `toJSON`)
 * to the value `JSON.stringify` would have produced for it, so the walk below
 * only ever sees plain data. A `Date` is left alone — `res.json` renders it the
 * same way and unwrapping it here would only lose the type earlier.
 */
function toPlain(value: object): unknown {
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  const candidate = value as Partial<JsonSerializable>;
  return typeof candidate.toJSON === 'function' ? candidate.toJSON() : value;
}

/**
 * Rebuild a response body with every `_id` renamed to `id`.
 *
 * Exported for direct use by tests and by any future non-router serialization
 * point; the middleware below is the only production caller.
 */
export function renameWireIds(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return value;

  const plain = toPlain(value);
  if (plain === null || typeof plain !== 'object') return plain;
  if (plain instanceof Date || Buffer.isBuffer(plain)) return plain;

  if (Array.isArray(plain)) {
    return plain.map((entry) => renameWireIds(entry, depth + 1));
  }

  const record = plain as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (key === '_id') continue;
    out[key] = renameWireIds(entry, depth + 1);
  }
  if ('_id' in record && (out.id === undefined || out.id === null)) {
    const raw = record._id;
    out.id = raw === null || raw === undefined ? raw : String(raw);
  }
  return out;
}

/**
 * Express middleware wrapping `res.json` so every body leaving these routers
 * carries `id` and never `_id`.
 */
export function serializeWireIds(_req: Request, res: Response, next: NextFunction): void {
  const json = res.json.bind(res);
  res.json = (body: unknown) => json(renameWireIds(body));
  next();
}

export default serializeWireIds;

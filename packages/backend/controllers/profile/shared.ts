/**
 * What the `controllers/profile/*` handlers share.
 *
 * ## Nothing here re-exports a Mongoose model any more
 *
 * `Saved`, `SavedPropertyFolder`, `RecentlyViewed` and `Property` went with the
 * saved-items port; `Profile` goes with this one. Every handler in this
 * directory now reads Postgres through `db/profiles/*`, `db/saved/*` and
 * `db/properties/*`, so the models are no longer reachable from here at all —
 * which is what makes "the profile is served from Postgres" a property of the
 * module graph rather than of everybody remembering.
 *
 * ## The profile cache and `_createDefaultProfile` are gone
 *
 * Both belonged to the Mongo profile read and both were removed with it:
 *
 *  - the five-minute in-process `Map` could only ever be correct in a single
 *    process, and Homiio runs several ECS tasks — see `crud.ts`;
 *  - `_createDefaultProfile` seeded a `personalProfile` block with the schema's
 *    defaults, which made "the user chose UTC" indistinguishable from "nobody
 *    ever asked". `ensureProfile` in `db/profiles/profileRepository.ts` creates
 *    the row with every column NULL, which is what `db/schema/profiles.ts`
 *    declares them nullable FOR.
 */

import { successResponse } from '../../middlewares/errorHandler';

const errorResponse = (message = 'Error occurred', code = 'ERROR') => ({
  success: false,
  message,
  code,
  timestamp: new Date().toISOString(),
});

/**
 * The caller's Oxy account id, from the session.
 *
 * Never from the body or a route parameter: `AGENTS.md` requires every write to
 * resolve its owner server-side, and every handler in this directory is scoped
 * to whoever is holding the credential.
 */
function _getOxyUserId(req: {
  user?: { id?: string; _id?: string } | null;
}): string | undefined {
  return req?.user?.id || req?.user?._id;
}

export { successResponse, errorResponse, _getOxyUserId };

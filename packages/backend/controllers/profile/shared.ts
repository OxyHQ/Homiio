/**
 * What the `controllers/profile/*` handlers share.
 *
 * Every handler in this directory reads Postgres through `db/profiles/*`,
 * `db/saved/*` and `db/properties/*`.
 *
 * ## No profile cache, and no seeded defaults
 *
 *  - an in-process cache could only ever be correct in a single process, and
 *    Homiio runs several ECS tasks — see `crud.ts`;
 *  - seeding a new profile with defaults would make "the user chose UTC"
 *    indistinguishable from "nobody ever asked". `ensureProfile` in
 *    `db/profiles/profileRepository.ts` creates the row with every column NULL,
 *    which is what `db/schema/profiles.ts` declares them nullable FOR.
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
function _getOxyUserId(req: { user?: { id?: string; _id?: string } | null }): string | undefined {
  return req?.user?.id || req?.user?._id;
}

export { successResponse, errorResponse, _getOxyUserId };

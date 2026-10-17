/**
 * Whether a photo may be SHOWN — the one definition, used by every read that
 * shows photos and by `has_images`.
 *
 * A legacy row (no Oxy file yet) is shown: its bytes are in Homiio's bucket
 * and the legacy route serves them. A row in Oxy is shown while Oxy last said
 * its file is `active` and not `private` (`services/files/fileEvents.ts`) —
 * Oxy serves nothing else, so showing it would render a broken image, and a
 * photo taken down after a rights claim must disappear from the listing, not
 * merely fail to load on it.
 */

import { sql, type SQL } from 'drizzle-orm';

import { qualified } from '../casing';
import { images } from '../schema';

/** The condition over the `images` row in scope (qualified, for correlated use). */
export function servableImageCondition(): SQL<boolean> {
  return sql<boolean>`(
    ${qualified(images.oxyFileId)} is null
    or (${qualified(images.oxyFileStatus)} = 'active' and ${qualified(images.oxyFileVisibility)} <> 'private')
  )`;
}

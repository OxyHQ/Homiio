/**
 * The ONE handle on Oxy Files (ADR 0043) for the whole backend.
 *
 * Every photo Homiio shows lives in Oxy Files: Homiio's own (scraped listing
 * photos, Wikimedia covers) owned by the Homiio APPLICATION, and a person's
 * uploads owned by THAT PERSON's account. The calls go out on Homiio's service
 * credential (`services/oxy.ts`: the attested task role in production), whose
 * application is the owner of every application file and the holder of every
 * reference — never a header or a body field.
 *
 * The scopes the Homiio application needs, granted by Oxy staff (they are
 * staff-only for a first-party application, ADR 0043 D11):
 *
 * - `files:app:write` — import and upload Homiio's own photos;
 * - `files:references:write` — register and remove Homiio's uses, reconcile;
 * - `files:user-media:write` — store a person's upload in THEIR account;
 * - `files:read` — `metadataByIds`, the ownership check on a published photo.
 *
 * Narrowed to a `Pick` (`oxyFilesSeam.ts`) so a test can hand in a fake with
 * exactly these methods, and so a new call into Oxy Files is a visible change
 * to that list.
 */

import { oxyService } from '../oxy';
import { type OxyFilesApi, oxyFilesOverride } from './oxyFilesSeam';

export { type OxyFilesApi, setOxyFilesForTests } from './oxyFilesSeam';

/** Oxy Files, on Homiio's service credential. */
export function oxyFiles(): OxyFilesApi {
  return oxyFilesOverride() ?? oxyService.assets;
}

/**
 * The HTTP status a failed Oxy call answered with, or undefined for a
 * transport failure. The SDK annotates its errors with `status` (and
 * `response.status`); its own helper for this is not exported.
 */
export function oxyErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as { status?: unknown; response?: { status?: unknown } };
  if (typeof record.status === 'number') return record.status;
  if (typeof record.response?.status === 'number') return record.response.status;
  return undefined;
}

/** The machine-readable code a failed Oxy call answered with, when it gave one. */
export function oxyErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

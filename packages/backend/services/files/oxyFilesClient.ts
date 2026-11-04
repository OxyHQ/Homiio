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
 * Own operations use registered workload identity (Oxy ADR 0049). A personal
 * upload also needs its initiating session or verified execution proof; ownerId
 * alone is never authority. External document tools retain live OAuth grants.
 * File references and per-file read entitlements remain resource constraints.
 *
 * Narrowed to a `Pick` (`oxyFilesSeam.ts`) so a test can hand in a fake with
 * exactly these methods, and so a new call into Oxy Files is a visible change
 * to that list.
 */

import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { readResponseBody } from '@oxy.so/core/server';

import { oxyService } from '../oxy';
import { type OxyFilesApi, linkedDownloadOverride, oxyFilesOverride } from './oxyFilesSeam';

export { type OxyFilesApi, setLinkedDownloadForTests, setOxyFilesForTests } from './oxyFilesSeam';

/** Oxy Files, on Homiio's service credential. */
export function oxyFiles(): OxyFilesApi {
  return oxyFilesOverride() ?? oxyService.assets;
}

/** How long one linked download may take, start to finish. */
const LINKED_DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * The bytes behind a URL `linkedDownloadUrls` minted, at most `maxBytes` (the
 * size Oxy recorded for the file). The URL is a bearer credential: it is
 * fetched here, never handed to a client or logged, and only over https. A
 * trusted Oxy-minted host, so plain `fetch` — bounded by one deadline and a
 * byte cap, never read whole on the server's word.
 */
export async function downloadLinked(url: string, maxBytes: number): Promise<Buffer> {
  const override = linkedDownloadOverride();
  if (override) return override(url);
  if (new URL(url).protocol !== 'https:') throw new Error('Oxy download URLs are https only');
  const response = await fetch(url, {
    credentials: 'omit',
    signal: AbortSignal.timeout(LINKED_DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`Oxy download failed (${response.status})`);
  }
  const read = await readResponseBody(Readable.fromWeb(response.body as WebReadableStream), {
    maxBytes,
    timeoutMs: LINKED_DOWNLOAD_TIMEOUT_MS,
  });
  if (read.kind !== 'ok') throw new Error(`Oxy download failed (${read.kind})`);
  return read.body;
}

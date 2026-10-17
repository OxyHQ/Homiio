/**
 * The test seam of `oxyFilesClient.ts`, in a module of its own with no
 * runtime imports — so the suite's setup can install the in-memory Oxy Files
 * without loading `services/oxy.ts` (and the SDK) into suites that mock
 * `@oxy.so/core/server` themselves.
 */

import type { ServerAssetsApi } from '@oxy.so/core/server';

/** What Homiio calls on Oxy Files; see `oxyFilesClient.ts`. */
export type OxyFilesApi = Pick<
  ServerAssetsApi,
  | 'uploadAppFile'
  | 'importAppFile'
  | 'importAppFiles'
  | 'uploadUserMedia'
  | 'uploadUserMediaLarge'
  | 'linkedDownloadUrls'
  | 'metadataByIds'
  | 'references'
  | 'publicUrl'
>;

let override: OxyFilesApi | null = null;

/** The installed stand-in, if any. */
export function oxyFilesOverride(): OxyFilesApi | null {
  return override;
}

/**
 * Replace the client — tests only, and the reason it is a setter rather than
 * a constructor argument threaded through every controller: the controllers
 * are singletons mounted at import time. `null` restores the real one.
 */
export function setOxyFilesForTests(api: OxyFilesApi | null): void {
  override = api;
}

/**
 * Fetch the bytes behind a short-lived Oxy download URL (`linkedDownloadUrls`).
 * A seam of its own because the URL is a real network address: the suite's
 * in-memory Oxy hands out URLs only it can answer.
 */
export type LinkedDownload = (url: string) => Promise<Buffer>;

let downloadOverride: LinkedDownload | null = null;

/** The installed stand-in, if any. */
export function linkedDownloadOverride(): LinkedDownload | null {
  return downloadOverride;
}

/** Replace the downloader — tests only. `null` restores `fetch`. */
export function setLinkedDownloadForTests(download: LinkedDownload | null): void {
  downloadOverride = download;
}

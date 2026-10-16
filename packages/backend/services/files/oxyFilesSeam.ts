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

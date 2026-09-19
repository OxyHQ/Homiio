/**
 * The GeoIP provider registry.
 *
 * One provider at a time, not a fallback chain — and that is a decision rather
 * than a simplification. A chain exists to survive one provider being down;
 * a memory-mapped file on the task's own disk has no "down" state distinct from
 * "not installed", and a second provider would be a second place a visitor's
 * address could be sent. Adding one later means adding a policy for when the
 * address leaves the machine, which is exactly the decision worth making
 * deliberately rather than inheriting from a `for` loop.
 *
 * The registration seam exists so tests install a fake instead of a file.
 */

import { createMmdbProvider } from './mmdbProvider';
import type { GeoIpProvider } from './types';

let installed: GeoIpProvider | undefined;

/** Install a provider, replacing whatever is there. The test seam. */
export function setGeoIpProvider(provider: GeoIpProvider): void {
  installed = provider;
}

/** Drop the installed provider so the default is rebuilt on next use. */
export function resetGeoIpProvider(): void {
  installed = undefined;
}

export function geoIpProvider(): GeoIpProvider {
  installed ??= createMmdbProvider();
  return installed;
}

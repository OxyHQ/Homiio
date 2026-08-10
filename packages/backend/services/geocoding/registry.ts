/**
 * The provider registry and the fallback policy.
 *
 * Registration is by configuration (`GEOCODING_PROVIDER_ORDER`), and the order
 * of that list IS the preference order. A provider named there but never
 * registered is skipped rather than faked, the same rule the listing-provider
 * ladder follows: an unprovisioned rung does not exist, it is not attempted
 * and failed.
 */

import config from '../../config';
import { createNominatimProvider, NOMINATIM_PROVIDER_ID } from './nominatimProvider';
import { GeocodingProviderError, type GeocodingProvider } from './types';

const providers = new Map<string, GeocodingProvider>();
let bootstrapped = false;

/**
 * Register (or replace) a provider. The seam a fake provider enters through.
 *
 * An explicit registration SUPPRESSES the lazy default below. Without that, a
 * test installing two fakes still got the live Nominatim adapter appended to
 * its fallback chain — so the "every provider failed" case fell through to it
 * and made a real request to the public OSM endpoint from a unit test. Measured
 * while writing `__tests__/unit/geocodingRegistry.test.ts`, which is exactly
 * the case a fake-provider seam exists to make impossible.
 */
export function registerProvider(provider: GeocodingProvider): void {
  bootstrapped = true;
  providers.set(provider.id, provider);
}

export function unregisterProvider(id: string): void {
  providers.delete(id);
}

/**
 * Drop every registration and re-bootstrap on next use.
 *
 * Test seam only. It exists so a suite that registered a fake cannot leak it
 * into the next suite — a leaked fake is indistinguishable from a passing test.
 */
export function resetProviderRegistry(): void {
  providers.clear();
  bootstrapped = false;
}

function bootstrap(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  // Nominatim is the only adapter in the tree today. It is registered here
  // rather than at module load so a test can `resetProviderRegistry()` and
  // register a fake in its place without a live instance ever being built.
  providers.set(NOMINATIM_PROVIDER_ID, createNominatimProvider());
}

/**
 * The configured providers, most-preferred first.
 *
 * Anything registered but absent from the configured order still appears, after
 * the configured ones, so a fake registered by a test is reachable without that
 * test having to also rewrite the environment.
 */
export function orderedProviders(): GeocodingProvider[] {
  bootstrap();
  const preferred: GeocodingProvider[] = [];
  for (const id of config.geocoding.providerOrder) {
    const provider = providers.get(id);
    if (provider) preferred.push(provider);
  }
  const seen = new Set(preferred.map((provider) => provider.id));
  for (const provider of providers.values()) {
    if (!seen.has(provider.id)) preferred.push(provider);
  }
  return preferred;
}

export function providerById(id: string): GeocodingProvider | undefined {
  bootstrap();
  return providers.get(id);
}

/** What a fallback run produced, and whether it was the first choice. */
export interface FallbackOutcome<T> {
  readonly value: T;
  readonly providerId: string;
  /**
   * True when the preferred provider failed and a later one answered. Surfaced
   * to the client as a degradation flag, WITHOUT naming which provider fell
   * over — that is internal detail a public response has no business leaking.
   */
  readonly degraded: boolean;
}

/**
 * Run `operation` down the preference order, moving on only when a provider
 * fails RECOVERABLY (timeout, 429, 5xx).
 *
 * Two things this deliberately does not do.
 *
 * It does not fall back on `invalid_response` or `invalid_request`: those say
 * the request itself was wrong or the answer was garbage, and asking a second
 * provider the same wrong question wastes its budget too.
 *
 * It does not swallow the final failure into an empty result. If every provider
 * fails, the last error is rethrown, because a search that answers `[]` after a
 * timeout is indistinguishable from one that answers `[]` because the place
 * does not exist — and the caller reading it will show a global feed.
 */
export async function withFallback<T>(
  operation: (provider: GeocodingProvider) => Promise<T>,
): Promise<FallbackOutcome<T>> {
  const candidates = orderedProviders();
  if (candidates.length === 0) {
    throw new GeocodingProviderError('provider_unavailable', 'none');
  }

  let lastError: unknown;
  for (const [index, provider] of candidates.entries()) {
    try {
      const value = await operation(provider);
      return { value, providerId: provider.id, degraded: index > 0 };
    } catch (error) {
      lastError = error;
      const recoverable =
        error instanceof GeocodingProviderError && error.isRecoverable;
      if (!recoverable) throw error;
    }
  }
  throw lastError;
}

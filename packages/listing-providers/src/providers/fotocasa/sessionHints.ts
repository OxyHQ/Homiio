/**
 * Discover → fetch browser session handoff for Fotocasa.
 *
 * Discover warms PerimeterX on a city search page; fetch must reuse that
 * `storageState` (+ sticky `proxySessionId`) instead of re-warming cold.
 */

import type { BrowserStorageState } from '../../session';

export const FOTOCASA_BROWSER_SESSION_HINT = 'fotocasaBrowserSession';

export interface FotocasaBrowserSessionHint {
  warmCity: string;
  storageState: BrowserStorageState;
  proxySessionId?: string;
}

function isBrowserStorageState(value: unknown): value is BrowserStorageState {
  if (!value || typeof value !== 'object') return false;
  return Array.isArray((value as { cookies?: unknown }).cookies);
}

/** Read a discover-produced session snapshot from an {@link ExternalListingRef}. */
export function readFotocasaBrowserSessionHint(
  hints: Record<string, unknown> | undefined,
): FotocasaBrowserSessionHint | undefined {
  if (!hints) return undefined;
  const raw = hints[FOTOCASA_BROWSER_SESSION_HINT];
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const warmCity = typeof record.warmCity === 'string' ? record.warmCity : undefined;
  if (!warmCity || !isBrowserStorageState(record.storageState)) return undefined;
  const proxySessionId =
    typeof record.proxySessionId === 'string' ? record.proxySessionId : undefined;
  return { warmCity, storageState: record.storageState, proxySessionId };
}

export function fotocasaBrowserSessionHints(
  session: FotocasaBrowserSessionHint,
): Record<string, unknown> {
  return { [FOTOCASA_BROWSER_SESSION_HINT]: session };
}

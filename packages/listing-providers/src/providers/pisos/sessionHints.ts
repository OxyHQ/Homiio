/**
 * Discover → fetch browser session handoff for Pisos.
 *
 * Discover may warm a sticky Playwright session when cold HTTP search is
 * challenged; fetch must reuse that `storageState` (+ `proxySessionId`) instead
 * of opening a fresh cold context per listing.
 */

import type { BrowserStorageState } from '../../session';

export const PISOS_BROWSER_SESSION_HINT = 'pisosBrowserSession';

export interface PisosBrowserSessionHint {
  proxySessionId?: string;
  storageState?: BrowserStorageState;
}

function isBrowserStorageState(value: unknown): value is BrowserStorageState {
  if (!value || typeof value !== 'object') return false;
  return Array.isArray((value as { cookies?: unknown }).cookies);
}

/** Read a discover-produced session snapshot from an {@link ExternalListingRef}. */
export function readPisosBrowserSessionHint(
  hints: Record<string, unknown> | undefined,
): PisosBrowserSessionHint | undefined {
  if (!hints) return undefined;
  const raw = hints[PISOS_BROWSER_SESSION_HINT];
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const proxySessionId =
    typeof record.proxySessionId === 'string' ? record.proxySessionId : undefined;
  const storageState = isBrowserStorageState(record.storageState)
    ? record.storageState
    : undefined;
  if (!proxySessionId && !storageState) return undefined;
  return { proxySessionId, storageState };
}

export function pisosBrowserSessionHints(
  session: PisosBrowserSessionHint,
): Record<string, unknown> {
  return { [PISOS_BROWSER_SESSION_HINT]: session };
}

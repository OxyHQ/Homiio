// Lightweight event API to coordinate search changes across components
// without triggering a navigation or full screen reload.
import type { LocationSelection } from '@homiio/shared-types';

export type SavedSearchPayload = {
  id?: string;
  name?: string;
  /** The FREE-TEXT dimension. On a LEGACY row this holds the place label. */
  query: string;
  /** The stored geographic scope, or `null` on a pre-contract row. */
  location?: LocationSelection | null;
  /**
   * How the location must be read (ADR 0002 §11).
   *
   * Carried on the EVENT rather than looked up by the listener, so a consumer
   * cannot apply a saved search without being handed the reason it might not be
   * runnable. Absent is treated as `needs_confirmation` by the listener, which
   * is the cautious direction.
   */
  locationStatus?: 'resolved' | 'needs_confirmation';
  filters?: Record<string, unknown>;
};

type Listener = (payload: SavedSearchPayload) => void | Promise<void>;

const listeners = new Set<Listener>();

export function onApplySavedSearch(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitApplySavedSearch(payload: SavedSearchPayload) {
  for (const l of Array.from(listeners)) {
    try {
      l(payload);
    } catch {
      // no-op
    }
  }
}


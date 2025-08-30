// Lightweight event API to coordinate search changes across components
// without triggering a navigation or full screen reload.

export type SavedSearchPayload = {
  id?: string;
  name?: string;
  query: string;
  filters?: any;
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


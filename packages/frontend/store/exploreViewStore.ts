/**
 * How Explore is PRESENTING its results: as a list, or as a map.
 *
 * ## Why this is a store and not `useState` in the results view
 *
 * It was local state, and local state has exactly one consumer. Sindi's
 * `set_results_view` action — "enséñamelo en el mapa", #519 §8.1 — has to reach
 * it from outside the component tree that owns it, and the alternatives are all
 * worse: a prop threaded through five layers, a ref exposed upward, or an event
 * bus whose ordering nobody can reason about.
 *
 * ## Presentation, and nothing else
 *
 * Deliberately NOT part of `searchQueryStore`. The query decides WHICH homes;
 * this decides how they are drawn. Folding it in would put a presentation flag
 * in the URL, in the saved-search payload and in the query key — so switching
 * to the map would look like a different search to the cache, and a saved
 * search would remember somebody's viewing preference from a year ago.
 *
 * ## It is honest about where it applies
 *
 * On a WIDE screen the list and the map are side by side and neither is hidden,
 * so there is nothing to switch: the value is read only by the narrow layout's
 * full-screen toggle. The executor reports that truthfully rather than claiming
 * to have switched a view that was already showing both — see
 * `hooks/useSindiActions.ts`.
 */

import { create } from 'zustand';

import type { SindiResultsView } from '@homiio/shared-types';

interface ExploreViewState {
  /** What the narrow layout shows. `list` on every fresh mount. */
  resultsView: SindiResultsView;
  setResultsView: (view: SindiResultsView) => void;
  toggleResultsView: () => void;
}

export const useExploreViewStore = create<ExploreViewState>()((set) => ({
  // Not persisted. A map somebody opened last week is not a preference they
  // expressed about today's search, and restoring it would put a first-time
  // visitor's cold start on a map with no results yet drawn.
  resultsView: 'list',
  setResultsView: (view) => set({ resultsView: view }),
  toggleResultsView: () =>
    set((state) => ({ resultsView: state.resultsView === 'map' ? 'list' : 'map' })),
}));

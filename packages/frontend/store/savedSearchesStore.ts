/**
 * Saved-search domain types.
 *
 * Server state for saved searches lives entirely in React Query (see
 * {@link useSavedSearches}); there is no Zustand mirror, so this module only
 * exports the shared types. The filename is kept (`savedSearchesStore`) because
 * several components import {@link SavedSearchFilters} from here.
 */

/**
 * Arbitrary filter criteria attached to a saved search (price range, property
 * type, amenities, etc.). The shape is determined by the search UI and is
 * persisted/round-tripped verbatim, so it is intentionally a loose record.
 */
export type SavedSearchFilters = Record<string, unknown>;

/** A normalised saved search as consumed across the app. */
export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  filters?: SavedSearchFilters;
  notifications: boolean;
  /**
   * Mirror of {@link SavedSearch.notifications} kept for downstream components
   * that read the backend's `notificationsEnabled` field name.
   */
  notificationsEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

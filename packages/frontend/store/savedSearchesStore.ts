/**
 * Saved-search domain types.
 *
 * Server state for saved searches lives entirely in React Query (see
 * {@link useSavedSearches}); there is no Zustand mirror, so this module only
 * exports the shared types. The filename is kept (`savedSearchesStore`) because
 * several components import {@link SavedSearchFilters} from here.
 */
import type { LocationSelection } from '@homiio/shared-types';

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
  /** The FREE-TEXT dimension. On a LEGACY row this holds the place label. */
  query: string;
  /** The stored geographic scope, or `null` on a row written before it existed. */
  location: LocationSelection | null;
  /**
   * How {@link SavedSearch.location} should be read (ADR 0002 §11).
   *
   * `needs_confirmation` means the row predates the location column, so all
   * anyone has is a LABEL in `query`. Such a search must not run: re-geocoding
   * the label and keeping the first hit is the homonym bug, and running it
   * WITHOUT a location is worse — a global feed under the name "Madrid", which
   * is the degradation §4.3 forbids in the words "not for a legacy saved
   * search".
   */
  locationStatus: 'resolved' | 'needs_confirmation';
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

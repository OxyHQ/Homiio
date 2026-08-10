/**
 * Saved-search domain types.
 *
 * Server state for saved searches lives entirely in React Query (see
 * {@link useSavedSearches}); there is no Zustand mirror, so this module only
 * exports the shared types. The filename is kept (`savedSearchesStore`) because
 * several components import {@link SavedSearchFilters} from here.
 */
import type {
  AlertChannel,
  HousingAlertRule,
  HousingAlertRuleType,
  LocationSelection,
  PushPrivacyMode,
  WatchAlertStatus,
  WatchCadence,
} from '@homiio/shared-types';

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
  /**
   * The `loc` token that reopens this search, or `undefined` when ADR 0002's
   * grammar cannot express its selection (a drawn polygon — §2.1 reserves that
   * wire format). Absent rather than approximated: a token built from the
   * polygon's bounding box would reopen a WIDER area than the one saved.
   */
  locToken?: string;
  filters?: SavedSearchFilters;
  notifications: boolean;

  // ── The watch half (#356) ──
  //
  // A saved search IS a watch: the same row carries what it watches for and how
  // often it may speak. Every field below is optional so a payload from an older
  // backend normalises to a silent, ordinary saved search rather than to
  // `undefined` reaching a switch.

  /** Which contract `query` was written against. `1` holds a place LABEL. */
  queryVersion?: number;
  /** Whether Home opens on this area. At most one per person, server-enforced. */
  isPrimaryArea?: boolean;
  cadence?: WatchCadence;
  channels?: AlertChannel[];
  alertRules?: HousingAlertRule[];
  /** Which rules the server will accept as enabled — never render a dead switch. */
  availableRuleTypes?: HousingAlertRuleType[];
  mutedUntil?: string | null;
  pushPrivacyMode?: PushPrivacyMode;
  /** Whether an AREA could be derived from the stored selection. */
  hasArea?: boolean;
  /** Whether alerting can actually run, and why not when it cannot. */
  alertStatus?: WatchAlertStatus;
  /**
   * Mirror of {@link SavedSearch.notifications} kept for downstream components
   * that read the backend's `notificationsEnabled` field name.
   */
  notificationsEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Search route — thin shell around the Airbnb-2026 results surface.
 *
 * The screen owns no map/list/filter logic of its own: it wires the shared
 * {@link SearchResultsView} to the active-search store and the auth signal, and
 * hosts the expanding {@link SearchPanel} used to edit the live query.
 *
 *  - `query` is the single source of truth, read from `useSearchQueryStore`.
 *  - `onQueryChange` shallow-merges filter/sort/bounds patches into the store.
 *  - `onEditSearch` reopens the panel seeded with the current query; committing
 *    it replaces the store query in place (no navigation — we're already here).
 *  - Save-search is gated on the Oxy auth signal; unauthenticated users are
 *    routed to `/profile` to sign in.
 *
 * Inbound deep links are mapped onto the store (re-applied when they change):
 *  - `?rentMode=vacation|long_term` switches the experience.
 *  - `?city=<slug>` resolves to a located "Where" via the cities API.
 *  - `?query=<text>` geocodes to a located "Where" via the keyless Nominatim
 *    geocoder (see `useAddressSearch`).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useOxy } from '@oxyhq/services';

import { ListingIntent, PropertyType, RentMode, type Property } from '@homiio/shared-types';

import { SearchResultsView } from '@/components/search/SearchResultsView';
import { SearchPanel } from '@/components/search/SearchPanel';
import type {
  SearchDateRange,
  SearchLocation,
  SearchQuery,
} from '@/components/search/types';
import { useSearchMode } from '@/context/SearchModeContext';
import { geocodeAddress } from '@/hooks/useAddressSearch';
import { cityService } from '@/services/cityService';
import { DEFAULT_SEARCH_QUERY, useSearchQueryStore } from '@/store/searchQueryStore';
import { onApplySavedSearch, type SavedSearchPayload } from '@/utils/searchEvents';

/** Parse a single optional string route param (expo-router unions string | string[]). */
function readParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Coerce the `rentMode` param onto the {@link RentMode} enum (vacation | long-term). */
function parseRentMode(value: string | undefined): RentMode | undefined {
  if (value === RentMode.VACATION) return RentMode.VACATION;
  if (value === RentMode.LONG_TERM) return RentMode.LONG_TERM;
  return undefined;
}

/** All valid {@link PropertyType} values, for narrowing saved-search payloads. */
const PROPERTY_TYPES = new Set<string>(Object.values(PropertyType));

/** All valid {@link ListingIntent} values, for narrowing saved-search payloads. */
const LISTING_INTENTS = new Set<string>(Object.values(ListingIntent));

const readIntent = (value: unknown): ListingIntent | undefined =>
  typeof value === 'string' && LISTING_INTENTS.has(value)
    ? (value as ListingIntent)
    : undefined;

const readNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const readString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

const readPropertyTypes = (value: unknown): PropertyType[] => {
  const raw = Array.isArray(value) ? value : value !== undefined ? [value] : [];
  return raw.filter(
    (v): v is PropertyType => typeof v === 'string' && PROPERTY_TYPES.has(v),
  );
};

const readDates = (filters: Record<string, unknown>): SearchDateRange | undefined => {
  const dates = filters.dates;
  if (dates && typeof dates === 'object') {
    const { start, end } = dates as { start?: unknown; end?: unknown };
    if (typeof start === 'string' && typeof end === 'string') return { start, end };
  }
  // Legacy flat shape used `checkIn`/`checkOut`.
  const start = readString(filters.checkIn);
  const end = readString(filters.checkOut);
  return start && end ? { start, end } : undefined;
};

/**
 * Reconstruct a {@link SearchQuery} from a saved-search payload. Tolerates both
 * the current shape (a flattened {@link SearchQuery}, written by
 * `SaveSearchBottomSheet`) and the legacy flat shape (`minPrice`/`maxPrice`/
 * `type`). The `location` is attached separately once the label is geocoded.
 */
function payloadToQuery(payload: SavedSearchPayload): SearchQuery {
  const filters = payload.filters ?? {};
  const rentMode = parseRentMode(readString(filters.rentMode)) ?? RentMode.LONG_TERM;
  const propertyTypes = filters.propertyTypes
    ? readPropertyTypes(filters.propertyTypes)
    : readPropertyTypes(filters.type);
  const priceMin = readNumber(filters.priceMin) ?? readNumber(filters.minPrice);
  const priceMax = readNumber(filters.priceMax) ?? readNumber(filters.maxPrice);

  return {
    ...DEFAULT_SEARCH_QUERY,
    rentMode,
    intent: readIntent(filters.intent),
    propertyTypes,
    priceMin,
    priceMax,
    bedrooms: readNumber(filters.bedrooms),
    bathrooms: readNumber(filters.bathrooms),
    amenities: readStringArray(filters.amenities),
    guests: readNumber(filters.guests),
    dates: rentMode === RentMode.VACATION ? readDates(filters) : undefined,
  };
}

/** Geocode a free-text place label into a {@link SearchLocation}, or null. */
async function geocodeLabel(label: string): Promise<SearchLocation | null> {
  const [match] = await geocodeAddress(label, { maxResults: 1 });
  if (!match || typeof match.lat !== 'number' || typeof match.lon !== 'number') {
    return null;
  }
  const [primary] = match.text.split(',');
  return {
    label: match.text,
    shortLabel: (primary ?? match.text).trim() || match.text,
    center: [match.lon, match.lat],
  };
}

export default function SearchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    query?: string | string[];
    city?: string | string[];
    rentMode?: string | string[];
  }>();
  const { isAuthenticated } = useOxy();
  const { setIsMapMode } = useSearchMode();

  const query = useSearchQueryStore((s) => s.query);
  const patchQuery = useSearchQueryStore((s) => s.patchQuery);

  const [panelOpen, setPanelOpen] = useState(false);

  // The results surface drives the shell's "map mode" (suppresses the right-bar
  // widget rail the rest of the app shows). Mount-scoped, mirroring the prior
  // screen's behaviour.
  useEffect(() => {
    setIsMapMode(true);
    return () => setIsMapMode(false);
  }, [setIsMapMode]);

  // Hydrate the active query from inbound deep-link params. This is a genuine
  // external side effect (URL → store, with async geocoding/city lookup), so an
  // effect is the right primitive. Keyed on the primitive params so it re-runs
  // only when a deep link actually changes — never on the user's own in-panel
  // edits (those don't touch the URL), so it can't clobber them.
  const queryParam = readParam(params.query);
  const cityParam = readParam(params.city);
  const rentModeParam = readParam(params.rentMode);

  useEffect(() => {
    const rentMode = parseRentMode(rentModeParam);
    if (rentMode) {
      useSearchQueryStore.getState().setRentMode(rentMode);
    }
    if (!cityParam && !queryParam) return;

    let cancelled = false;
    const applyLocation = (location: SearchLocation) => {
      if (cancelled) return;
      useSearchQueryStore.getState().setLocation(location);
    };

    (async () => {
      try {
        if (cityParam) {
          const response = await cityService.getCityBySlug(cityParam);
          const city = response?.data;
          if (city?.coordinates) {
            applyLocation({
              label: city.displayName || city.name,
              shortLabel: city.name,
              center: [city.coordinates.lng, city.coordinates.lat],
            });
            return;
          }
        }
        if (queryParam) {
          const location = await geocodeLabel(queryParam);
          if (location) applyLocation(location);
        }
      } catch {
        // Deep-link resolution is best-effort: the results fall back to the
        // default published feed if the city/geocode lookup fails.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cityParam, queryParam, rentModeParam]);

  // Apply saved searches pushed over the lightweight event bus by the
  // RightBar's SavedSearchesWidget while the user is already on this screen
  // (it avoids a navigation/remount). We reconstruct the full query from the
  // saved payload, commit it, then resolve the location label asynchronously.
  useEffect(() => {
    const unsubscribe = onApplySavedSearch(async (payload) => {
      const next = payloadToQuery(payload);
      useSearchQueryStore.getState().setQuery(next);
      const label = readString(payload.query);
      if (!label) return;
      try {
        const location = await geocodeLabel(label);
        if (location) useSearchQueryStore.getState().setLocation(location);
      } catch {
        // Label geocoding is best-effort; the committed filters still apply.
      }
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const handleEditSearch = useCallback(() => setPanelOpen(true), []);
  const handleClosePanel = useCallback(() => setPanelOpen(false), []);

  const handleSubmitSearch = useCallback((next: SearchQuery) => {
    useSearchQueryStore.getState().setQuery(next);
    setPanelOpen(false);
  }, []);

  const handlePropertyPress = useCallback(
    (property: Property) => {
      router.push(`/properties/${property._id || property.id}`);
    },
    [router],
  );

  const handleRequireAuth = useCallback(() => {
    router.push('/profile');
  }, [router]);

  return (
    <View style={styles.root}>
      <SearchResultsView
        query={query}
        onQueryChange={patchQuery}
        onEditSearch={handleEditSearch}
        onPropertyPress={handlePropertyPress}
        canSaveSearch={isAuthenticated}
        onRequireAuth={handleRequireAuth}
      />
      <SearchPanel
        open={panelOpen}
        onClose={handleClosePanel}
        initialQuery={query}
        onSubmit={handleSubmitSearch}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});

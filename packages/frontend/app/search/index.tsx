/**
 * Search screen — Airbnb-2026 inspired split layout.
 *
 * Web architecture:
 *  - Sticky top bar: SearchBar pill + view-mode SegmentedControl + filter
 *    Chip row.
 *  - Three view modes: `split` (default), `list`, `map`.
 *  - `split`: left column = PropertyResultsGrid (2 columns), right column
 *    = map. Map stays fixed while the list scrolls.
 *  - `list`: full-width 3-column grid, no map.
 *  - `map`: full-width map with floating PropertyResultsGrid in a
 *    Bloom-driven bottom panel.
 *
 * Mobile architecture:
 *  - SearchBar pill at top, results grid below (1 column), floating
 *    "Show map" Bloom button at the bottom that opens a full-screen map
 *    sheet.
 *
 * Reused shared primitives:
 *  - `PropertyCard`, `PropertyResultsGrid`, `PropertyResultsGridSkeleton`
 *  - `FilterChipRow`, `MapMarkerPopover`, `MapFab`
 *  - `EmptyState`, `ErrorState`
 *  - Bloom SegmentedControl, Chip, Button, SearchInput, BottomSheet,
 *    Typography
 */
import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Dimensions,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';

import * as SegmentedControl from '@oxyhq/bloom/segmented-control';
import { Button } from '@oxyhq/bloom/button';
import { SearchInput } from '@oxyhq/bloom/search-input';
import { H3, Text as BloomText } from '@oxyhq/bloom/typography';

import MapView, { type MapApi } from '@/components/Map';
import { SaveSearchBottomSheet } from '@/components/SaveSearchBottomSheet';
import {
  SearchFiltersBottomSheet,
  type SearchFilters,
} from '@/components/SearchFiltersBottomSheet';
import { SortBottomSheet, type SortKey } from '@/components/SortBottomSheet';
import {
  FilterChipRow,
  type FilterChipDef,
  type FilterChipKey,
} from '@/components/ui/FilterChipRow';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { MapFab } from '@/components/ui/MapFab';
import { MapMarkerPopover } from '@/components/ui/MapMarkerPopover';
import { PropertyResultsGrid } from '@/components/ui/PropertyResultsGrid';
import { PropertyResultsGridSkeleton } from '@/components/ui/PropertyResultsGridSkeleton';

import { BottomSheetContext } from '@/context/BottomSheetContext';
import { useMapState } from '@/context/MapStateContext';
import { useRentalMode } from '@/context/RentalModeContext';
import { useSearchMode } from '@/context/SearchModeContext';
import { useSavedSearches } from '@/hooks/useSavedSearches';
import {
  useDebouncedAddressSearch,
  geocodeAddress,
  type AddressSuggestion,
} from '@/hooks/useAddressSearch';
import { useIsDesktop } from '@/hooks/useOptimizedMediaQuery';
import { propertyService } from '@/services/propertyService';
import { useMapSearchStore } from '@/store/mapSearchStore';
import { onApplySavedSearch } from '@/utils/searchEvents';
import { colors } from '@/styles/colors';
import {
  cardShadow,
  hairline,
  radius,
  spacing,
  withShadow,
} from '@/constants/styles';
import { Property, RentMode } from '@homiio/shared-types';

/** Distinct view modes the search screen can render in. */
type ViewMode = 'split' | 'list' | 'map';

/**
 * A location suggestion shown in the search-as-you-type overlay. Sourced from
 * the keyless OpenStreetMap Nominatim geocoder via `useDebouncedAddressSearch`.
 */
interface LocationSuggestion {
  id: string;
  /** Full human-readable place name (Nominatim `display_name`). */
  place_name: string;
  /** Short primary label for the row. */
  text: string;
  /** Secondary line for the row (the remainder of the place name). */
  secondary: string;
  /** [longitude, latitude], GeoJSON order. */
  center: [number, number];
}

/** Map a Nominatim address suggestion onto the overlay's display shape. */
const toLocationSuggestion = (s: AddressSuggestion): LocationSuggestion | null => {
  if (typeof s.lat !== 'number' || typeof s.lon !== 'number') return null;
  const [primary, ...rest] = s.text.split(',');
  return {
    id: s.id,
    place_name: s.text,
    text: (primary ?? s.text).trim() || s.text,
    secondary: rest.join(',').trim(),
    center: [s.lon, s.lat],
  };
};

const DEFAULT_FILTERS: SearchFilters = {
  minPrice: 0,
  maxPrice: 5000,
  bedrooms: 1,
  bathrooms: 1,
  type: undefined,
  amenities: [],
};

const DEFAULT_BARCELONA_BOUNDS = {
  west: 2.0,
  south: 41.3,
  east: 2.3,
  north: 41.5,
} as const;

const SEARCH_DEBOUNCE_MS = 300;
const MIN_MOVE_DISTANCE_METERS = 500;
const MIN_ZOOM_DELTA = 0.8;
/** Half-width of the search box (in degrees) applied around a picked point. */
const LOCATION_BOUNDS_DELTA_DEG = 0.05;

// Filter-chip definitions are derived from the active filters so the
// chip can reflect "Set" vs "Default" state visually.
function buildChipDefs(
  t: ReturnType<typeof useTranslation>['t'],
  filters: SearchFilters,
  mode: 'long_term' | 'vacation',
): FilterChipDef[] {
  const priceLabel = mode === 'vacation'
    ? t('search.chips.nightlyPrice', 'Nightly price') || 'Nightly price'
    : t('search.chips.monthlyPrice', 'Monthly price') || 'Monthly price';
  const priceActive =
    filters.minPrice !== DEFAULT_FILTERS.minPrice ||
    filters.maxPrice !== DEFAULT_FILTERS.maxPrice;
  const bedsActive = Number(filters.bedrooms) !== Number(DEFAULT_FILTERS.bedrooms);
  const bathsActive = Number(filters.bathrooms) !== Number(DEFAULT_FILTERS.bathrooms);
  const typeActive = Boolean(filters.type);
  const amenitiesActive = (filters.amenities?.length ?? 0) > 0;

  return [
    {
      key: 'price',
      icon: 'pricetag-outline',
      label: priceLabel,
      active: priceActive,
    },
    {
      key: 'type',
      icon: 'home-outline',
      label: t('search.chips.type', 'Type') || 'Type',
      active: typeActive,
    },
    {
      key: 'bedrooms',
      icon: 'bed-outline',
      label: t('search.chips.beds', 'Beds') || 'Beds',
      active: bedsActive,
    },
    {
      key: 'bathrooms',
      icon: 'water-outline',
      label: t('search.chips.baths', 'Baths') || 'Baths',
      active: bathsActive,
    },
    {
      key: 'amenities',
      icon: 'sparkles-outline',
      label: t('search.chips.amenities', 'Amenities') || 'Amenities',
      active: amenitiesActive,
    },
    {
      key: 'more',
      icon: 'options-outline',
      label: t('search.chips.more', 'More filters') || 'More filters',
    },
  ];
}

// Sort key → comparator. Pure functions so it's easy to unit-test
// independently if we extract this later.
const SORT_FUNCTIONS: Record<SortKey, (a: Property, b: Property) => number> = {
  recommended: () => 0,
  price_asc: (a, b) => (a.rent?.amount ?? 0) - (b.rent?.amount ?? 0),
  price_desc: (a, b) => (b.rent?.amount ?? 0) - (a.rent?.amount ?? 0),
  newest: (a, b) => {
    const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bDate - aDate;
  },
  rating: () => 0,
};

export default function SearchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const { getMapState, setMapState } = useMapState();
  const { isAuthenticated } = useSavedSearches();
  const { setIsMapMode } = useSearchMode();
  const { mode: rentalMode } = useRentalMode();
  const bottomSheet = useContext(BottomSheetContext);

  const screenId = 'search-screen';
  const savedState = getMapState(screenId);
  const urlQuery = typeof params.query === 'string' ? params.query : '';

  // --- core search state ---
  const mapRef = useRef<MapApi>(null);
  const [searchQuery, setSearchQuery] = useState(
    urlQuery || savedState?.searchQuery || '',
  );
  // Keyless OpenStreetMap Nominatim geocoder for search-as-you-type.
  const {
    suggestions: addressSuggestions,
    loading: isSearching,
    debouncedSearch,
    clearSuggestions,
  } = useDebouncedAddressSearch({
    minQueryLength: 2,
    debounceDelay: SEARCH_DEBOUNCE_MS,
    maxResults: 6,
    includeAddressDetails: false,
  });
  const [showLocationResults, setShowLocationResults] = useState(false);
  const [filters, setFilters] = useState<SearchFilters>({
    ...DEFAULT_FILTERS,
    ...(savedState?.filters ?? {}),
  });
  const [sortKey, setSortKey] = useState<SortKey>('recommended');
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [showMobileMap, setShowMobileMap] = useState(false);
  const [highlightedPropertyId, setHighlightedPropertyId] = useState<
    string | null
  >(savedState?.highlightedMarkerId || null);
  const [currentBounds, setCurrentBounds] = useState<{
    west: number;
    south: number;
    east: number;
    north: number;
  } | null>(savedState?.bounds || null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // The map screen sits inside a "map mode" context flag used by the
  // outer layout to suppress shell chrome.
  useEffect(() => {
    setIsMapMode(true);
    return () => setIsMapMode(false);
  }, [setIsMapMode]);

  // Default view mode follows screen size: mobile defaults to list,
  // desktop to split. Once the user picks a mode we persist their
  // choice for the rest of the session.
  useEffect(() => {
    setViewMode(isDesktop ? 'split' : 'list');
  }, [isDesktop]);

  // --- accumulated properties live in the map store, shared with home ---
  const accumulatedProperties = useMapSearchStore((s) => s.properties);
  const mergeMapProperties = useMapSearchStore((s) => s.mergeProperties);

  const lastFetchCenterRef = useRef<[number, number] | null>(
    savedState?.center || null,
  );
  const lastFetchZoomRef = useRef<number | null>(savedState?.zoom ?? null);
  const lastSelectedLocationRef = useRef<string>('');

  // --- derived data ---
  const mapMarkers = useMemo(() => {
    if (!accumulatedProperties || accumulatedProperties.length === 0) return [];
    return accumulatedProperties
      .map((p) => {
        const coords =
          p?.address?.coordinates?.coordinates || p?.location?.coordinates;
        if (
          !coords ||
          coords.length !== 2 ||
          typeof coords[0] !== 'number' ||
          typeof coords[1] !== 'number'
        ) {
          return null;
        }
        return {
          id: p._id,
          coordinates: coords as [number, number],
          priceLabel: `€${p.rent?.amount?.toLocaleString() || 0}`,
        };
      })
      .filter(
        (m): m is { id: string; coordinates: [number, number]; priceLabel: string } =>
          m !== null,
      );
  }, [accumulatedProperties]);

  // Visible-on-screen filter so the list mirrors the current map viewport.
  const visibleProperties = useMemo(() => {
    if (!currentBounds) return accumulatedProperties;
    const within = (lng: number, lat: number) =>
      lng >= currentBounds.west &&
      lng <= currentBounds.east &&
      lat >= currentBounds.south &&
      lat <= currentBounds.north;
    return accumulatedProperties.filter((p) => {
      const coords = (p.address?.coordinates?.coordinates ||
        p.location?.coordinates) as [number, number] | undefined;
      if (!coords || coords.length !== 2) return false;
      const [lng, lat] = coords;
      return typeof lng === 'number' && typeof lat === 'number' && within(lng, lat);
    });
  }, [accumulatedProperties, currentBounds]);

  // Sorted view of the visible properties.
  const sortedProperties = useMemo(() => {
    const cmp = SORT_FUNCTIONS[sortKey];
    if (!cmp) return visibleProperties;
    return [...visibleProperties].sort(cmp);
  }, [visibleProperties, sortKey]);

  // --- map marker / popover state ---
  const selectedProperty = useMemo(() => {
    if (!highlightedPropertyId) return null;
    return (
      accumulatedProperties.find((p) => p._id === highlightedPropertyId) ?? null
    );
  }, [accumulatedProperties, highlightedPropertyId]);

  // --- data fetching ---
  const fetchProperties = useCallback(
    async (bounds: {
      west: number;
      south: number;
      east: number;
      north: number;
    }) => {
      setIsLoading(true);
      setFetchError(null);
      setHighlightedPropertyId(null);
      try {
        const round = (n: number, d = 3) =>
          Math.round(n * Math.pow(10, d)) / Math.pow(10, d);
        const qb = {
          west: round(bounds.west),
          south: round(bounds.south),
          east: round(bounds.east),
          north: round(bounds.north),
        };
        const rentModeFilter =
          rentalMode === 'vacation' ? RentMode.VACATION : RentMode.LONG_TERM;
        const baseFilters = {
          minRent: filters.minPrice,
          maxRent: filters.maxPrice,
          bedrooms:
            typeof filters.bedrooms === 'string' ? 5 : filters.bedrooms,
          bathrooms:
            typeof filters.bathrooms === 'string' ? 4 : filters.bathrooms,
          type: filters.type,
          amenities: filters.amenities,
          rentMode: rentModeFilter,
          ...(rentalMode === 'vacation'
            ? {
                checkIn: filters.checkIn,
                checkOut: filters.checkOut,
                guests: filters.guests,
                instantBook: filters.instantBook,
              }
            : { furnished: filters.furnished }),
        };
        const key = ['propertiesInBounds', qb, baseFilters];
        const response = await queryClient.ensureQueryData({
          queryKey: key,
          queryFn: async () =>
            propertyService.findPropertiesInBounds(bounds, baseFilters),
          staleTime: 1000 * 60,
          gcTime: 1000 * 60 * 10,
        });
        mergeMapProperties(response.properties || []);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to load properties';
        setFetchError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [filters, queryClient, mergeMapProperties, rentalMode],
  );

  // Initial fetch when nothing cached.
  useEffect(() => {
    if (accumulatedProperties.length === 0 && !savedState) {
      fetchProperties({ ...DEFAULT_BARCELONA_BOUNDS });
    }
    // Intentionally NOT depending on `accumulatedProperties.length` after
    // mount — we only want this to happen on first mount, not every time
    // the cache populates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-run the fetch when the rental mode flips so the user sees the
  // correct subset of listings immediately.
  useEffect(() => {
    if (currentBounds) {
      fetchProperties(currentBounds);
    } else if (accumulatedProperties.length > 0) {
      fetchProperties({ ...DEFAULT_BARCELONA_BOUNDS });
    }
    // We only want to re-fetch when the mode flips, not on every bound change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rentalMode]);

  // Location suggestions derived from the keyless Nominatim geocoder.
  const locationResults = useMemo<LocationSuggestion[]>(
    () =>
      addressSuggestions
        .map(toLocationSuggestion)
        .filter((s): s is LocationSuggestion => s !== null),
    [addressSuggestions],
  );

  // --- search-as-you-type via OpenStreetMap Nominatim geocoding ---
  useEffect(() => {
    const query = searchQuery.trim();
    if (!query || query === lastSelectedLocationRef.current) {
      clearSuggestions();
      setShowLocationResults(false);
      return;
    }
    setShowLocationResults(true);
    debouncedSearch(query);
  }, [searchQuery, debouncedSearch, clearSuggestions]);

  const handleSelectLocation = useCallback(
    (result: LocationSuggestion) => {
      const [lng, lat] = result.center;
      clearSuggestions();
      setShowLocationResults(false);
      setSearchQuery(result.place_name);
      lastSelectedLocationRef.current = result.place_name;
      mapRef.current?.navigateToLocation(result.center, 14);
      lastFetchCenterRef.current = result.center;
      lastFetchZoomRef.current = 14;
      const radiusDelta = LOCATION_BOUNDS_DELTA_DEG;
      const bounds = {
        west: lng - radiusDelta,
        south: lat - radiusDelta,
        east: lng + radiusDelta,
        north: lat + radiusDelta,
      };
      fetchProperties(bounds);
    },
    [fetchProperties, clearSuggestions],
  );

  // Saved-search bus subscription.
  useEffect(() => {
    const unsubscribe = onApplySavedSearch(async (saved) => {
      try {
        setSearchQuery(saved.query || '');
        lastSelectedLocationRef.current = saved.query || '';
        setFilters((prev) => ({
          ...prev,
          ...(saved.filters as Partial<SearchFilters>),
        }));
        if (!saved.query) return;
        const [match] = await geocodeAddress(saved.query, { maxResults: 1 });
        const suggestion = match ? toLocationSuggestion(match) : null;
        if (suggestion) handleSelectLocation(suggestion);
      } catch {
        /* silent — UI stays in last state */
      }
    });
    return () => {
      unsubscribe();
    };
  }, [handleSelectLocation]);

  // --- map gesture handlers ---
  const handleRegionChange = useCallback(
    ({
      center,
      bounds,
      zoom,
      isFinal,
    }: {
      center: [number, number];
      bounds: { west: number; south: number; east: number; north: number };
      zoom: number;
      isFinal?: boolean;
    }) => {
      if (!bounds || !center) return;
      setCurrentBounds(bounds);
      if (!isFinal) return;

      const distanceMeters = (
        a: [number, number],
        b: [number, number],
      ): number => {
        const toRad = (x: number) => (x * Math.PI) / 180;
        const R = 6371000;
        const dLat = toRad(b[1] - a[1]);
        const dLon = toRad(b[0] - a[0]);
        const lat1 = toRad(a[1]);
        const lat2 = toRad(b[1]);
        const sinDLat = Math.sin(dLat / 2);
        const sinDLon = Math.sin(dLon / 2);
        const h =
          sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
      };
      const diagonalMeters = distanceMeters(
        [bounds.west, bounds.north],
        [bounds.east, bounds.south],
      );
      const threshold = Math.max(MIN_MOVE_DISTANCE_METERS, diagonalMeters * 0.3);

      if (
        !lastFetchCenterRef.current ||
        lastFetchZoomRef.current === null
      ) {
        lastFetchCenterRef.current = center;
        lastFetchZoomRef.current = zoom;
        fetchProperties(bounds);
        return;
      }
      const moved = distanceMeters(lastFetchCenterRef.current, center);
      const zoomChanged = Math.abs(
        (lastFetchZoomRef.current ?? zoom) - zoom,
      );
      if (moved >= threshold || zoomChanged >= MIN_ZOOM_DELTA) {
        lastFetchCenterRef.current = center;
        lastFetchZoomRef.current = zoom;
        fetchProperties(bounds);
      }
    },
    [fetchProperties],
  );

  const handleMarkerPress = useCallback(
    ({ id }: { id: string; lngLat: [number, number] }) => {
      setHighlightedPropertyId(id);
      setMapState(screenId, { highlightedMarkerId: id });
    },
    [setMapState],
  );

  useEffect(() => {
    mapRef.current?.highlightMarker(highlightedPropertyId);
  }, [highlightedPropertyId]);

  const handlePropertyPress = useCallback(
    (property: Property) => {
      router.push(`/properties/${property._id}`);
    },
    [router],
  );

  // --- top-bar actions ---
  const handleFilterChange = useCallback(
    (sectionId: string, value: unknown) => {
      setFilters((prev) => {
        switch (sectionId) {
          case 'price':
            if (Array.isArray(value)) {
              const [min, max] = value;
              return {
                ...prev,
                minPrice: typeof min === 'number' ? min : prev.minPrice,
                maxPrice: typeof max === 'number' ? max : prev.maxPrice,
              };
            }
            return prev;
          case 'type':
            return {
              ...prev,
              type: typeof value === 'string' ? value : undefined,
            };
          case 'bedrooms':
            return {
              ...prev,
              bedrooms:
                typeof value === 'string' || typeof value === 'number'
                  ? Number(value)
                  : prev.bedrooms,
            };
          case 'bathrooms':
            return {
              ...prev,
              bathrooms:
                typeof value === 'string' || typeof value === 'number'
                  ? Number(value)
                  : prev.bathrooms,
            };
          case 'amenities': {
            const current = prev.amenities || [];
            if (typeof value !== 'string') return prev;
            const next = current.includes(value)
              ? current.filter((a) => a !== value)
              : [...current, value];
            return { ...prev, amenities: next };
          }
          case 'checkIn':
            return {
              ...prev,
              checkIn: typeof value === 'string' ? value : undefined,
            };
          case 'checkOut':
            return {
              ...prev,
              checkOut: typeof value === 'string' ? value : undefined,
            };
          case 'guests':
            return {
              ...prev,
              guests: typeof value === 'number' ? value : prev.guests,
            };
          case 'instantBook':
            return { ...prev, instantBook: Boolean(value) };
          case 'cancellationPolicy':
            return {
              ...prev,
              cancellationPolicy:
                typeof value === 'string'
                  ? (value as SearchFilters['cancellationPolicy'])
                  : undefined,
            };
          case 'moveIn':
            return {
              ...prev,
              moveIn: typeof value === 'string' ? value : undefined,
            };
          case 'leaseDuration':
            return {
              ...prev,
              leaseDuration: typeof value === 'string' ? value : undefined,
            };
          case 'maxDeposit':
            if (Array.isArray(value)) {
              const [, max] = value;
              return {
                ...prev,
                maxDeposit:
                  typeof max === 'number' ? max : prev.maxDeposit,
              };
            }
            return prev;
          case 'furnished':
            return { ...prev, furnished: Boolean(value) };
          default:
            return prev;
        }
      });
    },
    [],
  );

  const openFilters = useCallback(() => {
    bottomSheet.openBottomSheet(
      <SearchFiltersBottomSheet
        filters={filters}
        onFilterChange={handleFilterChange}
        onApply={() => {
          bottomSheet.closeBottomSheet();
          if (currentBounds) fetchProperties(currentBounds);
        }}
        onClear={() => {
          setFilters(DEFAULT_FILTERS);
          bottomSheet.closeBottomSheet();
        }}
      />,
    );
  }, [bottomSheet, filters, handleFilterChange, currentBounds, fetchProperties]);

  const handleChipPress = useCallback(
    (key: FilterChipKey) => {
      // All chips route through the same filter sheet; the sheet's
      // section order is controlled and the user lands on the relevant
      // group anyway.
      openFilters();
      void key;
    },
    [openFilters],
  );

  const handleSortPress = useCallback(() => {
    bottomSheet.openBottomSheet(
      <SortBottomSheet
        value={sortKey}
        onChange={setSortKey}
        onClose={() => bottomSheet.closeBottomSheet()}
      />,
    );
  }, [bottomSheet, sortKey]);

  const handleSaveSearch = useCallback(() => {
    if (!isAuthenticated) {
      router.push('/profile');
      return;
    }
    bottomSheet.openBottomSheet(
      <SaveSearchBottomSheet
        defaultName={searchQuery || 'My Search'}
        query={searchQuery}
        filters={{ ...filters }}
        onClose={() => bottomSheet.closeBottomSheet()}
        onSaved={() => bottomSheet.closeBottomSheet()}
      />,
    );
  }, [bottomSheet, isAuthenticated, router, searchQuery, filters]);

  const handleClearFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    if (currentBounds) fetchProperties(currentBounds);
  }, [currentBounds, fetchProperties]);

  const handleRefreshLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        timeInterval: 10000,
        distanceInterval: 10,
      });
      const coords: [number, number] = [
        location.coords.longitude,
        location.coords.latitude,
      ];
      mapRef.current?.navigateToLocation(coords, 14);
      lastFetchCenterRef.current = coords;
      lastFetchZoomRef.current = 14;
      setMapState(screenId, { center: coords, zoom: 14, bounds: undefined });
    } catch {
      /* permission denied or location unavailable — no-op */
    }
  }, [setMapState]);

  const chipDefs = useMemo(
    () => buildChipDefs(t, filters, rentalMode),
    [t, filters, rentalMode],
  );

  const resultsHeader = useMemo(() => {
    if (isLoading) {
      return t('search.header.loading', 'Searching homes...') || 'Searching homes...';
    }
    if (sortedProperties.length === 0) {
      return t('search.header.noResults', 'No homes match this area') ||
        'No homes match this area';
    }
    return t(
      'search.header.countWithCity',
      `${sortedProperties.length} homes in this area`,
    ) || `${sortedProperties.length} homes in this area`;
  }, [t, isLoading, sortedProperties.length]);

  // -------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------
  const renderTopBar = () => (
    <View style={[styles.topBar, cardShadow.sm]}>
      <View style={styles.topBarContent}>
        <View style={styles.searchInputWrap}>
          <SearchInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            onClearText={() => setSearchQuery('')}
            label={
              t(
                'search.input.placeholder',
                'Search cities, neighborhoods, or addresses',
              ) || 'Search cities, neighborhoods, or addresses'
            }
          />
        </View>
        {isDesktop ? (
          <View style={styles.viewModeWrap}>
            <SegmentedControl.Root<ViewMode>
              label={t('search.viewMode.label', 'View mode') || 'View mode'}
              type="tabs"
              size="small"
              value={viewMode}
              onChange={setViewMode}
            >
              <SegmentedControl.Item value="split">
                <SegmentedControl.ItemText>
                  {t('search.viewMode.split', 'Split') || 'Split'}
                </SegmentedControl.ItemText>
              </SegmentedControl.Item>
              <SegmentedControl.Item value="list">
                <SegmentedControl.ItemText>
                  {t('search.viewMode.list', 'List') || 'List'}
                </SegmentedControl.ItemText>
              </SegmentedControl.Item>
              <SegmentedControl.Item value="map">
                <SegmentedControl.ItemText>
                  {t('search.viewMode.map', 'Map') || 'Map'}
                </SegmentedControl.ItemText>
              </SegmentedControl.Item>
            </SegmentedControl.Root>
          </View>
        ) : null}
      </View>
      <FilterChipRow chips={chipDefs} onChipPress={handleChipPress} />
    </View>
  );

  const renderResultsHeader = () => (
    <View style={styles.resultsHeader}>
      <View style={styles.resultsHeaderText}>
        <H3 style={styles.resultsTitle}>{resultsHeader}</H3>
        {isSearching ? (
          <BloomText style={styles.resultsSubtitle}>
            {t('search.header.geocoding', 'Looking up location...') ||
              'Looking up location...'}
          </BloomText>
        ) : null}
      </View>
      <View style={styles.resultsHeaderActions}>
        <Button
          onPress={handleSortPress}
          variant="ghost"
          size="small"
          icon={<Ionicons name="swap-vertical" size={16} color={colors.COLOR_BLACK} />}
          iconPosition="left"
          accessibilityLabel={t('search.actions.sort', 'Sort') || 'Sort'}
        >
          {t('search.actions.sort', 'Sort') || 'Sort'}
        </Button>
        <Button
          onPress={handleSaveSearch}
          variant="ghost"
          size="small"
          icon={<Ionicons name="bookmark-outline" size={16} color={colors.COLOR_BLACK} />}
          iconPosition="left"
          accessibilityLabel={t('search.actions.save', 'Save') || 'Save'}
        >
          {t('search.actions.save', 'Save') || 'Save'}
        </Button>
        <Button
          onPress={handleRefreshLocation}
          variant="ghost"
          size="small"
          icon={<Ionicons name="locate-outline" size={16} color={colors.COLOR_BLACK} />}
          iconPosition="left"
          accessibilityLabel={t('search.actions.locate', 'Locate') || 'Locate'}
        >
          {t('search.actions.locate', 'Locate') || 'Locate'}
        </Button>
      </View>
    </View>
  );

  const renderLocationOverlay = () => {
    if (!showLocationResults || locationResults.length === 0) return null;
    return (
      <View style={[styles.locationOverlay, withShadow('md')]}>
        {locationResults.map((result) => (
          <Pressable
            key={result.id}
            onPress={() => handleSelectLocation(result)}
            style={({ pressed }) => [
              styles.locationRow,
              pressed ? styles.locationRowPressed : null,
            ]}
            accessibilityRole="button"
            accessibilityLabel={result.place_name}
          >
            <Ionicons
              name="location-outline"
              size={18}
              color={colors.COLOR_BLACK_LIGHT_3}
            />
            <View style={styles.locationText}>
              <BloomText style={styles.locationTitle}>{result.text}</BloomText>
              {result.secondary ? (
                <BloomText style={styles.locationSubtitle}>
                  {result.secondary}
                </BloomText>
              ) : null}
            </View>
          </Pressable>
        ))}
      </View>
    );
  };

  const renderResultsBody = (gridColumns?: Partial<{ sm: number; md: number; lg: number; xl: number }>) => {
    if (isLoading && sortedProperties.length === 0) {
      return (
        <PropertyResultsGridSkeleton
          count={6}
          columns={gridColumns}
          style={styles.gridPadding}
        />
      );
    }
    if (fetchError) {
      return (
        <ErrorState
          title={t('search.error.title', 'Could not load homes') || 'Could not load homes'}
          description={fetchError}
          retryLabel={t('common.tryAgain', 'Try again') || 'Try again'}
          onRetry={() => currentBounds && fetchProperties(currentBounds)}
        />
      );
    }
    if (sortedProperties.length === 0) {
      const hasFilters =
        filters.minPrice !== DEFAULT_FILTERS.minPrice ||
        filters.maxPrice !== DEFAULT_FILTERS.maxPrice ||
        filters.type ||
        (filters.amenities?.length ?? 0) > 0;
      return (
        <EmptyState
          icon="home-outline"
          title={
            t('search.empty.title', 'No homes match this area') ||
            'No homes match this area'
          }
          description={
            t(
              'search.empty.description',
              'Try moving the map or relaxing your filters.',
            ) || 'Try moving the map or relaxing your filters.'
          }
          actionText={
            hasFilters
              ? t('search.empty.action', 'Reset filters') || 'Reset filters'
              : undefined
          }
          actionIcon={hasFilters ? 'refresh' : undefined}
          onAction={hasFilters ? handleClearFilters : undefined}
        />
      );
    }
    return (
      <PropertyResultsGrid
        properties={sortedProperties}
        onPropertyPress={handlePropertyPress}
        highlightedPropertyId={highlightedPropertyId}
        columns={gridColumns}
        style={styles.gridPadding}
      />
    );
  };

  const renderResultsScroll = (gridColumns?: Partial<{ sm: number; md: number; lg: number; xl: number }>) => (
    <View style={styles.resultsScroll}>
      {renderResultsHeader()}
      {renderResultsBody(gridColumns)}
    </View>
  );

  const renderMapPanel = () => (
    <View style={styles.mapPanel}>
      <MapView
        key="search-map"
        ref={mapRef}
        style={styles.map}
        screenId={screenId}
        startFromCurrentLocation={!savedState}
        initialZoom={savedState?.zoom || 12}
        markers={mapMarkers}
        onRegionChange={handleRegionChange}
        onMarkerPress={handleMarkerPress}
      />
      {selectedProperty ? (
        <View
          style={[
            styles.popoverWrap,
            Platform.OS === 'web' ? styles.popoverWrapWeb : null,
          ]}
        >
          <MapMarkerPopover
            property={selectedProperty}
            onPress={() => handlePropertyPress(selectedProperty)}
            onDismiss={() => setHighlightedPropertyId(null)}
          />
        </View>
      ) : null}
    </View>
  );

  // Desktop split / list / map.
  if (isDesktop) {
    return (
      <View style={styles.container}>
        {renderTopBar()}
        {renderLocationOverlay()}
        {viewMode === 'split' ? (
          <View style={styles.splitRow}>
            <View style={styles.splitListColumn}>
              {renderResultsScroll({ sm: 1, md: 2, lg: 2, xl: 2 })}
            </View>
            <View style={styles.splitMapColumn}>{renderMapPanel()}</View>
          </View>
        ) : null}
        {viewMode === 'list' ? (
          <View style={styles.fullColumn}>
            {renderResultsScroll({ sm: 1, md: 2, lg: 3, xl: 4 })}
          </View>
        ) : null}
        {viewMode === 'map' ? (
          <View style={styles.fullColumn}>{renderMapPanel()}</View>
        ) : null}
      </View>
    );
  }

  // Mobile: list + floating Map button → full-screen map sheet.
  return (
    <View style={styles.container}>
      {renderTopBar()}
      {renderLocationOverlay()}
      {showMobileMap ? (
        <View style={styles.fullColumn}>{renderMapPanel()}</View>
      ) : (
        <View style={styles.fullColumn}>
          {renderResultsScroll({ sm: 1, md: 2, lg: 2, xl: 2 })}
        </View>
      )}
      <MapFab
        onPress={() => setShowMobileMap((prev) => !prev)}
        label={
          showMobileMap
            ? t('search.fab.list', 'List') || 'List'
            : t('search.fab.map', 'Map') || 'Map'
        }
        icon={showMobileMap ? 'list' : 'map'}
      />
    </View>
  );
}

const { width: screenWidth } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  topBar: Platform.select<ViewStyle>({
    web: {
      position: 'sticky',
      top: 0,
      zIndex: 100,
      backgroundColor: colors.surfaceElevated,
      borderBottomWidth: hairline.width,
      borderBottomColor: hairline.color,
    } as unknown as ViewStyle,
    default: {
      backgroundColor: colors.surfaceElevated,
      borderBottomWidth: hairline.width,
      borderBottomColor: hairline.color,
    },
  }) as ViewStyle,
  topBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    maxWidth: 1440,
    width: '100%',
    alignSelf: 'center',
  },
  searchInputWrap: {
    flex: 1,
    maxWidth: 640,
  },
  viewModeWrap: {
    width: 280,
  },
  locationOverlay: {
    position: 'absolute',
    top: 88,
    left: 16,
    right: 16,
    maxWidth: 640,
    alignSelf: 'center',
    zIndex: 200,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  locationRowPressed: {
    backgroundColor: colors.mutedSubtle,
  },
  locationText: {
    flex: 1,
    gap: 2,
  },
  locationTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  locationSubtitle: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  splitRow: {
    flex: 1,
    flexDirection: 'row',
  },
  splitListColumn: {
    flex: 1,
    minWidth: 0,
  },
  splitMapColumn: {
    flex: 1,
    minWidth: 0,
    borderLeftWidth: hairline.width,
    borderLeftColor: hairline.color,
  },
  fullColumn: {
    flex: 1,
  },
  resultsScroll: Platform.select<ViewStyle>({
    web: {
      flex: 1,
      overflow: 'auto',
    } as unknown as ViewStyle,
    default: { flex: 1 },
  }) as ViewStyle,
  resultsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  resultsHeaderText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  resultsTitle: {
    fontSize: screenWidth >= 768 ? 24 : 20,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  resultsSubtitle: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  resultsHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  gridPadding: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  mapPanel: {
    flex: 1,
    position: 'relative',
  },
  map: {
    ...StyleSheet.absoluteFill,
  },
  popoverWrap: {
    position: 'absolute',
    bottom: 24,
    left: 0,
    right: 0,
  },
  popoverWrapWeb: {
    maxWidth: 420,
    alignSelf: 'center',
  },
});

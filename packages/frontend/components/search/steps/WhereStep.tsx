/**
 * WhereStep — live city/area autocomplete, on Bloom's `DestinationSuggestions`.
 *
 * Suggestions come from Homiio's geo gateway (`/api/geo/search`, #351), never
 * from a geocoder the device contacts itself. While the text is short it
 * surfaces the user's recent searches; once they type, debounced suggestions
 * replace the list. Selecting a row commits a whole {@link LocationSelection}
 * — an `address_candidate` for a street address and a `place` for everything
 * else, which is the distinction that keeps a geocoder proposal and a
 * materialised Homiio place different things at every layer downstream.
 *
 * Three exports, because the text field does not always live here:
 *
 *  - {@link useWhereSearch} owns the lookup. The wide `StaySearchBar` draws its
 *    own text field inside the Where segment, so the caller holding that text
 *    runs the search.
 *  - {@link WhereSuggestions} draws the answer — the rows, the state line and
 *    the attribution — for whichever field asked.
 *  - {@link WhereStep} is both with a Bloom `Search` field on top, for the
 *    mobile sheet and the eviction board's area picker.
 *
 * **The scope rows.** Before anything is typed, the panel leads with the
 * choices that are not a place name ({@link WhereOptions}): "Use my location"
 * (disabled, with the reason, when location is off), "Explore everywhere" — a
 * deliberate row, never a fallback — and the last area chosen on this device.
 * They replace the strip that used to sit above Home.
 *
 * Two things here are contract rather than styling.
 *
 * **Every non-result state is distinguishable.** "No suggestions" used to be
 * the answer to five different questions — too few characters, in flight,
 * nothing matched, the provider timed out, offline — so a network failure
 * rendered as "no results" and invited the user to search somewhere else.
 * `AddressSearchState` separates them and each gets its own line of copy.
 *
 * **The attribution is rendered whenever results are.** The OSM data licence
 * requires it; the gateway sends it with every response precisely so the
 * surface showing results can display it, and a client cannot render what it
 * was never given.
 */
import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { RiEarthLine, RiFocus3Line, RiHistoryLine, RiMapPinLine, RiTimeLine } from '@oxy.so/bloom/icons';
import { Search } from '@oxy.so/bloom/search';
import { DestinationSuggestions, type DestinationSuggestion } from '@oxy.so/bloom/stay-search';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import {
  useDebouncedAddressSearch,
  type AddressSearchState,
} from '@/hooks/useAddressSearch';
import type { GeoAttribution } from '@/services/geoService';
import { useRecentSearchesStore, type RecentSearch } from '@/store/recentSearchesStore';
import {
  isValidBounds,
  normalizeLongitude,
  geoPlaceToSelection,
  locationKey,
  type GeoBounds,
  type GeoPlace,
  type LocationSelection,
  type GeoPoint,
} from '@homiio/shared-types';
import { useColors } from '@/hooks/useThemeColor';
import { spacing } from '@/constants/styles';
import { selectionLabel } from '../types';
import type { DeviceOptionState } from '@/components/location/scopeWhere';

/**
 * Half-width (degrees) of the box drawn around a picked point when the gateway
 * supplied no bounds of its own.
 *
 * A fallback, and a NARROW one — see {@link synthesizeBounds}. A real place
 * comes back with the provider's actual envelope, which is both correct and
 * free; the synthetic square around a city centre was never the city.
 */
const LOCATION_BOUNDS_DELTA_DEG = 0.05;
const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const MAX_RESULTS = 6;

/** Row ids are namespaced so a recent search and a place can never collide. */
const RECENT_PREFIX = 'recent:';
const PLACE_PREFIX = 'place:';
const OPTION_DEVICE = 'option:device';
const OPTION_EVERYWHERE = 'option:everywhere';
const OPTION_LAST_AREA = 'option:last-area';

const NO_RECENTS: readonly RecentSearch[] = [];

/** Unused by a disabled row, which is never selectable. */
const noop = (): void => undefined;

/**
 * The rows a "where?" panel offers before anything is typed.
 *
 * Every field is optional so a surface offers only what it can honour.
 */
export interface WhereOptions {
  /** "Use my location". `hidden` (or absent) omits the row. */
  device?: {
    readonly state: DeviceOptionState;
    /** The one line under the title: the radius, the progress or the reason. */
    readonly description?: string;
    readonly onPress: () => void;
  };
  /** "Explore everywhere". Absent when everywhere is already in force. */
  onEverywhere?: () => void;
  /** The last area chosen on this device. Absent when it is the area in force. */
  lastArea?: LocationSelection | null;
}

/**
 * Place types that describe an AREA rather than a point.
 *
 * A synthetic box is never drawn around one of these. An 11 km square centred
 * on a country's representative point is not the country — it is a rectangle
 * somewhere inside it, and searching it returns a handful of listings (or none)
 * from a request that succeeded. Zero results is the plausible-looking failure:
 * it reads as "no homes here" or "search is broken", never as "we invented a
 * box". Where the gateway supplies no bounds for an area, the screen carries
 * none and frames itself from the listings it gets back.
 */
const AREA_PLACE_TYPES: ReadonlySet<string> = new Set([
  'country',
  'region',
  'city',
  'district',
  'neighborhood',
  'postcode',
]);

/**
 * A small box around a point-like result, or `undefined`.
 *
 * Longitudes are normalised into [-180, 180) before the box is validated. ADR
 * 0002 §9.3 measured this exact call site as the real antimeridian gap: at
 * longitude 179.98 the naive east edge is 180.03, the backend's `isLongitude`
 * rejects it, and the whole search fails with `INVALID_GEO_PARAMS` — every
 * place within 0.05° of the antimeridian unsearchable. `normalizeLongitude`
 * wraps it, and the resulting `west > east` box is LEGAL: that is how a box
 * crossing the antimeridian is expressed, and PostGIS `::geography` already
 * reads it correctly. `isValidBounds` is the guard that the wrap produced
 * something the backend will accept rather than something merely plausible.
 */
function synthesizeBounds(place: GeoPlace, center: GeoPoint): GeoBounds | undefined {
  if (AREA_PLACE_TYPES.has(place.placeType)) return undefined;

  const { longitude, latitude } = center;
  const candidate = {
    west: normalizeLongitude(longitude - LOCATION_BOUNDS_DELTA_DEG),
    south: latitude - LOCATION_BOUNDS_DELTA_DEG,
    east: normalizeLongitude(longitude + LOCATION_BOUNDS_DELTA_DEG),
    north: latitude + LOCATION_BOUNDS_DELTA_DEG,
  };
  // Near a pole the latitude arithmetic can leave the valid range. Carrying no
  // bounds is correct there; a clamped box would be a different place.
  return isValidBounds(candidate) ? candidate : undefined;
}

/**
 * Map a gateway candidate onto the selection the user just chose.
 *
 * The mapping itself is `geoPlaceToSelection` from the shared contract, NOT a
 * local one: the `address` → `address_candidate` decision is the single place a
 * caller could quietly decide a street address is a "place", and a screen that
 * made that call itself would key by the wrong identity for the rest of that
 * selection's life.
 *
 * A centreless candidate is SELECTABLE. `LocationSelection` addresses a place
 * by IDENTITY, so the search scopes by the place's id and only the map has
 * nothing to frame from. Dropping such a row would remove a legitimate
 * disambiguation candidate from the list.
 *
 * The synthetic box is applied BEFORE the mapping and only where the gateway
 * supplied no bounds — see {@link synthesizeBounds}, which refuses to draw one
 * around an area type at all.
 */
function toLocationSelection(place: GeoPlace): LocationSelection {
  const bounds =
    place.bounds ?? (place.center ? synthesizeBounds(place, place.center) : undefined);
  return geoPlaceToSelection(bounds === undefined ? place : { ...place, bounds });
}

export interface WhereSearch {
  readonly state: AddressSearchState;
  readonly attribution?: GeoAttribution;
  /** Hand every keystroke here: it reports the text upward and runs the lookup. */
  readonly onChangeText: (text: string) => void;
  readonly onClear: () => void;
}

/**
 * The lookup behind a Where field, wherever that field is drawn.
 *
 * The text itself stays with the caller (`onChangeText` reports it) — the
 * lookup only follows it, so a field that is not ours can drive it.
 */
export function useWhereSearch(onChangeText: (text: string) => void): WhereSearch {
  const { state, attribution, debouncedSearch, clear } = useDebouncedAddressSearch({
    minQueryLength: MIN_QUERY_LENGTH,
    debounceDelay: SEARCH_DEBOUNCE_MS,
    maxResults: MAX_RESULTS,
  });

  const handleChange = useCallback(
    (text: string) => {
      onChangeText(text);
      if (text.trim().length >= MIN_QUERY_LENGTH) {
        debouncedSearch(text);
      } else {
        clear();
      }
    },
    [onChangeText, debouncedSearch, clear],
  );

  const handleClear = useCallback(() => {
    onChangeText('');
    clear();
  }, [onChangeText, clear]);

  return { state, attribution, onChangeText: handleChange, onClear: handleClear };
}

interface WhereSuggestionsProps {
  /** The text the lookup ran for. Below the minimum length, recents show. */
  value: string;
  search: WhereSearch;
  onSelectLocation: (selection: LocationSelection) => void;
  /** Omit to list no recent searches (a surface that only picks an area). */
  onSelectRecent?: (recent: RecentSearch) => void;
  /** A line shown when there is nothing to list yet (no recents, nothing typed). */
  emptyHint?: string;
  /** The scope rows shown before anything is typed. */
  options?: WhereOptions;
  style?: StyleProp<ViewStyle>;
}

/** The rows, the state line and the attribution for a Where lookup. */
export function WhereSuggestions({
  value,
  search,
  onSelectLocation,
  onSelectRecent,
  emptyHint,
  options,
  style,
}: WhereSuggestionsProps): React.ReactElement | null {
  const { t } = useTranslation();
  const colors = useColors();
  const storedSearches = useRecentSearchesStore((s) => s.searches);
  const recentSearches = onSelectRecent ? storedSearches : NO_RECENTS;
  const { state, attribution } = search;

  const places = useMemo<LocationSelection[]>(
    () => (state.status === 'results' ? state.places.map(toLocationSelection) : []),
    [state],
  );

  /**
   * One line of copy per state.
   *
   * A provider failure must never render as "no results": that tells the user
   * their place does not exist and invites them to search for somewhere else,
   * when the truthful answer is that Homiio could not ask.
   */
  const statusMessage = useMemo<string | null>(() => {
    switch (state.status) {
      case 'debouncing':
      case 'loading':
        return t('search.header.geocoding');
      case 'empty':
        return t('search.where.noResults');
      case 'failed':
        switch (state.reason) {
          case 'offline':
            return t('search.where.offline');
          case 'rate_limited':
            return t('search.where.rateLimited');
          case 'timeout':
          case 'provider_unavailable':
            return t('search.where.providerUnavailable');
          default:
            return t('search.where.failed');
        }
      default:
        return null;
    }
  }, [state, t]);

  const showRecents = value.trim().length < MIN_QUERY_LENGTH;

  // Keyed by the selection's own IDENTITY. Two candidates can share a rounded
  // centre — and one may have no centre at all — so a coordinate key would
  // collide and silently drop a row.
  const items = useMemo<DestinationSuggestion[]>(
    () =>
      showRecents
        ? recentSearches.map((recent) => ({
            id: `${RECENT_PREFIX}${recent.id}`,
            title: recent.label,
            description: recent.sublabel,
            icon: RiTimeLine,
          }))
        : places.map((selection) => ({
            id: `${PLACE_PREFIX}${locationKey(selection)}`,
            title: selectionLabel(selection)?.primary ?? '',
            description: selectionLabel(selection)?.secondary,
            icon: RiMapPinLine,
          })),
    [showRecents, recentSearches, places],
  );

  const handleSelect = useCallback(
    (item: DestinationSuggestion) => {
      if (item.id.startsWith(RECENT_PREFIX)) {
        const recent = recentSearches.find((r) => `${RECENT_PREFIX}${r.id}` === item.id);
        if (recent) onSelectRecent?.(recent);
        return;
      }
      const selection = places.find((s) => `${PLACE_PREFIX}${locationKey(s)}` === item.id);
      if (selection) onSelectLocation(selection);
    },
    [recentSearches, places, onSelectRecent, onSelectLocation],
  );

  /**
   * The scope rows, split by whether they can be pressed.
   *
   * Bloom's `DestinationSuggestion` has no `disabled` (its props are `id`,
   * `title`, `description`, `icon`), so a device row that cannot help — location
   * off, or a fix already in flight — is drawn as its own dimmed, inert list
   * rather than as a row that silently does nothing when pressed.
   */
  const device = options?.device && options.device.state !== 'hidden' ? options.device : null;
  const deviceDisabled = device !== null && (device.state === 'denied' || device.state === 'locating');
  const deviceItem = useMemo<DestinationSuggestion | null>(
    () =>
      device
        ? {
            id: OPTION_DEVICE,
            title: t('location.scope.useCurrent'),
            description: device.description,
            icon: RiFocus3Line,
          }
        : null,
    [device, t],
  );
  const lastArea = options?.lastArea ?? null;
  const onEverywhere = options?.onEverywhere;
  const optionItems = useMemo<DestinationSuggestion[]>(() => {
    if (!showRecents) return [];
    const rows: DestinationSuggestion[] = [];
    if (deviceItem && !deviceDisabled) rows.push(deviceItem);
    if (lastArea) {
      const label = selectionLabel(lastArea);
      rows.push({
        id: OPTION_LAST_AREA,
        title: label?.primary ?? '',
        description: label?.secondary ?? t('location.scope.lastArea'),
        icon: RiHistoryLine,
      });
    }
    if (onEverywhere) {
      rows.push({
        id: OPTION_EVERYWHERE,
        title: t('location.scope.exploreGlobal'),
        description: t('location.scope.everywhereHint'),
        icon: RiEarthLine,
      });
    }
    return rows;
  }, [showRecents, deviceItem, deviceDisabled, lastArea, onEverywhere, t]);

  const handleSelectOption = useCallback(
    (item: DestinationSuggestion) => {
      if (item.id === OPTION_DEVICE) device?.onPress();
      else if (item.id === OPTION_EVERYWHERE) onEverywhere?.();
      else if (item.id === OPTION_LAST_AREA && lastArea) onSelectLocation(lastArea);
    },
    [device, onEverywhere, lastArea, onSelectLocation],
  );

  const disabledDeviceRow =
    showRecents && deviceItem && deviceDisabled ? (
      <View
        style={styles.disabledRow}
        accessibilityState={{ disabled: true }}
        aria-disabled
      >
        <DestinationSuggestions
          items={[deviceItem]}
          onSelect={noop}
          accessibilityLabel={`${deviceItem.title}, ${deviceItem.description ?? ''}`}
        />
      </View>
    ) : null;
  const hasOptions = disabledDeviceRow !== null || optionItems.length > 0;
  const optionRows = hasOptions ? (
    <>
      {disabledDeviceRow}
      {optionItems.length > 0 ? (
        <DestinationSuggestions
          items={optionItems}
          onSelect={handleSelectOption}
          accessibilityLabel={t('location.scope.pickerTitle')}
        />
      ) : null}
    </>
  ) : null;

  const degraded = !showRecents && state.status === 'results' && state.degraded;
  const status = showRecents ? null : statusMessage ?? (items.length === 0 ? emptyHint ?? null : null);
  if (items.length === 0 && !status) {
    if (hasOptions) return <View style={[styles.list, style]}>{optionRows}</View>;
    return emptyHint ? (
      <BloomText style={[styles.statusText, { color: colors.textSecondary }, style]}>{emptyHint}</BloomText>
    ) : null;
  }

  return (
    <View style={[styles.list, style]}>
      {showRecents ? optionRows : null}
      {status ? (
        <BloomText style={[styles.statusText, { color: colors.textSecondary }]}>{status}</BloomText>
      ) : null}
      {degraded ? (
        <BloomText style={[styles.statusText, { color: colors.textSecondary }]}>
          {t('search.where.degraded')}
        </BloomText>
      ) : null}
      {items.length > 0 ? (
        <DestinationSuggestions
          items={items}
          onSelect={handleSelect}
          heading={showRecents ? t('search.recent.title') : undefined}
          accessibilityLabel={showRecents ? t('search.recent.title') : t('searchBar.long.where')}
        />
      ) : null}
      {/* Required by the provider's data licence wherever results appear. */}
      {!showRecents && places.length > 0 && attribution ? (
        <BloomText style={[styles.attribution, { color: colors.textSecondary }]}>
          {attribution.text}
        </BloomText>
      ) : null}
    </View>
  );
}

interface WhereStepProps {
  /** Current free-text value of the input. */
  value: string;
  /** Fired on every keystroke so the owner can hold the raw text. */
  onChangeText: (text: string) => void;
  /** Fired when a place suggestion is chosen. */
  onSelectLocation: (selection: LocationSelection) => void;
  /** Fired when a recent search row is chosen. Omit to list no recent searches. */
  onSelectRecent?: (recent: RecentSearch) => void;
  /** The scope rows shown before anything is typed. */
  options?: WhereOptions;
  /** Focus the field on mount. Default `true`. */
  autoFocus?: boolean;
}

/** A Bloom `Search` field over its suggestions. */
export const WhereStep: React.FC<WhereStepProps> = ({
  value,
  onChangeText,
  onSelectLocation,
  onSelectRecent,
  options,
  autoFocus = true,
}) => {
  const { t } = useTranslation();
  const search = useWhereSearch(onChangeText);

  return (
    <View style={styles.container}>
      <Search
        value={value}
        onChangeText={search.onChangeText}
        onClearText={search.onClear}
        autoFocus={autoFocus}
        label={t('search.input.placeholder')}
      />
      <WhereSuggestions
        value={value}
        search={search}
        onSelectLocation={onSelectLocation}
        onSelectRecent={onSelectRecent}
        options={options}
        // The rows carry their own 12 inset; pull them back to the field's edge.
        style={styles.bleed}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  list: {
    gap: spacing.xs,
  },
  bleed: {
    marginHorizontal: -12,
  },
  // Inert and dimmed: see `disabledDeviceRow`. `none` is valid CSS, unlike the
  // RN-only `box-none` (docs/frontend-conventions.md).
  disabledRow: {
    opacity: 0.5,
    pointerEvents: 'none',
  },
  statusText: {
    fontSize: 14,
    paddingVertical: spacing.sm,
    paddingHorizontal: 12,
  },
  attribution: {
    fontSize: 11,
    paddingTop: spacing.xs,
    paddingHorizontal: 12,
  },
});

export default WhereStep;

/**
 * WhereStep — live city/area autocomplete for the search panel.
 *
 * Suggestions come from Homiio's geo gateway (`/api/geo/search`, #351), never
 * from a geocoder the device contacts itself. While the input is empty it
 * surfaces the user's recent searches; once they type, debounced suggestions
 * replace the list. Selecting a row resolves a {@link SearchLocation} and hands
 * it back to the panel.
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
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Search } from '@oxyhq/bloom/search';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { useDebouncedAddressSearch } from '@/hooks/useAddressSearch';
import { useRecentSearchesStore, type RecentSearch } from '@/store/recentSearchesStore';
import type { GeoPlace } from '@homiio/shared-types';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';
import type { SearchLocation } from '../types';

/**
 * Half-width (degrees) of the box drawn around a picked point when the gateway
 * supplied no bounds of its own.
 *
 * Only a fallback now. A real place comes back with the provider's actual
 * envelope, which is both correct and free — the synthetic square around a city
 * centre was never the city.
 */
const LOCATION_BOUNDS_DELTA_DEG = 0.05;
const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const MAX_RESULTS = 6;

/**
 * Map a gateway candidate onto a resolved {@link SearchLocation}.
 *
 * The label is taken PRE-SPLIT from the gateway rather than by splitting a
 * display string on commas: that assumed a Western comma-separated ordering and
 * mangled every script and address format that does not use one (ADR 0002
 * §9.4).
 */
function toSearchLocation(place: GeoPlace): SearchLocation {
  const { longitude, latitude } = place.center;
  return {
    label: [place.label.primary, place.label.secondary].filter(Boolean).join(', '),
    shortLabel: place.label.primary,
    center: [longitude, latitude],
    bounds: place.bounds ?? {
      west: longitude - LOCATION_BOUNDS_DELTA_DEG,
      south: latitude - LOCATION_BOUNDS_DELTA_DEG,
      east: longitude + LOCATION_BOUNDS_DELTA_DEG,
      north: latitude + LOCATION_BOUNDS_DELTA_DEG,
    },
  };
}

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface SuggestionRowProps {
  icon: IoniconName;
  title: string;
  subtitle?: string;
  accessibilityLabel: string;
  onPress: () => void;
}

/**
 * A single tappable suggestion / recent-search row. NativeWind's css-interop
 * swallows the function form of `style`, so the pressed background is driven by
 * onPressIn/onPressOut state over a static style array instead.
 */
const SuggestionRow: React.FC<SuggestionRowProps> = ({
  icon,
  title,
  subtitle,
  accessibilityLabel,
  onPress,
}) => {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[styles.row, pressed ? styles.rowPressed : null]}
    >
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={18} color={colors.COLOR_BLACK_LIGHT_3} />
      </View>
      <View style={styles.rowText}>
        <BloomText style={styles.rowTitle} numberOfLines={1}>
          {title}
        </BloomText>
        {subtitle ? (
          <BloomText style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </BloomText>
        ) : null}
      </View>
    </Pressable>
  );
};

interface WhereStepProps {
  /** Current free-text value of the input. */
  value: string;
  /** Fired on every keystroke so the panel can hold the raw text. */
  onChangeText: (text: string) => void;
  /** Fired when a place suggestion is chosen. */
  onSelectLocation: (location: SearchLocation) => void;
  /** Fired when a recent search row is chosen. */
  onSelectRecent: (recent: RecentSearch) => void;
  /**
   * Compact mode for the wide centered dialog: tightens the gap between the
   * input and the suggestion/recent list so the dialog reads snug. The narrow
   * sheet leaves this `false`.
   */
  compact?: boolean;
}

export const WhereStep: React.FC<WhereStepProps> = ({
  value,
  onChangeText,
  onSelectLocation,
  onSelectRecent,
  compact = false,
}) => {
  const { t } = useTranslation();
  const recentSearches = useRecentSearchesStore((s) => s.searches);

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

  const resolvedSuggestions = useMemo<SearchLocation[]>(
    () => (state.status === 'results' ? state.places.map(toSearchLocation) : []),
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

  return (
    <View style={compact ? styles.containerCompact : styles.container}>
      <Search
        value={value}
        onChangeText={handleChange}
        onClearText={handleClear}
        autoFocus
        label={
          t('search.input.placeholder')
        }
      />

      {showRecents ? (
        recentSearches.length > 0 ? (
          <View style={styles.list}>
            <BloomText style={styles.sectionLabel}>
              {t('search.recent.title')}
            </BloomText>
            {recentSearches.map((recent) => (
              <SuggestionRow
                key={recent.id}
                icon="time-outline"
                title={recent.label}
                subtitle={recent.sublabel}
                accessibilityLabel={recent.label}
                onPress={() => onSelectRecent(recent)}
              />
            ))}
          </View>
        ) : null
      ) : (
        <View style={styles.list}>
          {statusMessage ? (
            <BloomText style={styles.statusText}>{statusMessage}</BloomText>
          ) : null}
          {state.status === 'results' && state.degraded ? (
            <BloomText style={styles.statusText}>{t('search.where.degraded')}</BloomText>
          ) : null}
          {resolvedSuggestions.map((location) => (
            <SuggestionRow
              key={`${location.center[0]},${location.center[1]}`}
              icon="location-outline"
              title={location.shortLabel}
              subtitle={location.label}
              accessibilityLabel={location.label}
              onPress={() => onSelectLocation(location)}
            />
          ))}
          {/* Required by the provider's data licence wherever results appear. */}
          {resolvedSuggestions.length > 0 && attribution ? (
            <BloomText style={styles.attribution}>{attribution.text}</BloomText>
          ) : null}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  // Tighter input → list gap for the compact centered dialog.
  containerCompact: {
    gap: spacing.md,
  },
  list: {
    gap: spacing.xs,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_4,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  rowPressed: {
    backgroundColor: colors.mutedSubtle,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  rowSubtitle: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  statusText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_4,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  attribution: {
    fontSize: 11,
    color: colors.COLOR_BLACK_LIGHT_4,
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
});

export default WhereStep;

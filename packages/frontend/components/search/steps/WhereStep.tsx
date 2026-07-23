/**
 * WhereStep — live city/area autocomplete for the search panel.
 *
 * Uses the keyless OpenStreetMap Nominatim geocoder via
 * `useDebouncedAddressSearch`. While the input is empty it surfaces the user's
 * recent searches; once they type, debounced suggestions replace the list.
 * Selecting a row resolves a {@link SearchLocation} (label + center + a small
 * bounding box) and hands it back to the panel.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Search } from '@oxyhq/bloom/search';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import {
  useDebouncedAddressSearch,
  type AddressSuggestion,
} from '@/hooks/useAddressSearch';
import { useRecentSearchesStore, type RecentSearch } from '@/store/recentSearchesStore';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';
import type { SearchLocation } from '../types';

/** Half-width (degrees) of the bounding box drawn around a picked point. */
const LOCATION_BOUNDS_DELTA_DEG = 0.05;
const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const MAX_RESULTS = 6;

/** Map a Nominatim suggestion onto a resolved {@link SearchLocation}. */
function toSearchLocation(s: AddressSuggestion): SearchLocation | null {
  if (typeof s.lat !== 'number' || typeof s.lon !== 'number') return null;
  const [primary] = s.text.split(',');
  const center: [number, number] = [s.lon, s.lat];
  return {
    label: s.text,
    shortLabel: (primary ?? s.text).trim() || s.text,
    center,
    bounds: {
      west: s.lon - LOCATION_BOUNDS_DELTA_DEG,
      south: s.lat - LOCATION_BOUNDS_DELTA_DEG,
      east: s.lon + LOCATION_BOUNDS_DELTA_DEG,
      north: s.lat + LOCATION_BOUNDS_DELTA_DEG,
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

  const { suggestions, loading, debouncedSearch, clearSuggestions } =
    useDebouncedAddressSearch({
      minQueryLength: MIN_QUERY_LENGTH,
      debounceDelay: SEARCH_DEBOUNCE_MS,
      maxResults: MAX_RESULTS,
      includeAddressDetails: false,
    });

  const handleChange = useCallback(
    (text: string) => {
      onChangeText(text);
      if (text.trim().length >= MIN_QUERY_LENGTH) {
        debouncedSearch(text);
      } else {
        clearSuggestions();
      }
    },
    [onChangeText, debouncedSearch, clearSuggestions],
  );

  const handleClear = useCallback(() => {
    onChangeText('');
    clearSuggestions();
  }, [onChangeText, clearSuggestions]);

  const resolvedSuggestions = useMemo<SearchLocation[]>(
    () =>
      suggestions
        .map(toSearchLocation)
        .filter((s): s is SearchLocation => s !== null),
    [suggestions],
  );

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
          {loading && resolvedSuggestions.length === 0 ? (
            <BloomText style={styles.statusText}>
              {t('search.header.geocoding')}
            </BloomText>
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
});

export default WhereStep;

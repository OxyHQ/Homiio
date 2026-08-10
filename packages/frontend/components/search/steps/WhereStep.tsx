/**
 * WhereStep — live city/area autocomplete for the search panel.
 *
 * Uses the keyless OpenStreetMap Nominatim geocoder via
 * `useDebouncedAddressSearch`. While the input is empty it surfaces the user's
 * recent searches; once they type, debounced suggestions replace the list.
 * Selecting a row commits a whole {@link LocationSelection} — an
 * `address_candidate`, because a geocoder proposal is a CANDIDATE and not a
 * materialised Homiio place, and the discriminant is what keeps the two
 * different things at every layer downstream.
 *
 * Where the suggestions come from is #351's half of this file; how a selection
 * is committed is this one's.
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
import { locationKey, type LocationSelection } from '@homiio/shared-types';
import { selectionLabel } from '../types';

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const MAX_RESULTS = 6;

/**
 * Map a geocoder suggestion onto an `address_candidate` selection.
 *
 * ## The synthetic bounding box is GONE
 *
 * This used to draw a +/-0.05 degree square around the picked point and call it
 * the selection's bounds. Two things were wrong with it. It is not the place's
 * extent — it is the same square for a hamlet and for Tokyo — and at longitude
 * 179.98 its east edge is 180.03, which `isLongitude` rejects, so the whole
 * search failed with a hard 400 for anywhere within 0.05 degrees of the
 * antimeridian. A candidate with no bounds is scoped by its centre and the
 * endpoint's default radius, which is honest about what a geocoder actually
 * told us. Real bounds arrive with the geo gateway (#351), which computes them.
 *
 * ## The label is not split on a comma
 *
 * `text.split(',')[0]` assumed a comma-separated Western ordering and mangled
 * every script and address format that does not use one. Until the gateway
 * returns a pre-split `PlaceLabel`, the provider's own string is kept WHOLE as
 * `primary` rather than cut at a character that means nothing in most of the
 * world.
 */
function toLocationSelection(s: AddressSuggestion): LocationSelection | null {
  if (typeof s.lat !== 'number' || typeof s.lon !== 'number') return null;
  return {
    kind: 'address_candidate',
    // An external candidate's ref is only as stable as its provider, which is
    // exactly why it must inline its own centre — it has to survive the
    // provider disappearing.
    source: { kind: 'external', provider: 'osm', ref: s.id },
    label: { primary: s.text, kind: 'place' },
    admin: { countryCode: s.address?.country ?? '' },
    center: { longitude: s.lon, latitude: s.lat },
    precision: 'approximate',
  };
}

/**
 * The row's two lines.
 *
 * `primary`/`secondary` are read as-is, never re-split. Once the gateway
 * supplies a pre-split `PlaceLabel` the secondary line carries the
 * administrative parent, which is what lets somebody tell "Barcelona,
 * Catalonia, Spain" from "Barcelona, Anzoátegui, Venezuela" without choosing
 * blind — the disambiguation the picker exists for.
 */
function suggestionTitle(selection: LocationSelection): string {
  return selectionLabel(selection)?.primary ?? '';
}

function suggestionSubtitle(selection: LocationSelection): string | undefined {
  return selectionLabel(selection)?.secondary;
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
  onSelectLocation: (selection: LocationSelection) => void;
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

  const resolvedSuggestions = useMemo<LocationSelection[]>(
    () =>
      suggestions
        .map(toLocationSelection)
        .filter((s): s is LocationSelection => s !== null),
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
          {resolvedSuggestions.map((selection) => (
            <SuggestionRow
              // Keyed by the selection's own identity, not by its coordinates.
              // Two candidates can share a rounded centre; they cannot share a
              // provider ref, and a duplicate React key silently drops a row.
              key={locationKey(selection)}
              icon="location-outline"
              title={suggestionTitle(selection)}
              subtitle={suggestionSubtitle(selection)}
              accessibilityLabel={suggestionTitle(selection)}
              onPress={() => onSelectLocation(selection)}
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

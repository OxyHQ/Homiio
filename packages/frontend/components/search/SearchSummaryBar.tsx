/**
 * SearchSummaryBar — the collapsed search pill.
 *
 * Renders the active query as a compact "Where · Type · Price" summary inside a
 * rounded, elevated pill (Airbnb collapsed search bar). Tapping anywhere
 * reopens the expanding `SearchPanel`. Used both on the home hero and as the
 * editable summary in the results top bar.
 */
import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Text as BloomText } from '@oxyhq/bloom/typography';

import { PropertyType, RentMode } from '@homiio/shared-types';
import { colors } from '@/styles/colors';
import { cardShadow, radius, spacing } from '@/constants/styles';
import type { SearchQuery } from './types';

/** Human label for a single property type. */
const TYPE_LABELS: Record<PropertyType, string> = {
  [PropertyType.APARTMENT]: 'Apartment',
  [PropertyType.HOUSE]: 'House',
  [PropertyType.ROOM]: 'Room',
  [PropertyType.STUDIO]: 'Studio',
  [PropertyType.COUCHSURFING]: 'Couchsurfing',
  [PropertyType.ROOMMATES]: 'Roommates',
  [PropertyType.COLIVING]: 'Coliving',
  [PropertyType.HOSTEL]: 'Hostel',
  [PropertyType.GUESTHOUSE]: 'Guesthouse',
  [PropertyType.CAMPSITE]: 'Campsite',
  [PropertyType.BOAT]: 'Boat',
  [PropertyType.TREEHOUSE]: 'Treehouse',
  [PropertyType.YURT]: 'Yurt',
  [PropertyType.OTHER]: 'Other',
};

interface SummarySegments {
  where: string;
  type: string;
  price: string;
}

interface SearchSummaryBarProps {
  query: SearchQuery;
  /** Open the expanding panel. */
  onPress: () => void;
  /**
   * Compact mode shrinks the pill for the results top bar (single line, no
   * leading search-icon emphasis). Defaults to the full hero pill.
   */
  compact?: boolean;
}

export const SearchSummaryBar: React.FC<SearchSummaryBarProps> = ({
  query,
  onPress,
  compact = false,
}) => {
  const { t } = useTranslation();

  const segments = useMemo<SummarySegments>(() => {
    const where =
      query.location?.shortLabel ||
      (t('search.summary.anywhere', 'Anywhere') || 'Anywhere');

    let type: string;
    if (query.propertyTypes.length === 0) {
      type = t('search.summary.anyType', 'Any type') || 'Any type';
    } else if (query.propertyTypes.length === 1) {
      const label = TYPE_LABELS[query.propertyTypes[0]];
      type = t(label, label) || label;
    } else {
      type =
        t('search.summary.typeCount', `${query.propertyTypes.length} types`) ||
        `${query.propertyTypes.length} types`;
    }

    let price: string;
    if (query.rentMode === RentMode.VACATION && query.dates?.start) {
      price = query.dates.end
        ? `${query.dates.start} – ${query.dates.end}`
        : query.dates.start;
    } else if (query.priceMin !== undefined && query.priceMax !== undefined) {
      price = `€${query.priceMin}–€${query.priceMax}`;
    } else if (query.priceMax !== undefined) {
      price = `≤ €${query.priceMax}`;
    } else if (query.priceMin !== undefined) {
      price = `≥ €${query.priceMin}`;
    } else {
      price = t('search.summary.anyPrice', 'Any price') || 'Any price';
    }

    return { where, type, price };
  }, [query, t]);

  const handlePress = useCallback(() => onPress(), [onPress]);

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={
        t('search.summary.edit', 'Edit search') || 'Edit search'
      }
      style={({ pressed }) => [
        styles.pill,
        compact ? styles.pillCompact : styles.pillFull,
        cardShadow.md,
        pressed ? styles.pillPressed : null,
      ]}
    >
      <View style={styles.searchIcon}>
        <Ionicons name="search" size={compact ? 16 : 18} color={colors.COLOR_BLACK} />
      </View>
      <View style={styles.segments}>
        <BloomText style={styles.primary} numberOfLines={1}>
          {segments.where}
        </BloomText>
        <View style={styles.secondaryRow}>
          <BloomText style={styles.secondary} numberOfLines={1}>
            {segments.type}
          </BloomText>
          <BloomText style={styles.dot}>·</BloomText>
          <BloomText style={styles.secondary} numberOfLines={1}>
            {segments.price}
          </BloomText>
        </View>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillFull: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  pillCompact: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  pillPressed: {
    opacity: 0.85,
  },
  searchIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  segments: {
    flex: 1,
    minWidth: 0,
  },
  primary: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  secondaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  secondary: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_4,
    flexShrink: 1,
  },
  dot: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_5,
  },
});

export default SearchSummaryBar;

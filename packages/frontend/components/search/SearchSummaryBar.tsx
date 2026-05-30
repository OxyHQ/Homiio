/**
 * SearchSummaryBar — the collapsed search pill.
 *
 * Two presentations, breakpoint- and prop-driven:
 *
 *  - Full mode, wide screens: an Airbnb-style 3-column pill
 *    (Where | Move-in/When | Property type) with hairline dividers and a
 *    circular Bloom-primary search button on the right. Each column and the
 *    button is pressable and opens the expanding `SearchPanel`, seeded to the
 *    relevant step.
 *  - Full mode, narrow screens, and `compact` mode (results top bar): a single
 *    "Where · Type · Price" summary line inside the same rounded, elevated pill.
 *
 * Tapping anywhere reopens the expanding `SearchPanel`. Used both on the home
 * hero and as the editable summary in the results top bar.
 */
import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Text as BloomText } from '@oxyhq/bloom/typography';

import { PropertyType, RentMode } from '@homiio/shared-types';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';
import { colors } from '@/styles/colors';
import { cardShadow, hairline, radius, spacing, tracker } from '@/constants/styles';
import type { SearchQuery, SearchStep } from './types';

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

/** Fixed pill geometry for the 3-column (wide) layout. */
const PILL_HEIGHT = 66;
const SEARCH_BUTTON_SIZE = 48;
const DIVIDER_HEIGHT = 28;

interface SummarySegments {
  where: string;
  type: string;
  price: string;
}

interface SearchSummaryBarProps {
  query: SearchQuery;
  /**
   * Open the expanding panel. When `onPressColumn` is not provided, every
   * pressable surface falls back to this handler.
   */
  onPress: () => void;
  /**
   * Open the expanding panel anchored on a specific step. The 3-column pill
   * (wide, full mode) calls this with the column the user tapped. Optional and
   * defaulted to `onPress` so callers that only need "open" keep working.
   */
  onPressColumn?: (step: SearchStep) => void;
  /**
   * Compact mode shrinks the pill for the results top bar (single line, no
   * leading search-icon emphasis). Defaults to the full hero pill.
   */
  compact?: boolean;
}

interface PillColumnProps {
  label: string;
  value: string;
  isFirst?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}

/** A single tappable column inside the wide 3-column pill. */
const PillColumn: React.FC<PillColumnProps> = ({
  label,
  value,
  isFirst = false,
  onPress,
  accessibilityLabel,
}) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel}
    style={({ pressed }) => [
      styles.column,
      isFirst ? styles.columnFirst : null,
      pressed ? styles.columnPressed : null,
    ]}
  >
    <BloomText style={styles.columnLabel} numberOfLines={1}>
      {label}
    </BloomText>
    <BloomText style={styles.columnValue} numberOfLines={1}>
      {value}
    </BloomText>
  </Pressable>
);

export const SearchSummaryBar: React.FC<SearchSummaryBarProps> = ({
  query,
  onPress,
  onPressColumn,
  compact = false,
}) => {
  const { t } = useTranslation();
  const isWide = useIsScreenNotMobile();

  const handlePress = useCallback(() => onPress(), [onPress]);
  const openColumn = useCallback(
    (step: SearchStep) => {
      if (onPressColumn) {
        onPressColumn(step);
        return;
      }
      onPress();
    },
    [onPressColumn, onPress],
  );

  const isVacation = query.rentMode === RentMode.VACATION;

  // Shared "Where" label, reused by both layouts.
  const whereLabel = useMemo(
    () =>
      query.location?.shortLabel ||
      (t('search.summary.anywhere', 'Anywhere') || 'Anywhere'),
    [query.location?.shortLabel, t],
  );

  // Shared "Property type" label, reused by both layouts.
  const typeLabel = useMemo(() => {
    if (query.propertyTypes.length === 0) {
      return t('search.summary.anyType', 'Any type') || 'Any type';
    }
    if (query.propertyTypes.length === 1) {
      const label = TYPE_LABELS[query.propertyTypes[0]];
      return t(label, label) || label;
    }
    return (
      t('search.summary.typeCount', `${query.propertyTypes.length} types`) ||
      `${query.propertyTypes.length} types`
    );
  }, [query.propertyTypes, t]);

  // Dates label for the wide pill's middle column.
  const datesLabel = useMemo(() => {
    if (query.dates?.start) {
      return query.dates.end
        ? `${query.dates.start} – ${query.dates.end}`
        : query.dates.start;
    }
    if (isVacation) {
      return t('search.summary.anyTime', 'Any time') || 'Any time';
    }
    return t('search.summary.addDates', 'Add dates') || 'Add dates';
  }, [query.dates, isVacation, t]);

  // Single-line summary segments (compact mode + narrow full mode).
  const segments = useMemo<SummarySegments>(() => {
    let price: string;
    if (isVacation && query.dates?.start) {
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

    return { where: whereLabel, type: typeLabel, price };
  }, [
    isVacation,
    query.dates,
    query.priceMin,
    query.priceMax,
    whereLabel,
    typeLabel,
    t,
  ]);

  // --- Wide, full mode: Airbnb-style 3-column pill ---
  if (isWide && !compact) {
    const whereColLabel =
      t('searchBar.long.where', 'Where') || 'Where';
    const middleColLabel = isVacation
      ? t('searchBar.vacation.when', 'When') || 'When'
      : t('searchBar.long.moveIn', 'Move-in') || 'Move-in';
    const typeColLabel =
      t('searchBar.long.propertyType', 'Property type') || 'Property type';

    return (
      <View style={[styles.pill3col, cardShadow.md]}>
        <PillColumn
          isFirst
          label={whereColLabel}
          value={whereLabel}
          onPress={() => openColumn('where')}
          accessibilityLabel={`${whereColLabel}: ${whereLabel}`}
        />
        <View style={styles.divider} />
        <PillColumn
          label={middleColLabel}
          value={datesLabel}
          onPress={() => openColumn(isVacation ? 'dates' : 'where')}
          accessibilityLabel={`${middleColLabel}: ${datesLabel}`}
        />
        <View style={styles.divider} />
        <PillColumn
          label={typeColLabel}
          value={typeLabel}
          onPress={() => openColumn('type')}
          accessibilityLabel={`${typeColLabel}: ${typeLabel}`}
        />
        <Pressable
          onPress={handlePress}
          accessibilityRole="button"
          accessibilityLabel={t('searchBar.search', 'Search') || 'Search'}
          style={({ pressed }) => [
            styles.searchButton,
            pressed ? styles.searchButtonPressed : null,
          ]}
        >
          <Ionicons name="search" size={20} color={colors.white} />
        </Pressable>
      </View>
    );
  }

  // --- Compact + narrow full mode: single "Where · Type · Price" line ---
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
  // --- 3-column (wide, full) pill ---
  pill3col: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    height: PILL_HEIGHT,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.pill,
    borderWidth: hairline.width,
    borderColor: hairline.color,
    paddingRight: (PILL_HEIGHT - SEARCH_BUTTON_SIZE) / 2,
  },
  column: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  columnFirst: {
    paddingLeft: spacing['2xl'],
    borderTopLeftRadius: radius.pill,
    borderBottomLeftRadius: radius.pill,
  },
  columnPressed: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_8,
  },
  columnLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    letterSpacing: tracker.wide,
  },
  columnValue: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  divider: {
    width: hairline.width,
    height: DIVIDER_HEIGHT,
    backgroundColor: hairline.color,
  },
  searchButton: {
    width: SEARCH_BUTTON_SIZE,
    height: SEARCH_BUTTON_SIZE,
    borderRadius: SEARCH_BUTTON_SIZE / 2,
    backgroundColor: colors.primaryColor,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  searchButtonPressed: {
    opacity: 0.85,
  },

  // --- Single-line (compact + narrow full) pill ---
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.pill,
    borderWidth: hairline.width,
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

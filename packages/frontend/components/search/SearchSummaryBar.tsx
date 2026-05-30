/**
 * SearchSummaryBar — the collapsed search pill.
 *
 * Two presentations, prop-driven:
 *
 *  - Full mode (home hero, every width): an Airbnb-style 3-column pill
 *    (Where | Move-in/When | Property type) with hairline dividers and a
 *    circular Bloom-primary search button on the right. Each column and the
 *    button is pressable and opens the expanding `SearchPanel`, seeded to the
 *    relevant step. On narrow phones the same pill scales down — tighter
 *    paddings/gaps, smaller label/value type, a smaller button/divider — and
 *    every column truncates so the three columns plus the button fit a typical
 *    phone width without wrapping or overflow.
 *  - `compact` mode (results top bar): a single "Where · Type · Price" summary
 *    line inside the same rounded, elevated pill.
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

/**
 * 3-column pill geometry. Two size sets so the same layout works on a wide
 * web hero and a narrow phone: the narrow set tightens the pill height, the
 * circular search button, and the hairline divider so all three columns plus
 * the button fit a typical phone width.
 */
const PILL_HEIGHT_WIDE = 66;
const PILL_HEIGHT_NARROW = 58;
const SEARCH_BUTTON_SIZE_WIDE = 48;
const SEARCH_BUTTON_SIZE_NARROW = 40;
const DIVIDER_HEIGHT_WIDE = 28;
const DIVIDER_HEIGHT_NARROW = 24;
const SEARCH_ICON_SIZE_WIDE = 20;
const SEARCH_ICON_SIZE_NARROW = 18;

/** Column label/value type sizes per width. */
const COLUMN_LABEL_FONT_WIDE = 12;
const COLUMN_LABEL_FONT_NARROW = 11;
const COLUMN_VALUE_FONT_WIDE = 13;
const COLUMN_VALUE_FONT_NARROW = 12;

/** Single-line (compact) pill leading search-icon size. */
const COMPACT_ICON_SIZE = 16;

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
  /** Apply the narrow-phone size set (tighter padding, smaller type). */
  isNarrow?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}

/**
 * A single tappable column inside the 3-column pill. Both the label and value
 * truncate to one line so a long place name or type label can never push the
 * other columns or the search button out of the pill on a narrow phone.
 */
const PillColumn: React.FC<PillColumnProps> = ({
  label,
  value,
  isFirst = false,
  isNarrow = false,
  onPress,
  accessibilityLabel,
}) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel}
    style={({ pressed }) => [
      styles.column,
      isNarrow ? styles.columnNarrow : null,
      isFirst ? styles.columnFirst : null,
      isFirst && isNarrow ? styles.columnFirstNarrow : null,
      pressed ? styles.columnPressed : null,
    ]}
  >
    <BloomText
      style={[styles.columnLabel, isNarrow ? styles.columnLabelNarrow : null]}
      numberOfLines={1}
      ellipsizeMode="tail"
    >
      {label}
    </BloomText>
    <BloomText
      style={[styles.columnValue, isNarrow ? styles.columnValueNarrow : null]}
      numberOfLines={1}
      ellipsizeMode="tail"
    >
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

  // Single-line summary segments (compact mode, results top bar).
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

  // --- Full mode (every width): Airbnb-style 3-column pill ---
  if (!compact) {
    // Narrow phones get the tighter size set; web/tablet keep the roomy one.
    const isNarrow = !isWide;
    const whereColLabel =
      t('searchBar.long.where', 'Where') || 'Where';
    const middleColLabel = isVacation
      ? t('searchBar.vacation.when', 'When') || 'When'
      : t('searchBar.long.moveIn', 'Move-in') || 'Move-in';
    const typeColLabel =
      t('searchBar.long.propertyType', 'Property type') || 'Property type';

    return (
      <View style={[styles.pill3col, isNarrow ? styles.pill3colNarrow : null, cardShadow.md]}>
        <PillColumn
          isFirst
          isNarrow={isNarrow}
          label={whereColLabel}
          value={whereLabel}
          onPress={() => openColumn('where')}
          accessibilityLabel={`${whereColLabel}: ${whereLabel}`}
        />
        <View style={[styles.divider, isNarrow ? styles.dividerNarrow : null]} />
        <PillColumn
          isNarrow={isNarrow}
          label={middleColLabel}
          value={datesLabel}
          onPress={() => openColumn(isVacation ? 'dates' : 'where')}
          accessibilityLabel={`${middleColLabel}: ${datesLabel}`}
        />
        <View style={[styles.divider, isNarrow ? styles.dividerNarrow : null]} />
        <PillColumn
          isNarrow={isNarrow}
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
            isNarrow ? styles.searchButtonNarrow : null,
            pressed ? styles.searchButtonPressed : null,
          ]}
        >
          <Ionicons
            name="search"
            size={isNarrow ? SEARCH_ICON_SIZE_NARROW : SEARCH_ICON_SIZE_WIDE}
            color={colors.white}
          />
        </Pressable>
      </View>
    );
  }

  // --- Compact mode (results top bar): single "Where · Type · Price" line ---
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={
        t('search.summary.edit', 'Edit search') || 'Edit search'
      }
      style={({ pressed }) => [
        styles.pill,
        cardShadow.md,
        pressed ? styles.pillPressed : null,
      ]}
    >
      <View style={styles.searchIcon}>
        <Ionicons name="search" size={COMPACT_ICON_SIZE} color={colors.COLOR_BLACK} />
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
  // --- 3-column (full) pill: wide base + narrow overrides ---
  pill3col: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    height: PILL_HEIGHT_WIDE,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.pill,
    borderWidth: hairline.width,
    borderColor: hairline.color,
    // Centre the circular button vertically inside the pill.
    paddingRight: (PILL_HEIGHT_WIDE - SEARCH_BUTTON_SIZE_WIDE) / 2,
  },
  pill3colNarrow: {
    height: PILL_HEIGHT_NARROW,
    paddingRight: (PILL_HEIGHT_NARROW - SEARCH_BUTTON_SIZE_NARROW) / 2,
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
  columnNarrow: {
    // Tighter horizontal padding so three columns + the button fit a phone.
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  columnFirst: {
    paddingLeft: spacing['2xl'],
    borderTopLeftRadius: radius.pill,
    borderBottomLeftRadius: radius.pill,
  },
  columnFirstNarrow: {
    paddingLeft: spacing.lg,
  },
  columnPressed: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_8,
  },
  columnLabel: {
    fontSize: COLUMN_LABEL_FONT_WIDE,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    letterSpacing: tracker.wide,
  },
  columnLabelNarrow: {
    fontSize: COLUMN_LABEL_FONT_NARROW,
  },
  columnValue: {
    fontSize: COLUMN_VALUE_FONT_WIDE,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  columnValueNarrow: {
    fontSize: COLUMN_VALUE_FONT_NARROW,
  },
  divider: {
    width: hairline.width,
    height: DIVIDER_HEIGHT_WIDE,
    backgroundColor: hairline.color,
  },
  dividerNarrow: {
    height: DIVIDER_HEIGHT_NARROW,
  },
  searchButton: {
    width: SEARCH_BUTTON_SIZE_WIDE,
    height: SEARCH_BUTTON_SIZE_WIDE,
    borderRadius: SEARCH_BUTTON_SIZE_WIDE / 2,
    backgroundColor: colors.primaryColor,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  searchButtonNarrow: {
    width: SEARCH_BUTTON_SIZE_NARROW,
    height: SEARCH_BUTTON_SIZE_NARROW,
    borderRadius: SEARCH_BUTTON_SIZE_NARROW / 2,
    marginLeft: spacing.xs,
  },
  searchButtonPressed: {
    opacity: 0.85,
  },

  // --- Single-line (compact) pill ---
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.pill,
    borderWidth: hairline.width,
    borderColor: colors.border,
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

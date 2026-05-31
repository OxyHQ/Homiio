/**
 * SearchSummaryBar — the collapsed search pill.
 *
 * Two presentations, prop-driven:
 *
 *  - Full mode (home hero, every width): an Airbnb-style 3-column pill
 *    (Where | Move-in/When | Property type) with hairline dividers and a
 *    circular Bloom-primary search button on the right. Each column and the
 *    button is pressable and opens the expanding `SearchPanel`, seeded to the
 *    relevant step. Native and web render the IDENTICAL pill — same height,
 *    same hairline dividers between all three columns, same Bloom-primary
 *    circular button, same bold-label/lighter-value typography. To fit a
 *    narrow phone the columns simply flex and truncate (one line, tail
 *    ellipsis) and their horizontal padding tightens slightly; nothing else
 *    scales down, so the phone pill reads as a narrower web pill, not a
 *    squished one.
 *  - `compact` mode (results top bar): a single "Where · Type · Price" summary
 *    line inside the same rounded, elevated pill, with an optional trailing
 *    bookmark (Airbnb places the save affordance at the right end of the
 *    results search bar). The summary line and the bookmark are SIBLING
 *    Pressables — never nested — so tapping the summary opens "edit search"
 *    while tapping the bookmark saves the search, and web never renders a
 *    `<button>` inside a `<button>`. The bookmark only appears when
 *    `onSavePress` is supplied; the full hero pill never shows it.
 *
 * Tapping the summary reopens the expanding `SearchPanel`. Used both on the
 * home hero and as the editable summary in the results top bar.
 */
import React, { useCallback, useMemo, useState } from 'react';
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
 * 3-column pill geometry. A SINGLE size set drives every width: the pill
 * height, the circular Bloom-primary search button, the hairline dividers, the
 * search icon, and the label/value type are identical on web and on a narrow
 * phone. The only width-dependent value is the per-column horizontal padding
 * (see `COLUMN_PAD_*` below): on a phone the columns sit a little tighter so
 * the three roomy columns plus the full-size button still fit ~360dp without
 * wrapping or pushing the button off-screen. Columns flex and truncate, so the
 * native pill reads as a narrower version of the web pill — same structure,
 * same emphasis — not a shrunken one.
 */
const PILL_HEIGHT = 66;
const SEARCH_BUTTON_SIZE = 48;
const DIVIDER_HEIGHT = 28;
const SEARCH_ICON_SIZE = 20;

/** Column label/value type sizes — identical on every width. */
const COLUMN_LABEL_FONT = 12;
const COLUMN_VALUE_FONT = 13;

/**
 * Per-column horizontal padding. The button keeps its full
 * `SEARCH_BUTTON_SIZE`; only this padding tightens on a phone so the three
 * columns shrink to make room. Web/tablet keep the roomy Airbnb spacing.
 */
const COLUMN_PAD_X_WIDE = spacing.xl;
const COLUMN_PAD_X_NARROW = spacing.md;
const COLUMN_FIRST_PAD_LEFT_WIDE = spacing['2xl'];
const COLUMN_FIRST_PAD_LEFT_NARROW = spacing.lg;

/** Single-line (compact) pill leading search-icon size. */
const COMPACT_ICON_SIZE = 16;

/**
 * Compact-pill trailing save affordance. The bookmark sits at the right end of
 * the results pill (Airbnb places the bookmark there). It is its own ~40dp tap
 * target, a SIBLING of the summary Pressable — never nested inside it — so web
 * never renders a `<button>` inside a `<button>`.
 */
const SAVE_BUTTON_SIZE = 40;
const SAVE_ICON_SIZE = 20;
/** Height of the hairline divider that separates the summary from the bookmark. */
const SAVE_DIVIDER_HEIGHT = 24;

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
  /**
   * Save-search affordance. When provided AND `compact` is true, a bookmark
   * button renders at the right end of the pill as its own tap target (a
   * sibling of the summary Pressable, not nested inside it). The full hero pill
   * never shows it. Omit `onSavePress` to render the pill without a bookmark.
   */
  onSavePress?: () => void;
  /** Whether the current search is already saved (fills the bookmark + tints it). */
  isSaved?: boolean;
  /** Accessibility label for the bookmark button (e.g. "Saved" / "Save"). */
  saveAccessibilityLabel?: string;
}

interface PillColumnProps {
  label: string;
  value: string;
  isFirst?: boolean;
  /**
   * Tighten only this column's horizontal padding for a narrow phone so the
   * three columns shrink to make room for the full-size button. Type sizes,
   * height, and the divider are unaffected.
   */
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
}) => {
  // NativeWind's css-interop rewrites the `style` prop and does not support
  // React Native's function form (`style={({ pressed }) => …}`) — the function
  // is swallowed and the element renders with no style. Use a STATIC style
  // array (which css-interop merges correctly) and drive the pressed tint with
  // onPressIn/onPressOut state instead.
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.column,
        isNarrow && styles.columnNarrow,
        isFirst && styles.columnFirst,
        isFirst && isNarrow && styles.columnFirstNarrow,
        pressed && styles.columnPressed,
      ]}
    >
      <BloomText style={styles.columnLabel} numberOfLines={1} ellipsizeMode="tail">
        {label}
      </BloomText>
      <BloomText style={styles.columnValue} numberOfLines={1} ellipsizeMode="tail">
        {value}
      </BloomText>
    </Pressable>
  );
};

interface SaveBookmarkButtonProps {
  isSaved: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}

/**
 * Trailing bookmark in the compact pill. A SIBLING of the summary Pressable —
 * never nested — so web renders two independent buttons, not a `<button>` in a
 * `<button>`. Owns its own pressed/hovered state (a hook can't run in `.map()`,
 * and keeping the visual state local mirrors `PillColumn`/`SearchActionPill`).
 */
const SaveBookmarkButton: React.FC<SaveBookmarkButtonProps> = ({
  isSaved,
  onPress,
  accessibilityLabel,
}) => {
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityState={{ selected: isSaved }}
      accessibilityLabel={accessibilityLabel}
      style={[styles.saveButton, (pressed || hovered) && styles.saveButtonPressed]}
    >
      <Ionicons
        name={isSaved ? 'bookmark' : 'bookmark-outline'}
        size={SAVE_ICON_SIZE}
        color={isSaved ? colors.primaryColor : colors.COLOR_BLACK}
      />
    </Pressable>
  );
};

export const SearchSummaryBar: React.FC<SearchSummaryBarProps> = ({
  query,
  onPress,
  onPressColumn,
  compact = false,
  onSavePress,
  isSaved = false,
  saveAccessibilityLabel,
}) => {
  const { t } = useTranslation();
  const isWide = useIsScreenNotMobile();
  const [searchPressed, setSearchPressed] = useState(false);
  const [summaryPressed, setSummaryPressed] = useState(false);

  const handlePress = useCallback(() => onPress(), [onPress]);
  const handleSavePress = useCallback(() => onSavePress?.(), [onSavePress]);
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
    // The pill, dividers, button, and type are identical on every width. The
    // only phone adjustment is tighter per-column horizontal padding so the
    // three columns flex down and leave room for the full-size button.
    const isNarrow = !isWide;
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
          isNarrow={isNarrow}
          label={whereColLabel}
          value={whereLabel}
          onPress={() => openColumn('where')}
          accessibilityLabel={`${whereColLabel}: ${whereLabel}`}
        />
        <View style={styles.divider} />
        <PillColumn
          isNarrow={isNarrow}
          label={middleColLabel}
          value={datesLabel}
          onPress={() => openColumn(isVacation ? 'dates' : 'where')}
          accessibilityLabel={`${middleColLabel}: ${datesLabel}`}
        />
        <View style={styles.divider} />
        <PillColumn
          isNarrow={isNarrow}
          label={typeColLabel}
          value={typeLabel}
          onPress={() => openColumn('type')}
          accessibilityLabel={`${typeColLabel}: ${typeLabel}`}
        />
        <Pressable
          onPress={handlePress}
          onPressIn={() => setSearchPressed(true)}
          onPressOut={() => setSearchPressed(false)}
          accessibilityRole="button"
          accessibilityLabel={t('searchBar.search', 'Search') || 'Search'}
          style={[styles.searchButton, searchPressed && styles.searchButtonPressed]}
        >
          <Ionicons name="search" size={SEARCH_ICON_SIZE} color={colors.primaryForeground} />
        </Pressable>
      </View>
    );
  }

  // --- Compact mode (results top bar): single "Where · Type · Price" line ---
  // The outer element is a plain View carrying the pill chrome (background,
  // border, radius, shadow). The summary area is ONE child Pressable (opens
  // "edit search"); the bookmark is a SIBLING Pressable, never nested inside
  // the summary — this mirrors how PropertyCard renders its save heart as a
  // sibling overlay so web never produces a <button> inside a <button>.
  const showSave = Boolean(onSavePress);
  return (
    <View style={[styles.pill, cardShadow.md]}>
      <Pressable
        onPress={handlePress}
        onPressIn={() => setSummaryPressed(true)}
        onPressOut={() => setSummaryPressed(false)}
        accessibilityRole="button"
        accessibilityLabel={
          t('search.summary.edit', 'Edit search') || 'Edit search'
        }
        style={[styles.summaryTap, summaryPressed && styles.summaryTapPressed]}
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
      {showSave ? (
        <>
          <View style={styles.saveDivider} />
          <SaveBookmarkButton
            isSaved={isSaved}
            onPress={handleSavePress}
            accessibilityLabel={
              saveAccessibilityLabel ||
              (t('search.actions.save', 'Save') || 'Save')
            }
          />
        </>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  // --- 3-column (full) pill: one size set for every width ---
  pill3col: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    height: PILL_HEIGHT,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.pill,
    borderWidth: hairline.width,
    borderColor: hairline.color,
    // Centre the circular button vertically inside the pill.
    paddingRight: (PILL_HEIGHT - SEARCH_BUTTON_SIZE) / 2,
  },
  column: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    justifyContent: 'center',
    paddingHorizontal: COLUMN_PAD_X_WIDE,
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  columnNarrow: {
    // Tighter horizontal padding so the three columns shrink to leave room for
    // the full-size button on a phone. Height/type/divider are unchanged.
    paddingHorizontal: COLUMN_PAD_X_NARROW,
  },
  columnFirst: {
    paddingLeft: COLUMN_FIRST_PAD_LEFT_WIDE,
    borderTopLeftRadius: radius.pill,
    borderBottomLeftRadius: radius.pill,
  },
  columnFirstNarrow: {
    paddingLeft: COLUMN_FIRST_PAD_LEFT_NARROW,
  },
  columnPressed: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_8,
  },
  columnLabel: {
    fontSize: COLUMN_LABEL_FONT,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    letterSpacing: tracker.wide,
  },
  columnValue: {
    fontSize: COLUMN_VALUE_FONT,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  divider: {
    width: hairline.width,
    height: DIVIDER_HEIGHT,
    backgroundColor: hairline.color,
  },
  searchButton: {
    // Reserve the button's full width — it never shrinks, so the flexing
    // columns give up space first and the button stays on-screen.
    flexShrink: 0,
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

  // --- Single-line (compact) pill ---
  // Outer chrome only: the summary tap target and the bookmark are SIBLINGS
  // inside this row. `overflow: hidden` keeps the summary's pressed tint inside
  // the rounded corners; the trailing padding insets the bookmark from the edge.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: spacing.xs,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.pill,
    borderWidth: hairline.width,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  // The tappable summary (search-icon + Where / Type · Price). Carries the
  // pill's inner padding so the bookmark can sit flush at the right end.
  summaryTap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.md,
  },
  summaryTapPressed: {
    opacity: 0.6,
  },
  // Hairline rule between the summary and the trailing bookmark.
  saveDivider: {
    width: hairline.width,
    height: SAVE_DIVIDER_HEIGHT,
    backgroundColor: hairline.color,
  },
  saveButton: {
    flexShrink: 0,
    width: SAVE_BUTTON_SIZE,
    height: SAVE_BUTTON_SIZE,
    borderRadius: SAVE_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.xs,
  },
  saveButtonPressed: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_8,
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

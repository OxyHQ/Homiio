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
import type { TFunction } from 'i18next';
import { Ionicons } from '@expo/vector-icons';

import { Text as BloomText } from '@oxyhq/bloom/typography';

import { OfferingType, PropertyType } from '@homiio/shared-types';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';
import { IconButton } from '@/components/ui/IconButton';
import { colors } from '@/styles/colors';
import { cardShadow, hairline, radius, spacing, tracker } from '@/constants/styles';
import type { SearchQuery, SearchStep } from './types';

/**
 * Format the price-range segment shared by the wide pill's middle column and the
 * compact summary line: an explicit min–max, a one-sided cap, or the "any price"
 * placeholder. One helper so both call sites read identically.
 */
function formatPriceRange(query: SearchQuery, t: TFunction): string {
  if (query.priceMin !== undefined && query.priceMax !== undefined) {
    return `€${query.priceMin}–€${query.priceMax}`;
  }
  if (query.priceMax !== undefined) {
    return `≤ €${query.priceMax}`;
  }
  if (query.priceMin !== undefined) {
    return `≥ €${query.priceMin}`;
  }
  return t('search.summary.anyPrice');
}

/** i18n key for a single property type label. */
const TYPE_I18N_KEYS: Record<PropertyType, string> = {
  [PropertyType.APARTMENT]: 'properties.titles.types.apartment',
  [PropertyType.HOUSE]: 'properties.titles.types.house',
  [PropertyType.ROOM]: 'properties.titles.types.room',
  [PropertyType.STUDIO]: 'properties.titles.types.studio',
  [PropertyType.COUCHSURFING]: 'search.propertyType.couchsurfing',
  [PropertyType.ROOMMATES]: 'search.propertyType.roommates',
  [PropertyType.COLIVING]: 'search.propertyType.coliving',
  [PropertyType.HOSTEL]: 'search.propertyType.hostel',
  [PropertyType.GUESTHOUSE]: 'search.propertyType.guesthouse',
  [PropertyType.CAMPSITE]: 'search.propertyType.campsite',
  [PropertyType.BOAT]: 'search.propertyType.boat',
  [PropertyType.TREEHOUSE]: 'search.propertyType.treehouse',
  [PropertyType.YURT]: 'search.propertyType.yurt',
  [PropertyType.OTHER]: 'search.propertyType.other',
};

/**
 * Slim 3-column pill geometry. A SINGLE size set drives every width: the pill
 * height, the circular Bloom-primary search button, the hairline dividers, the
 * search icon, and the one-line segment type are identical on web and on a
 * narrow phone. Each segment shows a SINGLE line — the current value if set,
 * else a muted placeholder — so the pill stays short (Airbnb-slim) instead of
 * stacking a label above a value. The only width-dependent value is the
 * per-column horizontal padding (see `COLUMN_PAD_*` below): on a phone the
 * columns sit a little tighter so the three segments plus the full-size button
 * still fit ~360dp without wrapping or pushing the button off-screen. Columns
 * flex and truncate, so the native pill reads as a narrower version of the web
 * pill — same structure, same emphasis — not a shrunken one.
 */
const PILL_HEIGHT = 52;
const SEARCH_BUTTON_SIZE = 40;
const DIVIDER_HEIGHT = 24;
const SEARCH_ICON_SIZE = 18;

/**
 * Max width of the full-mode pill so it reads as a CONTAINED rounded pill (like
 * the Airbnb `w-96` reference) rather than stretching full-bleed across a wide
 * hero. The pill keeps `width: '100%'` and centers via `alignSelf`, so it fills
 * the available width on a phone (up to this cap) and sits centered-and-capped
 * on desktop. Sized to hold all three single-line segments + the circular
 * button comfortably (each segment ~200px at the cap) without cramping.
 */
const PILL_MAX_WIDTH = 640;

/** One-line segment type size — identical on every width. */
const SEGMENT_FONT = 14;

/**
 * Per-column horizontal padding. The button keeps its full
 * `SEARCH_BUTTON_SIZE`; only this padding tightens on a phone so the three
 * columns shrink to make room. Web/tablet keep the roomy Airbnb spacing.
 */
const COLUMN_PAD_X_WIDE = spacing.lg;
const COLUMN_PAD_X_NARROW = spacing.md;

/** Single-line (compact) pill leading search-icon size. */
const COMPACT_ICON_SIZE = 16;

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
  /** The single line of text: the current value, or a placeholder when empty. */
  value: string;
  /** When true, `value` is a muted placeholder (nothing selected for this segment). */
  isPlaceholder: boolean;
  isFirst?: boolean;
  /**
   * Tighten only this column's horizontal padding for a narrow phone so the
   * three columns shrink to make room for the full-size button. Type size,
   * height, and the divider are unaffected.
   */
  isNarrow?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}

/**
 * A single tappable segment inside the slim 3-column pill. It renders ONE line —
 * the current value in bold foreground, or a muted-gray placeholder when nothing
 * is selected yet — truncated with a tail ellipsis so a long place name can
 * never push the other segments or the search button out of the pill.
 */
const PillColumn: React.FC<PillColumnProps> = ({
  value,
  isPlaceholder,
  isFirst = false,
  isNarrow = false,
  onPress,
  accessibilityLabel,
}) => {
  // NativeWind's css-interop rewrites the `style` prop and does not support
  // React Native's function form (a `pressed`-arg style callback) — the function
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
        pressed && styles.columnPressed,
      ]}
    >
      <BloomText
        style={isPlaceholder ? styles.columnPlaceholder : styles.columnValue}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {value}
      </BloomText>
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

  const isVacation = query.offering === OfferingType.SHORT_TERM_RENT;

  // Shared "Where" label, reused by both layouts.
  const whereLabel = useMemo(
    () =>
      query.location?.shortLabel ||
      (t('search.summary.anywhere')),
    [query.location?.shortLabel, t],
  );

  // Shared "Property type" label, reused by both layouts.
  const typeLabel = useMemo(() => {
    if (query.propertyTypes.length === 0) {
      return t('search.summary.anyType');
    }
    if (query.propertyTypes.length === 1) {
      return t(TYPE_I18N_KEYS[query.propertyTypes[0]]);
    }
    return t('search.summary.typeCount', { count: query.propertyTypes.length });
  }, [query.propertyTypes, t]);

  // Dates label for the slim pill's middle segment (vacation only). Falls back
  // to the "Any week" placeholder when no range is picked.
  const datesLabel = useMemo(() => {
    if (query.dates?.start) {
      return query.dates.end
        ? `${query.dates.start} – ${query.dates.end}`
        : query.dates.start;
    }
    return t('search.summary.anyWeek');
  }, [query.dates, t]);

  // Guests label for the slim pill's last segment (vacation only). Falls back to
  // the "Add guests" placeholder when no guest count is set.
  const guestsLabel = useMemo(
    () =>
      query.guests && query.guests > 0
        ? t('search.summary.guestCount', { count: query.guests })
        : t('search.summary.addGuests'),
    [query.guests, t],
  );

  // Price label for the wide pill's middle column (long-term / buy / exchange).
  const priceLabel = useMemo(
    () => formatPriceRange(query, t),
    [query, t],
  );

  // Single-line summary segments (compact mode, results top bar). Vacation shows
  // the picked date range in place of price; otherwise it reuses the shared
  // price-range formatter.
  const segments = useMemo<SummarySegments>(() => {
    const price =
      isVacation && query.dates?.start
        ? query.dates.end
          ? `${query.dates.start} – ${query.dates.end}`
          : query.dates.start
        : formatPriceRange(query, t);

    return { where: whereLabel, type: typeLabel, price };
  }, [isVacation, query, whereLabel, typeLabel, t]);

  // --- Full mode (every width): slim Airbnb-style 3-column pill ---
  if (!compact) {
    // The pill, dividers, button, and segment type are identical on every
    // width; only the per-column horizontal padding tightens on a phone so the
    // three segments flex down and leave room for the full-size button. Each
    // segment shows ONE line: the current value, or a muted placeholder.
    const isNarrow = !isWide;

    // Segment 1 — where (both modes).
    const whereFilled = Boolean(query.location?.shortLabel);
    const whereColLabel = t('searchBar.long.where');

    // Segment 2 — vacation: dates ("Any week"); long-term: price ("Any price").
    const midStep: SearchStep = isVacation ? 'dates' : 'price';
    const midValue = isVacation ? datesLabel : priceLabel;
    const midFilled = isVacation
      ? Boolean(query.dates?.start)
      : query.priceMin !== undefined || query.priceMax !== undefined;
    const midColLabel = isVacation
      ? t('searchBar.vacation.when')
      : t('search.step.price.title');

    // Segment 3 — vacation: guests ("Add guests"); long-term: type ("Any type").
    const lastStep: SearchStep = isVacation ? 'guests' : 'type';
    const lastValue = isVacation ? guestsLabel : typeLabel;
    const lastFilled = isVacation
      ? Boolean(query.guests && query.guests > 0)
      : query.propertyTypes.length > 0;
    const lastColLabel = isVacation
      ? t('searchBar.vacation.who')
      : t('searchBar.long.propertyType');

    return (
      <View style={[styles.pill3col, cardShadow.md]}>
        <PillColumn
          isFirst
          isNarrow={isNarrow}
          value={whereLabel}
          isPlaceholder={!whereFilled}
          onPress={() => openColumn('where')}
          accessibilityLabel={`${whereColLabel}: ${whereLabel}`}
        />
        <View style={styles.divider} />
        <PillColumn
          isNarrow={isNarrow}
          value={midValue}
          isPlaceholder={!midFilled}
          onPress={() => openColumn(midStep)}
          accessibilityLabel={`${midColLabel}: ${midValue}`}
        />
        <View style={styles.divider} />
        <PillColumn
          isNarrow={isNarrow}
          value={lastValue}
          isPlaceholder={!lastFilled}
          onPress={() => openColumn(lastStep)}
          accessibilityLabel={`${lastColLabel}: ${lastValue}`}
        />
        <Pressable
          onPress={handlePress}
          onPressIn={() => setSearchPressed(true)}
          onPressOut={() => setSearchPressed(false)}
          accessibilityRole="button"
          accessibilityLabel={t('searchBar.search')}
          // Bloom owns the circle color through NativeWind: `bg-primary` (brand
          // yellow) with a `text-primary-foreground` (black) glyph — never a
          // hardcoded StyleSheet color. See AGENTS.md §NativeWind theming.
          className="bg-primary"
          style={[styles.searchButton, searchPressed && styles.searchButtonPressed]}
        >
          <Ionicons name="search" size={SEARCH_ICON_SIZE} className="text-primary-foreground" />
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
          t('search.summary.edit')
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
          <IconButton
            variant="ghost"
            icon={isSaved ? 'bookmark' : 'bookmark-outline'}
            active={isSaved}
            activeColor={colors.primaryColor}
            onPress={handleSavePress}
            accessibilityLabel={saveAccessibilityLabel || t('search.actions.save')}
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
    // Contained, centered pill: cap the width and center it so a wide hero
    // shows a rounded pill rather than a full-bleed bar; `width: '100%'` still
    // fills a narrow phone up to the cap.
    maxWidth: PILL_MAX_WIDTH,
    alignSelf: 'center',
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
    // Center the one-line segment vertically. The Text keeps the default
    // cross-axis stretch (full segment width) so `textAlign: 'center'` centers
    // it horizontally while `numberOfLines`/`ellipsizeMode` can still tail-
    // truncate a long value — an `alignItems: 'center'` here would shrink the
    // Text to content width and defeat that truncation.
    justifyContent: 'center',
    paddingHorizontal: COLUMN_PAD_X_WIDE,
  },
  columnNarrow: {
    // Tighter horizontal padding so the three columns shrink to leave room for
    // the full-size button on a phone. Height/type/divider are unchanged.
    paddingHorizontal: COLUMN_PAD_X_NARROW,
  },
  // The first segment keeps the rounded-left corners but the SAME symmetric
  // horizontal padding as the others (no extra left inset) so its centered text
  // lines up with segments 2 and 3.
  columnFirst: {
    borderTopLeftRadius: radius.pill,
    borderBottomLeftRadius: radius.pill,
  },
  columnPressed: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_8,
  },
  // Filled segment: bold foreground value, centered.
  columnValue: {
    fontSize: SEGMENT_FONT,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
    letterSpacing: tracker.wide,
    textAlign: 'center',
  },
  // Empty segment: muted-gray placeholder (Airbnb's `text-gray-400`), centered.
  columnPlaceholder: {
    fontSize: SEGMENT_FONT,
    fontWeight: '400',
    color: colors.COLOR_BLACK_LIGHT_4,
    textAlign: 'center',
  },
  divider: {
    width: hairline.width,
    height: DIVIDER_HEIGHT,
    backgroundColor: hairline.color,
  },
  searchButton: {
    // Reserve the button's full width — it never shrinks, so the flexing
    // columns give up space first and the button stays on-screen. The fill
    // color comes from the `bg-primary` className (Bloom theme), not here.
    flexShrink: 0,
    width: SEARCH_BUTTON_SIZE,
    height: SEARCH_BUTTON_SIZE,
    borderRadius: SEARCH_BUTTON_SIZE / 2,
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

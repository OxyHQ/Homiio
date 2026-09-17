/**
 * StaySearch — the search composer, on Bloom's `stay-search` family.
 *
 * One component, two presentations chosen by width (`useIsScreenNotMobile()`):
 *
 *  - **Wide:** `StaySearchBar` — Where | middle | last segments with the round
 *    search button — and a `StaySearchPanel` dropping under the open segment.
 *    A stay shows When and Who; every other offering shows Price and Type in
 *    the same two slots, because those are what narrows a rental or a sale.
 *  - **Narrow:** the `StaySearchCompact` trigger, opening a bottom `Dialog` of
 *    `StaySearchStep` cards — one expanded at a time — over "Clear all" and
 *    "Search".
 *
 * The open step is CONTROLLED (`openStep`), so a screen can open the composer
 * on a given step from anywhere — "Choose a place" on an error state opens it on
 * Where.
 *
 * ## The draft
 *
 * Both presentations edit a local draft of the {@link SearchQuery}; the live
 * query stays still while the user composes.
 *
 *  - The round button / "Search" SUBMITS the draft (`onSubmit`) and records it
 *    as a recent search.
 *  - Wide only: closing the bar (a press outside, Escape) APPLIES the draft
 *    (`onApply`) when it changed, because the bar is still showing the edited
 *    values and silently reverting them would contradict what is on screen.
 *  - Narrow only: dismissing the sheet discards the draft — the sheet covered
 *    the page, and nothing edited in it was ever shown elsewhere.
 *
 * The draft re-seeds whenever the query it came from changes by VALUE. Callers
 * build the query inline (`{ ...activeQuery, offering }`), so identity would
 * change on every render.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { Button, CloseButton } from '@oxy.so/bloom/button';
import { Dialog } from '@oxy.so/bloom/dialog';
import { RiSearchLine } from '@oxy.so/bloom/icons';
import {
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlItemText,
} from '@oxy.so/bloom/segmented-control';
import {
  StaySearchBar,
  StaySearchCompact,
  StaySearchPanel,
  StaySearchStep,
  type GuestCounts,
  type StaySearchSegment,
} from '@oxy.so/bloom/stay-search';
import { H3 } from '@oxy.so/bloom/typography';

import { OfferingType, type LocationSelection, type PropertyType } from '@homiio/shared-types';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';
import { useSearchPriceHistogram } from '@/hooks/useSearchPriceHistogram';
import { useColors } from '@/hooks/useThemeColor';
import { useFormatting } from '@/utils/format';
import { useRecentSearchesStore, type RecentSearch } from '@/store/recentSearchesStore';
import { spacing } from '@/constants/styles';

import { DatesStep } from './steps/DatesStep';
import { GuestsStep, type GuestsValue } from './steps/GuestsStep';
import { PriceStep, priceTrackFor } from './steps/PriceStep';
import { TypeStep } from './steps/TypeStep';
import { WhereStep, WhereSuggestions, useWhereSearch } from './steps/WhereStep';
import {
  datesLabel,
  guestsLabel,
  isStayQuery,
  priceLabel,
  summaryLine,
  typeLabel,
} from './searchLabels';
import {
  BROWSE_MODE_OFFERING,
  browseModeFromOffering,
  locationDisplayLabel,
  type BrowseMode,
  type SearchDateRange,
  type SearchQuery,
  type SearchStep,
} from './types';

/** The four top-level browse modes, in display order, for the sheet's toggle. */
const BROWSE_MODE_ORDER: readonly BrowseMode[] = ['long_term', 'vacation', 'buy', 'exchange'];

/** i18n key for each browse mode in the sheet's toggle. */
const BROWSE_MODE_LABELS: Record<BrowseMode, string> = {
  long_term: 'search.mode.longTerm',
  vacation: 'search.mode.vacation',
  buy: 'search.mode.buy',
  exchange: 'search.mode.exchange',
};

/** Ordered steps per offering. Only a stay has dates and guests. */
const STAY_STEPS: readonly SearchStep[] = ['where', 'dates', 'guests', 'type', 'price'];
const OTHER_STEPS: readonly SearchStep[] = ['where', 'type', 'price'];

/** The short label of each step: the bar's segment label and the collapsed card's. */
const STEP_LABEL_KEYS: Record<SearchStep, string> = {
  where: 'searchBar.long.where',
  type: 'searchBar.long.propertyType',
  dates: 'searchBar.vacation.when',
  guests: 'searchBar.vacation.who',
  price: 'search.step.price.title',
};

/** The expanded card's heading. */
const STEP_TITLE_KEYS: Record<SearchStep, string> = {
  where: 'location.scope.pickerTitle',
  type: 'search.step.type.title',
  dates: 'search.step.dates.title',
  guests: 'search.step.guests.title',
  price: 'search.step.price.title',
};

/** The narrow sheet's height, as a share of the window: fixed, so it never jumps between steps. */
const SHEET_HEIGHT_RATIO = 0.88;

/** Wide panel widths per segment content. */
const WHERE_PANEL_WIDTH = 440;
const PRICE_PANEL_WIDTH = 440;
const GUESTS_PANEL_WIDTH = 400;
const TYPE_PANEL_WIDTH = 420;

/** The bar segment a step lives in, for the offering. */
function segmentFor(step: SearchStep | null, stay: boolean): StaySearchSegment | null {
  if (step === 'where') return 'destination';
  if (stay) {
    if (step === 'dates') return 'dates';
    if (step === 'guests') return 'guests';
    return null;
  }
  if (step === 'price') return 'dates';
  if (step === 'type') return 'guests';
  return null;
}

/** The step a bar segment edits, for the offering. */
function stepFor(segment: StaySearchSegment, stay: boolean): SearchStep {
  if (segment === 'destination') return 'where';
  if (segment === 'guests') return stay ? 'guests' : 'type';
  return stay ? 'dates' : 'price';
}

/**
 * A short recent-search label for a committed query.
 *
 * The bound is formatted by `priceLabel`, so neither the currency glyph nor the
 * word around it is baked into the string.
 */
function buildRecentLabel(
  query: SearchQuery,
  t: TFunction,
  locale: string,
): { label: string; sublabel?: string } {
  const where = locationDisplayLabel(query.location, t);
  const type = typeLabel(query, t);
  return {
    label: type ? `${where} · ${type}` : where,
    sublabel: priceLabel(query, t, locale) ?? undefined,
  };
}

export interface StaySearchProps {
  /** The query the composer describes and seeds its draft from. */
  query: SearchQuery;
  /** The open step, or `null` at rest. Controlled. */
  openStep: SearchStep | null;
  onOpenStepChange: (step: SearchStep | null) => void;
  /** The search button: the composed query, to run. */
  onSubmit: (query: SearchQuery) => void;
  /**
   * Wide only: the bar closed with an edited draft. Defaults to `onSubmit`, for
   * screens where applying and running a search are the same action.
   */
  onApply?: (query: SearchQuery) => void;
  style?: StyleProp<ViewStyle>;
}

export function StaySearch({
  query,
  openStep,
  onOpenStepChange,
  onSubmit,
  onApply,
  style,
}: StaySearchProps): React.ReactElement {
  const { t } = useTranslation();
  const { locale } = useFormatting();
  const isWide = useIsScreenNotMobile();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { height: windowHeight } = useWindowDimensions();
  const addRecentSearch = useRecentSearchesStore((s) => s.addSearch);
  const apply = onApply ?? onSubmit;

  // Seeded by VALUE (see the header), and re-seeded the same way.
  const queryKey = JSON.stringify(query);
  const [seedKey, setSeedKey] = useState(queryKey);
  const [draft, setDraft] = useState<SearchQuery>(query);
  // The free text is seeded from `queryText`, NEVER from the location's label:
  // seeding it from the label is how a place turned back into a text search.
  const [whereText, setWhereText] = useState<string>(query.queryText ?? '');
  const [guestCounts, setGuestCounts] = useState<GuestCounts | undefined>(undefined);
  // Fetched only while the price step is on screen; keyed without the bounds,
  // so moving the thumbs never refetches the bars.
  const priceBuckets = useSearchPriceHistogram(draft, priceTrackFor(draft.offering), {
    enabled: openStep === 'price',
  });
  if (seedKey !== queryKey) {
    setSeedKey(queryKey);
    setDraft(query);
    setWhereText(query.queryText ?? '');
    setGuestCounts(undefined);
  }

  const reset = useCallback(() => {
    setDraft(query);
    setWhereText(query.queryText ?? '');
    setGuestCounts(undefined);
  }, [query]);

  const whereSearch = useWhereSearch(setWhereText);
  const stay = isStayQuery(draft);
  const steps = stay ? STAY_STEPS : OTHER_STEPS;

  const nextStepAfter = useCallback(
    (step: SearchStep): SearchStep | null => {
      if (isWide) {
        // The bar walks its own three segments.
        if (step === 'where') return stay ? 'dates' : 'price';
        return null;
      }
      const index = steps.indexOf(step);
      return index >= 0 && index < steps.length - 1 ? steps[index + 1] : null;
    },
    [isWide, stay, steps],
  );

  // --- draft edits ---
  const handleSelectLocation = useCallback(
    (location: LocationSelection) => {
      // Committing a PLACE clears the free text: the user told us WHERE, not
      // WHAT. Copying the label into the text is how a place search turned into
      // a text search for its own name, ANDed with the geographic filter.
      setDraft((prev) => ({ ...prev, location, queryText: null }));
      setWhereText('');
      onOpenStepChange(nextStepAfter('where'));
    },
    [nextStepAfter, onOpenStepChange],
  );

  const handleSelectRecent = useCallback(
    (recent: RecentSearch) => {
      // A recent entry holds a `locationKey`, not a place — replaying a stored
      // coordinate would mean "near where you were last week". Resolving a key
      // back into a selection is the geo gateway's job (#351), so the filters
      // are replayed and the location is left for the user to pick: it asks
      // again rather than guessing.
      onOpenStepChange(null);
      onSubmit({ ...recent.filters, location: null });
    },
    [onOpenStepChange, onSubmit],
  );

  const handleTypes = useCallback((propertyTypes: PropertyType[]) => {
    setDraft((prev) => ({ ...prev, propertyTypes }));
  }, []);

  const handlePrice = useCallback((priceMin: number | undefined, priceMax: number | undefined) => {
    setDraft((prev) => ({ ...prev, priceMin, priceMax }));
  }, []);

  const handleDates = useCallback((dates: SearchDateRange | undefined) => {
    setDraft((prev) => ({ ...prev, dates }));
  }, []);

  const handleGuests = useCallback((value: GuestsValue) => {
    setDraft((prev) => ({ ...prev, guests: value.guests, petFriendly: value.petFriendly }));
  }, []);

  const handleBrowseMode = useCallback(
    (next: BrowseMode) => {
      const offering = BROWSE_MODE_OFFERING[next];
      const isShortTerm = offering === OfferingType.SHORT_TERM_RENT;
      setDraft((prev) => ({
        ...prev,
        offering,
        // The price range is per-offering (monthly vs nightly vs sale), so it
        // clears on a switch; dates and guests mean nothing outside a stay.
        priceMin: undefined,
        priceMax: undefined,
        ...(isShortTerm ? {} : { dates: undefined, guests: undefined }),
      }));
      if (!isShortTerm && (openStep === 'dates' || openStep === 'guests')) onOpenStepChange('price');
    },
    [openStep, onOpenStepChange],
  );

  const handleClear = useCallback(() => {
    setDraft((prev) => ({
      ...prev,
      location: null,
      queryText: null,
      propertyTypes: [],
      priceMin: undefined,
      priceMax: undefined,
      dates: undefined,
      guests: undefined,
      petFriendly: undefined,
    }));
    setWhereText('');
    setGuestCounts(undefined);
    onOpenStepChange('where');
  }, [onOpenStepChange]);

  const handleSubmit = useCallback(() => {
    addRecentSearch(draft, buildRecentLabel(draft, t, locale));
    onOpenStepChange(null);
    onSubmit(draft);
  }, [addRecentSearch, draft, t, locale, onOpenStepChange, onSubmit]);

  // --- labels ---
  const whereValue = draft.location ? locationDisplayLabel(draft.location, t) : undefined;
  const middleValue = stay ? datesLabel(draft, locale) : priceLabel(draft, t, locale);
  const lastValue = stay ? guestsLabel(draft, t) : typeLabel(draft, t);

  const barLabels = useMemo(
    () => ({
      where: t(STEP_LABEL_KEYS.where),
      when: t(stay ? STEP_LABEL_KEYS.dates : STEP_LABEL_KEYS.price),
      who: t(stay ? STEP_LABEL_KEYS.guests : STEP_LABEL_KEYS.type),
      destinationPlaceholder: t('search.summary.anywhere'),
      datesPlaceholder: t(stay ? 'search.summary.anyWeek' : 'search.summary.anyPrice'),
      guestsPlaceholder: t(stay ? 'search.summary.addGuests' : 'search.summary.anyType'),
      search: t('search.actions.search'),
    }),
    [stay, t],
  );

  const stepContent = (step: SearchStep, wide: boolean): React.ReactNode => {
    switch (step) {
      case 'where':
        return wide ? (
          <WhereSuggestions
            value={whereText}
            search={whereSearch}
            onSelectLocation={handleSelectLocation}
            onSelectRecent={handleSelectRecent}
            emptyHint={t('search.input.placeholder')}
          />
        ) : (
          <WhereStep
            value={whereText}
            onChangeText={setWhereText}
            onSelectLocation={handleSelectLocation}
            onSelectRecent={handleSelectRecent}
          />
        );
      case 'type':
        return <TypeStep offering={draft.offering} selected={draft.propertyTypes} onChange={handleTypes} />;
      case 'dates':
        return <DatesStep value={draft.dates} onChange={handleDates} visibleMonths={wide ? 2 : 1} />;
      case 'guests':
        return (
          <GuestsStep
            value={{ guests: draft.guests, petFriendly: draft.petFriendly }}
            onChange={handleGuests}
            counts={guestCounts}
            onCountsChange={setGuestCounts}
          />
        );
      case 'price':
        return (
          <PriceStep
            offering={draft.offering}
            priceMin={draft.priceMin}
            priceMax={draft.priceMax}
            buckets={priceBuckets}
            onChange={handlePrice}
          />
        );
      default:
        return null;
    }
  };

  // --- wide ---
  if (isWide) {
    const activeSegment = segmentFor(openStep, stay);
    const panelStep = activeSegment ? stepFor(activeSegment, stay) : null;

    const handleSegment = (segment: StaySearchSegment | null) => {
      if (segment !== null) {
        onOpenStepChange(stepFor(segment, stay));
        return;
      }
      onOpenStepChange(null);
      if (JSON.stringify(draft) !== queryKey) apply(draft);
    };

    let panel: React.ReactNode = null;
    if (panelStep) {
      const label = t(STEP_LABEL_KEYS[panelStep]);
      const content = stepContent(panelStep, true);
      switch (panelStep) {
        case 'where':
          panel = (
            <StaySearchPanel width={WHERE_PANEL_WIDTH} padding={16} accessibilityLabel={label}>
              {content}
            </StaySearchPanel>
          );
          break;
        case 'dates':
          panel = (
            <StaySearchPanel padding={24} accessibilityLabel={label}>
              {content}
            </StaySearchPanel>
          );
          break;
        case 'guests':
          panel = (
            <StaySearchPanel width={GUESTS_PANEL_WIDTH} padding={8} accessibilityLabel={label}>
              <View style={styles.guestsInset}>{content}</View>
            </StaySearchPanel>
          );
          break;
        case 'price':
          panel = (
            <StaySearchPanel width={PRICE_PANEL_WIDTH} padding={24} accessibilityLabel={label}>
              {content}
            </StaySearchPanel>
          );
          break;
        case 'type':
          panel = (
            <StaySearchPanel width={TYPE_PANEL_WIDTH} padding={24} accessibilityLabel={label}>
              {content}
            </StaySearchPanel>
          );
          break;
      }
    }

    return (
      <StaySearchBar
        activeSegment={activeSegment}
        onActiveSegmentChange={handleSegment}
        destination={whereValue}
        dates={middleValue ? { summary: middleValue } : undefined}
        guests={lastValue ?? undefined}
        datesMode="single"
        labels={barLabels}
        onSearch={handleSubmit}
        destinationQuery={whereText}
        onDestinationQueryChange={whereSearch.onChangeText}
        panel={panel}
        style={style}
      />
    );
  }

  // --- narrow ---
  const handleCloseSheet = () => {
    onOpenStepChange(null);
    reset();
  };

  const stepSummary = (step: SearchStep): string => {
    switch (step) {
      case 'where':
        return locationDisplayLabel(draft.location, t);
      case 'type':
        return typeLabel(draft, t) ?? t('search.summary.anyType');
      case 'dates':
        return datesLabel(draft, locale) ?? t('search.summary.anyWeek');
      case 'guests':
        return guestsLabel(draft, t) ?? t('search.summary.addGuests');
      case 'price':
        return priceLabel(draft, t, locale) ?? t('search.summary.anyPrice');
      default:
        return '';
    }
  };

  return (
    <>
      <StaySearchCompact
        onPress={() => onOpenStepChange('where')}
        title={locationDisplayLabel(query.location, t)}
        summary={summaryLine(query, t, locale)}
        accessibilityLabel={`${t('search.summary.edit')}: ${locationDisplayLabel(query.location, t)}, ${summaryLine(query, t, locale)}`}
        style={style}
      />
      <Dialog
        placement="bottom"
        open={openStep !== null}
        onClose={handleCloseSheet}
        label={t('search.panel.title')}
        contentPadding={0}
        scrollable={false}
        maxHeightRatio={0.95}
      >
        <View style={{ height: Math.round(windowHeight * SHEET_HEIGHT_RATIO) }}>
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleRow}>
              <H3>{t('search.panel.title')}</H3>
              <CloseButton onPress={handleCloseSheet} accessibilityLabel={t('common.close')} />
            </View>
            <SegmentedControl<BrowseMode>
              label={t('search.mode.label')}
              type="tabs"
              size="small"
              value={browseModeFromOffering(draft.offering)}
              onChange={handleBrowseMode}
            >
              {BROWSE_MODE_ORDER.map((mode) => (
                <SegmentedControlItem key={mode} value={mode}>
                  <SegmentedControlItemText>{t(BROWSE_MODE_LABELS[mode])}</SegmentedControlItemText>
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
          </View>
          <ScrollView
            style={[styles.sheetScroll, { backgroundColor: colors.backgroundSecondary }]}
            contentContainerStyle={styles.sheetScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {steps.map((step) => (
              <StaySearchStep
                key={step}
                label={t(STEP_LABEL_KEYS[step])}
                title={t(STEP_TITLE_KEYS[step])}
                summary={stepSummary(step)}
                expanded={openStep === step}
                onPress={() => onOpenStepChange(step)}
              >
                {openStep === step ? stepContent(step, false) : null}
              </StaySearchStep>
            ))}
          </ScrollView>
          <View
            style={[
              styles.sheetFooter,
              { borderTopColor: colors.border, paddingBottom: spacing.md + insets.bottom },
            ]}
          >
            <Button variant="link" onPress={handleClear} accessibilityLabel={t('search.actions.clearAll')}>
              {t('search.actions.clearAll')}
            </Button>
            <Button
              variant="primary"
              size="large"
              icon={RiSearchLine}
              onPress={handleSubmit}
              accessibilityLabel={t('search.actions.search')}
            >
              {t('search.actions.search')}
            </Button>
          </View>
        </View>
      </Dialog>
    </>
  );
}

const styles = StyleSheet.create({
  guestsInset: {
    paddingHorizontal: spacing.lg,
  },
  sheetHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  sheetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetScroll: {
    flex: 1,
  },
  sheetScrollContent: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  sheetFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

export default StaySearch;

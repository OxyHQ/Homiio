/**
 * HomeSearch — the search composer, on Bloom's `home-search` family.
 *
 * One component, two presentations chosen by width (`useIsScreenNotMobile()`):
 *
 *  - **Wide:** `HomeSearchBar` with the offering's own segments — Where · When ·
 *    Who for a stay, Where · Price · Type for every other offering — and a
 *    `StaySearchPanel` dropping under the open segment. The segment keys ARE the
 *    composer's {@link SearchStep}s, so nothing translates between a bar slot
 *    and the step it opens.
 *  - **Narrow:** the `StaySearchCompact` trigger, opening a bottom `Dialog` of
 *    `StaySearchStep` cards — one expanded at a time — over "Clear all" and
 *    "Search", with the offering switch (`SearchModeTabs`, segmented) on top.
 *
 * `modeTabs` adds the page-level switch ABOVE the composer ("explore by mode").
 * It changes the offering the SCREEN browses, through `onModeChange`; the
 * sheet's own switch only edits the unsent draft.
 *
 * The open step is CONTROLLED (`openStep`), so a screen can open the composer
 * on a given step from anywhere — "Choose a place" on an error state opens it on
 * Where.
 *
 * ## Where: the area this screen queries, stated in the first segment
 *
 * The Where segment (and, on a phone, the compact trigger's title) IS the
 * statement of the area — ADR 0002's "every where-surface states the area it
 * queries". Its panel leads with the choices that are not a typed place: "Use
 * my location" (disabled with the reason when location is off), the last area
 * chosen on this device, and "Explore everywhere", a deliberate row.
 *
 * `where` picks what the segment is bound to:
 *
 *  - **`query`** (default, Explore): the draft's own `location`. `null` is a
 *    real, location-less query and reads "Everywhere".
 *  - **`scope`** (Home): the app-wide scope (`useLocationScope`). A pick commits
 *    to the scope immediately; the segment reads "Choose an area" while nothing
 *    is chosen and "Finding where you are…" while the device answers. Searching
 *    with no area OPENS Where instead of running a global search, because
 *    "everywhere" is only ever a row somebody pressed.
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
import { HomeSearchBar, SearchModeTabs, type HomeSearchSegment } from '@oxy.so/bloom/home-search';
import { RiSearchLine } from '@oxy.so/bloom/icons';
import {
  StaySearchCompact,
  StaySearchPanel,
  StaySearchStep,
  type GuestCounts,
} from '@oxy.so/bloom/stay-search';
import { H3 } from '@oxy.so/bloom/typography';

import { OfferingType, type LocationSelection, type PropertyType } from '@homiio/shared-types';
import { useScopeWhere } from '@/components/location/useScopeWhere';
import {
  deviceOptionDescription,
  deviceOptionState,
  scopedSearchQuery,
  type DeviceOptionState,
} from '@/components/location/scopeWhere';
import { useLocationScope } from '@/hooks/useLocationScope';
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
import { WhereStep, WhereSuggestions, useWhereSearch, type WhereOptions } from './steps/WhereStep';
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

/** The four top-level browse modes, in display order, for the mode tabs. */
const BROWSE_MODE_ORDER: readonly BrowseMode[] = ['long_term', 'vacation', 'buy', 'exchange'];

/** i18n key for each browse mode in the mode tabs. */
const BROWSE_MODE_LABELS: Record<BrowseMode, string> = {
  long_term: 'search.mode.longTerm',
  vacation: 'search.mode.vacation',
  buy: 'search.mode.buy',
  exchange: 'search.mode.exchange',
};

/** Ordered steps per offering in the sheet. Only a stay has dates and guests. */
const STAY_STEPS: readonly SearchStep[] = ['where', 'dates', 'guests', 'type', 'price'];
const OTHER_STEPS: readonly SearchStep[] = ['where', 'type', 'price'];

/** The wide bar's segments, left to right. Each key is the step it opens. */
const STAY_SEGMENTS: readonly SearchStep[] = ['where', 'dates', 'guests'];
const OTHER_SEGMENTS: readonly SearchStep[] = ['where', 'price', 'type'];

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

/** What a step reads while it holds nothing: the bar's placeholder and the card's summary. */
const STEP_EMPTY_KEYS: Record<SearchStep, string> = {
  where: 'search.summary.anywhere',
  type: 'search.summary.anyType',
  dates: 'search.summary.anyWeek',
  guests: 'search.summary.addGuests',
  price: 'search.summary.anyPrice',
};

/** Relative segment widths in the wide bar: the place gets the most room. */
const SEGMENT_FLEX: Record<SearchStep, number> = {
  where: 1.5,
  type: 1.3,
  dates: 1.2,
  guests: 1.3,
  price: 1.2,
};

/** The narrow sheet's height, as a share of the window: fixed, so it never jumps between steps. */
const SHEET_HEIGHT_RATIO = 0.88;

/** Wide panel widths per segment content. */
const WHERE_PANEL_WIDTH = 440;
const PRICE_PANEL_WIDTH = 440;
const GUESTS_PANEL_WIDTH = 400;
const TYPE_PANEL_WIDTH = 440;

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

export interface HomeSearchProps {
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
  /**
   * The page-level mode switch above the composer, bound to `query.offering`.
   * `tabs` are text tabs and show only on a wide screen (a phone switches modes
   * in the sheet); `segmented` is the pill, which also reads on a photo and
   * shows at every width. Omit for none.
   */
  modeTabs?: 'tabs' | 'segmented';
  /** A mode tab was chosen: the screen switches the offering it browses. */
  onModeChange?: (mode: BrowseMode) => void;
  /**
   * What the Where segment is bound to: the draft's `location` (`query`, the
   * default) or the app-wide scope (`scope`). See the header.
   */
  where?: 'query' | 'scope';
  /**
   * `query` only: the URL asked for a place that did not resolve. With no
   * location in the draft, Where then reads "Choose an area" rather than
   * "Everywhere" — the search that failed was not a global one, and saying so
   * beside "We could not find that place" would be ADR 0002's failure in words.
   */
  locationUnresolved?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function HomeSearch({
  query,
  openStep,
  onOpenStepChange,
  onSubmit,
  onApply,
  modeTabs,
  onModeChange,
  where = 'query',
  locationUnresolved = false,
  style,
}: HomeSearchProps): React.ReactElement {
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
  const segmentSteps = stay ? STAY_SEGMENTS : OTHER_SEGMENTS;

  const nextStepAfter = useCallback(
    (step: SearchStep): SearchStep | null => {
      // The bar walks its own segments; the sheet walks every step.
      const order = isWide ? segmentSteps : steps;
      const index = order.indexOf(step);
      return index >= 0 && index < order.length - 1 ? order[index + 1] : null;
    },
    [isWide, segmentSteps, steps],
  );

  // --- where ---
  const scoped = where === 'scope';
  const scope = useLocationScope();
  const scopeWhere = useScopeWhere(scope, scoped ? scope.selection : draft.location);
  /** Explore pressed "use my location" and is waiting for the app-wide fix. */
  const [awaitingDevice, setAwaitingDevice] = useState(false);

  // --- draft edits ---
  const handleSelectLocation = useCallback(
    (location: LocationSelection) => {
      setAwaitingDevice(false);
      // Home: the pick IS the scope, committed now rather than on submit, so the
      // sections below the bar follow it and the segment never names a place
      // the page is not using.
      if (scoped) scope.choose(location);
      // Committing a PLACE clears the free text: the user told us WHERE, not
      // WHAT. Copying the label into the text is how a place search turned into
      // a text search for its own name, ANDed with the geographic filter.
      setDraft((prev) => ({ ...prev, location, queryText: null }));
      setWhereText('');
      onOpenStepChange(nextStepAfter('where'));
    },
    [scoped, scope, nextStepAfter, onOpenStepChange],
  );

  // Explore's "use my location": the fix is taken by the app-wide scope and
  // lands in the draft once it is there — adjusted during render, like the
  // seed above, rather than in an effect. Any other pick clears the wait, so a
  // late fix cannot replace a place chosen after the press.
  const deviceFix = scope.source === 'device' ? scope.selection : null;
  const deviceIssue = scope.deviceIssue;
  if (awaitingDevice) {
    if (deviceFix) {
      setAwaitingDevice(false);
      setDraft((prev) => ({ ...prev, location: deviceFix, queryText: null }));
      setWhereText('');
    } else if (deviceIssue !== null && scope.resolution.status !== 'resolving') {
      setAwaitingDevice(false);
    }
  }

  const whereOptions = useMemo<WhereOptions>(() => {
    if (scoped) {
      return {
        device: {
          ...scopeWhere.device,
          onPress: () => {
            scope.useCurrentLocation();
            onOpenStepChange(nextStepAfter('where'));
          },
        },
        lastArea: scopeWhere.lastArea,
        onEverywhere: scope.isGlobal
          ? undefined
          : () => {
              scope.exploreGlobal();
              setDraft((prev) => ({ ...prev, location: null }));
              onOpenStepChange(nextStepAfter('where'));
            },
      };
    }
    // Explore: the draft's own location. A fix the app already holds is a ready
    // row; otherwise the row asks the app-wide scope for one.
    const state: DeviceOptionState =
      !scopeWhere.geolocationSupported || draft.location?.kind === 'current_location'
        ? 'hidden'
        : deviceFix
          ? 'ready'
          : awaitingDevice && deviceIssue === null
            ? 'locating'
            : deviceOptionState({
                source: null,
                resolution: scope.resolution,
                deviceIssue,
                geolocationSupported: true,
              });
    return {
      device: {
        state,
        description: deviceOptionDescription(state, t, scopeWhere.radius),
        onPress: () => {
          if (deviceFix) {
            handleSelectLocation(deviceFix);
            return;
          }
          setAwaitingDevice(true);
          scope.useCurrentLocation();
        },
      },
      lastArea: scopeWhere.lastArea,
      onEverywhere:
        draft.location === null && !locationUnresolved
          ? undefined
          : () => {
              setDraft((prev) => ({ ...prev, location: null }));
              setWhereText('');
              onOpenStepChange(nextStepAfter('where'));
            },
    };
  }, [
    scoped,
    scope,
    scopeWhere,
    draft.location,
    locationUnresolved,
    deviceFix,
    deviceIssue,
    awaitingDevice,
    t,
    handleSelectLocation,
    nextStepAfter,
    onOpenStepChange,
  ]);

  /**
   * What a submit runs: on Home the location is the scope, never the draft's —
   * and `null` while no area is chosen, when a search would be a global one
   * nobody asked for.
   */
  const committed = useCallback(
    (next: SearchQuery): SearchQuery | null => (scoped ? scopedSearchQuery(next, scope) : next),
    [scoped, scope],
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

  const handlePageMode = useCallback(
    (mode: BrowseMode) => {
      // The offering changes under the composer, and with it the segments: a
      // panel open on a segment the new mode does not have would be orphaned.
      onOpenStepChange(null);
      onModeChange?.(mode);
    },
    [onModeChange, onOpenStepChange],
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
    const next = committed(draft);
    if (!next) {
      // Ask, rather than run the world under a bar that says "Choose an area".
      onOpenStepChange('where');
      return;
    }
    addRecentSearch(next, buildRecentLabel(next, t, locale));
    onOpenStepChange(null);
    onSubmit(next);
  }, [committed, addRecentSearch, draft, t, locale, onOpenStepChange, onSubmit]);

  /** The Where value: the scope's statement, or the draft's own place. */
  const whereValue = (location: LocationSelection | null): string | null =>
    scoped
      ? scopeWhere.statement.value
      : location
        ? locationDisplayLabel(location, t)
        : locationUnresolved
          ? null
          : t('location.scope.everywhere');
  const wherePlaceholder = scoped
    ? scopeWhere.statement.placeholder
    : locationUnresolved
      ? t('location.scope.chooseArea')
      : t(STEP_EMPTY_KEYS.where);

  // --- labels ---
  /** A step's value in the draft, or `null` while it holds nothing. */
  const stepValue = (step: SearchStep): string | null => {
    switch (step) {
      case 'where':
        return whereValue(draft.location);
      case 'type':
        return typeLabel(draft, t);
      case 'dates':
        return datesLabel(draft, locale);
      case 'guests':
        return guestsLabel(draft, t);
      case 'price':
        return priceLabel(draft, t, locale);
      default:
        return null;
    }
  };

  const modeLabels = useMemo(
    () => ({
      long_term: t(BROWSE_MODE_LABELS.long_term),
      vacation: t(BROWSE_MODE_LABELS.vacation),
      buy: t(BROWSE_MODE_LABELS.buy),
      exchange: t(BROWSE_MODE_LABELS.exchange),
    }),
    [t],
  );

  const renderModeTabs = (
    value: BrowseMode,
    onValueChange: (mode: BrowseMode) => void,
    variant: 'tabs' | 'segmented',
    tabsStyle?: StyleProp<ViewStyle>,
  ): React.ReactElement => (
    <SearchModeTabs<BrowseMode>
      value={value}
      onValueChange={onValueChange}
      modes={BROWSE_MODE_ORDER}
      labels={modeLabels}
      variant={variant}
      accessibilityLabel={t('search.mode.label')}
      style={tabsStyle}
    />
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
            options={whereOptions}
          />
        ) : (
          <WhereStep
            value={whereText}
            onChangeText={setWhereText}
            onSelectLocation={handleSelectLocation}
            onSelectRecent={handleSelectRecent}
            options={whereOptions}
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

  const pageMode = browseModeFromOffering(query.offering);

  // --- wide ---
  if (isWide) {
    const activeSegment = openStep !== null && segmentSteps.includes(openStep) ? openStep : null;
    const segments: HomeSearchSegment<SearchStep>[] = segmentSteps.map((step) => ({
      key: step,
      label: t(STEP_LABEL_KEYS[step]),
      value: stepValue(step) ?? undefined,
      placeholder: step === 'where' ? wherePlaceholder : t(STEP_EMPTY_KEYS[step]),
      flex: SEGMENT_FLEX[step],
    }));

    const handleSegment = (segment: SearchStep | null) => {
      if (segment !== null) {
        onOpenStepChange(segment);
        return;
      }
      onOpenStepChange(null);
      const next = committed(draft);
      if (next && JSON.stringify(draft) !== queryKey) apply(next);
    };

    let panel: React.ReactNode = null;
    if (activeSegment) {
      const label = t(STEP_LABEL_KEYS[activeSegment]);
      const content = stepContent(activeSegment, true);
      switch (activeSegment) {
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
            <StaySearchPanel width={TYPE_PANEL_WIDTH} padding={20} accessibilityLabel={label}>
              {content}
            </StaySearchPanel>
          );
          break;
      }
    }

    const bar = (
      <HomeSearchBar<SearchStep>
        segments={segments}
        activeSegment={activeSegment}
        onActiveSegmentChange={handleSegment}
        onSearch={handleSubmit}
        searchLabel={t('search.actions.search')}
        query={whereText}
        onQueryChange={whereSearch.onChangeText}
        panel={panel}
        style={modeTabs ? styles.fill : style}
      />
    );

    if (!modeTabs) return bar;
    return (
      <View style={[styles.withTabs, style]}>
        {renderModeTabs(
          pageMode,
          handlePageMode,
          modeTabs,
          modeTabs === 'segmented' ? styles.segmentedTabs : styles.textTabs,
        )}
        {bar}
      </View>
    );
  }

  // --- narrow ---
  const handleCloseSheet = () => {
    onOpenStepChange(null);
    reset();
  };

  const compactTitle = whereValue(query.location) ?? wherePlaceholder;
  const compact = (
    <StaySearchCompact
      onPress={() => onOpenStepChange('where')}
      title={compactTitle}
      summary={summaryLine(query, t, locale)}
      accessibilityLabel={`${t('search.summary.edit')}: ${compactTitle}, ${summaryLine(query, t, locale)}`}
      style={modeTabs === 'segmented' ? undefined : style}
    />
  );

  return (
    <>
      {modeTabs === 'segmented' ? (
        <View style={[styles.withTabs, style]}>
          {renderModeTabs(pageMode, handlePageMode, 'segmented')}
          {compact}
        </View>
      ) : (
        compact
      )}
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
            {renderModeTabs(browseModeFromOffering(draft.offering), handleBrowseMode, 'segmented')}
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
                summary={step === 'where' ? (whereValue(draft.location) ?? wherePlaceholder) : (stepValue(step) ?? t(STEP_EMPTY_KEYS[step]))}
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
  withTabs: {
    gap: spacing.md,
  },
  fill: {
    width: '100%',
  },
  textTabs: {
    alignSelf: 'center',
  },
  // The pill stretches to its container; past a phone's width that is a very
  // long pill, so it stops at a readable width and centres.
  segmentedTabs: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
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

export default HomeSearch;

/**
 * SearchFiltersDialog — the ONE filters surface for a listing search, on Bloom's
 * `stay-filters` parts inside a Bloom `Dialog` (a centred 780-wide card from
 * `md`, a bottom sheet below it).
 *
 * ## Only filters that filter
 *
 * Every section maps onto a {@link SearchQuery} field that `usePropertySearch`
 * sends and the search endpoint applies: type, price (in the offering's own
 * unit), minimum bedrooms and bathrooms, guests (stays), amenities (all must
 * match), and the fair-price, instant-book (stays) and pet-friendly flags. A
 * control with no field behind it is a filter that silently does not filter —
 * the reason move-in, lease duration, deposit, furnished and cancellation were
 * removed from this sheet — so none is offered here.
 *
 * ## A draft, applied once
 *
 * The dialog edits a local draft and reports it through `onApply` when "Show …"
 * is pressed. The label on that button is the draft's own result count: the
 * same `usePropertySearch` the results screen runs, keyed by the draft, so the
 * number is the answer the screen will show — and applying reuses that page
 * from the cache instead of fetching it again. Dragging the price slider only
 * moves the thumbs; the count follows when the drag ends.
 *
 * The bars over the price slider come from `useSearchPriceHistogram`: the same
 * scope and draft filters, without the price bounds, so releasing a thumb
 * refetches the count and not the bars.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Dialog } from '@oxy.so/bloom/dialog';
import {
  AmenityFilter,
  AreaRangeFilter,
  AvailabilityFilter,
  CountFilter,
  FilterFooter,
  FloorFilter,
  FilterSection,
  PriceRangeFilter,
  SwitchFilterRow,
  type FilterIconComponent,
  type ToggleChipOption,
} from '@oxy.so/bloom/stay-filters';
import { StepperRow } from '@oxy.so/bloom/stepper';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { formatArea, OfferingType, type PropertyType } from '@homiio/shared-types';
import { getAmenityById } from '@/constants/amenities';
import { usePropertySearch } from '@/hooks/usePropertySearch';
import { useFormatting } from '@/utils/format';
import { useSearchPriceHistogram } from '@/hooks/useSearchPriceHistogram';
import type { SearchFilterPatch } from '@/store/searchQueryStore';
import { spacing } from '@/constants/styles';

import {
  PriceCurrencyChoice,
  PriceHistogramNote,
  priceBounds,
  priceRangeValue,
  priceTrackFor,
  priceUnitKey,
  usePriceFormatter,
} from './steps/PriceStep';
import { TypeStep } from './steps/TypeStep';
import type { SearchQuery } from './types';

/**
 * Amenity slugs offered, in the canonical vocabulary listings are stored with
 * (`listing-providers/src/parse/amenities.ts`). The catalog resolves each to its
 * label and glyph through its aliases (`parking` → `parking_space`).
 */
const AMENITY_SLUGS = [
  'wifi',
  'air_conditioning',
  'heating',
  'washing_machine',
  'dishwasher',
  'elevator',
  'balcony',
  'terrace',
  'parking',
  'pool',
  'garden',
  'gym',
] as const;

/** The highest count pill: "5+" bedrooms, "4+" bathrooms. */
const MAX_BEDROOMS = 5;
const MAX_BATHROOMS = 4;
const MAX_GUESTS = 16;

/**
 * The area track, in SQUARE METRES.
 *
 * 500 m² is the ceiling Bloom's own buy template uses and comfortably past the
 * top of a residential distribution; the step is 5 because a metre of
 * granularity on a slider is noise nobody can aim at.
 */
const AREA_MAX_SQM = 500;
const AREA_STEP_SQM = 5;

/**
 * A `Date` as the civil day the URL and the API carry.
 *
 * `toISOString().slice(0, 10)` reads the date in UTC, and that is the point
 * rather than a bug to work around: the value is a DAY somebody picked in a
 * calendar, not an instant, and anchoring it to UTC is what makes the same
 * shared link answer the same way from any timezone. The backend parses it the
 * same way — see `searchQueryBuilder.ts#parseDateParam`.
 */
function toCivilDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A civil day back into a `Date` for the picker, or null. */
function fromCivilDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/**
 * The floor chips Homiio can actually answer.
 *
 * `ground` resolves to `floor = 0` over the listings that publish their floor;
 * `elevator` to `has_elevator`. Bloom's default set also offers `middle` and
 * `top`, which need the building's floor count — a column that does not exist,
 * so those two are not offered rather than drawn over nothing.
 */
type FloorChip = 'ground' | 'elevator';
// The `label` here is never rendered — `FloorFilter`'s `labels` prop overrides
// every one of them with a translated string. It is present because Bloom's
// option type requires it, and it is the English so a reader of this file can
// see which chip is which without opening the locale.
const FLOOR_CHIPS: Array<{ value: FloorChip; label: string }> = [
  { value: 'ground', label: 'Ground floor' },
  { value: 'elevator', label: 'With a lift' },
];

/** The fields this dialog edits, and nothing else. */
type FilterDraft = Pick<
  SearchQuery,
  | 'propertyTypes'
  | 'priceMin'
  | 'priceMax'
  | 'priceCurrency'
  | 'bedrooms'
  | 'bathrooms'
  | 'sizeMin'
  | 'sizeMax'
  | 'groundFloor'
  | 'hasElevator'
  | 'availableNow'
  | 'availableBy'
  | 'guests'
  | 'amenities'
  | 'fairPrice'
  | 'instantBook'
  | 'petFriendly'
>;

function draftOf(query: SearchQuery): FilterDraft {
  return {
    propertyTypes: query.propertyTypes,
    priceMin: query.priceMin,
    priceMax: query.priceMax,
    priceCurrency: query.priceCurrency,
    bedrooms: query.bedrooms,
    bathrooms: query.bathrooms,
    sizeMin: query.sizeMin,
    sizeMax: query.sizeMax,
    groundFloor: query.groundFloor,
    hasElevator: query.hasElevator,
    availableNow: query.availableNow,
    availableBy: query.availableBy,
    guests: query.guests,
    amenities: query.amenities,
    fairPrice: query.fairPrice,
    instantBook: query.instantBook,
    petFriendly: query.petFriendly,
  };
}

const EMPTY_DRAFT: FilterDraft = {
  propertyTypes: [],
  priceMin: undefined,
  priceMax: undefined,
  priceCurrency: undefined,
  bedrooms: undefined,
  bathrooms: undefined,
  sizeMin: undefined,
  sizeMax: undefined,
  groundFloor: undefined,
  hasElevator: undefined,
  availableNow: undefined,
  availableBy: undefined,
  guests: undefined,
  amenities: [],
  fairPrice: undefined,
  instantBook: undefined,
  petFriendly: undefined,
};

export interface ActiveFilterCountOptions {
  /** Count the property types too (off where a category bar or the route owns the type). */
  includeTypes?: boolean;
}

/**
 * The applied refinements this dialog edits, for the trigger's badge. The
 * location, sort, map bounds and the offering are stated elsewhere and do not
 * count.
 */
export function countActiveFilters(
  query: SearchQuery,
  { includeTypes = true }: ActiveFilterCountOptions = {},
): number {
  let count = includeTypes ? query.propertyTypes.length : 0;
  if (query.priceMin !== undefined || query.priceMax !== undefined) count += 1;
  if (query.bedrooms !== undefined) count += 1;
  if (query.bathrooms !== undefined) count += 1;
  // ONE refinement, like the price range: a person who set both ends of the
  // area did not apply two filters, and a badge reading "2" for one control is
  // a number nobody can reconcile with the screen.
  if (query.sizeMin !== undefined || query.sizeMax !== undefined) count += 1;
  // Likewise one: the switch and the date are two spellings of the same
  // question, and only one of them is ever in force.
  if (query.availableNow === true || query.availableBy !== undefined) count += 1;
  // Two chips, counted separately: they are two independent questions in one
  // control, and somebody who picked both did narrow twice.
  if (query.groundFloor === true) count += 1;
  if (query.hasElevator === true) count += 1;
  count += query.amenities.length;
  if (query.fairPrice === true) count += 1;
  if (query.instantBook === true) count += 1;
  if (query.petFriendly === true) count += 1;
  return count;
}

export interface SearchFiltersDialogProps {
  open: boolean;
  onClose: () => void;
  /** The applied query: seeds the draft, and supplies the scope the count runs in. */
  query: SearchQuery;
  onApply: (patch: SearchFilterPatch) => void;
  /** Offer the "Type of place" section. Off where the type is owned elsewhere. */
  showTypes?: boolean;
}

export function SearchFiltersDialog({
  open,
  onClose,
  query,
  onApply,
  showTypes = true,
}: SearchFiltersDialogProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      label={t('search.actions.filters')}
      header={{ title: t('search.actions.filters'), largeTitle: false }}
      placement={{ base: 'bottom', md: 'center' }}
      maxWidth={780}
      scrollable={false}
      contentPadding={0}
    >
      {/* Mounted only while open, so every opening re-seeds from the applied query. */}
      {open ? (
        <FiltersBody query={query} onApply={onApply} onClose={onClose} showTypes={showTypes} />
      ) : null}
    </Dialog>
  );
}

interface FiltersBodyProps {
  query: SearchQuery;
  onApply: (patch: SearchFilterPatch) => void;
  onClose: () => void;
  showTypes: boolean;
}

function FiltersBody({ query, onApply, onClose, showTypes }: FiltersBodyProps): React.ReactElement {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<FilterDraft>(() => draftOf(query));
  const isStay = query.offering === OfferingType.SHORT_TERM_RENT;
  /**
   * Whether "when can I move in?" is a question this offering answers.
   *
   * A stay is booked for a RANGE, which the dates step owns; a sale completes
   * rather than becoming available. Offering the row for either would be a
   * control whose answer means something else — which is worse than not having
   * it, because it looks like it worked.
   */
  const showAvailability =
    query.offering === OfferingType.LONG_TERM_RENT || query.offering === OfferingType.EXCHANGE;
  const availableByDate = useMemo(() => fromCivilDate(draft.availableBy), [draft.availableBy]);

  const track = priceTrackFor(query.offering);
  const unitKey = priceUnitKey(query.offering);
  // The thumbs follow the drag; the draft (and the count) follow the release.
  const [priceUi, setPriceUi] = useState<[number, number]>(() =>
    priceRangeValue(query.priceMin, query.priceMax, track),
  );

  // Derived rather than held: the chips ARE the two booleans, and a second
  // copy of that state is the one that drifts when a draft is cleared.
  const floorChips = useMemo<FloorChip[]>(
    () => [
      ...(draft.groundFloor ? (['ground'] as const) : []),
      ...(draft.hasElevator ? (['elevator'] as const) : []),
    ],
    [draft.groundFloor, draft.hasElevator],
  );

  const patch = useCallback((next: Partial<FilterDraft>) => {
    setDraft((prev) => ({ ...prev, ...next }));
  }, []);

  const handleClear = () => {
    setDraft(showTypes ? EMPTY_DRAFT : { ...EMPTY_DRAFT, propertyTypes: draft.propertyTypes });
    setPriceUi(priceRangeValue(undefined, undefined, track));
  };

  const handleApply = useCallback(() => {
    onApply(draft);
    onClose();
  }, [draft, onApply, onClose]);

  // The draft's own answer, from the endpoint the results screen reads.
  const draftQuery = useMemo<SearchQuery>(() => ({ ...query, ...draft }), [query, draft]);
  const preview = usePropertySearch(draftQuery);
  const previewTotal = preview.data?.pages[0]?.total;
  const priceHistogram = useSearchPriceHistogram(draftQuery, track);
  // The thumbs and the bars are read together, so they are labelled in the same
  // currency — the scope's, once its distribution has come back.
  const formatting = useFormatting();
  const formatPrice = usePriceFormatter(track, priceHistogram?.currency);

  // Declared after the histogram because it READS it: the range the user sets
  // is committed in the currency the bars they set it against were counted in.
  const commitPrice = (range: [number, number]) => {
    setPriceUi(range);
    patch(priceBounds(range, track, priceHistogram?.currency));
  };
  /**
   * The area, formatted the way every other surface formats one.
   *
   * `formatArea(..., 'sqm', ...)` with the locale's own unit labels — the same
   * call `PropertyCard` and `RoomList` make, so a filter and a card never
   * disagree about what "78 m²" looks like, and a locale that prefers square
   * feet converts here rather than in a slider.
   */
  const formatAreaValue = useCallback(
    (value: number): string =>
      formatArea(value, 'sqm', formatting.locale, { labels: formatting.areaUnitLabels }),
    [formatting.locale, formatting.areaUnitLabels],
  );
  const resultsLabel =
    typeof previewTotal === 'number'
      ? t('search.filters.showResults', { count: previewTotal })
      : t('search.filters.show');

  const amenityOptions = useMemo<ToggleChipOption[]>(
    () =>
      AMENITY_SLUGS.map((slug) => {
        const amenity = getAmenityById(slug);
        return {
          value: slug,
          label: amenity?.nameKey ? t(amenity.nameKey) : slug,
          // The catalog types its glyphs as Button icons; they are the same Bloom
          // SVG components the filter chips draw.
          icon: amenity?.icon as FilterIconComponent | undefined,
        };
      }),
    [t],
  );

  const clearDisabled =
    countActiveFilters({ ...query, ...draft }, { includeTypes: showTypes }) === 0 &&
    draft.guests === undefined;

  return (
    <>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {showTypes ? (
          <FilterSection title={t('search.filters.propertyType')}>
            <TypeStep
              offering={query.offering}
              selected={draft.propertyTypes}
              onChange={(propertyTypes: PropertyType[]) => patch({ propertyTypes })}
            />
          </FilterSection>
        ) : null}

        <FilterSection
          title={t('search.step.price.title')}
          description={unitKey ? t(unitKey) : undefined}
        >
          <PriceRangeFilter
            buckets={priceHistogram?.counts}
            min={0}
            max={track.max}
            step={track.step}
            value={priceUi}
            onValueChange={setPriceUi}
            onValueCommit={commitPrice}
            formatPrice={formatPrice}
            minLabel={t('search.step.price.min')}
            maxLabel={t('search.step.price.max')}
            accessibilityLabel={t('search.step.price.title')}
          />
          <PriceCurrencyChoice
            histogram={priceHistogram}
            // The bound is re-read in the chosen unit, never converted. The
            // slider does not move: "up to 1,200" becomes "up to 1,200 złoty".
            onChange={(priceCurrency) => patch({ priceCurrency })}
          />
          <PriceHistogramNote histogram={priceHistogram} />
        </FilterSection>

        {/* Two chips, not Bloom's four.
            Bloom's default set is Ground / Middle / Top / With elevator, and
            Homiio can answer exactly half of it: there is no column for how
            many floors a building has, so "top" and "middle" have nothing to
            resolve against and would be chips drawn over nothing.
            "Ground" is only meaningful because `properties.floor` stopped being
            `NOT NULL DEFAULT 0` — before that, every listing whose floor nobody
            stated claimed the ground floor. */}
        <FilterSection title={t('search.filters.floor')}>
          <FloorFilter<FloorChip>
            options={FLOOR_CHIPS}
            labels={{
              ground: t('search.filters.floorGround'),
              elevator: t('search.filters.floorElevator'),
            }}
            value={floorChips}
            onValueChange={(next) =>
              patch({
                groundFloor: next.includes('ground') ? true : undefined,
                hasElevator: next.includes('elevator') ? true : undefined,
              })
            }
            accessibilityLabel={t('search.filters.floor')}
          />
          {/* The honest footnote: the filter reaches only the listings whose
              owner chose to publish their floor, because the floor is part of
              the address. Without it an empty result reads as "no ground-floor
              flats here" rather than "most listings here do not say". */}
          {draft.groundFloor ? (
            <BloomText style={styles.floorNote}>{t('search.filters.floorPublishedOnly')}</BloomText>
          ) : null}
        </FilterSection>

        <FilterSection title={t('search.filters.rooms')}>
          <CountFilter
            title={t('properties.filters.bedrooms')}
            value={draft.bedrooms ?? null}
            onValueChange={(bedrooms) => patch({ bedrooms: bedrooms ?? undefined })}
            max={MAX_BEDROOMS}
            anyLabel={t('search.step.price.any')}
            style={styles.countRow}
          />
          <CountFilter
            title={t('properties.filters.bathrooms')}
            value={draft.bathrooms ?? null}
            onValueChange={(bathrooms) => patch({ bathrooms: bathrooms ?? undefined })}
            max={MAX_BATHROOMS}
            anyLabel={t('search.step.price.any')}
          />
          {isStay ? (
            <StepperRow
              title={t('search.filters.guests')}
              value={draft.guests ?? 0}
              onValueChange={(guests) => patch({ guests: guests > 0 ? guests : undefined })}
              min={0}
              max={MAX_GUESTS}
              decrementLabel={t('search.actions.decreaseGuests')}
              incrementLabel={t('search.actions.increaseGuests')}
              style={styles.guestsRow}
            />
          ) : null}
        </FilterSection>

        {/* Floor area, in SQUARE METRES.

            The column behind it is named `square_footage` and holds metres — a
            legacy misnomer — and a listing nobody measured is stored as `0`.
            The SERVER excludes those from a maximum rather than matching them,
            so "up to 120 m²" does not quietly return the whole catalogue; see
            `db/properties/propertyFilters.ts#areaInRange`. */}
        <FilterSection title={t('search.filters.area')}>
          <AreaRangeFilter
            min={0}
            max={AREA_MAX_SQM}
            step={AREA_STEP_SQM}
            value={[draft.sizeMin ?? null, draft.sizeMax ?? null]}
            onValueCommit={([sizeMin, sizeMax]) =>
              patch({ sizeMin: sizeMin ?? undefined, sizeMax: sizeMax ?? undefined })
            }
            onValueChange={([sizeMin, sizeMax]) =>
              patch({ sizeMin: sizeMin ?? undefined, sizeMax: sizeMax ?? undefined })
            }
            formatArea={formatAreaValue}
            minLabel={t('search.step.price.min')}
            maxLabel={t('search.step.price.max')}
            accessibilityLabel={t('search.filters.area')}
          />
        </FilterSection>

        {/* Availability. Only for offerings where "move in" is the question a
            date answers: a stay is booked for a RANGE (the dates step owns
            that) and a sale completes rather than becoming available, so
            offering the row there would be a control whose answer means
            something else. */}
        {showAvailability ? (
          <FilterSection title={t('search.filters.availability')}>
            <AvailabilityFilter
              availableNow={draft.availableNow === true}
              onAvailableNowChange={(on) => patch({ availableNow: on ? true : undefined })}
              date={availableByDate}
              onDateChange={(date) =>
                patch({ availableBy: date ? toCivilDate(date) : undefined })
              }
              availableNowLabel={t('search.filters.availableNow')}
              availableNowDescription={t('search.filters.availableNowHint')}
              dateLabel={t('search.filters.availableFrom')}
              datePlaceholder={t('search.step.price.any')}
              minDate={new Date()}
              locale={formatting.locale}
            />
          </FilterSection>
        ) : null}

        <FilterSection title={t('search.filters.amenities')}>
          <AmenityFilter
            options={amenityOptions}
            value={draft.amenities}
            onValueChange={(amenities) => patch({ amenities })}
            accessibilityLabel={t('search.filters.amenities')}
            showMoreLabel={t('search.filters.showMore')}
            showLessLabel={t('search.filters.showLess')}
          />
        </FilterSection>

        <FilterSection title={t('search.filters.options')} divider={false}>
          <SwitchFilterRow
            title={t('search.filters.fairPrice')}
            value={draft.fairPrice === true}
            onValueChange={(on) => patch({ fairPrice: on ? true : undefined })}
          />
          <SwitchFilterRow
            title={t('home.category.petFriendly')}
            value={draft.petFriendly === true}
            onValueChange={(on) => patch({ petFriendly: on ? true : undefined })}
          />
          {isStay ? (
            <SwitchFilterRow
              title={t('search.filters.instantBook')}
              value={draft.instantBook === true}
              onValueChange={(on) => patch({ instantBook: on ? true : undefined })}
            />
          ) : null}
        </FilterSection>
      </ScrollView>
      <FilterFooter
        resultsLabel={resultsLabel}
        loading={preview.isFetching && previewTotal === undefined}
        onApply={handleApply}
        onClear={handleClear}
        clearLabel={t('search.actions.clearAll')}
        clearDisabled={clearDisabled}
        style={{ paddingBottom: spacing.md + insets.bottom }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexShrink: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
  },
  floorNote: {
    fontSize: 12,
    opacity: 0.7,
  },
  countRow: {
    marginBottom: spacing.xl,
  },
  guestsRow: {
    marginTop: spacing.xl,
  },
});

export default SearchFiltersDialog;

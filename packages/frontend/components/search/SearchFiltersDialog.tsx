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
  CountFilter,
  FilterFooter,
  FilterSection,
  PriceRangeFilter,
  SwitchFilterRow,
  type FilterIconComponent,
  type ToggleChipOption,
} from '@oxy.so/bloom/stay-filters';
import { StepperRow } from '@oxy.so/bloom/stepper';

import { OfferingType, type PropertyType } from '@homiio/shared-types';
import { getAmenityById } from '@/constants/amenities';
import { usePropertySearch } from '@/hooks/usePropertySearch';
import { useSearchPriceHistogram } from '@/hooks/useSearchPriceHistogram';
import type { SearchFilterPatch } from '@/store/searchQueryStore';
import { spacing } from '@/constants/styles';

import {
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

/** The fields this dialog edits, and nothing else. */
type FilterDraft = Pick<
  SearchQuery,
  | 'propertyTypes'
  | 'priceMin'
  | 'priceMax'
  | 'bedrooms'
  | 'bathrooms'
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
    bedrooms: query.bedrooms,
    bathrooms: query.bathrooms,
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
  bedrooms: undefined,
  bathrooms: undefined,
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

  const track = priceTrackFor(query.offering);
  const formatPrice = usePriceFormatter(track);
  const unitKey = priceUnitKey(query.offering);
  // The thumbs follow the drag; the draft (and the count) follow the release.
  const [priceUi, setPriceUi] = useState<[number, number]>(() =>
    priceRangeValue(query.priceMin, query.priceMax, track),
  );

  const patch = useCallback((next: Partial<FilterDraft>) => {
    setDraft((prev) => ({ ...prev, ...next }));
  }, []);

  const commitPrice = (range: [number, number]) => {
    setPriceUi(range);
    patch(priceBounds(range, track));
  };

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
  const priceBuckets = useSearchPriceHistogram(draftQuery, track);
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
            buckets={priceBuckets}
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
  countRow: {
    marginBottom: spacing.xl,
  },
  guestsRow: {
    marginTop: spacing.xl,
  },
});

export default SearchFiltersDialog;

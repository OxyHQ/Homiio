/**
 * The Filters / Sort row above a city's listings, and the filters dialog it
 * opens — on Bloom's `stay-filters` parts.
 *
 * The city feed has its own filter model (`useInfiniteCityProperties`), so this
 * is not the search `SearchFiltersDialog`: it offers exactly the four filters
 * that feed applies — verified, eco-friendly, minimum bedrooms and bathrooms —
 * and nothing it would ignore.
 */
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxy.so/bloom/button';
import { Dialog } from '@oxy.so/bloom/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@oxy.so/bloom/dropdown-menu';
import { RiExpandUpDownLine } from '@oxy.so/bloom/icons';
import {
  CountFilter,
  FilterFooter,
  FilterSection,
  FilterTriggerButton,
  SwitchFilterRow,
} from '@oxy.so/bloom/stay-filters';

import type { CitySortBy } from '@/hooks/useInfiniteCityProperties';
import { spacing } from '@/constants/styles';

/** The filters the city feed applies. Counts are minimums; `undefined` is any. */
export interface CityFilterValues {
  verified: boolean;
  ecoFriendly: boolean;
  bedrooms?: number;
  bathrooms?: number;
}

export const EMPTY_CITY_FILTERS: CityFilterValues = {
  verified: false,
  ecoFriendly: false,
  bedrooms: undefined,
  bathrooms: undefined,
};

/** How many of the filters are applied, for the trigger's badge. */
export function countCityFilters(values: CityFilterValues): number {
  return (
    (values.verified ? 1 : 0) +
    (values.ecoFriendly ? 1 : 0) +
    (values.bedrooms !== undefined ? 1 : 0) +
    (values.bathrooms !== undefined ? 1 : 0)
  );
}

/** i18n key for each city-page sort order. */
const SORT_LABEL_KEYS: Record<CitySortBy, string> = {
  newest: 'properties.city.sortNewest',
  priceAsc: 'properties.city.sortPriceAsc',
  priceDesc: 'properties.city.sortPriceDesc',
};
const SORT_ORDER: readonly CitySortBy[] = ['newest', 'priceAsc', 'priceDesc'];

const MAX_BEDROOMS = 4;
const MAX_BATHROOMS = 3;

interface FiltersBarProps {
  filters: CityFilterValues;
  onApplyFilters: (filters: CityFilterValues) => void;
  sortBy: CitySortBy;
  onSortChange: (sortBy: CitySortBy) => void;
}

/** The Filters trigger and Sort menu above a city's listings. */
export function FiltersBar({ filters, onApplyFilters, sortBy, onSortChange }: FiltersBarProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const count = countCityFilters(filters);
  const sortWord = t('properties.city.sortBy');
  const sortLabel = t(SORT_LABEL_KEYS[sortBy] ?? SORT_LABEL_KEYS.newest);

  return (
    <View style={styles.container}>
      <FilterTriggerButton
        count={count}
        onPress={() => setOpen(true)}
        label={t('search.actions.filters')}
        accessibilityLabel={count > 0 ? `${t('search.actions.filters')}, ${count}` : t('search.actions.filters')}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild label={`${sortWord}: ${sortLabel}`}>
          <Button
            variant="outline"
            size="medium"
            icon={RiExpandUpDownLine}
            accessibilityLabel={`${sortWord}: ${sortLabel}`}
          >
            {sortLabel}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" label={sortWord}>
          <DropdownMenuLabel>{sortWord}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={sortBy}
            onValueChange={(value) => onSortChange(value as CitySortBy)}
          >
            {SORT_ORDER.map((key) => (
              <DropdownMenuRadioItem key={key} value={key}>
                {t(SORT_LABEL_KEYS[key])}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        label={t('search.actions.filters')}
        header={{ title: t('search.actions.filters'), largeTitle: false }}
        placement={{ base: 'bottom', md: 'center' }}
        maxWidth={560}
        scrollable={false}
        contentPadding={0}
      >
        {open ? (
          <CityFiltersBody filters={filters} onApply={onApplyFilters} onClose={() => setOpen(false)} />
        ) : null}
      </Dialog>
    </View>
  );
}

interface CityFiltersBodyProps {
  filters: CityFilterValues;
  onApply: (filters: CityFilterValues) => void;
  onClose: () => void;
}

function CityFiltersBody({ filters, onApply, onClose }: CityFiltersBodyProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<CityFilterValues>(filters);
  const patch = useCallback(
    (next: Partial<CityFilterValues>) => setDraft((prev) => ({ ...prev, ...next })),
    [],
  );

  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
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
        </FilterSection>
        <FilterSection title={t('search.filters.options')} divider={false}>
          <SwitchFilterRow
            title={t('properties.city.verifiedOnly')}
            value={draft.verified}
            onValueChange={(verified) => patch({ verified })}
          />
          <SwitchFilterRow
            title={t('properties.city.ecoFriendlyOnly')}
            value={draft.ecoFriendly}
            onValueChange={(ecoFriendly) => patch({ ecoFriendly })}
          />
        </FilterSection>
      </ScrollView>
      <FilterFooter
        resultsLabel={t('properties.filters.apply')}
        onApply={() => {
          onApply(draft);
          onClose();
        }}
        onClear={() => setDraft(EMPTY_CITY_FILTERS)}
        clearLabel={t('search.actions.clearAll')}
        clearDisabled={countCityFilters(draft) === 0}
        style={{ paddingBottom: spacing.md + insets.bottom }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  scroll: {
    flexShrink: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
  },
  countRow: {
    marginBottom: spacing.xl,
  },
});

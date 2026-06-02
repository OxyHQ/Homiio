/**
 * QuickFiltersWidget — one-tap structured filters for the search rail.
 *
 * Each chip maps to a REAL field on the active {@link SearchQuery} (never a
 * free-text keyword): the selection is merged into a single structured patch and
 * applied through the active-search store, so results and the map update exactly
 * as the full search panel would. Chips with no backing backend filter are
 * intentionally omitted (see `QUICK_FILTERS`).
 *
 * Apply path:
 *  - On a `/search` route the patch is merged in place via `patchQuery`, mirroring
 *    the results view's own `onQueryChange={patchQuery}` so the live query updates
 *    without a navigation/remount.
 *  - Elsewhere the patch is written to the (module-level, navigation-stable) store
 *    first, then we navigate to `/search`, which reads the current query on mount.
 *    No structured fields are smuggled through route params (the search screen only
 *    parses `query`/`city`/`offering`), so this is the lossless apply path.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { usePathname, useRouter } from 'expo-router';

import { Button } from '@oxyhq/bloom/button';
import { Chip } from '@oxyhq/bloom/chip';

import { PropertyType } from '@homiio/shared-types';
import type { SearchQuery } from '@/components/search/types';
import { useSearchQueryStore } from '@/store/searchQueryStore';
import { spacing } from '@/constants/styles';
import { BaseWidget } from './BaseWidget';

/** Route prefix that means "the live search surface is already mounted". */
const SEARCH_ROUTE = '/explore';
/** Budget chip threshold: monthly price ceiling for the "Under €1000" filter. */
const BUDGET_PRICE_MAX = 1000;
/** Amenity slug a listing must carry to be considered pet-friendly. */
const AMENITY_PET_FRIENDLY = 'pet_friendly';

/**
 * The fields a quick filter contributes to the structured query. Only fields
 * backed by a working `GET /properties/search` filter are expressible here, so a
 * chip can never apply a no-op.
 */
type QuickFilterPatch = Partial<
  Pick<SearchQuery, 'propertyTypes' | 'amenities' | 'priceMax'>
>;

/** A one-tap filter: its i18n label key and the structured fields it writes. */
interface QuickFilter {
  id: string;
  /** i18n key under `search.widgets.quickFilters`. */
  labelKey: string;
  /** The fields this chip merges into the active query when selected. */
  patch: QuickFilterPatch;
}

/**
 * The shippable quick filters — every one maps to a REAL backend filter:
 *  - Co-living  → `propertyType=coliving`         (`filter.type`)
 *  - Pets       → `amenities` includes `pet_friendly` (`$all` match)
 *  - Budget     → `priceMax=1000`                  (monthly price `$lte`)
 *
 * Deliberately omitted (no backing filter reachable from `SearchQuery`):
 *  - Furnished  — `furnishedStatus` is a separate, non-searchable field and the
 *                 `furnished` slug is on no listing's `amenities`, so it'd match 0.
 *  - Eco/Verified — the builder reads `eco`/`verified` query params, but the
 *                 structured query exposes no field that emits them.
 */
const QUICK_FILTERS: readonly QuickFilter[] = [
  {
    id: 'coliving',
    labelKey: 'search.widgets.quickFilters.coliving',
    patch: { propertyTypes: [PropertyType.COLIVING] },
  },
  {
    id: 'pets',
    labelKey: 'search.widgets.quickFilters.pets',
    patch: { amenities: [AMENITY_PET_FRIENDLY] },
  },
  {
    id: 'budget',
    labelKey: 'search.widgets.quickFilters.budget',
    patch: { priceMax: BUDGET_PRICE_MAX },
  },
] as const;

/**
 * Merge the patches of the selected chips into one structured query patch.
 * Array fields (`propertyTypes`, `amenities`) union their slugs; scalar fields
 * (`priceMax`) take the selected value. Order-independent.
 */
function mergeSelectedPatches(selectedIds: readonly string[]): QuickFilterPatch {
  const propertyTypes = new Set<PropertyType>();
  const amenities = new Set<string>();
  let priceMax: number | undefined;

  for (const filter of QUICK_FILTERS) {
    if (!selectedIds.includes(filter.id)) continue;
    filter.patch.propertyTypes?.forEach((type) => propertyTypes.add(type));
    filter.patch.amenities?.forEach((slug) => amenities.add(slug));
    if (filter.patch.priceMax !== undefined) priceMax = filter.patch.priceMax;
  }

  const patch: QuickFilterPatch = {};
  if (propertyTypes.size > 0) patch.propertyTypes = Array.from(propertyTypes);
  if (amenities.size > 0) patch.amenities = Array.from(amenities);
  if (priceMax !== undefined) patch.priceMax = priceMax;
  return patch;
}

export function QuickFiltersWidget() {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();

  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const selectedCount = selectedIds.length;
  const hasSelection = selectedCount > 0;

  const toggleFilter = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id],
    );
  }, []);

  const applyFilters = useCallback(() => {
    if (!hasSelection) return;
    const patch = mergeSelectedPatches(selectedIds);
    useSearchQueryStore.getState().patchQuery(patch);
    // On the search surface the patch updates the live query in place; elsewhere
    // the store carries it across the navigation to the (just-mounted) results.
    if (!pathname.startsWith(SEARCH_ROUTE)) {
      router.push(SEARCH_ROUTE);
    }
  }, [hasSelection, selectedIds, pathname, router]);

  const openAdvancedFilters = useCallback(() => {
    router.push(SEARCH_ROUTE);
  }, [router]);

  const primaryLabel = useMemo(
    () => t('search.widgets.quickFilters.searchWithCount', { count: selectedCount }),
    [t, selectedCount],
  );

  return (
    <BaseWidget title={t('search.widgets.quickFilters.title')}>
      <View style={styles.container}>
        <View style={styles.chips}>
          {QUICK_FILTERS.map((filter) => {
            const isSelected = selectedIds.includes(filter.id);
            const label = t(filter.labelKey);
            return (
              <Chip
                key={filter.id}
                variant={isSelected ? 'solid' : 'outlined'}
                color={isSelected ? 'primary' : 'default'}
                size="medium"
                selected={isSelected}
                onPress={() => toggleFilter(filter.id)}
                accessibilityLabel={label}
              >
                {label}
              </Chip>
            );
          })}
        </View>

        <Button
          variant="primary"
          size="medium"
          disabled={!hasSelection}
          onPress={applyFilters}
        >
          {primaryLabel}
        </Button>

        <Button variant="secondary" size="medium" onPress={openAdvancedFilters}>
          {t('search.widgets.quickFilters.advancedFilters')}
        </Button>
      </View>
    </BaseWidget>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});

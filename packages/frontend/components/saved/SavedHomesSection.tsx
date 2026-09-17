/**
 * Every saved home, as `ListingCardGrid`s grouped by how the home is offered.
 *
 * A home lands in the group of the offering its card PRICES — the same
 * `resolvePrimaryOffering` the card reads, so the "For sale" group never shows
 * a monthly rent. The active browse mode's group comes first. A search field
 * and the recency chips narrow the whole set before it is grouped.
 *
 * Saved has no paginated list endpoint, so the groups reveal the in-memory list
 * a window at a time: the shared sentinel on web, and on native the screen's
 * own `onScroll`, which bumps `loadMoreSignal`.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxy.so/bloom/button';
import { Chip } from '@oxy.so/bloom/chip';
import { RiSearchLine } from '@oxy.so/bloom/icons';
import { Search } from '@oxy.so/bloom/search';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text } from '@oxy.so/bloom/typography';
import type { Property } from '@homiio/shared-types';

import { LoadMoreSentinel } from '@/components/common/LoadMoreSentinel';
import { PropertyResultsGrid } from '@/components/ui/PropertyResultsGrid';
import { PropertyResultsGridSkeleton } from '@/components/ui/PropertyResultsGridSkeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import type { BrowseMode } from '@/components/search/types';
import { useRentalMode } from '@/context/RentalModeContext';
import type { SavedProperty } from '@/services/savedPropertyService';
import {
  getPropertyTitle,
  resolvePrimaryOffering,
  type OfferingKind,
} from '@/utils/propertyUtils';

import { SavedSection } from './SavedSection';

type RecencyFilter = 'all' | 'recent' | 'noted';

const RECENCY_CHIPS: { value: RecencyFilter; labelKey: string }[] = [
  { value: 'all', labelKey: 'common.all' },
  { value: 'recent', labelKey: 'saved.filters.thisWeek' },
  { value: 'noted', labelKey: 'saved.filters.withNotes' },
];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const INITIAL_WINDOW = 24;
const WINDOW_STEP = 24;

const KIND_ORDER: readonly OfferingKind[] = ['long_term', 'short_term', 'sale', 'exchange'];

const BROWSE_MODE_KIND: Record<BrowseMode, OfferingKind> = {
  long_term: 'long_term',
  vacation: 'short_term',
  buy: 'sale',
  exchange: 'exchange',
};

interface SavedHomesSectionProps {
  savedProperties: readonly SavedProperty[];
  /** When the list was last fetched — the "now" of the "This week" filter. */
  fetchedAt: number;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  /** Bumped by the screen's native scroll reaching the end: reveal the next window. */
  loadMoreSignal: number;
}

export function SavedHomesSection({
  savedProperties,
  fetchedAt,
  loading,
  error,
  onRetry,
  loadMoreSignal,
}: SavedHomesSectionProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { browseMode } = useRentalMode();
  const [searchQuery, setSearchQuery] = useState('');
  const [recency, setRecency] = useState<RecencyFilter>('all');

  const filtered = useMemo<SavedProperty[]>(() => {
    const q = searchQuery.toLowerCase().trim();
    return savedProperties.filter((property) => {
      if (q) {
        const title = getPropertyTitle(property).toLowerCase();
        const city = property.address?.cityName?.toLowerCase() ?? '';
        if (!title.includes(q) && !city.includes(q)) return false;
      }
      switch (recency) {
        case 'recent': {
          const savedTime = property.savedAt ? new Date(property.savedAt).getTime() : fetchedAt;
          return fetchedAt - savedTime <= WEEK_MS;
        }
        case 'noted':
          return Boolean(property.notes && property.notes.trim().length > 0);
        default:
          return true;
      }
    });
  }, [savedProperties, searchQuery, recency, fetchedAt]);

  const [visibleCount, setVisibleCount] = useState(INITIAL_WINDOW);
  const hasMore = visibleCount < filtered.length;
  const loadMore = useCallback(() => {
    setVisibleCount((count) =>
      count < filtered.length ? Math.min(count + WINDOW_STEP, filtered.length) : count,
    );
  }, [filtered.length]);

  // Both adjustments use the "adjust state during render" pattern, so neither
  // needs an effect: a new filter set resets the window, and a new native
  // end-of-scroll signal grows it.
  const signature = `${searchQuery}|${recency}`;
  const [prevSignature, setPrevSignature] = useState(signature);
  if (signature !== prevSignature) {
    setPrevSignature(signature);
    setVisibleCount(INITIAL_WINDOW);
  }
  const [prevSignal, setPrevSignal] = useState(loadMoreSignal);
  if (loadMoreSignal !== prevSignal) {
    setPrevSignal(loadMoreSignal);
    if (hasMore) setVisibleCount(Math.min(visibleCount + WINDOW_STEP, filtered.length));
  }

  const freeLabel = t('listing.exchange.free');
  const groups = useMemo(() => {
    const byKind = new Map<OfferingKind, Property[]>();
    for (const property of filtered.slice(0, visibleCount)) {
      const kind = resolvePrimaryOffering(property, browseMode, freeLabel).kind;
      const list = byKind.get(kind);
      if (list) list.push(property);
      else byKind.set(kind, [property]);
    }
    const first = BROWSE_MODE_KIND[browseMode];
    const order = [first, ...KIND_ORDER.filter((kind) => kind !== first)];
    return order
      .map((kind) => ({ kind, properties: byKind.get(kind) ?? [] }))
      .filter((group) => group.properties.length > 0);
  }, [filtered, visibleCount, browseMode, freeLabel]);

  const handlePropertyPress = useCallback((property: Property) => {
    if (property.id) router.push(`/properties/${property.id}`);
  }, []);

  let body: React.ReactNode;
  if (loading && savedProperties.length === 0) {
    body = <PropertyResultsGridSkeleton count={4} />;
  } else if (error && savedProperties.length === 0) {
    body = (
      <ErrorState
        title={t('saved.loadFailed')}
        description={error instanceof Error ? error.message : t('common.tryAgain')}
        retryLabel={t('common.retry')}
        onRetry={onRetry}
      />
    );
  } else if (savedProperties.length === 0) {
    body = (
      <View style={{ gap: 12, alignItems: 'flex-start' }}>
        <Text variant="body-2-regular" style={{ color: theme.colors.textSecondary }}>
          {t('saved.noPropertiesDescription')}
        </Text>
        <Button variant="secondary" size="small" leadingIcon={RiSearchLine} onPress={() => router.push('/explore')}>
          {t('saved.exploreCta')}
        </Button>
      </View>
    );
  } else {
    body = (
      <>
        <View style={{ gap: 12 }}>
          <Search
            value={searchQuery}
            label={t('saved.searchPlaceholder')}
            onChangeText={setSearchQuery}
            onClearText={() => setSearchQuery('')}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {RECENCY_CHIPS.map((chip) => {
              const active = recency === chip.value;
              return (
                <Chip
                  key={chip.value}
                  variant={active ? 'solid' : 'outlined'}
                  color={active ? 'primary' : 'default'}
                  size="medium"
                  selected={active}
                  onPress={() => setRecency(chip.value)}
                >
                  {t(chip.labelKey)}
                </Chip>
              );
            })}
          </View>
        </View>
        {filtered.length === 0 ? (
          <Text variant="body-2-regular" style={{ color: theme.colors.textSecondary }}>
            {t('saved.adjustFilters')}
          </Text>
        ) : (
          <View style={{ gap: 40 }}>
            {groups.map((group) => (
              <View key={group.kind} style={{ gap: 16 }} testID={`saved-homes-${group.kind}`}>
                <Text role="heading" aria-level={3} variant="body-semibold" style={{ color: theme.colors.text }}>
                  {t(`saved.groups.${group.kind}`)}
                </Text>
                <PropertyResultsGrid properties={group.properties} onPropertyPress={handlePropertyPress} />
              </View>
            ))}
            <LoadMoreSentinel enabled={hasMore} onLoadMore={loadMore} />
          </View>
        )}
      </>
    );
  }

  return (
    <SavedSection
      title={t('saved.sections.homes')}
      description={
        savedProperties.length > 0
          ? t('saved.folder.propertyCount', { count: savedProperties.length })
          : undefined
      }
      testID="saved-homes"
    >
      {body}
    </SavedSection>
  );
}

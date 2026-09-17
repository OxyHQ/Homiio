import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { RiEqualizerLine, RiExpandUpDownLine } from '@oxy.so/bloom/icons';

import { SearchActionPill } from '@/components/search/SearchActionPill';
import { spacing } from '@/constants/styles';

interface FiltersBarProps {
    activeFiltersCount: number;
    onFilterPress: () => void;
    sortBy: string;
    onSortPress: () => void;
}

/** i18n key for each city-page sort order. */
const SORT_LABEL_KEYS: Record<string, string> = {
    newest: 'properties.city.sortNewest',
    priceAsc: 'properties.city.sortPriceAsc',
    priceDesc: 'properties.city.sortPriceDesc',
};

/** The Filters / Sort pill row above a city's listings. */
export function FiltersBar({ activeFiltersCount, onFilterPress, sortBy, onSortPress }: FiltersBarProps) {
    const { t } = useTranslation();
    const filtersLabel = t('search.actions.filters');
    const sortLabel = t(SORT_LABEL_KEYS[sortBy] ?? SORT_LABEL_KEYS.newest);

    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.container}
        >
            <SearchActionPill
                label={filtersLabel}
                icon={RiEqualizerLine}
                active={activeFiltersCount > 0}
                count={activeFiltersCount}
                onPress={onFilterPress}
                accessibilityLabel={
                    activeFiltersCount > 0 ? `${filtersLabel}, ${activeFiltersCount}` : filtersLabel
                }
            />
            <SearchActionPill
                label={sortLabel}
                icon={RiExpandUpDownLine}
                active={sortBy !== 'newest'}
                onPress={onSortPress}
                accessibilityLabel={`${t('search.actions.sort')}: ${sortLabel}`}
            />
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        gap: spacing.sm,
    },
});

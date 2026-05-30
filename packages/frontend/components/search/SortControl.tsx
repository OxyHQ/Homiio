/**
 * SortControl — compact sort selector for the search results bar.
 *
 * Presents the three backend-supported orders (relevance / price / newest) as
 * a list of Bloom radio rows. Designed to live inside the app's
 * `BottomSheetContext` on narrow screens or an inline popover on wide screens;
 * it owns no presentation chrome of its own beyond the rows + title so the
 * caller controls how it's surfaced.
 */
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { RadioIndicator } from '@oxyhq/bloom/radio-indicator';
import { H3, Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';
import type { SearchSortBy, SearchSortOrder } from './types';

/** A selectable sort option mapping the UI label to the backend field+order. */
interface SortOption {
  key: string;
  labelKey: string;
  fallback: string;
  sortBy: SearchSortBy;
  sortOrder: SearchSortOrder;
}

const SORT_OPTIONS: readonly SortOption[] = [
  {
    key: 'relevance',
    labelKey: 'search.sort.recommended',
    fallback: 'Recommended',
    sortBy: 'relevance',
    sortOrder: 'desc',
  },
  {
    key: 'price_asc',
    labelKey: 'search.sort.priceAsc',
    fallback: 'Price: Low to high',
    sortBy: 'price',
    sortOrder: 'asc',
  },
  {
    key: 'price_desc',
    labelKey: 'search.sort.priceDesc',
    fallback: 'Price: High to low',
    sortBy: 'price',
    sortOrder: 'desc',
  },
  {
    key: 'newest',
    labelKey: 'search.sort.newest',
    fallback: 'Newest first',
    sortBy: 'createdAt',
    sortOrder: 'desc',
  },
] as const;

/** Resolve the active option from a (sortBy, sortOrder) pair. */
function matchOption(sortBy: SearchSortBy, sortOrder: SearchSortOrder): string {
  const found = SORT_OPTIONS.find(
    (o) => o.sortBy === sortBy && o.sortOrder === sortOrder,
  );
  return found?.key ?? SORT_OPTIONS[0].key;
}

interface SortControlProps {
  sortBy: SearchSortBy;
  sortOrder: SearchSortOrder;
  onChange: (sortBy: SearchSortBy, sortOrder: SearchSortOrder) => void;
  /** Fired after a selection so a sheet host can dismiss itself. */
  onClose?: () => void;
}

export const SortControl: React.FC<SortControlProps> = ({
  sortBy,
  sortOrder,
  onChange,
  onClose,
}) => {
  const { t } = useTranslation();
  const activeKey = matchOption(sortBy, sortOrder);

  const handleSelect = useCallback(
    (option: SortOption) => {
      onChange(option.sortBy, option.sortOrder);
      onClose?.();
    },
    [onChange, onClose],
  );

  return (
    <View style={styles.container}>
      <H3 style={styles.title}>{t('search.sort.title', 'Sort by')}</H3>
      {SORT_OPTIONS.map((option) => {
        const isSelected = option.key === activeKey;
        const label = t(option.labelKey, option.fallback) || option.fallback;
        return (
          <Pressable
            key={option.key}
            onPress={() => handleSelect(option)}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={label}
            style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
          >
            <BloomText style={[styles.label, isSelected ? styles.labelSelected : null]}>
              {label}
            </BloomText>
            <RadioIndicator selected={isSelected} />
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing['2xl'],
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    marginBottom: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  rowPressed: {
    opacity: 0.7,
  },
  label: {
    fontSize: 16,
    color: colors.COLOR_BLACK,
    flex: 1,
    paddingRight: spacing.md,
  },
  labelSelected: {
    fontWeight: '600',
  },
});

export default SortControl;

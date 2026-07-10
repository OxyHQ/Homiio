/**
 * SortControl — compact sort selector for the search results bar.
 *
 * Presents the three backend-supported orders (relevance / price / newest) as
 * a list of Bloom radio rows. Designed to live inside the app's
 * `BottomSheetContext` on narrow screens or an inline popover on wide screens;
 * it owns no presentation chrome of its own beyond the rows + title so the
 * caller controls how it's surfaced.
 */
import React, { useCallback, useState } from 'react';
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
    key: 'fairness',
    labelKey: 'search.sort.fairness',
    fallback: 'Best value',
    sortBy: 'fairness',
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
function matchOption(sortBy: SearchSortBy, sortOrder: SearchSortOrder): SortOption {
  return (
    SORT_OPTIONS.find((o) => o.sortBy === sortBy && o.sortOrder === sortOrder) ??
    SORT_OPTIONS[0]
  );
}

/** The default (relevance) order — used by callers to tell "is a sort applied". */
export const DEFAULT_SORT_OPTION = SORT_OPTIONS[0];

/**
 * Human label for the active (sortBy, sortOrder) pair, for the results bar's
 * Sort pill. Shared with {@link SortControl} so the pill and the sheet agree.
 */
export function resolveSortLabel(
  sortBy: SearchSortBy,
  sortOrder: SearchSortOrder,
  t: (key: string, fallback: string) => string,
): { label: string; isDefault: boolean } {
  const option = matchOption(sortBy, sortOrder);
  return {
    label: t(option.labelKey, option.fallback) || option.fallback,
    isDefault: option.key === DEFAULT_SORT_OPTION.key,
  };
}

interface SortRowProps {
  label: string;
  isSelected: boolean;
  onPress: () => void;
}

/**
 * A single sort option row. NativeWind's css-interop swallows the function form
 * of `style`, so the pressed tint is driven by onPressIn/onPressOut state over a
 * static style array instead.
 */
const SortRow: React.FC<SortRowProps> = ({ label, isSelected, onPress }) => {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="radio"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={label}
      style={[styles.row, pressed ? styles.rowPressed : null]}
    >
      <BloomText style={[styles.label, isSelected ? styles.labelSelected : null]}>
        {label}
      </BloomText>
      <RadioIndicator selected={isSelected} />
    </Pressable>
  );
};

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
  const activeKey = matchOption(sortBy, sortOrder).key;

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
          <SortRow
            key={option.key}
            label={label}
            isSelected={isSelected}
            onPress={() => handleSelect(option)}
          />
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

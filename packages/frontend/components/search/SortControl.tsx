/**
 * Sort for listing results, in two presentations sharing one option list.
 *
 *  - {@link SortMenu} — the explore toolbar: a Bloom `DropdownMenu` anchored to
 *    the Sort pill (an anchored panel on web, a sheet on native) with a radio
 *    group of orders.
 *  - {@link SortControl} — the same options as Bloom `Item` rows with a
 *    `RadioIndicator`, for callers that present it inside their own sheet.
 *
 * Both resolve the active option from the (sortBy, sortOrder) pair, so the pill
 * label, the menu and the sheet can never disagree.
 */
import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@oxy.so/bloom/dropdown-menu';
import { RiExpandUpDownLine } from '@oxy.so/bloom/icons';
import { Item } from '@oxy.so/bloom/item';
import { RadioIndicator } from '@oxy.so/bloom/radio-indicator';
import { H3 } from '@oxy.so/bloom/typography';

import { spacing } from '@/constants/styles';
import { SearchActionPill } from './SearchActionPill';
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

interface SortControlProps {
  sortBy: SearchSortBy;
  sortOrder: SearchSortOrder;
  onChange: (sortBy: SearchSortBy, sortOrder: SearchSortOrder) => void;
  /** Fired after a selection so a sheet host can dismiss itself. */
  onClose?: () => void;
}

/** The sort options as radio rows, for a caller-owned sheet. */
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
    <View style={styles.container} accessibilityRole="radiogroup">
      <H3 style={styles.title}>{t('search.sort.title')}</H3>
      {SORT_OPTIONS.map((option) => {
        const isSelected = option.key === activeKey;
        const label = t(option.labelKey, option.fallback) || option.fallback;
        return (
          <Item
            key={option.key}
            title={label}
            role="radio"
            selected={isSelected}
            trailing={<RadioIndicator selected={isSelected} />}
            onPress={() => handleSelect(option)}
            accessibilityLabel={label}
          />
        );
      })}
    </View>
  );
};

interface SortMenuProps {
  sortBy: SearchSortBy;
  sortOrder: SearchSortOrder;
  onChange: (sortBy: SearchSortBy, sortOrder: SearchSortOrder) => void;
}

/** The toolbar Sort pill, opening the orders as a Bloom dropdown menu. */
export const SortMenu: React.FC<SortMenuProps> = ({ sortBy, sortOrder, onChange }) => {
  const { t } = useTranslation();
  const active = matchOption(sortBy, sortOrder);
  const sort = resolveSortLabel(sortBy, sortOrder, t);
  const sortWord = t('search.actions.sort', 'Sort') || 'Sort';

  const handleValueChange = useCallback(
    (key: string) => {
      const option = SORT_OPTIONS.find((o) => o.key === key);
      if (option) onChange(option.sortBy, option.sortOrder);
    },
    [onChange],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild label={`${sortWord}: ${sort.label}`}>
        <SearchActionPill
          label={sort.isDefault ? sortWord : sort.label}
          icon={RiExpandUpDownLine}
          active={!sort.isDefault}
          accessibilityLabel={`${sortWord}: ${sort.label}`}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" label={t('search.sort.title')}>
        <DropdownMenuLabel>{t('search.sort.title')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={active.key} onValueChange={handleValueChange}>
          {SORT_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.key} value={option.key}>
              {t(option.labelKey, option.fallback) || option.fallback}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing['2xl'],
  },
  title: {
    marginBottom: spacing.md,
  },
});

export default SortControl;

/**
 * SortMenu — the sort control for listing results: an outline Bloom `Button`
 * (the same shape as Bloom's `FilterTriggerButton` beside it) opening a
 * `DropdownMenu` radio group of orders — an anchored panel on web, a sheet on
 * native.
 *
 * The active option is resolved from the (sortBy, sortOrder) pair, so the
 * button label and the checked row can never disagree.
 */
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxy.so/bloom/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@oxy.so/bloom/dropdown-menu';
import { RiExpandUpDownLine } from '@oxy.so/bloom/icons';

import type { SearchSortBy, SearchSortOrder } from './types';

/** A selectable sort option mapping the UI label to the backend field+order. */
interface SortOption {
  key: string;
  labelKey: string;
  sortBy: SearchSortBy;
  sortOrder: SearchSortOrder;
}

const SORT_OPTIONS: readonly SortOption[] = [
  { key: 'relevance', labelKey: 'search.sort.recommended', sortBy: 'relevance', sortOrder: 'desc' },
  { key: 'fairness', labelKey: 'search.sort.fairness', sortBy: 'fairness', sortOrder: 'desc' },
  { key: 'price_asc', labelKey: 'search.sort.priceAsc', sortBy: 'price', sortOrder: 'asc' },
  { key: 'price_desc', labelKey: 'search.sort.priceDesc', sortBy: 'price', sortOrder: 'desc' },
  { key: 'newest', labelKey: 'search.sort.newest', sortBy: 'createdAt', sortOrder: 'desc' },
];

/** Resolve the active option from a (sortBy, sortOrder) pair. */
function matchOption(sortBy: SearchSortBy, sortOrder: SearchSortOrder): SortOption {
  return SORT_OPTIONS.find((o) => o.sortBy === sortBy && o.sortOrder === sortOrder) ?? SORT_OPTIONS[0];
}

interface SortMenuProps {
  sortBy: SearchSortBy;
  sortOrder: SearchSortOrder;
  onChange: (sortBy: SearchSortBy, sortOrder: SearchSortOrder) => void;
  /** Glyph only, for a narrow toolbar; the name still says the active order. */
  iconOnly?: boolean;
}

/** The toolbar Sort button, opening the orders as a Bloom dropdown menu. */
export const SortMenu: React.FC<SortMenuProps> = ({ sortBy, sortOrder, onChange, iconOnly = false }) => {
  const { t } = useTranslation();
  const active = matchOption(sortBy, sortOrder);
  const activeLabel = t(active.labelKey);
  const isDefault = active.key === SORT_OPTIONS[0].key;
  const sortWord = t('search.actions.sort');

  const handleValueChange = useCallback(
    (key: string) => {
      const option = SORT_OPTIONS.find((o) => o.key === key);
      if (option) onChange(option.sortBy, option.sortOrder);
    },
    [onChange],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild label={`${sortWord}: ${activeLabel}`}>
        <Button
          variant="outline"
          size="medium"
          icon={RiExpandUpDownLine}
          iconOnly={iconOnly}
          accessibilityLabel={`${sortWord}: ${activeLabel}`}
        >
          {iconOnly ? undefined : isDefault ? sortWord : activeLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" label={t('search.sort.title')}>
        <DropdownMenuLabel>{t('search.sort.title')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={active.key} onValueChange={handleValueChange}>
          {SORT_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.key} value={option.key}>
              {t(option.labelKey)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default SortMenu;

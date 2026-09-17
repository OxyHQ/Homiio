/**
 * PropertyTypeCategoryBar — the property types above a results list, on Bloom's
 * `CategoryBar`, with the list's own controls (Filters, Sort) pinned right.
 *
 * Every category FILTERS: "All" is no type constraint and each other item is
 * `propertyTypes: [type]`. A query holding several types (chosen in the search
 * composer's Type step) selects no item rather than pretending to be one of them.
 */
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { CategoryBar, type CategoryBarItem } from '@oxy.so/bloom/category-bar';
import { RiLayoutGridLine } from '@oxy.so/bloom/icons';

import type { OfferingType, PropertyType } from '@homiio/shared-types';

import { SEARCH_TYPE_OPTIONS, typeOptionLabelKey } from './steps/TypeStep';

const ALL_KEY = 'all';

interface PropertyTypeCategoryBarProps {
  offering: OfferingType;
  selected: PropertyType[];
  onChange: (types: PropertyType[]) => void;
  /** Pinned right, never scrolls: the list's Filters and Sort controls. */
  trailing?: React.ReactNode;
  /** The surface behind the bar, which the web edge fades blend into. */
  fadeColor?: string;
}

export function PropertyTypeCategoryBar({
  offering,
  selected,
  onChange,
  trailing,
  fadeColor,
}: PropertyTypeCategoryBarProps): React.ReactElement {
  const { t } = useTranslation();

  const items = useMemo<CategoryBarItem[]>(
    () => [
      { key: ALL_KEY, label: t('common.all'), icon: RiLayoutGridLine },
      ...SEARCH_TYPE_OPTIONS.map((option) => ({
        key: option.type,
        label: t(typeOptionLabelKey(option, offering)),
        icon: option.icon,
      })),
    ],
    [offering, t],
  );

  const value =
    selected.length === 0
      ? ALL_KEY
      : selected.length === 1 && SEARCH_TYPE_OPTIONS.some((o) => o.type === selected[0])
        ? selected[0]
        : undefined;

  return (
    <CategoryBar
      items={items}
      value={value}
      onValueChange={(key) => onChange(key === ALL_KEY ? [] : [key as PropertyType])}
      accessibilityLabel={t('search.filters.propertyType')}
      previousLabel={t('search.category.previous')}
      nextLabel={t('search.category.next')}
      trailing={trailing}
      fadeColor={fadeColor}
    />
  );
}

export default PropertyTypeCategoryBar;

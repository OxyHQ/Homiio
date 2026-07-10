/**
 * FeaturedGridSection — titled home-page property grid.
 *
 * A thin section wrapper: a single bold title above the shared,
 * container-responsive `PropertyResultsGrid`. The grid body is the SAME
 * component used by search/browse/saved/profile, so every multi-column
 * property grid in the app reads at one density and never collapses below
 * 2 columns (`resolveGridColumns` owns the min-2 logic).
 *
 * The section hides itself if no items are provided — there is no skeleton
 * placeholder loop on the home page, per the Airbnb-2026 directive ("no empty
 * rows", "no shimmer carpets").
 */
import React from 'react';
import { View } from 'react-native';

import { H1 } from '@oxyhq/bloom/typography';

import { PropertyResultsGrid } from '@/components/ui/PropertyResultsGrid';
import { PAGE_GUTTER_CLASS } from '@/constants/styles';
import type { Property } from '@homiio/shared-types';

interface FeaturedGridSectionProps {
  title: string;
  items: readonly Property[];
  /** Open a property's detail screen. */
  onPropertyPress: (property: Property) => void;
  /**
   * Optional cap on the column count, forwarded to the shared grid. The grid is
   * container-driven by default; pass this to limit how wide it spreads. Never
   * forces below the grid's minimum column count.
   */
  maxColumns?: number;
}

export function FeaturedGridSection({
  title,
  items,
  onPropertyPress,
  maxColumns,
}: FeaturedGridSectionProps) {
  if (items.length === 0) return null;

  return (
    <View className={`w-full ${PAGE_GUTTER_CLASS}`}>
      <H1 className="mb-5 text-[26px] font-bold leading-8 tracking-tight text-foreground">
        {title}
      </H1>
      <PropertyResultsGrid
        properties={items}
        onPropertyPress={onPropertyPress}
        maxColumns={maxColumns}
      />
    </View>
  );
}

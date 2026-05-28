/**
 * SortBottomSheet — Bloom-based sort options for the search screen.
 *
 * Rendered inside `BottomSheetContext.openBottomSheet`. The actual
 * sort wiring lives on the search screen; this component is just a
 * presentation surface that posts back the selected option.
 *
 * Uses Bloom Typography + Bloom RadioIndicator. No hand-rolled radios
 * or text styles.
 */
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { RadioIndicator } from '@oxyhq/bloom/radio-indicator';
import { H3, Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

export type SortKey =
  | 'recommended'
  | 'price_asc'
  | 'price_desc'
  | 'newest'
  | 'rating';

interface SortOption {
  key: SortKey;
  labelKey: string;
  fallback: string;
}

const SORT_OPTIONS: readonly SortOption[] = [
  { key: 'recommended', labelKey: 'search.sort.recommended', fallback: 'Recommended' },
  { key: 'price_asc', labelKey: 'search.sort.priceAsc', fallback: 'Price: Low to high' },
  { key: 'price_desc', labelKey: 'search.sort.priceDesc', fallback: 'Price: High to low' },
  { key: 'newest', labelKey: 'search.sort.newest', fallback: 'Newest first' },
  { key: 'rating', labelKey: 'search.sort.rating', fallback: 'Top rated' },
] as const;

interface SortBottomSheetProps {
  value: SortKey;
  onChange: (next: SortKey) => void;
  onClose: () => void;
}

export const SortBottomSheet: React.FC<SortBottomSheetProps> = ({
  value,
  onChange,
  onClose,
}) => {
  const { t } = useTranslation();

  const handleSelect = useCallback(
    (next: SortKey) => {
      onChange(next);
      onClose();
    },
    [onChange, onClose],
  );

  return (
    <View style={styles.container}>
      <H3 style={styles.title}>{t('search.sort.title', 'Sort by')}</H3>
      {SORT_OPTIONS.map((option) => {
        const isSelected = option.key === value;
        const label = t(option.labelKey, option.fallback) || option.fallback;
        return (
          <Pressable
            key={option.key}
            onPress={() => handleSelect(option.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={label}
            style={({ pressed }) => [
              styles.row,
              pressed ? styles.rowPressed : null,
            ]}
          >
            <BloomText
              style={[styles.label, isSelected ? styles.labelSelected : null]}
            >
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

export default SortBottomSheet;

import React, { useCallback, useContext, useMemo, useState } from 'react';
import { Platform, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { SearchInput } from '@oxyhq/bloom/search-input';
import * as SegmentedControl from '@oxyhq/bloom/segmented-control';
import { Chip } from '@oxyhq/bloom/chip';

import { useRentalMode, type RentalMode } from '@/context/RentalModeContext';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { SearchFiltersBottomSheet } from '@/components/SearchFiltersBottomSheet';
import { colors } from '@/styles/colors';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface SecondaryChip {
  id: string;
  label: string;
  icon: IoniconName;
}

interface SearchBarProps {
  hideFilterIcon?: boolean;
  /** When true the secondary "Where / When / Who" pill row is hidden. */
  hideSecondaryRow?: boolean;
}

const LONG_TERM_CHIPS: SecondaryChip[] = [
  { id: 'where', label: 'searchBar.long.where', icon: 'location-outline' },
  { id: 'moveIn', label: 'searchBar.long.moveIn', icon: 'calendar-outline' },
  { id: 'propertyType', label: 'searchBar.long.propertyType', icon: 'home-outline' },
];

const VACATION_CHIPS: SecondaryChip[] = [
  { id: 'where', label: 'searchBar.vacation.where', icon: 'location-outline' },
  { id: 'when', label: 'searchBar.vacation.when', icon: 'calendar-outline' },
  { id: 'who', label: 'searchBar.vacation.who', icon: 'people-outline' },
];

const FILTER_FALLBACK = {
  minPrice: 0,
  maxPrice: 5000,
  bedrooms: 1,
  bathrooms: 1,
  type: undefined,
  amenities: [] as string[],
};

export const SearchBar = ({
  hideFilterIcon = false,
  hideSecondaryRow = false,
}: SearchBarProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const router = useRouter();
  const { t } = useTranslation();
  const { mode, setMode } = useRentalMode();
  const bottomSheet = useContext(BottomSheetContext);

  const secondaryChips = useMemo(
    () => (mode === 'vacation' ? VACATION_CHIPS : LONG_TERM_CHIPS),
    [mode],
  );

  const submitSearch = useCallback(() => {
    const q = searchQuery.trim();
    if (!q) return;
    router.push(`/search/${encodeURIComponent(q)}`);
  }, [router, searchQuery]);

  const openFilters = useCallback(() => {
    bottomSheet.openBottomSheet(
      <SearchFiltersBottomSheet
        filters={FILTER_FALLBACK}
        onFilterChange={() => {
          // SearchBar is a launching pad — actual filter wiring lives on the
          // search screen. The user can still tweak values here and they will
          // re-open with persisted state once they navigate to /search.
        }}
        onApply={() => {
          bottomSheet.closeBottomSheet();
          router.push('/search');
        }}
        onClear={() => bottomSheet.closeBottomSheet()}
      />,
    );
  }, [bottomSheet, router]);

  const handleModeChange = useCallback(
    (next: RentalMode) => {
      setMode(next);
    },
    [setMode],
  );

  const isWeb = Platform.OS === 'web';

  return (
    <View className="w-full flex-col gap-2 py-1 z-50">
      <View
        className={
          isWeb
            ? 'w-full flex-col gap-2 lg:flex-row lg:items-center lg:gap-3'
            : 'w-full flex-col gap-2'
        }
      >
        <View className={isWeb ? 'w-full lg:w-64' : 'w-full'}>
          <SegmentedControl.Root<RentalMode>
            label={t('searchBar.mode.label', 'Rental mode')}
            type="tabs"
            size="small"
            value={mode}
            onChange={handleModeChange}
            accessibilityHint={t(
              'searchBar.mode.hint',
              'Switch between long-term rentals and vacation stays',
            )}
          >
            <SegmentedControl.Item value="long_term">
              <SegmentedControl.ItemText>
                {t('searchBar.mode.longTerm', 'Long-term')}
              </SegmentedControl.ItemText>
            </SegmentedControl.Item>
            <SegmentedControl.Item value="vacation">
              <SegmentedControl.ItemText>
                {t('searchBar.mode.vacation', 'Vacation')}
              </SegmentedControl.ItemText>
            </SegmentedControl.Item>
          </SegmentedControl.Root>
        </View>

        <View className="w-full flex-row items-center gap-2 flex-1">
          <View className="flex-1">
            <SearchInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              onClearText={() => setSearchQuery('')}
              onSubmitEditing={submitSearch}
              label={
                mode === 'vacation'
                  ? t('searchBar.placeholder.vacation', 'Search stays, beach, city...')
                  : t('searchBar.placeholder.longTerm', 'Search by city, neighborhood...')
              }
            />
          </View>

          {!hideFilterIcon && (
            <Chip
              variant="outlined"
              size="medium"
              onPress={openFilters}
              accessibilityLabel={t('searchBar.openFilters', 'Open filters')}
              startIcon={
                <Ionicons
                  name="options-outline"
                  size={16}
                  color={colors.COLOR_BLACK_LIGHT_3}
                />
              }
            >
              {t('searchBar.filters', 'Filters')}
            </Chip>
          )}
        </View>
      </View>

      {!hideSecondaryRow && (
        <View className="w-full flex-row flex-wrap gap-2">
          {secondaryChips.map((chip) => (
            <Chip
              key={chip.id}
              variant="soft"
              size="medium"
              onPress={openFilters}
              accessibilityLabel={t(chip.label, chip.id)}
              startIcon={
                <Ionicons
                  name={chip.icon}
                  size={14}
                  color={colors.COLOR_BLACK_LIGHT_3}
                />
              }
            >
              {t(chip.label, chip.id)}
            </Chip>
          ))}
        </View>
      )}
    </View>
  );
};

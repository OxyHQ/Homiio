/**
 * Hero pill search bar — Airbnb-2026 inspired.
 *
 * One rounded pill with three segments (Where / When / Who for vacation,
 * Where / Move-in / Property type for long-term), separated by hairline
 * dividers, with a circular search button on the right edge. A small
 * SegmentedControl above the pill switches rental modes.
 *
 * Each segment is a Pressable: on web it opens an inline expansion below
 * the pill, on mobile it routes straight to the filters bottom sheet.
 * The actual data wiring lives on /search — this component is just a
 * launching pad with persisted values held in local state.
 */
import React, { useCallback, useContext, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import * as SegmentedControl from '@oxyhq/bloom/segmented-control';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { useRentalMode, type RentalMode } from '@/context/RentalModeContext';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import {
  SearchFiltersBottomSheet,
  SearchFilters,
} from '@/components/SearchFiltersBottomSheet';
import { colors } from '@/styles/colors';
import { cardShadow, hairline, radius } from '@/constants/styles';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface SegmentDef {
  id: string;
  labelKey: string;
  fallbackLabel: string;
  valueFallback: string;
  icon: IoniconName;
}

const LONG_TERM_SEGMENTS: SegmentDef[] = [
  {
    id: 'where',
    labelKey: 'searchBar.long.where',
    fallbackLabel: 'Where',
    valueFallback: 'Any city',
    icon: 'location-outline',
  },
  {
    id: 'moveIn',
    labelKey: 'searchBar.long.moveIn',
    fallbackLabel: 'Move-in',
    valueFallback: 'Add date',
    icon: 'calendar-outline',
  },
  {
    id: 'propertyType',
    labelKey: 'searchBar.long.propertyType',
    fallbackLabel: 'Property type',
    valueFallback: 'Any type',
    icon: 'home-outline',
  },
];

const VACATION_SEGMENTS: SegmentDef[] = [
  {
    id: 'where',
    labelKey: 'searchBar.vacation.where',
    fallbackLabel: 'Where',
    valueFallback: 'Any destination',
    icon: 'location-outline',
  },
  {
    id: 'when',
    labelKey: 'searchBar.vacation.when',
    fallbackLabel: 'When',
    valueFallback: 'Add dates',
    icon: 'calendar-outline',
  },
  {
    id: 'who',
    labelKey: 'searchBar.vacation.who',
    fallbackLabel: 'Who',
    valueFallback: 'Add guests',
    icon: 'people-outline',
  },
];

const FILTER_FALLBACK: SearchFilters = {
  minPrice: 0,
  maxPrice: 5000,
  bedrooms: 1,
  bathrooms: 1,
  type: undefined,
  amenities: [],
};

interface SearchBarProps {
  /** Hide the right-edge circular search button. Default false. */
  hideFilterIcon?: boolean;
  /**
   * @deprecated Retained for backward compatibility with old callers that
   * passed `hideSecondaryRow`. The new pill design no longer has a
   * secondary chip row, so this prop is a no-op.
   */
  hideSecondaryRow?: boolean;
}

interface PillSegmentProps {
  label: string;
  value: string;
  isFirst?: boolean;
  isLast?: boolean;
  onPress: (event: GestureResponderEvent) => void;
  accessibilityLabel: string;
}

const PillSegment: React.FC<PillSegmentProps> = ({
  label,
  value,
  isFirst = false,
  isLast = false,
  onPress,
  accessibilityLabel,
}) => {
  const [hovered, setHovered] = useState(false);

  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);

  // Squeeze radius into the outer pill: only the leading edge of the
  // first cell and the trailing edge of the last cell are rounded.
  // Web's :hover state is faked with onHoverIn/onHoverOut from RNW.
  const segmentStyle = [
    styles.segment,
    isFirst && styles.segmentFirst,
    isLast && styles.segmentLast,
    hovered && styles.segmentHovered,
  ];

  return (
    <Pressable
      style={segmentStyle}
      onPress={onPress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <BloomText style={styles.segmentLabel} numberOfLines={1}>
        {label}
      </BloomText>
      <BloomText style={styles.segmentValue} numberOfLines={1}>
        {value}
      </BloomText>
    </Pressable>
  );
};

export const SearchBar: React.FC<SearchBarProps> = ({
  hideFilterIcon = false,
}) => {
  const router = useRouter();
  const { t } = useTranslation();
  const { mode, setMode } = useRentalMode();
  const bottomSheet = useContext(BottomSheetContext);

  const segments = useMemo(
    () => (mode === 'vacation' ? VACATION_SEGMENTS : LONG_TERM_SEGMENTS),
    [mode],
  );

  const openFilters = useCallback(() => {
    bottomSheet.openBottomSheet(
      <SearchFiltersBottomSheet
        filters={FILTER_FALLBACK}
        onFilterChange={() => {
          // The actual filter wiring lives on the search screen; this
          // launching-pad surface only opens the sheet so the user can
          // tweak preferences before they navigate.
        }}
        onApply={() => {
          bottomSheet.closeBottomSheet();
          router.push('/search');
        }}
        onClear={() => bottomSheet.closeBottomSheet()}
      />,
    );
  }, [bottomSheet, router]);

  const submitSearch = useCallback(() => {
    router.push('/search');
  }, [router]);

  const handleModeChange = useCallback(
    (next: RentalMode) => {
      setMode(next);
    },
    [setMode],
  );

  const isWeb = Platform.OS === 'web';

  return (
    <View style={styles.root}>
      <View style={[styles.modeWrapper, isWeb ? styles.modeWrapperWeb : null]}>
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

      <View style={[styles.pillShell, isWeb ? styles.pillShellWeb : null]}>
        <View style={[styles.pill, cardShadow.md]}>
          {segments.map((segment, index) => (
            <React.Fragment key={segment.id}>
              {index > 0 ? <View style={styles.pillDivider} /> : null}
              <PillSegment
                label={t(segment.labelKey, segment.fallbackLabel) || segment.fallbackLabel}
                value={t(`${segment.labelKey}.value`, segment.valueFallback) || segment.valueFallback}
                isFirst={index === 0}
                isLast={false}
                onPress={openFilters}
                accessibilityLabel={t(segment.labelKey, segment.fallbackLabel) || segment.fallbackLabel}
              />
            </React.Fragment>
          ))}
          {!hideFilterIcon ? (
            <Pressable
              style={styles.searchButton}
              onPress={submitSearch}
              accessibilityRole="button"
              accessibilityLabel={t('searchBar.search', 'Search') || 'Search'}
            >
              <Ionicons name="search" size={20} color={colors.primaryForeground} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
};

const PILL_HEIGHT = 66;
const SEARCH_BUTTON_SIZE = 48;

const styles = StyleSheet.create({
  root: {
    width: '100%',
    gap: 12,
    alignItems: 'center',
  },
  modeWrapper: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
  },
  modeWrapperWeb: {
    alignSelf: 'center',
    paddingHorizontal: 0,
  },
  pillShell: {
    width: '100%',
    paddingHorizontal: 16,
  },
  pillShellWeb: {
    maxWidth: 880,
    alignSelf: 'center',
    paddingHorizontal: 0,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    borderWidth: hairline.width,
    borderColor: hairline.color,
    height: PILL_HEIGHT,
    paddingVertical: 0,
    paddingLeft: 0,
    paddingRight: (PILL_HEIGHT - SEARCH_BUTTON_SIZE) / 2,
  },
  segment: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    minWidth: 0,
    height: '100%',
    gap: 2,
  },
  segmentFirst: {
    paddingLeft: 28,
    borderTopLeftRadius: radius.pill,
    borderBottomLeftRadius: radius.pill,
  },
  segmentLast: {
    paddingRight: 28,
  },
  segmentHovered: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_8,
  },
  segmentLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    letterSpacing: 0.2,
  },
  segmentValue: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  pillDivider: {
    width: hairline.width,
    height: 28,
    backgroundColor: hairline.color,
  },
  searchButton: {
    width: SEARCH_BUTTON_SIZE,
    height: SEARCH_BUTTON_SIZE,
    borderRadius: SEARCH_BUTTON_SIZE / 2,
    backgroundColor: colors.primaryColor,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
});

export default SearchBar;

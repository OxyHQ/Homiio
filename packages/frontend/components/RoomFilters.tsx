/**
 * RoomFilters — the rooms-tab filter form, on Bloom's `stay-filters` parts,
 * rendered INSIDE the Bloom `Dialog` that `RoomList` owns (the dialog supplies
 * the title and the close control, and hands this body the scrolling).
 *
 * The form edits a local draft and only reaches the list through
 * `onApplyFilters`: Apply commits the draft, Clear all resets it.
 *
 * ## Only what the rooms feed applies
 *
 * The rooms list is `GET /api/properties?type=room`, and the form offers what
 * that endpoint filters on: monthly rent, amenities, pet-friendly, a city or
 * region, and the two orders it sorts by. It used to offer a smoking switch
 * (no such parameter), sort by "best match" and "name" (unknown `sortBy`
 * values fall back to newest), and amenity chips for slugs no listing is
 * stored with (`private_bathroom`, `smoking_allowed`, and `furnished`, which is
 * a structured field rather than an amenity) — controls that changed nothing.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import {
  AmenityFilter,
  FilterFooter,
  FilterSection,
  PriceRangeFilter,
  SegmentedFilter,
  SwitchFilterRow,
  type FilterIconComponent,
  type ToggleChipOption,
} from '@oxy.so/bloom/stay-filters';
import { TextFieldInput } from '@oxy.so/bloom/text-field';

import { PropertyType } from '@homiio/shared-types';
import { PropertyFilters } from '@/services/propertyService';
import { getAmenityById } from '@/constants/amenities';
import { usePriceFormatter } from '@/components/search/steps/PriceStep';
import { spacing } from '@/constants/styles';

/** Direction used when sorting room results. */
export type RoomSortOrder = 'asc' | 'desc';

/**
 * Filters used by the rooms feature. Extends the shared {@link PropertyFilters}
 * contract with the room-list query options that the properties list endpoint
 * supports (sorting).
 */
export interface RoomFilterOptions extends PropertyFilters {
    /** Field to sort the room results by (maps to the backend `sortBy`). */
    sortBy?: string;
    /** Sort direction (maps to the backend `sortOrder`). */
    sortOrder?: RoomSortOrder;
}

/** Monthly rent slider bounds. A thumb resting on an end means "no bound". */
const RENT_TRACK = { max: 5000, step: 50 } as const;

/** Amenity slugs offered: ones listings are actually stored with. */
const AMENITY_SLUGS = ['balcony', 'walk_in_closet', 'air_conditioning', 'heating'] as const;

/** The orders the list endpoint sorts by, with the direction each implies. */
const SORT_OPTIONS = {
    createdAt: { order: 'desc', labelKey: 'roommates.rooms.sort.newest' },
    price: { order: 'asc', labelKey: 'roommates.rooms.sort.price' },
} as const satisfies Record<string, { order: RoomSortOrder; labelKey: string }>;
type RoomSortKey = keyof typeof SORT_OPTIONS;

const ROOM_DEFAULTS: RoomFilterOptions = {
    type: PropertyType.ROOM,
    sortBy: 'createdAt',
    sortOrder: 'desc',
};

interface RoomFiltersProps {
    filters: RoomFilterOptions;
    onApplyFilters: (filters: RoomFilterOptions) => void;
    onClose: () => void;
}

export function RoomFilters({ filters, onApplyFilters, onClose }: RoomFiltersProps) {
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const formatRent = usePriceFormatter(RENT_TRACK);
    const [draft, setDraft] = useState<RoomFilterOptions>(filters);

    const patch = useCallback((next: Partial<RoomFilterOptions>) => {
        setDraft((prev) => ({ ...prev, ...next }));
    }, []);

    const rentRange = useMemo<[number, number]>(
        () => [draft.minRent ?? 0, Math.min(draft.maxRent ?? RENT_TRACK.max, RENT_TRACK.max)],
        [draft.minRent, draft.maxRent],
    );

    const handleRentChange = useCallback(
        ([min, max]: [number, number]) =>
            patch({
                minRent: min <= 0 ? undefined : min,
                maxRent: max >= RENT_TRACK.max ? undefined : max,
            }),
        [patch],
    );

    const amenityOptions = useMemo<ToggleChipOption[]>(
        () =>
            AMENITY_SLUGS.map((slug) => {
                const amenity = getAmenityById(slug);
                return {
                    value: slug,
                    label: amenity?.nameKey ? t(amenity.nameKey) : slug,
                    // The catalog types its glyphs as Button icons; they are the
                    // same Bloom SVG components the filter chips draw.
                    icon: amenity?.icon as FilterIconComponent | undefined,
                };
            }),
        [t],
    );

    const sortKey: RoomSortKey = draft.sortBy === 'price' ? 'price' : 'createdAt';
    const sortOptions = useMemo(
        () =>
            (Object.keys(SORT_OPTIONS) as RoomSortKey[]).map((value) => ({
                value,
                label: t(SORT_OPTIONS[value].labelKey),
            })),
        [t],
    );

    const handleApply = () => {
        onApplyFilters(draft);
        onClose();
    };

    return (
        <>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
                <FilterSection title={t('properties.filters.priceRange')} description={t('search.step.price.perMonth')}>
                    <PriceRangeFilter
                        min={0}
                        max={RENT_TRACK.max}
                        step={RENT_TRACK.step}
                        value={rentRange}
                        onValueChange={handleRentChange}
                        formatPrice={formatRent}
                        minLabel={t('search.step.price.min')}
                        maxLabel={t('search.step.price.max')}
                        accessibilityLabel={t('properties.filters.priceRange')}
                    />
                </FilterSection>

                <FilterSection title={t('properties.filters.amenities')}>
                    <AmenityFilter
                        options={amenityOptions}
                        value={draft.amenities ?? []}
                        onValueChange={(amenities) =>
                            patch({ amenities: amenities.length > 0 ? amenities : undefined })
                        }
                        accessibilityLabel={t('properties.filters.amenities')}
                        showMoreLabel={t('search.filters.showMore')}
                        showLessLabel={t('search.filters.showLess')}
                    />
                    <SwitchFilterRow
                        title={t('home.category.petFriendly')}
                        value={draft.petFriendly ?? false}
                        onValueChange={(petFriendly) => patch({ petFriendly: petFriendly || undefined })}
                        style={styles.switchRow}
                    />
                </FilterSection>

                <FilterSection title={t('roommates.rooms.location')}>
                    <View style={styles.row}>
                        <View style={styles.half}>
                            <TextFieldInput
                                label={t('roommates.rooms.city')}
                                placeholder={t('roommates.rooms.cityPlaceholder')}
                                value={draft.city ?? ''}
                                onChangeText={(value) => patch({ city: value || undefined })}
                            />
                        </View>
                        <View style={styles.half}>
                            <TextFieldInput
                                label={t('roommates.rooms.state')}
                                placeholder={t('roommates.rooms.statePlaceholder')}
                                value={draft.state ?? ''}
                                onChangeText={(value) => patch({ state: value || undefined })}
                            />
                        </View>
                    </View>
                </FilterSection>

                <FilterSection title={t('search.sort.title')} divider={false}>
                    <SegmentedFilter<RoomSortKey>
                        options={sortOptions}
                        value={sortKey}
                        onValueChange={(value) =>
                            patch({ sortBy: value, sortOrder: SORT_OPTIONS[value].order })
                        }
                        accessibilityLabel={t('search.sort.title')}
                    />
                </FilterSection>
            </ScrollView>
            <FilterFooter
                resultsLabel={t('properties.filters.apply')}
                onApply={handleApply}
                onClear={() => setDraft(ROOM_DEFAULTS)}
                clearLabel={t('search.actions.clearAll')}
                style={{ paddingBottom: spacing.md + insets.bottom }}
            />
        </>
    );
}

const styles = StyleSheet.create({
    scroll: {
        flexShrink: 1,
    },
    scrollContent: {
        paddingHorizontal: spacing.xl,
    },
    switchRow: {
        marginTop: spacing.lg,
    },
    row: {
        flexDirection: 'row',
        gap: spacing.md,
    },
    half: {
        flex: 1,
    },
});

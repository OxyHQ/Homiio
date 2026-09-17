/**
 * RoomFilters — the rooms-tab filter form, rendered INSIDE the Bloom `Dialog`
 * that `RoomList` owns (the dialog supplies the title and the close control).
 *
 * The form edits a local draft and only reaches the list through
 * `onApplyFilters`: Apply commits the draft, Reset commits the room defaults.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxy.so/bloom/button';
import { Chip } from '@oxy.so/bloom/chip';
import { RangeSlider } from '@oxy.so/bloom/slider';
import { SettingsListItem } from '@oxy.so/bloom/settings-list';
import { Switch } from '@oxy.so/bloom/switch';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { PropertyType, formatMoney } from '@homiio/shared-types';
import { PropertyFilters } from '@/services/propertyService';
import { SEARCH_PRICE_CURRENCY } from '@/components/search/types';
import { useFormatting } from '@/utils/format';
import { spacing } from '@/constants/styles';

/** Direction used when sorting room results. */
export type RoomSortOrder = 'asc' | 'desc';

/**
 * Filters used by the rooms feature. Extends the shared {@link PropertyFilters}
 * contract with the room-list query options that the properties list endpoint
 * supports (sorting) plus the smoking-preference toggle surfaced in the UI.
 */
export interface RoomFilterOptions extends PropertyFilters {
    /** Field to sort the room results by (maps to the backend `sortBy`). */
    sortBy?: string;
    /** Sort direction (maps to the backend `sortOrder`). */
    sortOrder?: RoomSortOrder;
    /** UI preference for listings that allow smoking. */
    smokingAllowed?: boolean;
}

/** Values a single filter control can produce. */
type RoomFilterValue = RoomFilterOptions[keyof RoomFilterOptions];

/** Monthly rent slider bounds. A thumb resting on an end means "no bound". */
const RENT_MIN = 0;
const RENT_MAX = 5000;
const RENT_STEP = 50;

/** Amenity slugs offered as chips, with their label keys. */
const AMENITY_OPTIONS: readonly { slug: string; labelKey: string }[] = [
    { slug: 'private_bathroom', labelKey: 'roommates.rooms.amenity.privateBathroom' },
    { slug: 'balcony', labelKey: 'search.filters.amenity.balcony' },
    { slug: 'walk_in_closet', labelKey: 'roommates.rooms.amenity.walkInCloset' },
    { slug: 'air_conditioning', labelKey: 'search.filters.amenity.airConditioning' },
    { slug: 'heating', labelKey: 'search.filters.amenity.heating' },
    { slug: 'furnished', labelKey: 'property.sections.furnished' },
    { slug: 'pet_friendly', labelKey: 'home.category.petFriendly' },
    { slug: 'smoking_allowed', labelKey: 'roommates.rooms.smokingAllowed' },
];

/** Sort options: backend field plus the direction it implies. */
const SORT_OPTIONS: readonly { value: string; order: RoomSortOrder; labelKey: string }[] = [
    { value: 'matchScore', order: 'desc', labelKey: 'roommates.rooms.sort.bestMatch' },
    { value: 'rent.amount', order: 'asc', labelKey: 'roommates.rooms.sort.price' },
    { value: 'createdAt', order: 'desc', labelKey: 'roommates.rooms.sort.newest' },
    { value: 'title', order: 'desc', labelKey: 'roommates.rooms.sort.name' },
];

interface RoomFiltersProps {
    filters: RoomFilterOptions;
    onApplyFilters: (filters: RoomFilterOptions) => void;
    onClose: () => void;
}

export function RoomFilters({ filters, onApplyFilters, onClose }: RoomFiltersProps) {
    const { t } = useTranslation();
    const { locale } = useFormatting();
    const [localFilters, setLocalFilters] = useState<RoomFilterOptions>(filters);

    const handleInputChange = useCallback((key: keyof RoomFilterOptions, value: RoomFilterValue) => {
        setLocalFilters((prev) => ({ ...prev, [key]: value }));
    }, []);

    const rentRange = useMemo<[number, number]>(
        () => [localFilters.minRent ?? RENT_MIN, localFilters.maxRent ?? RENT_MAX],
        [localFilters.minRent, localFilters.maxRent],
    );

    const handleRentChange = useCallback(([min, max]: [number, number]) => {
        setLocalFilters((prev) => ({
            ...prev,
            minRent: min <= RENT_MIN ? undefined : min,
            maxRent: max >= RENT_MAX ? undefined : max,
        }));
    }, []);

    const formatRent = useCallback(
        (value: number, index: number) => {
            if (index === 0 && value <= RENT_MIN) return t('roommates.rooms.anyPrice');
            if (index === 1 && value >= RENT_MAX) return t('roommates.rooms.anyPrice');
            return formatMoney(value, SEARCH_PRICE_CURRENCY, locale, { maximumFractionDigits: 0 });
        },
        [locale, t],
    );

    const toggleAmenity = useCallback((slug: string) => {
        setLocalFilters((prev) => {
            const current = prev.amenities ?? [];
            const next = current.includes(slug)
                ? current.filter((a) => a !== slug)
                : [...current, slug];
            return { ...prev, amenities: next.length > 0 ? next : undefined };
        });
    }, []);

    const handleApply = () => {
        onApplyFilters(localFilters);
        onClose();
    };

    const handleReset = () => {
        const resetFilters: RoomFilterOptions = {
            type: PropertyType.ROOM,
            sortBy: 'createdAt',
            sortOrder: 'desc',
        };
        setLocalFilters(resetFilters);
        onApplyFilters(resetFilters);
        onClose();
    };

    return (
        <View style={styles.container}>
            <View style={styles.section}>
                <BloomText style={styles.sectionTitle}>{t('properties.filters.priceRange')}</BloomText>
                <RangeSlider
                    value={rentRange}
                    onValueChange={handleRentChange}
                    min={RENT_MIN}
                    max={RENT_MAX}
                    step={RENT_STEP}
                    formatValue={formatRent}
                    accessibilityLabel={t('properties.filters.priceRange')}
                    style={styles.slider}
                />
            </View>

            {/* Room type is fixed to PropertyType.ROOM. */}

            <View style={styles.section}>
                <BloomText style={styles.sectionTitle}>{t('properties.filters.amenities')}</BloomText>
                <View style={styles.chips}>
                    {AMENITY_OPTIONS.map(({ slug, labelKey }) => {
                        const selected = localFilters.amenities?.includes(slug) ?? false;
                        return (
                            <Chip
                                key={slug}
                                variant={selected ? 'solid' : 'outlined'}
                                color={selected ? 'primary' : 'default'}
                                selected={selected}
                                onPress={() => toggleAmenity(slug)}
                                accessibilityLabel={t(labelKey)}
                            >
                                {t(labelKey)}
                            </Chip>
                        );
                    })}
                </View>
            </View>

            <View style={styles.section}>
                <BloomText style={styles.sectionTitle}>{t('roommates.preferences')}</BloomText>
                <SettingsListItem
                    title={t('home.category.petFriendly')}
                    accessibilityRole="none"
                    rightElement={
                        <Switch
                            value={localFilters.petFriendly ?? false}
                            onValueChange={(value) => handleInputChange('petFriendly', value)}
                            accessibilityLabel={t('home.category.petFriendly')}
                        />
                    }
                />
                <SettingsListItem
                    title={t('roommates.rooms.smokingAllowed')}
                    accessibilityRole="none"
                    rightElement={
                        <Switch
                            value={localFilters.smokingAllowed ?? false}
                            onValueChange={(value) => handleInputChange('smokingAllowed', value)}
                            accessibilityLabel={t('roommates.rooms.smokingAllowed')}
                        />
                    }
                />
            </View>

            <View style={styles.section}>
                <BloomText style={styles.sectionTitle}>{t('roommates.rooms.location')}</BloomText>
                <View style={styles.row}>
                    <View style={styles.half}>
                        <TextFieldInput
                            label={t('roommates.rooms.city')}
                            placeholder={t('roommates.rooms.cityPlaceholder')}
                            value={localFilters.city ?? ''}
                            onChangeText={(value) => handleInputChange('city', value || undefined)}
                        />
                    </View>
                    <View style={styles.half}>
                        <TextFieldInput
                            label={t('roommates.rooms.state')}
                            placeholder={t('roommates.rooms.statePlaceholder')}
                            value={localFilters.state ?? ''}
                            onChangeText={(value) => handleInputChange('state', value || undefined)}
                        />
                    </View>
                </View>
            </View>

            <View style={styles.section}>
                <BloomText style={styles.sectionTitle}>{t('search.sort.title')}</BloomText>
                <View style={styles.chips}>
                    {SORT_OPTIONS.map(({ value, order, labelKey }) => {
                        const selected = localFilters.sortBy === value;
                        return (
                            <Chip
                                key={value}
                                variant={selected ? 'solid' : 'outlined'}
                                color={selected ? 'primary' : 'default'}
                                selected={selected}
                                onPress={() =>
                                    setLocalFilters((prev) => ({ ...prev, sortBy: value, sortOrder: order }))
                                }
                                accessibilityLabel={t(labelKey)}
                            >
                                {t(labelKey)}
                            </Chip>
                        );
                    })}
                </View>
            </View>

            <View style={styles.footer}>
                <Button variant="secondary" size="medium" onPress={handleReset} accessibilityLabel={t('common.reset')}>
                    {t('common.reset')}
                </Button>
                <Button
                    variant="primary"
                    size="medium"
                    onPress={handleApply}
                    accessibilityLabel={t('properties.filters.apply')}
                >
                    {t('properties.filters.apply')}
                </Button>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        gap: spacing.xl,
    },
    section: {
        gap: spacing.sm,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
    },
    slider: {
        marginTop: spacing.lg,
    },
    chips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.sm,
    },
    row: {
        flexDirection: 'row',
        gap: spacing.md,
    },
    half: {
        flex: 1,
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: spacing.sm,
    },
});

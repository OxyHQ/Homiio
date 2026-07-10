import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FiltersBottomSheet, FilterSection, FilterValue } from '@/components/FiltersBar/FiltersBottomSheet';
import { useRentalMode } from '@/context/RentalModeContext';
import { CancellationPolicy } from '@homiio/shared-types';

/**
 * Shared filter shape used by SearchScreen + SearchBar quick filters.
 *
 * The schema is intentionally permissive about long-term vs vacation fields
 * because the same listing can appear in either mode. Sections are gated by
 * the active mode at render time (see `filterSections` below) rather than at
 * the type level. The active OFFERING (rent / sale / exchange) is owned by the
 * top-level browse toggle, not this sheet, so there is no listing-type section.
 */
export interface SearchFilters {
    minPrice: number;
    maxPrice: number;
    bedrooms: number | string;
    bathrooms: number | string;
    type?: string;
    amenities?: string[];

    // Vacation-specific
    checkIn?: string;
    checkOut?: string;
    guests?: number;
    instantBook?: boolean;
    cancellationPolicy?: CancellationPolicy;

    // Long-term-specific
    moveIn?: string;
    leaseDuration?: string;
    maxDeposit?: number;
    furnished?: boolean;
}

interface SearchFiltersBottomSheetProps {
    filters: SearchFilters;
    onFilterChange: (sectionId: string, value: FilterValue) => void;
    onApply: () => void;
    onClear: () => void;
}

const PROPERTY_TYPES_LONG_TERM = [
    { id: 'apartment', labelKey: 'search.types.apartments' },
    { id: 'house', labelKey: 'search.types.houses' },
    { id: 'room', labelKey: 'search.types.rooms' },
    { id: 'studio', labelKey: 'search.types.studios' },
] as const;

const PROPERTY_TYPES_VACATION = [
    { id: 'apartment', labelKey: 'search.types.apartments' },
    { id: 'house', labelKey: 'search.filters.propertyTypeVacation.wholeHouses' },
    { id: 'room', labelKey: 'search.filters.propertyTypeVacation.privateRooms' },
    { id: 'studio', labelKey: 'search.types.studios' },
] as const;

const AMENITIES = [
    'wifi',
    'parking',
    'gym',
    'pool',
    'balcony',
    'garden',
    'elevator',
    'air_conditioning',
    'heating',
    'dishwasher',
    'washing_machine',
];

const AMENITY_I18N_KEYS: Record<string, string> = {
    wifi: 'search.filters.amenity.wifi',
    parking: 'search.filters.amenity.parking',
    gym: 'search.filters.amenity.gym',
    pool: 'search.filters.amenity.pool',
    balcony: 'search.filters.amenity.balcony',
    garden: 'search.filters.amenity.garden',
    elevator: 'search.filters.amenity.elevator',
    air_conditioning: 'search.filters.amenity.airConditioning',
    heating: 'search.filters.amenity.heating',
    dishwasher: 'search.filters.amenity.dishwasher',
    washing_machine: 'search.filters.amenity.washingMachine',
};

const LEASE_DURATIONS = [
    { id: '3_months', labelKey: 'search.filters.leaseDuration.3Months' },
    { id: '6_months', labelKey: 'search.filters.leaseDuration.6Months' },
    { id: '12_months', labelKey: 'search.filters.leaseDuration.12Months' },
    { id: 'flexible', labelKey: 'search.filters.leaseDuration.flexible' },
] as const;

const CANCELLATION_POLICIES = [
    { id: CancellationPolicy.FLEXIBLE, labelKey: 'search.filters.cancellation.flexible' },
    { id: CancellationPolicy.MODERATE, labelKey: 'search.filters.cancellation.moderate' },
    { id: CancellationPolicy.STRICT, labelKey: 'search.filters.cancellation.strict' },
    { id: CancellationPolicy.SUPER_STRICT, labelKey: 'search.filters.cancellation.superStrict' },
] as const;

export function SearchFiltersBottomSheet({
    filters,
    onFilterChange,
    onApply,
    onClear,
}: SearchFiltersBottomSheetProps) {
    const { t } = useTranslation();
    const { mode } = useRentalMode();

    const filterSections: FilterSection[] = useMemo(() => {
        const propertyTypes = mode === 'vacation' ? PROPERTY_TYPES_VACATION : PROPERTY_TYPES_LONG_TERM;
        const sections: FilterSection[] = [
            {
                id: 'type',
                title: t('search.filters.propertyType'),
                type: 'chips',
                options: propertyTypes.map((type) => ({
                    id: type.id,
                    label: t(type.labelKey),
                    value: type.id,
                })),
                value: filters.type,
            },
            {
                id: 'price',
                title: mode === 'vacation' ? t('search.filters.nightlyPrice') : t('search.filters.monthlyPrice'),
                type: 'range',
                min: 0,
                max: mode === 'vacation' ? 1000 : 10000,
                value:
                    filters.minPrice || filters.maxPrice
                        ? [filters.minPrice, filters.maxPrice]
                        : undefined,
            },
            {
                id: 'bedrooms',
                title: t('property.sections.bedrooms'),
                type: 'chips',
                options: [
                    { id: '1', label: '1', value: '1' },
                    { id: '2', label: '2', value: '2' },
                    { id: '3', label: '3', value: '3' },
                    { id: '4', label: '4', value: '4' },
                    { id: '5', label: '5+', value: '5' },
                ],
                value: filters.bedrooms?.toString(),
            },
            {
                id: 'bathrooms',
                title: t('property.sections.bathrooms'),
                type: 'chips',
                options: [
                    { id: '1', label: '1', value: '1' },
                    { id: '2', label: '2', value: '2' },
                    { id: '3', label: '3', value: '3' },
                    { id: '4', label: '4+', value: '4' },
                ],
                value: filters.bathrooms?.toString(),
            },
        ];

        if (mode === 'vacation') {
            sections.push(
                {
                    id: 'checkIn',
                    title: t('search.filters.checkIn'),
                    type: 'date',
                    value: filters.checkIn || '',
                    placeholder: t('search.filters.addDate'),
                },
                {
                    id: 'checkOut',
                    title: t('search.filters.checkOut'),
                    type: 'date',
                    value: filters.checkOut || '',
                    placeholder: t('search.filters.addDate'),
                },
                {
                    id: 'guests',
                    title: t('search.filters.guests'),
                    type: 'counter',
                    value: typeof filters.guests === 'number' ? filters.guests : 0,
                },
                {
                    id: 'instantBook',
                    title: t('search.filters.instantBook'),
                    type: 'toggle',
                    value: Boolean(filters.instantBook),
                },
                {
                    id: 'cancellationPolicy',
                    title: t('search.filters.cancellationPolicy'),
                    type: 'chips',
                    options: CANCELLATION_POLICIES.map((policy) => ({
                        id: policy.id,
                        label: t(policy.labelKey),
                        value: policy.id,
                    })),
                    value: filters.cancellationPolicy,
                },
            );
        } else {
            sections.push(
                {
                    id: 'moveIn',
                    title: t('search.filters.moveInDate'),
                    type: 'date',
                    value: filters.moveIn || '',
                    placeholder: t('search.filters.addDate'),
                },
                {
                    id: 'leaseDuration',
                    title: t('search.filters.leaseDuration'),
                    type: 'chips',
                    options: LEASE_DURATIONS.map((duration) => ({
                        id: duration.id,
                        label: t(duration.labelKey),
                        value: duration.id,
                    })),
                    value: filters.leaseDuration,
                },
                {
                    id: 'maxDeposit',
                    title: t('search.filters.maxDeposit'),
                    type: 'range',
                    min: 0,
                    max: 10000,
                    value: typeof filters.maxDeposit === 'number' ? [0, filters.maxDeposit] : undefined,
                },
                {
                    id: 'furnished',
                    title: t('property.sections.furnished'),
                    type: 'toggle',
                    value: Boolean(filters.furnished),
                },
            );
        }

        sections.push({
            id: 'amenities',
            title: t('search.filters.amenities'),
            type: 'chips',
            options: AMENITIES.map((amenity) => ({
                id: amenity,
                label: t(AMENITY_I18N_KEYS[amenity]),
                value: amenity,
            })),
            value: filters.amenities,
        });

        return sections;
    }, [t, filters, mode]);

    return (
        <FiltersBottomSheet
            sections={filterSections}
            onFilterChange={onFilterChange}
            onApply={onApply}
            onClear={onClear}
        />
    );
}

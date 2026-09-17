import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FiltersBottomSheet, FilterSection, FilterValue } from '@/components/FiltersBar/FiltersBottomSheet';
import { useRentalMode } from '@/context/RentalModeContext';
import { getAmenityById } from '@/constants/amenities';
import { CancellationPolicy, formatMoney } from '@homiio/shared-types';
import { SEARCH_PRICE_CURRENCY } from '@/components/search/types';
import { useFormatting } from '@/utils/format';

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

    /** Only listings with a fair-price badge (`priceEthics.isFairPrice`). */
    fairPrice?: boolean;
}

interface SearchFiltersBottomSheetProps {
    filters: SearchFilters;
    onFilterChange: (sectionId: string, value: FilterValue) => void;
    onApply: () => void;
    onClear: () => void;
}

/** Property types offered, with their long-term and vacation phrasing. */
const PROPERTY_TYPES = [
    { id: 'apartment', longTermKey: 'search.types.apartments', vacationKey: 'search.types.apartments' },
    { id: 'house', longTermKey: 'search.types.houses', vacationKey: 'search.filters.propertyTypeVacation.wholeHouses' },
    { id: 'room', longTermKey: 'search.types.rooms', vacationKey: 'search.filters.propertyTypeVacation.privateRooms' },
    { id: 'studio', longTermKey: 'search.types.studios', vacationKey: 'search.types.studios' },
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

/** Slider ceilings per unit: a month of rent, a night. The top means "no maximum". */
const PRICE_MAX_MONTHLY = 10000;
const PRICE_MAX_NIGHTLY = 1000;
const PRICE_STEP_MONTHLY = 100;
const PRICE_STEP_NIGHTLY = 10;
const MAX_GUESTS = 16;

/**
 * The filters sheet for listing searches.
 *
 * Only sections a search can actually APPLY are offered. The sheet used to also
 * show check-in / check-out, move-in, lease duration, max deposit, furnished and
 * cancellation policy; none of them had a field on `SearchQuery`, so every one
 * of those controls changed nothing — a filter that silently does not filter.
 * Dates and guests for a stay are composed in the search panel's own steps.
 */
export function SearchFiltersBottomSheet({
    filters,
    onFilterChange,
    onApply,
    onClear,
}: SearchFiltersBottomSheetProps) {
    const { t } = useTranslation();
    const { mode } = useRentalMode();
    const { locale } = useFormatting();

    const filterSections: FilterSection[] = useMemo(() => {
        const isVacation = mode === 'vacation';
        const money = (amount: number): string =>
            formatMoney(amount, SEARCH_PRICE_CURRENCY, locale, { maximumFractionDigits: 0 });

        const sections: FilterSection[] = [
            {
                id: 'fairPrice',
                title: t('search.filters.fairPrice'),
                type: 'toggle',
                value: Boolean(filters.fairPrice),
            },
            {
                id: 'type',
                title: t('search.filters.propertyType'),
                type: 'chips',
                options: PROPERTY_TYPES.map((type) => ({
                    id: type.id,
                    label: t(isVacation ? type.vacationKey : type.longTermKey),
                    value: type.id,
                })),
                value: filters.type,
            },
            {
                id: 'price',
                title: isVacation ? t('search.filters.nightlyPrice') : t('search.filters.monthlyPrice'),
                type: 'range',
                min: 0,
                max: isVacation ? PRICE_MAX_NIGHTLY : PRICE_MAX_MONTHLY,
                step: isVacation ? PRICE_STEP_NIGHTLY : PRICE_STEP_MONTHLY,
                formatValue: money,
                value:
                    filters.minPrice || filters.maxPrice
                        ? [filters.minPrice, filters.maxPrice]
                        : undefined,
            },
            {
                id: 'bedrooms',
                title: t('properties.filters.bedrooms'),
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
                title: t('properties.filters.bathrooms'),
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

        if (isVacation) {
            sections.push(
                {
                    id: 'guests',
                    title: t('search.filters.guests'),
                    type: 'counter',
                    max: MAX_GUESTS,
                    stepLabels: [t('search.actions.decreaseGuests'), t('search.actions.increaseGuests')],
                    value: typeof filters.guests === 'number' ? filters.guests : 0,
                },
                {
                    id: 'instantBook',
                    title: t('search.filters.instantBook'),
                    type: 'toggle',
                    value: Boolean(filters.instantBook),
                },
            );
        }

        sections.push({
            id: 'amenities',
            title: t('search.filters.amenities'),
            type: 'chips',
            multiple: true,
            options: AMENITIES.map((amenity) => {
                const nameKey = getAmenityById(amenity)?.nameKey;
                return {
                    id: amenity,
                    label: nameKey ? t(nameKey) : amenity,
                    value: amenity,
                };
            }),
            value: filters.amenities ?? [],
        });

        return sections;
    }, [t, filters, mode, locale]);

    return (
        <FiltersBottomSheet
            sections={filterSections}
            onFilterChange={onFilterChange}
            onApply={onApply}
            onClear={onClear}
        />
    );
}

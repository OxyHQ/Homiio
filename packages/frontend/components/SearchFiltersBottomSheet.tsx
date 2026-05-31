import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FiltersBottomSheet, FilterSection, FilterValue } from '@/components/FiltersBar/FiltersBottomSheet';
import { useRentalMode } from '@/context/RentalModeContext';
import { CancellationPolicy, ListingIntent } from '@homiio/shared-types';

/**
 * Shared filter shape used by SearchScreen + SearchBar quick filters.
 *
 * The schema is intentionally permissive about long-term vs vacation fields
 * because the same listing can appear in either mode. Sections are gated by
 * the active mode at render time (see `filterSections` below) rather than at
 * the type level.
 */
export interface SearchFilters {
    minPrice: number;
    maxPrice: number;
    bedrooms: number | string;
    bathrooms: number | string;
    type?: string;
    /** Listing type to scope to (rent / sale / exchange). Undefined = any. */
    intent?: ListingIntent;
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

const LISTING_TYPES = [
    { id: ListingIntent.RENT, label: 'listing.intent.rent', fallback: 'Rent' },
    { id: ListingIntent.SALE, label: 'listing.intent.sale', fallback: 'For sale' },
    { id: ListingIntent.EXCHANGE, label: 'listing.intent.exchange', fallback: 'Exchange' },
];

const PROPERTY_TYPES_LONG_TERM = [
    { id: 'apartment', label: 'Apartments' },
    { id: 'house', label: 'Houses' },
    { id: 'room', label: 'Rooms' },
    { id: 'studio', label: 'Studios' },
];

const PROPERTY_TYPES_VACATION = [
    { id: 'apartment', label: 'Apartments' },
    { id: 'house', label: 'Whole houses' },
    { id: 'room', label: 'Private rooms' },
    { id: 'studio', label: 'Studios' },
];

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

const LEASE_DURATIONS = [
    { id: '3_months', label: '3 months' },
    { id: '6_months', label: '6 months' },
    { id: '12_months', label: '12 months' },
    { id: 'flexible', label: 'Flexible' },
];

const CANCELLATION_POLICIES = [
    { id: CancellationPolicy.FLEXIBLE, label: 'Flexible' },
    { id: CancellationPolicy.MODERATE, label: 'Moderate' },
    { id: CancellationPolicy.STRICT, label: 'Strict' },
    { id: CancellationPolicy.SUPER_STRICT, label: 'Super strict' },
];

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
                id: 'intent',
                title: t('search.filters.listingType', 'Listing type'),
                type: 'chips',
                options: LISTING_TYPES.map((listingType) => ({
                    id: listingType.id,
                    label: t(listingType.label, listingType.fallback),
                    value: listingType.id,
                })),
                value: filters.intent,
            },
            {
                id: 'type',
                title: t('Property Type'),
                type: 'chips',
                options: propertyTypes.map((type) => ({
                    id: type.id,
                    label: t(type.label),
                    value: type.id,
                })),
                value: filters.type,
            },
            {
                id: 'price',
                title: mode === 'vacation' ? t('Nightly price') : t('Monthly price'),
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
                title: t('Bedrooms'),
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
                title: t('Bathrooms'),
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
                    title: t('Check-in'),
                    type: 'date',
                    value: filters.checkIn || '',
                    placeholder: t('Add date'),
                },
                {
                    id: 'checkOut',
                    title: t('Check-out'),
                    type: 'date',
                    value: filters.checkOut || '',
                    placeholder: t('Add date'),
                },
                {
                    id: 'guests',
                    title: t('Guests'),
                    type: 'counter',
                    value: typeof filters.guests === 'number' ? filters.guests : 0,
                },
                {
                    id: 'instantBook',
                    title: t('Instant book'),
                    type: 'toggle',
                    value: Boolean(filters.instantBook),
                },
                {
                    id: 'cancellationPolicy',
                    title: t('Cancellation policy'),
                    type: 'chips',
                    options: CANCELLATION_POLICIES.map((policy) => ({
                        id: policy.id,
                        label: t(policy.label),
                        value: policy.id,
                    })),
                    value: filters.cancellationPolicy,
                },
            );
        } else {
            sections.push(
                {
                    id: 'moveIn',
                    title: t('Move-in date'),
                    type: 'date',
                    value: filters.moveIn || '',
                    placeholder: t('Add date'),
                },
                {
                    id: 'leaseDuration',
                    title: t('Lease duration'),
                    type: 'chips',
                    options: LEASE_DURATIONS.map((duration) => ({
                        id: duration.id,
                        label: t(duration.label),
                        value: duration.id,
                    })),
                    value: filters.leaseDuration,
                },
                {
                    id: 'maxDeposit',
                    title: t('Max deposit'),
                    type: 'range',
                    min: 0,
                    max: 10000,
                    value: typeof filters.maxDeposit === 'number' ? [0, filters.maxDeposit] : undefined,
                },
                {
                    id: 'furnished',
                    title: t('Furnished'),
                    type: 'toggle',
                    value: Boolean(filters.furnished),
                },
            );
        }

        sections.push({
            id: 'amenities',
            title: t('Amenities'),
            type: 'chips',
            options: AMENITIES.map((amenity) => ({
                id: amenity,
                label: t(amenity.replace('_', ' ')),
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

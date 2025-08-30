import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FiltersBottomSheet, FilterSection } from '@/components/FiltersBar/FiltersBottomSheet';

interface Filters {
    minPrice: number;
    maxPrice: number;
    bedrooms: number | string;
    bathrooms: number | string;
    type?: string;
    amenities?: string[];
}

interface SearchFiltersBottomSheetProps {
    filters: Filters;
    onFilterChange: (sectionId: string, value: any) => void;
    onApply: () => void;
    onClear: () => void;
}

const PROPERTY_TYPES = [
    { id: 'apartment', label: 'Apartments', icon: 'business-outline' },
    { id: 'house', label: 'Houses', icon: 'home-outline' },
    { id: 'room', label: 'Rooms', icon: 'bed-outline' },
    { id: 'studio', label: 'Studios', icon: 'square-outline' },
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

export function SearchFiltersBottomSheet({
    filters,
    onFilterChange,
    onApply,
    onClear,
}: SearchFiltersBottomSheetProps) {
    const { t } = useTranslation();

    const filterSections: FilterSection[] = useMemo(() => [
        {
            id: 'type',
            title: t('Property Type'),
            type: 'chips',
            options: PROPERTY_TYPES.map(type => ({
                id: type.id,
                label: t(type.label),
                value: type.id
            })),
            value: filters.type
        },
        {
            id: 'price',
            title: t('Price Range'),
            type: 'range',
            min: 0,
            max: 10000,
            value: filters.minPrice || filters.maxPrice ? [filters.minPrice, filters.maxPrice] : undefined
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
            value: filters.bedrooms?.toString()
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
            value: filters.bathrooms?.toString()
        },
        {
            id: 'amenities',
            title: t('Amenities'),
            type: 'chips',
            options: AMENITIES.map(amenity => ({
                id: amenity,
                label: t(amenity.replace('_', ' ')),
                value: amenity
            })),
            value: filters.amenities
        }
    ], [t, filters]);

    return (
        <FiltersBottomSheet
            sections={filterSections}
            onFilterChange={onFilterChange}
            onApply={onApply}
            onClear={onClear}
        />
    );
}

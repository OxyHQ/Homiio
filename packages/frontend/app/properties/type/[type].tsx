import React, { useEffect, useState, useMemo, useCallback , useContext } from 'react';
import { View, StyleSheet, ScrollView, RefreshControl, Platform } from 'react-native';
import { useLocalSearchParams , useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useProperties } from '@/hooks';
import { PropertyCard } from '@/components/PropertyCard';
import { ThemedText } from '@/components/ThemedText';
import { colors } from '@/styles/colors';
import { phuduFontWeights } from '@/styles/fonts';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { FiltersBar } from '@/components/FiltersBar';
import { FiltersBottomSheet, FilterSection, FilterValue } from '@/components/FiltersBar/FiltersBottomSheet';

import { Property as BaseProperty } from '@homiio/shared-types';

interface Property extends Omit<BaseProperty, '_id'> {
    _id?: string;
    id?: string;
}

export default function PropertyTypeScreen() {
    const { type } = useLocalSearchParams();
    const { t } = useTranslation();
    const router = useRouter();
    const [refreshing, setRefreshing] = useState(false);
    const { openBottomSheet, closeBottomSheet } = useContext(BottomSheetContext);
    const [filters, setFilters] = useState({
        priceMin: '',
        priceMax: '',
        bedrooms: '',
        bathrooms: '',
        amenities: [] as string[],
        sortBy: 'newest'
    });

    const filterSections: FilterSection[] = useMemo(() => [
        {
            id: 'price',
            title: t('properties.type.filters.price'),
            type: 'range',
            min: 0,
            max: 10000,
            value: filters.priceMin || filters.priceMax ? [parseInt(filters.priceMin), parseInt(filters.priceMax)] : undefined
        },
        {
            id: 'bedrooms',
            title: t('properties.type.filters.bedrooms'),
            type: 'chips',
            options: [
                { id: '1', label: '1', value: '1' },
                { id: '2', label: '2', value: '2' },
                { id: '3', label: '3', value: '3' },
                { id: '4', label: '4', value: '4' },
                { id: '5', label: '5+', value: '5' },
            ],
            value: filters.bedrooms
        },
        {
            id: 'bathrooms',
            title: t('properties.type.filters.bathrooms'),
            type: 'chips',
            options: [
                { id: '1', label: '1', value: '1' },
                { id: '2', label: '2', value: '2' },
                { id: '3', label: '3', value: '3' },
                { id: '4', label: '4+', value: '4' },
            ],
            value: filters.bathrooms
        }
    ], [t, filters]);

    const handleFilterChange = useCallback((sectionId: string, value: FilterValue | FilterValue[]) => {
        setFilters(prev => {
            switch (sectionId) {
                case 'price':
                    if (Array.isArray(value)) {
                        return {
                            ...prev,
                            priceMin: value[0]?.toString() || '',
                            priceMax: value[1]?.toString() || ''
                        };
                    }
                    return prev;
                case 'bedrooms':
                    return { ...prev, bedrooms: value.toString() };
                case 'bathrooms':
                    return { ...prev, bathrooms: value.toString() };
                default:
                    return prev;
            }
        });
    }, []);

    const handleOpenFilters = useCallback(() => {
        openBottomSheet(
            <FiltersBottomSheet
                sections={filterSections}
                onFilterChange={handleFilterChange}
                onApply={closeBottomSheet}
                onClear={() => {
                    setFilters({
                        priceMin: '',
                        priceMax: '',
                        bedrooms: '',
                        bathrooms: '',
                        amenities: [],
                        sortBy: 'newest'
                    });
                    closeBottomSheet();
                }}
            />
        );
    }, [openBottomSheet, closeBottomSheet, filterSections, handleFilterChange]);

    // Get properties data
    const { properties, loading: propertiesLoading, loadProperties } = useProperties();

    // Filter and sort properties
    const filteredProperties = useMemo(() => {
        let filtered = properties?.filter((property) => property.type === type) || [];

        // Apply price filter
        if (filters.priceMin) {
            filtered = filtered.filter(p => p.rent.amount >= parseInt(filters.priceMin));
        }
        if (filters.priceMax) {
            filtered = filtered.filter(p => p.rent.amount <= parseInt(filters.priceMax));
        }

        // Apply bedroom filter
        if (filters.bedrooms) {
            filtered = filtered.filter(p => p.bedrooms === parseInt(filters.bedrooms));
        }

        // Apply bathroom filter
        if (filters.bathrooms) {
            filtered = filtered.filter(p => p.bathrooms === parseInt(filters.bathrooms));
        }

        // Apply amenities filter
        if (filters.amenities.length > 0) {
            filtered = filtered.filter(p =>
                filters.amenities.every(amenity => p.amenities?.includes(amenity))
            );
        }

        // Apply sorting
        switch (filters.sortBy) {
            case 'priceAsc':
                filtered.sort((a, b) => a.rent.amount - b.rent.amount);
                break;
            case 'priceDesc':
                filtered.sort((a, b) => b.rent.amount - a.rent.amount);
                break;
            case 'newest':
            default:
                filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                break;
        }

        return filtered;
    }, [properties, type, filters]);

    // Load properties on component mount
    useEffect(() => {
        loadProperties({
            limit: 50,
            status: 'available',
            type: type as string,
        });
    }, [loadProperties, type]);

    const onRefresh = React.useCallback(async () => {
        setRefreshing(true);
        try {
            await loadProperties({
                limit: 50,
                status: 'available',
                type: type as string,
            });
        } catch (error) {
            console.error('Error refreshing data:', error);
        } finally {
            setRefreshing(false);
        }
    }, [loadProperties, type]);

    // Get the type name from the type ID
    const getTypeName = (typeId: string) => {
        const typeMap: { [key: string]: string } = {
            apartment: t('search.propertyType.apartments'),
            house: t('search.propertyType.houses'),
            room: t('search.propertyType.rooms'),
            studio: t('search.propertyType.studios'),
            coliving: t('search.propertyType.coliving'),
            public_housing: t('search.propertyType.publicHousing'),
        };
        return typeMap[typeId] || typeId;
    };

    return (
        <ScrollView
            style={styles.container}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
            <View style={styles.header}>
                <ThemedText style={styles.title}>
                    {t('properties.type.title', { type: getTypeName(type as string) })}
                </ThemedText>
                <ThemedText style={styles.subtitle}>
                    {t('properties.type.subtitle', {
                        count: filteredProperties.length,
                        type: getTypeName(type as string).toLowerCase(),
                    })}
                </ThemedText>
            </View>

            <FiltersBar
                activeFiltersCount={
                    Object.values(filters).filter(value =>
                        value !== '' &&
                        value !== 'newest' &&
                        (Array.isArray(value) ? value.length > 0 : true)
                    ).length
                }
                onFilterPress={handleOpenFilters}
                sortBy={filters.sortBy}
                onSortPress={() => {
                    openBottomSheet(
                        <FiltersBottomSheet
                            sections={[
                                {
                                    id: 'sort',
                                    title: t('properties.type.filters.sort.title'),
                                    type: 'chips',
                                    options: [
                                        { id: 'newest', label: t('properties.type.filters.sort.newest'), value: 'newest' },
                                        { id: 'priceAsc', label: t('properties.type.filters.sort.priceAsc'), value: 'priceAsc' },
                                        { id: 'priceDesc', label: t('properties.type.filters.sort.priceDesc'), value: 'priceDesc' },
                                    ],
                                    value: filters.sortBy
                                }
                            ]}
                            onFilterChange={(_, value) => setFilters(prev => ({ ...prev, sortBy: value.toString() }))}
                            onApply={closeBottomSheet}
                            onClear={() => {
                                setFilters(prev => ({ ...prev, sortBy: 'newest' }));
                                closeBottomSheet();
                            }}
                        />
                    );
                }}
            />

            {propertiesLoading ? (
                <View style={styles.loadingContainer}>
                    <ThemedText style={styles.loadingText}>{t('common.loading')}</ThemedText>
                </View>
            ) : filteredProperties.length === 0 ? (
                <View style={styles.emptyContainer}>
                    <ThemedText style={styles.emptyText}>
                        {t('properties.type.empty', { type: getTypeName(type as string).toLowerCase() })}
                    </ThemedText>
                </View>
            ) : (
                <View style={styles.propertiesGrid}>
                    {filteredProperties.map((property) => (
                        <View key={property._id || property.id} style={styles.propertyCardWrapper}>
                            <PropertyCard
                                property={property}
                                variant="default"
                                onPress={() => router.push(`/properties/${property._id || property.id}`)}
                            />
                        </View>
                    ))}
                </View>
            )}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    header: {
        padding: 16,
        marginBottom: 16,
    },
    title: {
        fontSize: 28,
        color: colors.COLOR_BLACK,
        fontFamily: phuduFontWeights.bold,
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_3,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    loadingText: {
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_3,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    emptyText: {
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_3,
        textAlign: 'center',
    },
    propertiesGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        padding: 8,
        gap: 16,
    },
    propertyCardWrapper: {
        width: '100%',
        maxWidth: '100%',
        ...Platform.select({
            web: {
                flex: 1,
                minWidth: 300,
                maxWidth: 400,
            },
            default: {
                width: '100%',
            },
        }),
    },
});

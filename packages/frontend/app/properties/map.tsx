import React, { useState, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    FlatList,
    ActivityIndicator,
    RefreshControl,
    Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/styles/colors';
import { PropertiesMap } from '@/components/PropertiesMap';
import { PropertyCard } from '@/components/PropertyCard';
import { useProperties } from '@/hooks/usePropertyQueries';
import { Property, PropertyFilters } from '@/services/propertyService';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';

interface MapProperty extends Property {
    title: string;
    location: string;
}

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const PROPERTY_TYPES = [
    { id: 'apartment', label: 'Apartments' },
    { id: 'house', label: 'Houses' },
    { id: 'room', label: 'Rooms' },
    { id: 'studio', label: 'Studios' },
];

export default function PropertiesMapScreen() {
    const { t } = useTranslation();
    const router = useRouter();

    // State management
    const [viewMode, setViewMode] = useState<'map' | 'list'>('map');
    const [searchQuery, setSearchQuery] = useState('');
    const [filters, setFilters] = useState<PropertyFilters>({
        page: 1,
        limit: 50, // Load more properties for map view
    });
    const [showFilters, setShowFilters] = useState(false);
    const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
    const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
    const [mapCenter, setMapCenter] = useState({ lat: 40.7128, lng: -74.0060 }); // Default to NYC

    // Data fetching
    const {
        data: propertiesData,
        isLoading,
        error,
        refetch,
    } = useProperties(filters);

    const properties = propertiesData?.properties || [];
    const totalResults = propertiesData?.total || 0;

    // Transform properties for map display
    const mapProperties: MapProperty[] = properties
        .filter(property => property.address?.coordinates?.lat && property.address?.coordinates?.lng)
        .map(property => ({
            ...property,
            title: generatePropertyTitle(property),
            location: `${property.address.street}, ${property.address.city}, ${property.address.state}`,
        }));

    // Update map center based on properties
    useEffect(() => {
        if (mapProperties.length > 0) {
            const validProperties = mapProperties.filter(p =>
                p.address.coordinates?.lat && p.address.coordinates?.lng
            );

            if (validProperties.length > 0) {
                const avgLat = validProperties.reduce((sum, p) => sum + (p.address.coordinates?.lat || 0), 0) / validProperties.length;
                const avgLng = validProperties.reduce((sum, p) => sum + (p.address.coordinates?.lng || 0), 0) / validProperties.length;
                setMapCenter({ lat: avgLat, lng: avgLng });
            }
        }
    }, [mapProperties]);

    // Handle search
    const handleSearch = useCallback(() => {
        const newFilters: PropertyFilters = {
            ...filters,
            search: searchQuery.trim() || undefined,
            type: selectedTypes.length > 0 ? selectedTypes.join(',') : undefined,
            page: 1, // Reset to first page on new search
        };
        setFilters(newFilters);
    }, [searchQuery, filters, selectedTypes]);

    // Handle load more
    const handleLoadMore = () => {
        if (properties.length < totalResults) {
            setFilters(prev => ({
                ...prev,
                page: (prev.page || 1) + 1,
            }));
        }
    };

    // Filter handlers
    const togglePropertyType = (type: string) => {
        setSelectedTypes(prev =>
            prev.includes(type)
                ? prev.filter(t => t !== type)
                : [...prev, type]
        );
    };

    const clearFilters = () => {
        setSelectedTypes([]);
        setSearchQuery('');
        setFilters({
            page: 1,
            limit: 50,
        });
    };

    // Property selection handlers
    const handlePropertySelect = (property: Property) => {
        setSelectedProperty(property);
        if (property.address?.coordinates?.lat && property.address?.coordinates?.lng) {
            setMapCenter({
                lat: property.address.coordinates.lat,
                lng: property.address.coordinates.lng,
            });
        }
    };

    const handlePropertyPress = (property: Property) => {
        router.push(`/properties/${property._id || property.id}`);
    };

    // Render filter section
    const renderFilterSection = () => (
        <View style={styles.filterSection}>
            <View style={styles.filterHeader}>
                <Text style={styles.filterTitle}>{t('Filters')}</Text>
                <TouchableOpacity onPress={clearFilters}>
                    <Text style={styles.clearFiltersText}>{t('Clear All')}</Text>
                </TouchableOpacity>
            </View>

            {/* Property Types */}
            <View style={styles.filterGroup}>
                <Text style={styles.filterGroupTitle}>{t('Property Type')}</Text>
                <View style={styles.filterChips}>
                    {PROPERTY_TYPES.map((type) => (
                        <TouchableOpacity
                            key={type.id}
                            style={[
                                styles.filterChip,
                                selectedTypes.includes(type.id) && styles.filterChipActive,
                            ]}
                            onPress={() => togglePropertyType(type.id)}
                        >
                            <Text
                                style={[
                                    styles.filterChipText,
                                    selectedTypes.includes(type.id) && styles.filterChipTextActive,
                                ]}
                            >
                                {t(type.label)}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>
        </View>
    );

    // Render property list item
    const renderPropertyItem = ({ item }: { item: Property }) => (
        <PropertyCard
            id={item._id || item.id || ''}
            title={generatePropertyTitle(item)}
            location={`${item.address.street}, ${item.address.city}, ${item.address.state}`}
            price={item.rent.amount}
            currency="$"
            type={item.type as any}
            imageUrl={item.images?.[0] || ''}
            bedrooms={item.bedrooms || 0}
            bathrooms={item.bathrooms || 0}
            size={item.squareFootage || 0}
            onPress={() => handlePropertyPress(item)}
        />
    );

    // Render empty state
    const renderEmptyState = () => (
        <View style={styles.emptyState}>
            <Text style={styles.emptyStateTitle}>{t('No Properties Found')}</Text>
            <Text style={styles.emptyStateSubtitle}>
                {t('Try adjusting your search criteria or filters')}
            </Text>
        </View>
    );

    // Render error state
    const renderErrorState = () => (
        <View style={styles.errorState}>
            <Text style={styles.errorStateTitle}>{t('Error Loading Properties')}</Text>
            <Text style={styles.errorStateSubtitle}>
                {error?.message || t('Please try again later')}
            </Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
                <Text style={styles.retryButtonText}>{t('Retry')}</Text>
            </TouchableOpacity>
        </View>
    );

    return (
        <SafeAreaView style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Text style={styles.backButtonText}>←</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{t('Properties Map')}</Text>
                <TouchableOpacity onPress={() => setShowFilters(!showFilters)} style={styles.filterButton}>
                    <Text style={styles.filterButtonText}>⚙️</Text>
                </TouchableOpacity>
            </View>

            {/* Search Bar */}
            <View style={styles.searchContainer}>
                <View style={styles.searchInputContainer}>
                    <Text style={styles.searchIcon}>🔍</Text>
                    <TextInput
                        style={styles.searchInput}
                        placeholder={t('Search properties...')}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        onSubmitEditing={handleSearch}
                        returnKeyType="search"
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => setSearchQuery('')}>
                            <Text style={styles.clearIcon}>✕</Text>
                        </TouchableOpacity>
                    )}
                </View>
                <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
                    <Text style={styles.searchButtonText}>{t('Search')}</Text>
                </TouchableOpacity>
            </View>

            {/* View Mode Toggle */}
            <View style={styles.viewModeToggle}>
                <TouchableOpacity
                    style={[styles.viewModeButton, viewMode === 'map' && styles.viewModeButtonActive]}
                    onPress={() => setViewMode('map')}
                >
                    <Text style={styles.viewModeButtonIcon}>🗺️</Text>
                    <Text
                        style={[
                            styles.viewModeButtonText,
                            viewMode === 'map' && styles.viewModeButtonTextActive,
                        ]}
                    >
                        {t('Map')}
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.viewModeButton, viewMode === 'list' && styles.viewModeButtonActive]}
                    onPress={() => setViewMode('list')}
                >
                    <Text style={styles.viewModeButtonIcon}>📋</Text>
                    <Text
                        style={[
                            styles.viewModeButtonText,
                            viewMode === 'list' && styles.viewModeButtonTextActive,
                        ]}
                    >
                        {t('List')}
                    </Text>
                </TouchableOpacity>
            </View>

            {/* Filters */}
            {showFilters && renderFilterSection()}

            {/* Content */}
            {isLoading && !properties.length ? (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.primaryColor} />
                    <Text style={styles.loadingText}>{t('Loading properties...')}</Text>
                </View>
            ) : error && !properties.length ? (
                renderErrorState()
            ) : properties.length === 0 ? (
                renderEmptyState()
            ) : viewMode === 'map' ? (
                /* Map View */
                <View style={styles.mapContainer}>
                    <PropertiesMap
                        properties={mapProperties}
                        center={mapCenter}
                        zoom={12}
                        height={screenHeight * 0.6}
                        onPropertySelect={handlePropertySelect}
                        onPropertyPress={handlePropertyPress}
                        selectedPropertyId={selectedProperty?._id}
                    />

                    {/* Selected Property Details */}
                    {selectedProperty && (
                        <View style={styles.selectedPropertyContainer}>
                            <PropertyCard
                                id={selectedProperty._id || selectedProperty.id || ''}
                                title={generatePropertyTitle(selectedProperty)}
                                location={`${selectedProperty.address.street}, ${selectedProperty.address.city}, ${selectedProperty.address.state}`}
                                price={selectedProperty.rent.amount}
                                currency="$"
                                type={selectedProperty.type as any}
                                imageUrl={selectedProperty.images?.[0] || ''}
                                bedrooms={selectedProperty.bedrooms || 0}
                                bathrooms={selectedProperty.bathrooms || 0}
                                size={selectedProperty.squareFootage || 0}
                                onPress={() => handlePropertyPress(selectedProperty)}
                            />
                            <TouchableOpacity
                                style={styles.closeSelectedButton}
                                onPress={() => setSelectedProperty(null)}
                            >
                                <Text style={styles.closeButtonText}>✕</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    {/* Properties List Overlay */}
                    <View style={styles.propertiesListOverlay}>
                        <Text style={styles.propertiesListTitle}>
                            {t('Properties')} ({mapProperties.length})
                        </Text>
                        <FlatList
                            data={mapProperties.slice(0, 5)} // Show first 5 properties
                            renderItem={({ item }) => (
                                <TouchableOpacity
                                    style={styles.propertyListItem}
                                    onPress={() => handlePropertySelect(item)}
                                >
                                    <Text style={styles.propertyListItemTitle} numberOfLines={1}>
                                        {item.title}
                                    </Text>
                                    <Text style={styles.propertyListItemPrice}>
                                        ${item.rent.amount}/{item.rent.paymentFrequency}
                                    </Text>
                                </TouchableOpacity>
                            )}
                            keyExtractor={(item) => item._id || item.id || ''}
                            horizontal
                            showsHorizontalScrollIndicator={false}
                        />
                    </View>
                </View>
            ) : (
                /* List View */
                <FlatList
                    data={properties}
                    renderItem={renderPropertyItem}
                    keyExtractor={(item) => item._id || item.id || ''}
                    contentContainerStyle={styles.listContainer}
                    refreshControl={
                        <RefreshControl refreshing={isLoading} onRefresh={refetch} />
                    }
                    onEndReached={handleLoadMore}
                    onEndReachedThreshold={0.1}
                    ListFooterComponent={
                        isLoading && properties.length > 0 ? (
                            <View style={styles.loadingMore}>
                                <ActivityIndicator size="small" color={colors.primaryColor} />
                                <Text style={styles.loadingMoreText}>{t('Loading more...')}</Text>
                            </View>
                        ) : null
                    }
                />
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.primaryLight,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.primaryLight_1,
    },
    backButton: {
        padding: 8,
    },
    backButtonText: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
    },
    filterButton: {
        padding: 8,
    },
    filterButtonText: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
    },
    searchContainer: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 12,
    },
    searchInputContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.primaryLight_1,
        borderRadius: 8,
        paddingHorizontal: 12,
    },
    searchInput: {
        flex: 1,
        paddingVertical: 12,
        paddingHorizontal: 8,
        fontSize: 16,
        color: colors.primaryDark,
    },
    searchIcon: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
    },
    clearIcon: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryColor,
    },
    searchButton: {
        backgroundColor: colors.primaryColor,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 8,
        justifyContent: 'center',
    },
    searchButtonText: {
        color: 'white',
        fontWeight: '600',
        fontSize: 16,
    },
    viewModeToggle: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        paddingBottom: 12,
        gap: 8,
    },
    viewModeButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.primaryColor,
        gap: 8,
    },
    viewModeButtonActive: {
        backgroundColor: colors.primaryColor,
    },
    viewModeButtonText: {
        fontSize: 16,
        fontWeight: '500',
        color: colors.primaryColor,
    },
    viewModeButtonTextActive: {
        color: 'white',
    },
    viewModeButtonIcon: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
    },
    filterSection: {
        backgroundColor: colors.primaryLight_1,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.primaryLight_1,
    },
    filterHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    filterTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryDark,
    },
    clearFiltersText: {
        fontSize: 14,
        color: colors.primaryColor,
        fontWeight: '500',
    },
    filterGroup: {
        marginBottom: 16,
    },
    filterGroupTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.primaryDark,
        marginBottom: 8,
    },
    filterChips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    filterChip: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.primaryColor,
        gap: 4,
    },
    filterChipActive: {
        backgroundColor: colors.primaryColor,
    },
    filterChipText: {
        fontSize: 12,
        color: colors.primaryColor,
        fontWeight: '500',
    },
    filterChipTextActive: {
        color: 'white',
    },
    mapContainer: {
        flex: 1,
        position: 'relative',
    },
    selectedPropertyContainer: {
        position: 'absolute',
        bottom: 20,
        left: 16,
        right: 16,
        backgroundColor: 'white',
        borderRadius: 12,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
    },
    closeSelectedButton: {
        position: 'absolute',
        top: 8,
        right: 8,
        backgroundColor: colors.primaryColor,
        borderRadius: 12,
        width: 24,
        height: 24,
        justifyContent: 'center',
        alignItems: 'center',
    },
    closeButtonText: {
        fontSize: 18,
        fontWeight: '600',
        color: 'white',
    },
    propertiesListOverlay: {
        position: 'absolute',
        top: 20,
        left: 16,
        right: 16,
        backgroundColor: 'white',
        borderRadius: 12,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
    },
    propertiesListTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryDark,
        marginBottom: 12,
    },
    propertyListItem: {
        backgroundColor: colors.primaryLight_1,
        padding: 12,
        borderRadius: 8,
        marginRight: 8,
        minWidth: 120,
    },
    propertyListItemTitle: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.primaryDark,
        marginBottom: 4,
    },
    propertyListItemPrice: {
        fontSize: 12,
        color: colors.primaryColor,
        fontWeight: '600',
    },
    infoWindow: {
        backgroundColor: 'white',
        borderRadius: 8,
        padding: 12,
        minWidth: 200,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 4,
    },
    infoWindowTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.primaryDark,
        marginBottom: 4,
    },
    infoWindowLocation: {
        fontSize: 12,
        color: colors.primaryLight_1,
        marginBottom: 8,
    },
    infoWindowPrice: {
        fontSize: 16,
        fontWeight: '700',
        color: colors.primaryColor,
        marginBottom: 12,
    },
    infoWindowActions: {
        flexDirection: 'row',
        gap: 8,
    },
    infoWindowButton: {
        flex: 1,
        backgroundColor: colors.primaryColor,
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 6,
        alignItems: 'center',
    },
    infoWindowButtonSecondary: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: colors.primaryColor,
    },
    infoWindowButtonText: {
        fontSize: 12,
        fontWeight: '600',
        color: 'white',
    },
    infoWindowButtonTextSecondary: {
        color: colors.primaryColor,
    },
    listContainer: {
        padding: 16,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        marginTop: 12,
        fontSize: 16,
        color: colors.primaryDark,
    },
    loadingMore: {
        paddingVertical: 20,
        alignItems: 'center',
    },
    loadingMoreText: {
        marginTop: 8,
        fontSize: 14,
        color: colors.primaryLight_1,
    },
    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
    },
    emptyStateTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
        marginTop: 16,
        marginBottom: 8,
    },
    emptyStateSubtitle: {
        fontSize: 14,
        color: colors.primaryLight_1,
        textAlign: 'center',
        lineHeight: 20,
    },
    errorState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
    },
    errorStateTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
        marginTop: 16,
        marginBottom: 8,
    },
    errorStateSubtitle: {
        fontSize: 14,
        color: colors.primaryLight_1,
        textAlign: 'center',
        lineHeight: 20,
        marginBottom: 16,
    },
    retryButton: {
        backgroundColor: colors.primaryColor,
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 8,
    },
    retryButtonText: {
        color: 'white',
        fontWeight: '600',
        fontSize: 16,
    },
}); 
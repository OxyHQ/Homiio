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
    Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/styles/colors';
import { PropertiesMap } from '@/components/PropertiesMap';
import { PropertyCard } from '@/components/PropertyCard';
import { useProperties } from '@/hooks';
import { Property, PropertyFilters } from '@/services/propertyService';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { SearchBar } from '@/components/SearchBar';
import { Ionicons } from '@expo/vector-icons';

interface MapProperty extends Property {
    title: string;
    location: string;
}

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const IconComponent = Ionicons as any;

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
        limit: 50,
    });
    const [showFilters, setShowFilters] = useState(false);
    const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
    const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
    const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);

    // Data fetching
    const {
        properties,
        loading: isLoading,
        error,
        pagination,
        loadProperties,
    } = useProperties();

    const totalResults = pagination.total || 0;

    // Load properties on mount
    useEffect(() => {
        loadProperties(filters);
    }, []);

    // Transform properties for map display
    const mapProperties: MapProperty[] = properties
        .filter(property => property.address?.coordinates?.lat && property.address?.coordinates?.lng)
        .map(property => ({
            ...property,
            title: generatePropertyTitle(property),
            location: `${property.address?.street || ''}, ${property.address?.city || ''}, ${property.address?.state || ''}`,
        }));

    // Auto-center map on first load
    useEffect(() => {
        if (properties.length > 0 && !mapCenter) {
            const validProperties = properties.filter(p =>
                p.address?.coordinates?.lat && p.address?.coordinates?.lng
            );

            if (validProperties.length > 0) {
                const avgLat = validProperties.reduce((sum, p) => sum + (p.address.coordinates?.lat || 0), 0) / validProperties.length;
                const avgLng = validProperties.reduce((sum, p) => sum + (p.address.coordinates?.lng || 0), 0) / validProperties.length;
                setMapCenter({ lat: avgLat, lng: avgLng });
            }
        }
    }, [properties, mapCenter]);

    // Handle search
    const handleSearch = useCallback((query: string) => {
        setSearchQuery(query);
        const newFilters: PropertyFilters = {
            ...filters,
            search: query.trim() || undefined,
            type: selectedTypes.length > 0 ? selectedTypes.join(',') : undefined,
            page: 1,
        };
        setFilters(newFilters);
        loadProperties(newFilters);
    }, [filters, selectedTypes, loadProperties]);

    // Handle load more
    const handleLoadMore = () => {
        if (properties.length < totalResults) {
            const newFilters = {
                ...filters,
                page: (filters.page || 1) + 1,
            };
            setFilters(newFilters);
            loadProperties(newFilters);
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
        const newFilters = {
            page: 1,
            limit: 50,
        };
        setFilters(newFilters);
        loadProperties(newFilters);
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
            property={item}
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
                {error || t('Please try again later')}
            </Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => loadProperties(filters)}>
                <Text style={styles.retryButtonText}>{t('Retry')}</Text>
            </TouchableOpacity>
        </View>
    );

    // Show error state
    if (error) {
        return (
            <View style={styles.container}>
                <View style={styles.errorContainer}>
                    <Text style={styles.errorTitle}>Failed to load properties</Text>
                    <Text style={styles.errorMessage}>
                        {error || 'An error occurred while loading the properties map.'}
                    </Text>
                    <TouchableOpacity style={styles.retryButton} onPress={() => loadProperties(filters)}>
                        <Text style={styles.retryButtonText}>Try Again</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    return (
        <SafeAreaView style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <IconComponent name="arrow-back" size={24} color={colors.primaryDark} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{t('properties.map')}</Text>
                <TouchableOpacity onPress={() => setShowFilters(!showFilters)} style={styles.filterButton}>
                    <IconComponent name="options-outline" size={24} color={colors.primaryDark} />
                </TouchableOpacity>
            </View>

            {/* Search Bar */}
            <View style={styles.searchContainer}>
                <View style={styles.searchBar}>
                    <IconComponent name="search" size={20} color={colors.COLOR_BLACK_LIGHT_4} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder={t("Search properties")}
                        value={searchQuery}
                        onChangeText={handleSearch}
                        returnKeyType="search"
                    />
                </View>
            </View>

            {/* View Mode Toggle */}
            <View style={styles.viewModeToggle}>
                <TouchableOpacity
                    style={[styles.viewModeButton, viewMode === 'map' && styles.viewModeButtonActive]}
                    onPress={() => setViewMode('map')}
                >
                    <IconComponent name="map-outline" size={20} color={viewMode === 'map' ? 'white' : colors.primaryColor} />
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
                    <IconComponent name="list-outline" size={20} color={viewMode === 'list' ? 'white' : colors.primaryColor} />
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
            ) : properties.length === 0 ? (
                renderEmptyState()
            ) : viewMode === 'map' ? (
                /* Map View */
                <View style={styles.mapContainer}>
                    <PropertiesMap
                        properties={mapProperties}
                        center={mapCenter || undefined}
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
                                property={selectedProperty}
                                onPress={() => handlePropertyPress(selectedProperty)}
                            />
                            <TouchableOpacity
                                style={styles.closeSelectedButton}
                                onPress={() => setSelectedProperty(null)}
                            >
                                <IconComponent name="close" size={20} color="white" />
                            </TouchableOpacity>
                        </View>
                    )}

                    {/* Properties List Overlay */}
                    <View style={styles.propertiesListOverlay}>
                        <Text style={styles.propertiesListTitle}>
                            {t('Properties')} ({mapProperties.length})
                        </Text>
                        <FlatList
                            data={mapProperties.slice(0, 5)}
                            renderItem={({ item }) => (
                                <TouchableOpacity
                                    style={styles.propertyListItem}
                                    onPress={() => handlePropertySelect(item)}
                                >
                                    <Text style={styles.propertyListItemTitle} numberOfLines={1}>
                                        {item.title}
                                    </Text>
                                    <Text style={styles.propertyListItemPrice}>
                                        ${item.rent?.amount || 0}/{item.rent?.paymentFrequency || 'month'}
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
                        <RefreshControl refreshing={isLoading} onRefresh={() => loadProperties(filters)} />
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

            {/* Debug Info (only in development) */}
            {__DEV__ && (
                <View style={styles.debugContainer}>
                    <Text style={styles.debugText}>
                        Properties: {properties.length} |
                        Map Center: {mapCenter ? `${mapCenter.lat.toFixed(4)}, ${mapCenter.lng.toFixed(4)}` : 'Not set'} |
                        Platform: {Platform.OS}
                    </Text>
                </View>
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
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
    },
    filterButton: {
        padding: 8,
    },
    searchContainer: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: colors.primaryLight,
    },
    searchBar: {
        backgroundColor: colors.primaryLight_1,
        borderRadius: 100,
        height: 45,
        flexDirection: 'row',
        justifyContent: 'flex-start',
        alignItems: 'center',
        paddingStart: 15,
        flex: 1,
        width: '100%',
    },
    searchInput: {
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_4,
        marginHorizontal: 17,
        flex: 1,
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
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 32,
    },
    errorTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: colors.primaryDark,
        marginBottom: 8,
        textAlign: 'center',
    },
    errorMessage: {
        fontSize: 16,
        color: colors.primaryDark_1,
        textAlign: 'center',
        marginBottom: 24,
    },
    debugContainer: {
        padding: 8,
        backgroundColor: colors.primaryLight_1,
    },
    debugText: {
        fontSize: 12,
        color: colors.primaryDark_1,
        textAlign: 'center',
    },
}); 
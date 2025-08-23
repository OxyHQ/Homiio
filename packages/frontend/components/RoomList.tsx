import React, { useEffect, useState, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Image,
    TouchableOpacity,
    ActivityIndicator,
    FlatList,
    RefreshControl,
    ScrollView,
    TextInput,
} from 'react-native';
import { useOxy } from '@oxyhq/services';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors } from '@/styles/colors';
import { propertyService, type Property, type PropertyFilters } from '@/services/propertyService';
import { EmptyState } from '@/components/ui/EmptyState';
import { RoomFilters } from '@/components/RoomFilters';
import { PropertyType } from '@homiio/shared-types';

// Type assertion for Ionicons compatibility
const IconComponent = Ionicons as any;

interface RoomListProps {
    filters?: PropertyFilters;
    onFilterChange?: (filters: PropertyFilters) => void;
}

interface RoomCardProps {
    property: Property;
    matchScore?: number;
}

const RoomCard = React.memo(({ property, matchScore }: RoomCardProps) => {
    const router = useRouter();

    const handlePress = () => {
        router.push(`/properties/${property._id}/`);
    };

    const isAvailable = property.availability?.isAvailable ?? true;
    const primaryImage = propertyService.getPrimaryImageUrl(property);
    const formattedPrice = propertyService.formatPropertyPrice(property);

    // Calculate occupancy status
    const maxOccupants = property.rules?.maxOccupancy ?? 1;
    const currentOccupants = property.occupancy?.currentOccupants?.length ?? 0;
    const isFull = currentOccupants >= maxOccupants;
    const capacityText = `${currentOccupants}/${maxOccupants} occupants`;

    return (
        <TouchableOpacity
            style={styles.roomCard}
            onPress={handlePress}
            activeOpacity={0.7}
        >
            {/* Room Image */}
            <View style={styles.imageContainer}>
                {primaryImage ? (
                    <Image
                        source={{ uri: primaryImage }}
                        style={styles.roomImage}
                        resizeMode="cover"
                    />
                ) : (
                    <View style={[styles.roomImage, styles.placeholderImage]}>
                        <Ionicons name="image-outline" size={32} color={colors.COLOR_BLACK_LIGHT_5} />
                    </View>
                )}
                {/* Match Score Badge */}
                {matchScore > 0 && (
                    <View style={styles.matchScoreBadge}>
                        <Text style={styles.matchScoreText}>{matchScore}% Match</Text>
                    </View>
                )}
            </View>

            {/* Room Details */}
            <View style={styles.detailsContainer}>
                <View style={styles.headerRow}>
                    <Text style={styles.roomName} numberOfLines={1}>
                        {property.title}
                    </Text>
                    <Text style={styles.price}>{formattedPrice}</Text>
                </View>

                {property.parentPropertyId && (
                    <Text style={styles.propertyName} numberOfLines={1}>
                        Part of {property.parentPropertyTitle || 'Larger Property'}
                    </Text>
                )}

                <Text style={styles.location} numberOfLines={1}>
                    {property.address?.city}, {property.address?.state}
                </Text>

                {/* Room Features */}
                <View style={styles.featuresRow}>
                    <View style={styles.feature}>
                        <Ionicons name="bed-outline" size={16} color={colors.primaryDark_1} />
                        <Text style={styles.featureText}>
                            {property.type === PropertyType.ROOM ? 'Room' : propertyService.getPropertyTypeDisplay(property.type)}
                        </Text>
                    </View>
                    {property.squareFootage && (
                        <View style={styles.feature}>
                            <Ionicons name="resize-outline" size={16} color={colors.primaryDark_1} />
                            <Text style={styles.featureText}>{property.squareFootage} sq ft</Text>
                        </View>
                    )}
                    <View style={styles.feature}>
                        <Ionicons name="people-outline" size={16} color={colors.primaryDark_1} />
                        <Text style={styles.featureText}>{capacityText}</Text>
                    </View>
                </View>

                {/* Availability Badge */}
                <View style={[
                    styles.availabilityBadge,
                    { backgroundColor: !isAvailable || isFull ? colors.COLOR_RED_LIGHT_1 : colors.COLOR_GREEN_LIGHT_1 }
                ]}>
                    <Text style={[
                        styles.availabilityText,
                        { color: !isAvailable || isFull ? colors.COLOR_RED : colors.COLOR_GREEN }
                    ]}>
                        {!isAvailable ? 'Unavailable' : isFull ? 'Full' : 'Available'}
                    </Text>
                </View>
            </View>
        </TouchableOpacity>
    );
});
RoomCard.displayName = 'RoomCard';

export function RoomList({ filters, onFilterChange }: RoomListProps) {
    const { oxyServices, activeSessionId } = useOxy();
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [rooms, setRooms] = useState<Property[]>([]);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [showFilters, setShowFilters] = useState(false);

    const loadRooms = useCallback(async (pageNum = 1, refresh = false) => {
        try {
            if (!refresh && (!hasMore || loading)) return;

            if (!refresh) setLoading(true);

            const response = await propertyService.getRooms(
                {
                    ...filters,
                    type: PropertyType.ROOM,
                    page: pageNum,
                    limit: 10,
                    sortBy: filters?.sortBy || 'createdAt',
                    sortOrder: filters?.sortOrder || 'desc'
                },
                oxyServices,
                activeSessionId
            );

            setRooms(prev =>
                refresh ? response.rooms : [...prev, ...response.rooms]
            );
            setHasMore(response.page < response.totalPages);
            setPage(pageNum);
        } catch (error) {
            console.error('Error loading rooms:', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [filters, hasMore, loading, oxyServices, activeSessionId]);

    useEffect(() => {
        loadRooms(1, true);
    }, [loadRooms, filters]);

    const handleRefresh = useCallback(() => {
        setRefreshing(true);
        loadRooms(1, true);
    }, [loadRooms]);

    const handleLoadMore = useCallback(() => {
        if (hasMore && !loading) {
            loadRooms(page + 1);
        }
    }, [hasMore, loading, loadRooms, page]);

    const renderFooter = () => {
        if (!loading || !hasMore) return null;
        return (
            <View style={styles.footerLoader}>
                <ActivityIndicator size="small" color={colors.primaryColor} />
            </View>
        );
    };

    if (loading && rooms.length === 0) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primaryColor} />
            </View>
        );
    }

    if (!loading && rooms.length === 0) {
        return (
            <EmptyState
                icon="bed-outline"
                title="No Rooms Found"
                description="Try adjusting your filters to see more rooms"
                actionText={filters ? "Clear Filters" : undefined}
                actionIcon={filters ? "filter-outline" : undefined}
                onAction={filters ? () => onFilterChange?.({}) : undefined}
            />
        );
    }

    return (
        <View style={styles.container}>
            {/* Header with filter button */}
            <View style={styles.header}>
                <View style={styles.searchBar}>
                    <IconComponent name="search-outline" size={20} color={colors.COLOR_BLACK_LIGHT_5} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search rooms..."
                        placeholderTextColor={colors.COLOR_BLACK_LIGHT_5}
                        onChangeText={text => onFilterChange?.({ ...filters, searchText: text })}
                        value={filters?.searchText}
                    />
                </View>
                <TouchableOpacity
                    style={styles.filterButton}
                    onPress={() => setShowFilters(true)}
                >
                    <IconComponent name="filter" size={20} color={colors.primaryColor} />
                </TouchableOpacity>
            </View>

            {/* Active filters */}
            {filters && Object.keys(filters).length > 0 && (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.filtersRow}
                    contentContainerStyle={styles.filtersContent}
                >
                    {Object.entries(filters).map(([key, value]) => {
                        if (!value || key === 'searchText' || key === 'sortBy' || key === 'sortOrder' || key === 'type') return null;
                        return (
                            <TouchableOpacity
                                key={key}
                                style={styles.filterChip}
                                onPress={() => {
                                    const newFilters = { ...filters };
                                    delete newFilters[key as keyof PropertyFilters];
                                    onFilterChange?.(newFilters);
                                }}
                            >
                                <Text style={styles.filterChipText}>
                                    {key === 'minPrice' ? `$${value}+` :
                                        key === 'maxPrice' ? `Up to $${value}` :
                                            key === 'type' ? propertyService.getPropertyTypeDisplay(value as PropertyType) :
                                                Array.isArray(value) ? `${value.length} selected` : value.toString()}
                                </Text>
                                <IconComponent name="close-circle" size={16} color={colors.primaryColor} />
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>
            )}

            {/* Room list */}
            <FlatList
                data={rooms}
                renderItem={({ item }) => <RoomCard property={item} />}
                keyExtractor={item => item._id}
                contentContainerStyle={styles.listContainer}
                showsVerticalScrollIndicator={false}
                onEndReached={handleLoadMore}
                onEndReachedThreshold={0.5}
                ListFooterComponent={renderFooter}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={handleRefresh}
                        colors={[colors.primaryColor]}
                        tintColor={colors.primaryColor}
                    />
                }
            />

            {/* Filters modal */}
            {showFilters && (
                <View style={StyleSheet.absoluteFill}>
                    <RoomFilters
                        filters={filters || {}}
                        onApplyFilters={onFilterChange || (() => { })}
                        onClose={() => setShowFilters(false)}
                    />
                </View>
            )}
        </View>
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
        padding: 16,
        gap: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
    },
    searchBar: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.primaryLight,
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_6,
        borderRadius: 8,
        paddingHorizontal: 12,
        height: 40,
    },
    searchInput: {
        flex: 1,
        marginLeft: 8,
        fontSize: 14,
        color: colors.primaryDark,
    },
    filterButton: {
        width: 40,
        height: 40,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_6,
        justifyContent: 'center',
        alignItems: 'center',
    },
    filtersRow: {
        maxHeight: 48,
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
    },
    filtersContent: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        gap: 8,
        flexDirection: 'row',
    },
    filterChip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: `${colors.primaryColor}12`,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        gap: 4,
    },
    filterChipText: {
        fontSize: 12,
        color: colors.primaryColor,
        fontWeight: '500',
    },
    listContainer: {
        padding: 16,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    footerLoader: {
        paddingVertical: 16,
        alignItems: 'center',
    },
    roomCard: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
        overflow: 'hidden',
    },
    imageContainer: {
        position: 'relative',
        height: 200,
    },
    roomImage: {
        width: '100%',
        height: '100%',
    },
    placeholderImage: {
        backgroundColor: '#f3f4f6',
        justifyContent: 'center',
        alignItems: 'center',
    },
    matchScoreBadge: {
        position: 'absolute',
        top: 12,
        right: 12,
        backgroundColor: colors.primaryColor,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
    },
    matchScoreText: {
        color: '#ffffff',
        fontSize: 12,
        fontWeight: '600',
    },
    detailsContainer: {
        padding: 16,
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    roomName: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
        flex: 1,
        marginRight: 8,
    },
    price: {
        fontSize: 16,
        fontWeight: '700',
        color: colors.primaryColor,
    },
    propertyName: {
        fontSize: 14,
        color: colors.primaryDark_1,
        marginBottom: 2,
    },
    location: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_5,
        marginBottom: 12,
    },
    featuresRow: {
        flexDirection: 'row',
        marginBottom: 12,
        gap: 16,
    },
    feature: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    featureText: {
        fontSize: 13,
        color: colors.primaryDark_1,
    },
    availabilityBadge: {
        alignSelf: 'flex-start',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
    },
    availabilityText: {
        fontSize: 12,
        fontWeight: '500',
    },
});

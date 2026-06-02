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
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors } from '@/styles/colors';
import { shadowToken } from '@/styles/shadows';
import { propertyService, type Property } from '@/services/propertyService';
import { getPropertyTitle } from '@/utils/propertyUtils';
import { logger } from '@/utils/logger';
import { EmptyState } from '@/components/ui/EmptyState';
import { RoomFilters, type RoomFilterOptions } from '@/components/RoomFilters';
import { PropertyType } from '@homiio/shared-types';

interface RoomListProps {
    filters?: RoomFilterOptions;
    onFilterChange?: (filters: RoomFilterOptions) => void;
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

    const isAvailable = propertyService.isPropertyAvailable(property);
    const primaryImage = propertyService.getPrimaryImageUrl(property);
    const formattedPrice = propertyService.formatPropertyPrice(property);
    const title = getPropertyTitle(property);
    const score = matchScore ?? 0;

    // The property contract does not expose live occupancy, so surface the
    // maximum capacity the listing supports instead of an occupied/total count.
    const maxOccupants = property.rules?.maxGuests ?? property.maxGuests ?? 1;
    const capacityText = `Up to ${maxOccupants} ${maxOccupants === 1 ? 'guest' : 'guests'}`;

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
                {score > 0 && (
                    <View style={styles.matchScoreBadge}>
                        <Text style={styles.matchScoreText}>{score}% Match</Text>
                    </View>
                )}
            </View>

            {/* Room Details */}
            <View style={styles.detailsContainer}>
                <View style={styles.headerRow}>
                    <Text style={styles.roomName} numberOfLines={1}>
                        {title}
                    </Text>
                    <Text style={styles.price}>{formattedPrice}</Text>
                </View>

                <Text style={styles.location} numberOfLines={1}>
                    {[property.address?.cityName, property.address?.regionName].filter(Boolean).join(', ')}
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
                    { backgroundColor: isAvailable ? colors.successSubtle : colors.dangerSubtle }
                ]}>
                    <Text style={[
                        styles.availabilityText,
                        { color: isAvailable ? colors.success : colors.danger }
                    ]}>
                        {isAvailable ? 'Available' : 'Unavailable'}
                    </Text>
                </View>
            </View>
        </TouchableOpacity>
    );
});
RoomCard.displayName = 'RoomCard';

export function RoomList({ filters, onFilterChange }: RoomListProps) {
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

            // Typed as RoomFilterOptions so the room-only `sortBy` / `sortOrder`
            // query params flow through to the (subtype-compatible) PropertyFilters
            // expected by the service and on to the properties list endpoint.
            const params: RoomFilterOptions = {
                ...filters,
                type: PropertyType.ROOM,
                page: pageNum,
                limit: 10,
                sortBy: filters?.sortBy || 'createdAt',
                sortOrder: filters?.sortOrder || 'desc',
            };

            const response = await propertyService.getRooms(params);

            setRooms(prev =>
                refresh ? response.rooms : [...prev, ...response.rooms]
            );
            setHasMore(response.page < response.totalPages);
            setPage(pageNum);
        } catch (error) {
            logger.error('Error loading rooms:', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [filters, hasMore, loading]);

    // Initial load + reload whenever the filters change. The fetch is performed
    // in an inline guarded async function so no setState runs synchronously
    // within the effect (which would cause cascading renders). `loadRooms` is
    // still used by the refresh / load-more event handlers below.
    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const params: RoomFilterOptions = {
                    ...filters,
                    type: PropertyType.ROOM,
                    page: 1,
                    limit: 10,
                    sortBy: filters?.sortBy || 'createdAt',
                    sortOrder: filters?.sortOrder || 'desc',
                };
                const response = await propertyService.getRooms(params);
                if (!active) return;
                setRooms(response.rooms);
                setHasMore(response.page < response.totalPages);
                setPage(1);
            } catch (error) {
                logger.error('Error loading rooms:', error);
            } finally {
                if (active) {
                    setLoading(false);
                    setRefreshing(false);
                }
            }
        })();
        return () => {
            active = false;
        };
    }, [filters]);

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
                    <Ionicons name="search-outline" size={20} color={colors.COLOR_BLACK_LIGHT_5} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search rooms..."
                        placeholderTextColor={colors.COLOR_BLACK_LIGHT_5}
                        onChangeText={text => onFilterChange?.({ ...filters, search: text })}
                        value={filters?.search}
                    />
                </View>
                <TouchableOpacity
                    style={styles.filterButton}
                    onPress={() => setShowFilters(true)}
                >
                    <Ionicons name="filter" size={20} color={colors.primaryColor} />
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
                        if (!value || key === 'search' || key === 'sortBy' || key === 'sortOrder' || key === 'type') return null;
                        return (
                            <TouchableOpacity
                                key={key}
                                style={styles.filterChip}
                                onPress={() => {
                                    const newFilters = { ...filters };
                                    delete newFilters[key as keyof RoomFilterOptions];
                                    onFilterChange?.(newFilters);
                                }}
                            >
                                <Text style={styles.filterChipText}>
                                    {key === 'minRent' ? `$${value}+` :
                                        key === 'maxRent' ? `Up to $${value}` :
                                            Array.isArray(value) ? `${value.length} selected` : String(value)}
                                </Text>
                                <Ionicons name="close-circle" size={16} color={colors.primaryColor} />
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
        backgroundColor: colors.white,
        borderRadius: 12,
        marginBottom: 16,
        ...shadowToken({ y: 2, blur: 4, color: colors.COLOR_BLACK, opacity: 0.1, elevation: 3 }),
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
        backgroundColor: colors.mutedSubtle,
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
        color: colors.primaryForeground,
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

import React, { useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, Image, FlatList, RefreshControl, ScrollView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Badge } from '@oxy.so/bloom/badge';
import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import { Chip } from '@oxy.so/bloom/chip';
import { Dialog } from '@oxy.so/bloom/dialog';
import {
    RiEqualizerLine,
    RiExpandDiagonalSLine,
    RiFilterLine,
    RiGroupLine,
    RiHotelBedLine,
    RiImageLine,
} from '@oxy.so/bloom/icons';
import { Loading } from '@oxy.so/bloom/loading';
import { Search } from '@oxy.so/bloom/search';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { ZoomableImage } from '@/components/ui/ZoomableImage';
import { propertyService, type Property } from '@/services/propertyService';
import { getPropertyTitle } from '@/utils/propertyUtils';
import { logger } from '@/utils/logger';
import { EmptyState } from '@/components/ui/EmptyState';
import { RoomFilters, type RoomFilterOptions } from '@/components/RoomFilters';
import { PropertyType, formatArea, formatMoney } from '@homiio/shared-types';
import { SEARCH_PRICE_CURRENCY } from '@/components/search/types';
import { useFormatting } from '@/utils/format';
import { useColors } from '@/hooks/useThemeColor';
import { spacing } from '@/constants/styles';

const FEATURE_ICON_SIZE = 16;

/** The rooms filter dialog is a bottom sheet on phones and a centred card on wide screens. */
const FILTERS_DIALOG_PLACEMENT = { base: 'bottom', md: 'center' } as const;

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
    const { t } = useTranslation();
    const palette = useColors();
    const formatting = useFormatting();
    const { locale, areaUnitLabels } = formatting;
    // Hover anywhere on the card zooms its photo (web). No card transform.
    const [hovered, setHovered] = useState(false);

    const handlePress = () => {
        router.push(`/properties/${property.id}/`);
    };

    const isAvailable = propertyService.isPropertyAvailable(property);
    const primaryImage = propertyService.getPrimaryImageUrl(property);
    const formattedPrice = propertyService.formatPropertyPrice(property, formatting);
    const title = getPropertyTitle(property);
    const score = matchScore ?? 0;

    // The property contract does not expose live occupancy, so surface the
    // maximum capacity the listing supports instead of an occupied/total count.
    const maxOccupants = property.rules?.maxGuests ?? property.maxGuests ?? 1;

    return (
        // Plain View hosts the web hover; hovering anywhere on the card zooms
        // the photo. The card itself never scales.
        <View
            onPointerEnter={Platform.OS === 'web' ? () => setHovered(true) : undefined}
            onPointerLeave={Platform.OS === 'web' ? () => setHovered(false) : undefined}
            style={styles.cardWrap}
        >
            <Card
                variant="outlined"
                onPress={handlePress}
                accessibilityRole="link"
                accessibilityLabel={title}
                style={styles.roomCard}
            >
                <View style={styles.imageContainer}>
                    {primaryImage ? (
                        <ZoomableImage active={hovered} style={styles.roomImageFill}>
                            <Image source={{ uri: primaryImage }} style={styles.roomImage} resizeMode="cover" />
                        </ZoomableImage>
                    ) : (
                        <View style={[styles.roomImage, styles.placeholderImage, { backgroundColor: palette.backgroundSecondary }]}>
                            <RiImageLine size="2xl" fill={palette.textTertiary} />
                        </View>
                    )}
                    {score > 0 ? (
                        <View style={styles.matchScoreBadge}>
                            <Badge
                                variant="solid"
                                color="primary"
                                content={t('roommates.rooms.match', { score })}
                            />
                        </View>
                    ) : null}
                </View>

                <View style={styles.detailsContainer}>
                    <View style={styles.headerRow}>
                        <BloomText style={styles.roomName} numberOfLines={1}>
                            {title}
                        </BloomText>
                        <BloomText style={[styles.price, { color: palette.primary }]}>{formattedPrice}</BloomText>
                    </View>

                    <BloomText style={[styles.location, { color: palette.textSecondary }]} numberOfLines={1}>
                        {[property.address?.cityName, property.address?.regionName].filter(Boolean).join(', ')}
                    </BloomText>

                    <View style={styles.featuresRow}>
                        <View style={styles.feature}>
                            <RiHotelBedLine width={FEATURE_ICON_SIZE} height={FEATURE_ICON_SIZE} fill={palette.textSecondary} />
                            <BloomText style={[styles.featureText, { color: palette.textSecondary }]}>
                                {property.type === PropertyType.ROOM
                                    ? t('roommates.rooms.roomType')
                                    : propertyService.getPropertyTypeDisplay(property.type)}
                            </BloomText>
                        </View>
                        {property.squareFootage ? (
                            <View style={styles.feature}>
                                <RiExpandDiagonalSLine width={FEATURE_ICON_SIZE} height={FEATURE_ICON_SIZE} fill={palette.textSecondary} />
                                <BloomText style={[styles.featureText, { color: palette.textSecondary }]}>
                                    {formatArea(property.squareFootage, 'sqm', locale, { labels: areaUnitLabels })}
                                </BloomText>
                            </View>
                        ) : null}
                        <View style={styles.feature}>
                            <RiGroupLine width={FEATURE_ICON_SIZE} height={FEATURE_ICON_SIZE} fill={palette.textSecondary} />
                            <BloomText style={[styles.featureText, { color: palette.textSecondary }]}>
                                {t('roommates.rooms.capacity', { count: maxOccupants })}
                            </BloomText>
                        </View>
                    </View>

                    <View style={styles.availability}>
                        <Badge
                            variant="subtle"
                            color={isAvailable ? 'success' : 'error'}
                            content={isAvailable ? t('roommates.rooms.available') : t('roommates.rooms.unavailable')}
                        />
                    </View>
                </View>
            </Card>
        </View>
    );
});
RoomCard.displayName = 'RoomCard';

export function RoomList({ filters, onFilterChange }: RoomListProps) {
    const { t } = useTranslation();
    const { locale } = useFormatting();
    const palette = useColors();
    // A rent filter bound carries the search-filter currency, like every other
    // numeric price filter in the app.
    const rentBound = (value: unknown): string =>
        formatMoney(Number(value), SEARCH_PRICE_CURRENCY, locale, { maximumFractionDigits: 0 });
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
                <Loading size="small" showText={false} />
            </View>
        );
    };

    const filtersDialog = (
        <Dialog
            open={showFilters}
            onClose={() => setShowFilters(false)}
            placement={FILTERS_DIALOG_PLACEMENT}
            header={{ title: t('roommates.rooms.filtersTitle'), largeTitle: false }}
            label={t('roommates.rooms.filtersTitle')}
            // The form scrolls its sections and pins its own footer.
            scrollable={false}
            contentPadding={0}
        >
            {showFilters ? (
                <RoomFilters
                    filters={filters || {}}
                    onApplyFilters={onFilterChange || (() => { })}
                    onClose={() => setShowFilters(false)}
                />
            ) : null}
        </Dialog>
    );

    if (loading && rooms.length === 0) {
        return (
            <View style={styles.loadingContainer}>
                <Loading size="large" showText={false} />
            </View>
        );
    }

    if (!loading && rooms.length === 0) {
        return (
            <>
                <EmptyState
                    icon={RiHotelBedLine}
                    title={t('roommates.rooms.emptyTitle')}
                    description={t('roommates.rooms.emptyDescription')}
                    actionText={filters ? t('properties.city.clearFilters') : undefined}
                    actionIcon={filters ? RiFilterLine : undefined}
                    onAction={filters ? () => onFilterChange?.({}) : undefined}
                />
                {filtersDialog}
            </>
        );
    }

    const activeFilterChips = filters
        ? Object.entries(filters).filter(
              ([key, value]) =>
                  Boolean(value) && key !== 'search' && key !== 'sortBy' && key !== 'sortOrder' && key !== 'type',
          )
        : [];

    return (
        <View style={styles.container}>
            <View style={[styles.header, { borderBottomColor: palette.border }]}>
                <View style={styles.searchBar}>
                    <Search
                        label={t('roommates.rooms.searchPlaceholder')}
                        placeholder={t('roommates.rooms.searchPlaceholder')}
                        value={filters?.search ?? ''}
                        onChangeText={(text) => onFilterChange?.({ ...filters, search: text })}
                        onClearText={() => onFilterChange?.({ ...filters, search: undefined })}
                    />
                </View>
                <Button
                    variant="secondary"
                    iconOnly
                    icon={RiEqualizerLine}
                    onPress={() => setShowFilters(true)}
                    accessibilityLabel={t('common.filter')}
                />
            </View>

            {activeFilterChips.length > 0 ? (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={[styles.filtersRow, { borderBottomColor: palette.border }]}
                    contentContainerStyle={styles.filtersContent}
                >
                    {activeFilterChips.map(([key, value]) => {
                        const label =
                            key === 'minRent'
                                ? t('format.range.from', { value: rentBound(value) })
                                : key === 'maxRent'
                                    ? t('format.range.upTo', { value: rentBound(value) })
                                    : Array.isArray(value)
                                        ? t('roommates.rooms.selectedCount', { count: value.length })
                                        : String(value);
                        const remove = () => {
                            const newFilters = { ...filters };
                            delete newFilters[key as keyof RoomFilterOptions];
                            onFilterChange?.(newFilters);
                        };
                        return (
                            <Chip
                                key={key}
                                size="small"
                                variant="subtle"
                                color="primary"
                                onPress={remove}
                                onClose={remove}
                                accessibilityLabel={`${t('common.remove')}: ${label}`}
                            >
                                {label}
                            </Chip>
                        );
                    })}
                </ScrollView>
            ) : null}

            <FlatList
                data={rooms}
                renderItem={({ item }) => <RoomCard property={item} />}
                keyExtractor={item => item.id}
                contentContainerStyle={styles.listContainer}
                showsVerticalScrollIndicator={false}
                onEndReached={handleLoadMore}
                onEndReachedThreshold={0.5}
                ListFooterComponent={renderFooter}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={handleRefresh}
                        colors={[palette.primary]}
                        tintColor={palette.primary}
                    />
                }
            />

            {filtersDialog}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: spacing.lg,
        gap: spacing.md,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    searchBar: {
        flex: 1,
    },
    filtersRow: {
        maxHeight: 48,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    filtersContent: {
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        gap: spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
    },
    listContainer: {
        padding: spacing.lg,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    footerLoader: {
        paddingVertical: spacing.lg,
        alignItems: 'center',
    },
    cardWrap: {
        marginBottom: spacing.lg,
    },
    roomCard: {
        overflow: 'hidden',
        padding: 0,
    },
    imageContainer: {
        position: 'relative',
        height: 200,
    },
    roomImage: {
        width: '100%',
        height: '100%',
    },
    // The masked zoom wrapper fills the image box so the photo scales inside it.
    roomImageFill: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
    },
    placeholderImage: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    matchScoreBadge: {
        position: 'absolute',
        top: spacing.md,
        right: spacing.md,
    },
    detailsContainer: {
        padding: spacing.lg,
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: spacing.xs,
    },
    roomName: {
        fontSize: 18,
        fontWeight: '600',
        flex: 1,
        marginRight: spacing.sm,
    },
    price: {
        fontSize: 16,
        fontWeight: '700',
    },
    location: {
        fontSize: 14,
        marginBottom: spacing.md,
    },
    featuresRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: spacing.md,
        gap: spacing.lg,
    },
    feature: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
    },
    featureText: {
        fontSize: 13,
    },
    availability: {
        alignSelf: 'flex-start',
    },
});

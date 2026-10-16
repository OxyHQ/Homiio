import React, { useState } from 'react';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import {
  View,
  StyleSheet,
  Image,
  FlatList,
  RefreshControl,
  ScrollView,
  Platform,
} from 'react-native';
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
        onPress={handlePress}
        accessibilityRole="link"
        accessibilityLabel={title}
        style={styles.roomCard}
        appearance="outline"
      >
        <View style={styles.imageContainer}>
          {primaryImage ? (
            <ZoomableImage active={hovered} style={styles.roomImageFill}>
              <Image source={{ uri: primaryImage }} style={styles.roomImage} resizeMode="cover" />
            </ZoomableImage>
          ) : (
            <View
              style={[
                styles.roomImage,
                styles.placeholderImage,
                { backgroundColor: palette.backgroundSecondary },
              ]}
            >
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
            <BloomText style={[styles.price, { color: palette.primary }]}>
              {formattedPrice}
            </BloomText>
          </View>

          <BloomText style={[styles.location, { color: palette.textSecondary }]} numberOfLines={1}>
            {[property.address?.cityName, property.address?.regionName].filter(Boolean).join(', ')}
          </BloomText>

          <View style={styles.featuresRow}>
            <View style={styles.feature}>
              <RiHotelBedLine
                width={FEATURE_ICON_SIZE}
                height={FEATURE_ICON_SIZE}
                fill={palette.textSecondary}
              />
              <BloomText style={[styles.featureText, { color: palette.textSecondary }]}>
                {property.type === PropertyType.ROOM
                  ? t('roommates.rooms.roomType')
                  : propertyService.getPropertyTypeDisplay(property.type)}
              </BloomText>
            </View>
            {property.squareFootage ? (
              <View style={styles.feature}>
                <RiExpandDiagonalSLine
                  width={FEATURE_ICON_SIZE}
                  height={FEATURE_ICON_SIZE}
                  fill={palette.textSecondary}
                />
                <BloomText style={[styles.featureText, { color: palette.textSecondary }]}>
                  {formatArea(property.squareFootage, 'sqm', locale, { labels: areaUnitLabels })}
                </BloomText>
              </View>
            ) : null}
            <View style={styles.feature}>
              <RiGroupLine
                width={FEATURE_ICON_SIZE}
                height={FEATURE_ICON_SIZE}
                fill={palette.textSecondary}
              />
              <BloomText style={[styles.featureText, { color: palette.textSecondary }]}>
                {t('roommates.rooms.capacity', { count: maxOccupants })}
              </BloomText>
            </View>
          </View>

          <View style={styles.availability}>
            <Badge
              variant="subtle"
              color={isAvailable ? 'success' : 'error'}
              content={
                isAvailable ? t('roommates.rooms.available') : t('roommates.rooms.unavailable')
              }
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
  const [refreshing, setRefreshing] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // One cache entry per filter set; a filter change starts a new feed while the
  // previous rooms stay on screen until the first page of the new one lands.
  const roomsQuery = useInfiniteQuery({
    queryKey: ['rooms', filters ?? null],
    initialPageParam: 1,
    // Typed as RoomFilterOptions so the room-only `sortBy` / `sortOrder`
    // query params flow through to the (subtype-compatible) PropertyFilters
    // expected by the service and on to the properties list endpoint.
    queryFn: ({ pageParam }) => {
      const params: RoomFilterOptions = {
        ...filters,
        type: PropertyType.ROOM,
        page: pageParam,
        limit: 10,
        sortBy: filters?.sortBy || 'createdAt',
        sortOrder: filters?.sortOrder || 'desc',
      };
      return propertyService.getRooms(params);
    },
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    placeholderData: keepPreviousData,
  });
  const rooms = roomsQuery.data?.pages.flatMap((page) => page.rooms) ?? [];
  const loading = roomsQuery.isPending;

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await roomsQuery.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const handleLoadMore = () => {
    if (roomsQuery.hasNextPage && !roomsQuery.isFetchingNextPage) {
      void roomsQuery.fetchNextPage();
    }
  };

  const renderFooter = () => {
    if (!roomsQuery.isFetchingNextPage) return null;
    return (
      <View style={styles.footerLoader}>
        <Loading size="sm" showText={false} />
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
          onApplyFilters={onFilterChange || (() => {})}
          onClose={() => setShowFilters(false)}
        />
      ) : null}
    </Dialog>
  );

  if (loading && rooms.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <Loading size="lg" showText={false} />
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
          Boolean(value) &&
          key !== 'search' &&
          key !== 'sortBy' &&
          key !== 'sortOrder' &&
          key !== 'type',
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
          iconOnly
          icon={RiEqualizerLine}
          onPress={() => setShowFilters(true)}
          accessibilityLabel={t('common.filter')}
          tone="neutral"
          appearance="outline"
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
                size="sm"
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
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={renderFooter}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
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

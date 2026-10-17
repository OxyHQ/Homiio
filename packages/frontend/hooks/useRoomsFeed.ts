/**
 * The room listings feed of the roommates Rooms tab.
 *
 * One cache entry per filter set; a filter change starts a new feed while the
 * previous rooms stay on screen until the first page of the new one lands. The
 * PAGE owns the scroller (`ScreenScrollView`), so it is the page that calls
 * `loadMore` from `onEndReached` and `refresh` from its `RefreshControl`;
 * `RoomList` only renders what this returns.
 */
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { PropertyType } from '@homiio/shared-types';

import type { RoomFilterOptions } from '@/components/RoomFilters';
import { propertyService } from '@/services/propertyService';

const PAGE_SIZE = 10;

export function useRoomsFeed(filters: RoomFilterOptions | undefined, enabled: boolean) {
  const query = useInfiniteQuery({
    queryKey: ['rooms', filters ?? null],
    initialPageParam: 1,
    // Typed as RoomFilterOptions so the room-only `sortBy` / `sortOrder` query
    // params flow through to the (subtype-compatible) PropertyFilters expected
    // by the service and on to the properties list endpoint.
    queryFn: ({ pageParam }) => {
      const params: RoomFilterOptions = {
        ...filters,
        type: PropertyType.ROOM,
        page: pageParam,
        limit: PAGE_SIZE,
        sortBy: filters?.sortBy || 'createdAt',
        sortOrder: filters?.sortOrder || 'desc',
      };
      return propertyService.getRooms(params);
    },
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    placeholderData: keepPreviousData,
    enabled,
  });

  return {
    rooms: query.data?.pages.flatMap((page) => page.rooms) ?? [],
    loading: query.isPending,
    loadingMore: query.isFetchingNextPage,
    // A filter change shows the previous rooms while the new feed loads; that is
    // not a pull-to-refresh, so the spinner stays for a real refetch only.
    refreshing: query.isRefetching && !query.isPlaceholderData,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
    refresh: () => void query.refetch(),
  };
}

export type RoomsFeed = ReturnType<typeof useRoomsFeed>;

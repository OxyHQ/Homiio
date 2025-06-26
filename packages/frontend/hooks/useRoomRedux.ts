import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '@/store/store';
import {
  fetchRooms,
  fetchRoom,
  fetchRoomStats,
  fetchRoomEnergyStats,
  searchRooms,
  createRoom,
  updateRoom,
  deleteRoom,
  assignTenant,
  unassignTenant,
  clearError,
  clearCurrentRoom,
  clearSearchResults,
  setFilters,
  clearFilters,
} from '@/store/reducers/roomReducer';
import { Room, CreateRoomData, RoomFilters } from '@/services/roomService';
import { toast } from 'sonner';

// Helper function to create room key
const createRoomKey = (propertyId: string, roomId: string) => `${propertyId}:${roomId}`;

// Room Selectors
export const useRoomSelectors = () => {
  const rooms = useSelector((state: RootState) => state.rooms.rooms);
  const currentRoom = useSelector((state: RootState) => state.rooms.currentRoom);
  const roomStats = useSelector((state: RootState) => state.rooms.roomStats);
  const roomEnergyStats = useSelector((state: RootState) => state.rooms.roomEnergyStats);
  const searchResults = useSelector((state: RootState) => state.rooms.searchResults);
  const filters = useSelector((state: RootState) => state.rooms.filters);
  const pagination = useSelector((state: RootState) => state.rooms.pagination);
  const loading = useSelector((state: RootState) => state.rooms.loading);
  const error = useSelector((state: RootState) => state.rooms.error);

  return {
    rooms,
    currentRoom,
    roomStats,
    roomEnergyStats,
    searchResults,
    filters,
    pagination,
    loading,
    error,
  };
};

// Room Hooks
export const useRooms = (propertyId: string) => {
  const dispatch = useDispatch<AppDispatch>();
  const { rooms, loading, error, pagination } = useRoomSelectors();

  const loadRooms = useCallback((filters?: RoomFilters) => {
    if (propertyId) {
      dispatch(fetchRooms({ propertyId, filters }));
    }
  }, [dispatch, propertyId]);

  const clearErrorAction = useCallback(() => {
    dispatch(clearError());
  }, [dispatch]);

  const setFiltersAction = useCallback((newFilters: RoomFilters) => {
    dispatch(setFilters({ propertyId, filters: newFilters }));
  }, [dispatch, propertyId]);

  const clearFiltersAction = useCallback(() => {
    dispatch(clearFilters(propertyId));
  }, [dispatch, propertyId]);

  return {
    rooms: rooms[propertyId] || [],
    loading: loading.rooms,
    error,
    pagination: pagination[propertyId] || { total: 0, page: 1, totalPages: 1, limit: 10 },
    loadRooms,
    clearError: clearErrorAction,
    setFilters: setFiltersAction,
    clearFilters: clearFiltersAction,
  };
};

export const useRoom = (propertyId: string, roomId: string) => {
  const dispatch = useDispatch<AppDispatch>();
  const { currentRoom, loading, error } = useRoomSelectors();

  const loadRoom = useCallback(() => {
    if (propertyId && roomId) {
      dispatch(fetchRoom({ propertyId, roomId }));
    }
  }, [dispatch, propertyId, roomId]);

  const clearCurrentRoomAction = useCallback(() => {
    dispatch(clearCurrentRoom());
  }, [dispatch]);

  return {
    room: currentRoom,
    loading: loading.currentRoom,
    error,
    loadRoom,
    clearCurrentRoom: clearCurrentRoomAction,
  };
};

export const useRoomStats = (propertyId: string, roomId: string) => {
  const dispatch = useDispatch<AppDispatch>();
  const { roomStats, loading, error } = useRoomSelectors();

  const loadStats = useCallback(() => {
    if (propertyId && roomId) {
      dispatch(fetchRoomStats({ propertyId, roomId }));
    }
  }, [dispatch, propertyId, roomId]);

  const key = createRoomKey(propertyId, roomId);

  return {
    stats: roomStats[key] || null,
    loading: loading.stats,
    error,
    loadStats,
  };
};

export const useRoomEnergyStats = (propertyId: string, roomId: string, period: 'day' | 'week' | 'month' = 'day') => {
  const dispatch = useDispatch<AppDispatch>();
  const { roomEnergyStats, loading, error } = useRoomSelectors();

  const loadEnergyStats = useCallback(() => {
    if (propertyId && roomId) {
      dispatch(fetchRoomEnergyStats({ propertyId, roomId, period }));
    }
  }, [dispatch, propertyId, roomId, period]);

  const key = createRoomKey(propertyId, roomId);
  const stats = roomEnergyStats[key]?.[period] || null;

  return {
    stats,
    loading: loading.energy,
    error,
    loadEnergyStats,
  };
};

export const useSearchRooms = (propertyId: string) => {
  const dispatch = useDispatch<AppDispatch>();
  const { searchResults, loading, error } = useRoomSelectors();

  const search = useCallback((query: string, filters?: RoomFilters) => {
    if (propertyId && query && query.length > 0) {
      dispatch(searchRooms({ propertyId, query, filters }));
    }
  }, [dispatch, propertyId]);

  const clearSearchResultsAction = useCallback(() => {
    dispatch(clearSearchResults(propertyId));
  }, [dispatch, propertyId]);

  return {
    searchResults: searchResults[propertyId] || [],
    loading: loading.search,
    error,
    search,
    clearSearchResults: clearSearchResultsAction,
  };
};

export const useCreateRoom = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { loading, error } = useRoomSelectors();

  const create = useCallback(async (propertyId: string, data: CreateRoomData) => {
    try {
      const result = await dispatch(createRoom({ propertyId, data })).unwrap();
      toast.success('Room created successfully');
      return result;
    } catch (error: any) {
      toast.error(error.message || 'Failed to create room');
      throw error;
    }
  }, [dispatch]);

  return {
    create,
    loading: loading.create,
    error,
  };
};

export const useUpdateRoom = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { loading, error } = useRoomSelectors();

  const update = useCallback(async (propertyId: string, roomId: string, data: Partial<CreateRoomData>) => {
    try {
      const result = await dispatch(updateRoom({ propertyId, roomId, data })).unwrap();
      toast.success('Room updated successfully');
      return result;
    } catch (error: any) {
      toast.error(error.message || 'Failed to update room');
      throw error;
    }
  }, [dispatch]);

  return {
    update,
    loading: loading.update,
    error,
  };
};

export const useDeleteRoom = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { loading, error } = useRoomSelectors();

  const remove = useCallback(async (propertyId: string, roomId: string) => {
    try {
      await dispatch(deleteRoom({ propertyId, roomId })).unwrap();
      toast.success('Room deleted successfully');
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete room');
      throw error;
    }
  }, [dispatch]);

  return {
    remove,
    loading: loading.delete,
    error,
  };
};

export const useAssignTenant = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { loading, error } = useRoomSelectors();

  const assign = useCallback(async (propertyId: string, roomId: string, tenantId: string) => {
    try {
      const result = await dispatch(assignTenant({ propertyId, roomId, tenantId })).unwrap();
      toast.success('Tenant assigned successfully');
      return result;
    } catch (error: any) {
      toast.error(error.message || 'Failed to assign tenant');
      throw error;
    }
  }, [dispatch]);

  return {
    assign,
    loading: loading.assignTenant,
    error,
  };
};

export const useUnassignTenant = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { loading, error } = useRoomSelectors();

  const unassign = useCallback(async (propertyId: string, roomId: string) => {
    try {
      const result = await dispatch(unassignTenant({ propertyId, roomId })).unwrap();
      toast.success('Tenant unassigned successfully');
      return result;
    } catch (error: any) {
      toast.error(error.message || 'Failed to unassign tenant');
      throw error;
    }
  }, [dispatch]);

  return {
    unassign,
    loading: loading.unassignTenant,
    error,
  };
}; 
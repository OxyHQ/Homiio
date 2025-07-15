import { useCallback } from 'react';
import { useRoomStore } from '@/store/roomStore';
import { Room, CreateRoomData, RoomFilters } from '@/services/roomService';
import { toast } from 'sonner';

// Helper function to create room key
const createRoomKey = (propertyId: string, roomId: string) => `${propertyId}:${roomId}`;

// Room Hooks
export const useRooms = (propertyId: string) => {
  const { rooms, isLoading, error, setRooms, setLoading, setError, clearError } = useRoomStore();

  const loadRooms = useCallback(async (filters?: RoomFilters) => {
    if (propertyId) {
      try {
        setLoading(true);
        setError(null);
        
        // Import the API function
        const { roomApi } = await import('@/utils/api');
        const response = await roomApi.getRooms(propertyId, filters);
        
        setRooms(response.data || []);
      } catch (error: any) {
        setError(error.message || 'Failed to load rooms');
      } finally {
        setLoading(false);
      }
    }
  }, [propertyId, setRooms, setLoading, setError]);

  const clearErrorAction = useCallback(() => {
    clearError();
  }, [clearError]);

  const setFiltersAction = useCallback((newFilters: RoomFilters) => {
    // Not implemented in Zustand store yet
    console.warn('setFilters not implemented in Zustand store');
  }, []);

  const clearFiltersAction = useCallback(() => {
    // Not implemented in Zustand store yet
    console.warn('clearFilters not implemented in Zustand store');
  }, []);

  return {
    rooms: rooms || [],
    loading: isLoading,
    error,
    pagination: { total: rooms?.length || 0, page: 1, totalPages: 1, limit: 10 }, // Not implemented in Zustand store yet
    loadRooms,
    clearError: clearErrorAction,
    setFilters: setFiltersAction,
    clearFilters: clearFiltersAction,
  };
};

export const useRoom = (propertyId: string, roomId: string) => {
  const { currentRoom, isLoading, error, setCurrentRoom, setLoading, setError, clearCurrentRoom } = useRoomStore();

  const loadRoom = useCallback(async () => {
    if (propertyId && roomId) {
      try {
        setLoading(true);
        setError(null);
        
        // Import the API function
        const { roomApi } = await import('@/utils/api');
        const response = await roomApi.getRoom(propertyId, roomId);
        
        setCurrentRoom(response.data);
      } catch (error: any) {
        setError(error.message || 'Failed to load room');
      } finally {
        setLoading(false);
      }
    }
  }, [propertyId, roomId, setCurrentRoom, setLoading, setError]);

  const clearCurrentRoomAction = useCallback(() => {
    clearCurrentRoom();
  }, [clearCurrentRoom]);

  return {
    room: currentRoom,
    loading: isLoading,
    error,
    loadRoom,
    clearCurrentRoom: clearCurrentRoomAction,
  };
};

export const useRoomStats = (propertyId: string, roomId: string) => {
  const { roomStats, isLoading, error, setRoomStats, setLoading, setError } = useRoomStore();

  const loadStats = useCallback(async () => {
    if (propertyId && roomId) {
      try {
        setLoading(true);
        setError(null);
        
        // Import the API function
        const { roomApi } = await import('@/utils/api');
        const response = await roomApi.getRoomStats(propertyId, roomId);
        
        setRoomStats(response.data);
      } catch (error: any) {
        setError(error.message || 'Failed to load room stats');
      } finally {
        setLoading(false);
      }
    }
  }, [propertyId, roomId, setRoomStats, setLoading, setError]);

  return {
    stats: roomStats || null,
    loading: isLoading,
    error,
    loadStats,
  };
};

export const useRoomEnergyStats = (propertyId: string, roomId: string, period: 'day' | 'week' | 'month' = 'day') => {
  const { roomEnergyStats, isLoading, error, setRoomEnergyStats, setLoading, setError } = useRoomStore();

  const loadEnergyStats = useCallback(async () => {
    if (propertyId && roomId) {
      try {
        setLoading(true);
        setError(null);
        
        // Import the API function
        const { roomApi } = await import('@/utils/api');
        const response = await roomApi.getRoomEnergyStats(propertyId, roomId, period);
        
        setRoomEnergyStats(response.data);
      } catch (error: any) {
        setError(error.message || 'Failed to load room energy stats');
      } finally {
        setLoading(false);
      }
    }
  }, [propertyId, roomId, period, setRoomEnergyStats, setLoading, setError]);

  const stats = roomEnergyStats?.[period] || null;

  return {
    stats,
    loading: isLoading,
    error,
    loadEnergyStats,
  };
};

export const useSearchRooms = (propertyId: string) => {
  const { searchResults, isLoading, error, setSearchResults, setLoading, setError, clearSearchResults } = useRoomStore();

  const search = useCallback(async (query: string, filters?: RoomFilters) => {
    if (propertyId && query && query.length > 0) {
      try {
        setLoading(true);
        setError(null);
        
        // Import the API function
        const { roomApi } = await import('@/utils/api');
        const response = await roomApi.searchRooms(propertyId, query, filters);
        
        setSearchResults(response.data || []);
      } catch (error: any) {
        setError(error.message || 'Failed to search rooms');
      } finally {
        setLoading(false);
      }
    }
  }, [propertyId, setSearchResults, setLoading, setError]);

  const clearSearchResultsAction = useCallback(() => {
    clearSearchResults();
  }, [clearSearchResults]);

  return {
    searchResults: searchResults || [],
    loading: isLoading,
    error,
    search,
    clearSearchResults: clearSearchResultsAction,
  };
};

export const useCreateRoom = () => {
  const { isLoading, error, setLoading, setError } = useRoomStore();

  const create = useCallback(async (propertyId: string, data: CreateRoomData) => {
    try {
      setLoading(true);
      setError(null);
      
      // Import the API function
      const { roomApi } = await import('@/utils/api');
      const result = await roomApi.createRoom(propertyId, data);
      
      toast.success('Room created successfully');
      return result.data;
    } catch (error: any) {
      toast.error(error.message || 'Failed to create room');
      setError(error.message || 'Failed to create room');
      throw error;
    } finally {
      setLoading(false);
    }
  }, [setLoading, setError]);

  return {
    create,
    loading: isLoading,
    error,
  };
};

export const useUpdateRoom = () => {
  const { isLoading, error, setLoading, setError } = useRoomStore();

  const update = useCallback(async (propertyId: string, roomId: string, data: Partial<CreateRoomData>) => {
    try {
      setLoading(true);
      setError(null);
      
      // Import the API function
      const { roomApi } = await import('@/utils/api');
      const result = await roomApi.updateRoom(propertyId, roomId, data);
      
      toast.success('Room updated successfully');
      return result.data;
    } catch (error: any) {
      toast.error(error.message || 'Failed to update room');
      setError(error.message || 'Failed to update room');
      throw error;
    } finally {
      setLoading(false);
    }
  }, [setLoading, setError]);

  return {
    update,
    loading: isLoading,
    error,
  };
};

export const useDeleteRoom = () => {
  const { isLoading, error, setLoading, setError } = useRoomStore();

  const remove = useCallback(async (propertyId: string, roomId: string) => {
    try {
      setLoading(true);
      setError(null);
      
      // Import the API function
      const { roomApi } = await import('@/utils/api');
      await roomApi.deleteRoom(propertyId, roomId);
      
      toast.success('Room deleted successfully');
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete room');
      setError(error.message || 'Failed to delete room');
      throw error;
    } finally {
      setLoading(false);
    }
  }, [setLoading, setError]);

  return {
    remove,
    loading: isLoading,
    error,
  };
};

export const useAssignTenant = () => {
  const { isLoading, error, setLoading, setError } = useRoomStore();

  const assign = useCallback(async (propertyId: string, roomId: string, tenantId: string) => {
    try {
      setLoading(true);
      setError(null);
      
      // Import the API function
      const { roomApi } = await import('@/utils/api');
      const result = await roomApi.assignTenant(propertyId, roomId, tenantId);
      
      toast.success('Tenant assigned successfully');
      return result.data;
    } catch (error: any) {
      toast.error(error.message || 'Failed to assign tenant');
      setError(error.message || 'Failed to assign tenant');
      throw error;
    } finally {
      setLoading(false);
    }
  }, [setLoading, setError]);

  return {
    assign,
    loading: isLoading,
    error,
  };
};

export const useUnassignTenant = () => {
  const { isLoading, error, setLoading, setError } = useRoomStore();

  const unassign = useCallback(async (propertyId: string, roomId: string, tenantId: string) => {
    try {
      setLoading(true);
      setError(null);
      
      // Import the API function
      const { roomApi } = await import('@/utils/api');
      const result = await roomApi.unassignTenant(propertyId, roomId, tenantId);
      
      toast.success('Tenant unassigned successfully');
      return result.data;
    } catch (error: any) {
      toast.error(error.message || 'Failed to unassign tenant');
      setError(error.message || 'Failed to unassign tenant');
      throw error;
    } finally {
      setLoading(false);
    }
  }, [setLoading, setError]);

  return {
    unassign,
    loading: isLoading,
    error,
  };
}; 
import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { roomService, Room, CreateRoomData, RoomFilters } from '@/services/roomService';

interface RoomState {
  rooms: Record<string, Room[]>; // Keyed by propertyId
  currentRoom: Room | null;
  roomStats: Record<string, any>; // Keyed by "propertyId:roomId"
  roomEnergyStats: Record<string, Record<string, any>>; // Keyed by "propertyId:roomId" -> period
  searchResults: Record<string, Room[]>; // Keyed by propertyId
  filters: Record<string, RoomFilters>; // Keyed by propertyId
  pagination: Record<string, {
    total: number;
    page: number;
    totalPages: number;
    limit: number;
  }>; // Keyed by propertyId
  loading: {
    rooms: boolean;
    currentRoom: boolean;
    stats: boolean;
    energy: boolean;
    search: boolean;
    create: boolean;
    update: boolean;
    delete: boolean;
    assignTenant: boolean;
    unassignTenant: boolean;
  };
  error: string | null;
}

const initialState: RoomState = {
  rooms: {},
  currentRoom: null,
  roomStats: {},
  roomEnergyStats: {},
  searchResults: {},
  filters: {},
  pagination: {},
  loading: {
    rooms: false,
    currentRoom: false,
    stats: false,
    energy: false,
    search: false,
    create: false,
    update: false,
    delete: false,
    assignTenant: false,
    unassignTenant: false,
  },
  error: null,
};

// Helper function to create room key
const createRoomKey = (propertyId: string, roomId: string) => `${propertyId}:${roomId}`;

// Async thunks
export const fetchRooms = createAsyncThunk(
  'rooms/fetchRooms',
  async ({ propertyId, filters }: { propertyId: string; filters?: RoomFilters }) => {
    const result = await roomService.getRooms(propertyId, filters);
    return { propertyId, ...result };
  }
);

export const fetchRoom = createAsyncThunk(
  'rooms/fetchRoom',
  async ({ propertyId, roomId }: { propertyId: string; roomId: string }) => {
    const room = await roomService.getRoom(propertyId, roomId);
    return { propertyId, roomId, room };
  }
);

export const fetchRoomStats = createAsyncThunk(
  'rooms/fetchRoomStats',
  async ({ propertyId, roomId }: { propertyId: string; roomId: string }) => {
    const stats = await roomService.getRoomStats(propertyId, roomId);
    return { propertyId, roomId, stats };
  }
);

export const fetchRoomEnergyStats = createAsyncThunk(
  'rooms/fetchRoomEnergyStats',
  async ({ propertyId, roomId, period }: { propertyId: string; roomId: string; period: 'day' | 'week' | 'month' }) => {
    const stats = await roomService.getRoomEnergyStats(propertyId, roomId, period);
    return { propertyId, roomId, period, stats };
  }
);

export const searchRooms = createAsyncThunk(
  'rooms/searchRooms',
  async ({ propertyId, query, filters }: { propertyId: string; query: string; filters?: RoomFilters }) => {
    const result = await roomService.searchRooms(propertyId, query, filters);
    return { propertyId, ...result };
  }
);

export const createRoom = createAsyncThunk(
  'rooms/createRoom',
  async ({ propertyId, data }: { propertyId: string; data: CreateRoomData }) => {
    const room = await roomService.createRoom(propertyId, data);
    return { propertyId, room };
  }
);

export const updateRoom = createAsyncThunk(
  'rooms/updateRoom',
  async ({ propertyId, roomId, data }: { propertyId: string; roomId: string; data: Partial<CreateRoomData> }) => {
    const room = await roomService.updateRoom(propertyId, roomId, data);
    return { propertyId, roomId, room };
  }
);

export const deleteRoom = createAsyncThunk(
  'rooms/deleteRoom',
  async ({ propertyId, roomId }: { propertyId: string; roomId: string }) => {
    await roomService.deleteRoom(propertyId, roomId);
    return { propertyId, roomId };
  }
);

export const assignTenant = createAsyncThunk(
  'rooms/assignTenant',
  async ({ propertyId, roomId, tenantId }: { propertyId: string; roomId: string; tenantId: string }) => {
    const room = await roomService.assignTenant(propertyId, roomId, tenantId);
    return { propertyId, roomId, tenantId, room };
  }
);

export const unassignTenant = createAsyncThunk(
  'rooms/unassignTenant',
  async ({ propertyId, roomId }: { propertyId: string; roomId: string }) => {
    const room = await roomService.unassignTenant(propertyId, roomId);
    return { propertyId, roomId, room };
  }
);

const roomSlice = createSlice({
  name: 'rooms',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    clearCurrentRoom: (state) => {
      state.currentRoom = null;
    },
    clearSearchResults: (state, action: PayloadAction<string>) => {
      state.searchResults[action.payload] = [];
    },
    setFilters: (state, action: PayloadAction<{ propertyId: string; filters: RoomFilters }>) => {
      const { propertyId, filters } = action.payload;
      state.filters[propertyId] = { ...state.filters[propertyId], ...filters };
    },
    clearFilters: (state, action: PayloadAction<string>) => {
      state.filters[action.payload] = {};
    },
    updateRoomInList: (state, action: PayloadAction<{ propertyId: string; room: Room }>) => {
      const { propertyId, room } = action.payload;
      if (state.rooms[propertyId]) {
        const index = state.rooms[propertyId].findIndex(r => (r._id || r.id) === (room._id || room.id));
        if (index !== -1) {
          state.rooms[propertyId][index] = room;
        }
      }
    },
    removeRoomFromList: (state, action: PayloadAction<{ propertyId: string; roomId: string }>) => {
      const { propertyId, roomId } = action.payload;
      if (state.rooms[propertyId]) {
        state.rooms[propertyId] = state.rooms[propertyId].filter(r => (r._id || r.id) !== roomId);
      }
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch Rooms
      .addCase(fetchRooms.pending, (state) => {
        state.loading.rooms = true;
        state.error = null;
      })
      .addCase(fetchRooms.fulfilled, (state, action) => {
        state.loading.rooms = false;
        const { propertyId, rooms, total, page, totalPages } = action.payload;
        state.rooms[propertyId] = rooms;
        state.pagination[propertyId] = {
          total,
          page,
          totalPages,
          limit: 10,
        };
      })
      .addCase(fetchRooms.rejected, (state, action) => {
        state.loading.rooms = false;
        state.error = action.error.message || 'Failed to fetch rooms';
      })
      
      // Fetch Single Room
      .addCase(fetchRoom.pending, (state) => {
        state.loading.currentRoom = true;
        state.error = null;
      })
      .addCase(fetchRoom.fulfilled, (state, action) => {
        state.loading.currentRoom = false;
        state.currentRoom = action.payload.room;
      })
      .addCase(fetchRoom.rejected, (state, action) => {
        state.loading.currentRoom = false;
        state.error = action.error.message || 'Failed to fetch room';
      })
      
      // Fetch Room Stats
      .addCase(fetchRoomStats.pending, (state) => {
        state.loading.stats = true;
        state.error = null;
      })
      .addCase(fetchRoomStats.fulfilled, (state, action) => {
        state.loading.stats = false;
        const { propertyId, roomId, stats } = action.payload;
        const key = createRoomKey(propertyId, roomId);
        state.roomStats[key] = stats;
      })
      .addCase(fetchRoomStats.rejected, (state, action) => {
        state.loading.stats = false;
        state.error = action.error.message || 'Failed to fetch room stats';
      })
      
      // Fetch Room Energy Stats
      .addCase(fetchRoomEnergyStats.pending, (state) => {
        state.loading.energy = true;
        state.error = null;
      })
      .addCase(fetchRoomEnergyStats.fulfilled, (state, action) => {
        state.loading.energy = false;
        const { propertyId, roomId, period, stats } = action.payload;
        const key = createRoomKey(propertyId, roomId);
        if (!state.roomEnergyStats[key]) {
          state.roomEnergyStats[key] = {};
        }
        state.roomEnergyStats[key][period] = stats;
      })
      .addCase(fetchRoomEnergyStats.rejected, (state, action) => {
        state.loading.energy = false;
        state.error = action.error.message || 'Failed to fetch energy stats';
      })
      
      // Search Rooms
      .addCase(searchRooms.pending, (state) => {
        state.loading.search = true;
        state.error = null;
      })
      .addCase(searchRooms.fulfilled, (state, action) => {
        state.loading.search = false;
        const { propertyId, rooms } = action.payload;
        state.searchResults[propertyId] = rooms;
      })
      .addCase(searchRooms.rejected, (state, action) => {
        state.loading.search = false;
        state.error = action.error.message || 'Failed to search rooms';
      })
      
      // Create Room
      .addCase(createRoom.pending, (state) => {
        state.loading.create = true;
        state.error = null;
      })
      .addCase(createRoom.fulfilled, (state, action) => {
        state.loading.create = false;
        const { propertyId, room } = action.payload;
        if (!state.rooms[propertyId]) {
          state.rooms[propertyId] = [];
        }
        state.rooms[propertyId].unshift(room);
        state.currentRoom = room;
      })
      .addCase(createRoom.rejected, (state, action) => {
        state.loading.create = false;
        state.error = action.error.message || 'Failed to create room';
      })
      
      // Update Room
      .addCase(updateRoom.pending, (state) => {
        state.loading.update = true;
        state.error = null;
      })
      .addCase(updateRoom.fulfilled, (state, action) => {
        state.loading.update = false;
        const { propertyId, roomId, room } = action.payload;
        
        // Update in rooms list
        if (state.rooms[propertyId]) {
          const index = state.rooms[propertyId].findIndex(r => (r._id || r.id) === roomId);
          if (index !== -1) {
            state.rooms[propertyId][index] = room;
          }
        }
        
        // Update current room if it's the same
        if (state.currentRoom && (state.currentRoom._id || state.currentRoom.id) === roomId) {
          state.currentRoom = room;
        }
      })
      .addCase(updateRoom.rejected, (state, action) => {
        state.loading.update = false;
        state.error = action.error.message || 'Failed to update room';
      })
      
      // Delete Room
      .addCase(deleteRoom.pending, (state) => {
        state.loading.delete = true;
        state.error = null;
      })
      .addCase(deleteRoom.fulfilled, (state, action) => {
        state.loading.delete = false;
        const { propertyId, roomId } = action.payload;
        
        // Remove from rooms list
        if (state.rooms[propertyId]) {
          state.rooms[propertyId] = state.rooms[propertyId].filter(r => (r._id || r.id) !== roomId);
        }
        
        // Clear current room if it's the deleted one
        if (state.currentRoom && (state.currentRoom._id || state.currentRoom.id) === roomId) {
          state.currentRoom = null;
        }
        
        // Clear related stats
        const key = createRoomKey(propertyId, roomId);
        delete state.roomStats[key];
        delete state.roomEnergyStats[key];
      })
      .addCase(deleteRoom.rejected, (state, action) => {
        state.loading.delete = false;
        state.error = action.error.message || 'Failed to delete room';
      })
      
      // Assign Tenant
      .addCase(assignTenant.pending, (state) => {
        state.loading.assignTenant = true;
        state.error = null;
      })
      .addCase(assignTenant.fulfilled, (state, action) => {
        state.loading.assignTenant = false;
        const { propertyId, roomId, room } = action.payload;
        
        // Update in rooms list
        if (state.rooms[propertyId]) {
          const index = state.rooms[propertyId].findIndex(r => (r._id || r.id) === roomId);
          if (index !== -1) {
            state.rooms[propertyId][index] = room;
          }
        }
        
        // Update current room if it's the same
        if (state.currentRoom && (state.currentRoom._id || state.currentRoom.id) === roomId) {
          state.currentRoom = room;
        }
      })
      .addCase(assignTenant.rejected, (state, action) => {
        state.loading.assignTenant = false;
        state.error = action.error.message || 'Failed to assign tenant';
      })
      
      // Unassign Tenant
      .addCase(unassignTenant.pending, (state) => {
        state.loading.unassignTenant = true;
        state.error = null;
      })
      .addCase(unassignTenant.fulfilled, (state, action) => {
        state.loading.unassignTenant = false;
        const { propertyId, roomId, room } = action.payload;
        
        // Update in rooms list
        if (state.rooms[propertyId]) {
          const index = state.rooms[propertyId].findIndex(r => (r._id || r.id) === roomId);
          if (index !== -1) {
            state.rooms[propertyId][index] = room;
          }
        }
        
        // Update current room if it's the same
        if (state.currentRoom && (state.currentRoom._id || state.currentRoom.id) === roomId) {
          state.currentRoom = room;
        }
      })
      .addCase(unassignTenant.rejected, (state, action) => {
        state.loading.unassignTenant = false;
        state.error = action.error.message || 'Failed to unassign tenant';
      });
  },
});

export const {
  clearError,
  clearCurrentRoom,
  clearSearchResults,
  setFilters,
  clearFilters,
  updateRoomInList,
  removeRoomFromList,
} = roomSlice.actions;

export default roomSlice.reducer; 
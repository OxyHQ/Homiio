import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { propertyService, Property, CreatePropertyData, PropertyFilters } from '@/services/propertyService';
import { useOxy } from '@oxyhq/services';

interface PropertyState {
  properties: Property[];
  currentProperty: Property | null;
  propertyStats: Record<string, any>;
  propertyEnergyStats: Record<string, Record<string, any>>;
  searchResults: Property[];
  filters: PropertyFilters;
  pagination: {
    total: number;
    page: number;
    totalPages: number;
    limit: number;
  };
  loading: {
    properties: boolean;
    currentProperty: boolean;
    stats: boolean;
    energy: boolean;
    search: boolean;
    create: boolean;
    update: boolean;
    delete: boolean;
  };
  error: string | null;
}

const initialState: PropertyState = {
  properties: [],
  currentProperty: null,
  propertyStats: {},
  propertyEnergyStats: {},
  searchResults: [],
  filters: {},
  pagination: {
    total: 0,
    page: 1,
    totalPages: 1,
    limit: 10,
  },
  loading: {
    properties: false,
    currentProperty: false,
    stats: false,
    energy: false,
    search: false,
    create: false,
    update: false,
    delete: false,
  },
  error: null,
};

// Async thunks
export const fetchProperties = createAsyncThunk(
  'properties/fetchProperties',
  async (filters?: PropertyFilters) => {
    const result = await propertyService.getProperties(filters);
    return result;
  }
);

export const fetchProperty = createAsyncThunk(
  'properties/fetchProperty',
  async ({ id, oxyServices, activeSessionId }: { id: string; oxyServices: any; activeSessionId: string }) => {
    const property = await propertyService.getProperty(id, oxyServices, activeSessionId);
    return property;
  }
);

export const fetchPropertyStats = createAsyncThunk(
  'properties/fetchPropertyStats',
  async (id: string) => {
    const stats = await propertyService.getPropertyStats(id);
    return { id, stats };
  }
);

export const fetchPropertyEnergyStats = createAsyncThunk(
  'properties/fetchPropertyEnergyStats',
  async ({ id, period }: { id: string; period: 'day' | 'week' | 'month' }) => {
    const stats = await propertyService.getPropertyEnergyStats(id, period);
    return { id, period, stats };
  }
);

export const searchProperties = createAsyncThunk(
  'properties/searchProperties',
  async ({ query, filters }: { query: string; filters?: PropertyFilters }) => {
    const result = await propertyService.searchProperties(query, filters);
    return result;
  }
);

export const createProperty = createAsyncThunk(
  'properties/createProperty',
  async ({ data, oxyServices, activeSessionId }: { data: CreatePropertyData; oxyServices: any; activeSessionId: string }) => {
    const property = await propertyService.createProperty(data, oxyServices, activeSessionId);
    return property;
  }
);

export const updateProperty = createAsyncThunk(
  'properties/updateProperty',
  async ({ id, data }: { id: string; data: Partial<CreatePropertyData> }) => {
    const property = await propertyService.updateProperty(id, data);
    return { id, property };
  }
);

export const deleteProperty = createAsyncThunk(
  'properties/deleteProperty',
  async (id: string) => {
    await propertyService.deleteProperty(id);
    return id;
  }
);

const propertySlice = createSlice({
  name: 'properties',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    clearCurrentProperty: (state) => {
      state.currentProperty = null;
    },
    clearSearchResults: (state) => {
      state.searchResults = [];
    },
    setFilters: (state, action: PayloadAction<PropertyFilters>) => {
      state.filters = { ...state.filters, ...action.payload };
    },
    clearFilters: (state) => {
      state.filters = {};
    },
    resetLoading: (state) => {
      state.loading = {
        properties: false,
        currentProperty: false,
        stats: false,
        energy: false,
        search: false,
        create: false,
        update: false,
        delete: false,
      };
    },
    updatePropertyInList: (state, action: PayloadAction<Property>) => {
      const index = state.properties.findIndex(p => (p._id || p.id) === (action.payload._id || action.payload.id));
      if (index !== -1) {
        state.properties[index] = action.payload;
      }
    },
    removePropertyFromList: (state, action: PayloadAction<string>) => {
      state.properties = state.properties.filter(p => (p._id || p.id) !== action.payload);
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch Properties
      .addCase(fetchProperties.pending, (state) => {
        state.loading.properties = true;
        state.error = null;
      })
      .addCase(fetchProperties.fulfilled, (state, action) => {
        state.loading.properties = false;
        state.properties = action.payload.properties;
        state.pagination = {
          total: action.payload.total,
          page: action.payload.page,
          totalPages: action.payload.totalPages,
          limit: 10,
        };
      })
      .addCase(fetchProperties.rejected, (state, action) => {
        state.loading.properties = false;
        state.error = action.error.message || 'Failed to fetch properties';
      })
      
      // Fetch Single Property
      .addCase(fetchProperty.pending, (state) => {
        state.loading.currentProperty = true;
        state.error = null;
      })
      .addCase(fetchProperty.fulfilled, (state, action) => {
        state.loading.currentProperty = false;
        state.currentProperty = action.payload;
      })
      .addCase(fetchProperty.rejected, (state, action) => {
        state.loading.currentProperty = false;
        state.error = action.error.message || 'Failed to fetch property';
      })
      
      // Fetch Property Stats
      .addCase(fetchPropertyStats.pending, (state) => {
        state.loading.stats = true;
        state.error = null;
      })
      .addCase(fetchPropertyStats.fulfilled, (state, action) => {
        state.loading.stats = false;
        state.propertyStats[action.payload.id] = action.payload.stats;
      })
      .addCase(fetchPropertyStats.rejected, (state, action) => {
        state.loading.stats = false;
        state.error = action.error.message || 'Failed to fetch property stats';
      })
      
      // Fetch Property Energy Stats
      .addCase(fetchPropertyEnergyStats.pending, (state) => {
        state.loading.energy = true;
        state.error = null;
      })
      .addCase(fetchPropertyEnergyStats.fulfilled, (state, action) => {
        state.loading.energy = false;
        if (!state.propertyEnergyStats[action.payload.id]) {
          state.propertyEnergyStats[action.payload.id] = {};
        }
        state.propertyEnergyStats[action.payload.id][action.payload.period] = action.payload.stats;
      })
      .addCase(fetchPropertyEnergyStats.rejected, (state, action) => {
        state.loading.energy = false;
        state.error = action.error.message || 'Failed to fetch energy stats';
      })
      
      // Search Properties
      .addCase(searchProperties.pending, (state) => {
        state.loading.search = true;
        state.error = null;
      })
      .addCase(searchProperties.fulfilled, (state, action) => {
        state.loading.search = false;
        state.searchResults = action.payload.properties;
      })
      .addCase(searchProperties.rejected, (state, action) => {
        state.loading.search = false;
        state.error = action.error.message || 'Failed to search properties';
      })
      
      // Create Property
      .addCase(createProperty.pending, (state) => {
        state.loading.create = true;
        state.error = null;
      })
      .addCase(createProperty.fulfilled, (state, action) => {
        state.loading.create = false;
        state.properties.unshift(action.payload);
        state.currentProperty = action.payload;
      })
      .addCase(createProperty.rejected, (state, action) => {
        state.loading.create = false;
        state.error = action.error.message || 'Failed to create property';
      })
      
      // Update Property
      .addCase(updateProperty.pending, (state) => {
        state.loading.update = true;
        state.error = null;
      })
      .addCase(updateProperty.fulfilled, (state, action) => {
        state.loading.update = false;
        const { id, property } = action.payload;
        
        // Update in properties list
        const index = state.properties.findIndex(p => (p._id || p.id) === id);
        if (index !== -1) {
          state.properties[index] = property;
        }
        
        // Update current property if it's the same
        if (state.currentProperty && (state.currentProperty._id || state.currentProperty.id) === id) {
          state.currentProperty = property;
        }
      })
      .addCase(updateProperty.rejected, (state, action) => {
        state.loading.update = false;
        state.error = action.error.message || 'Failed to update property';
      })
      
      // Delete Property
      .addCase(deleteProperty.pending, (state) => {
        state.loading.delete = true;
        state.error = null;
      })
      .addCase(deleteProperty.fulfilled, (state, action) => {
        state.loading.delete = false;
        const deletedId = action.payload;
        
        // Remove from properties list
        state.properties = state.properties.filter(p => (p._id || p.id) !== deletedId);
        
        // Clear current property if it's the deleted one
        if (state.currentProperty && (state.currentProperty._id || state.currentProperty.id) === deletedId) {
          state.currentProperty = null;
        }
      })
      .addCase(deleteProperty.rejected, (state, action) => {
        state.loading.delete = false;
        state.error = action.error.message || 'Failed to delete property';
      });
  },
});

export const {
  clearError,
  clearCurrentProperty,
  clearSearchResults,
  setFilters,
  clearFilters,
  resetLoading,
  updatePropertyInList,
  removePropertyFromList,
} = propertySlice.actions;

export default propertySlice.reducer;

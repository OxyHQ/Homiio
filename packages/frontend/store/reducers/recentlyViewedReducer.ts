import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { userApi } from '@/utils/api';
import type { Property } from '@/services/propertyService';

interface RecentlyViewedState {
  properties: Property[];
  isLoading: boolean;
  error: string | null;
}

const initialState: RecentlyViewedState = {
  properties: [],
  isLoading: false,
  error: null,
};

// Async thunk to fetch recently viewed properties
export const fetchRecentlyViewedProperties = createAsyncThunk(
  'recentlyViewed/fetchProperties',
  async ({ oxyServices, activeSessionId }: { oxyServices: any, activeSessionId: string }) => {
    console.log('Redux: Fetching recently viewed properties');
    try {
      const response = await userApi.getRecentProperties(oxyServices, activeSessionId);
      console.log('Redux: Raw API response:', response);
      
      // Handle the nested response structure: { data: { success: true, data: [...], ... } }
      const properties = response.data?.data || response.data || [];
      console.log('Redux: Extracted properties:', properties.length, 'items');
      
      return properties;
    } catch (error) {
      console.error('Redux: Error fetching recently viewed properties:', error);
      throw error;
    }
  }
);

// Async thunk to clear recently viewed properties
export const clearRecentlyViewedProperties = createAsyncThunk(
  'recentlyViewed/clearProperties',
  async ({ oxyServices, activeSessionId }: { oxyServices: any, activeSessionId: string }) => {
    console.log('Redux: Clearing recently viewed properties');
    try {
      const response = await userApi.clearRecentProperties(oxyServices, activeSessionId);
      console.log('Redux: Successfully cleared recently viewed properties');
      return [];
    } catch (error) {
      console.error('Redux: Error clearing recently viewed properties:', error);
      throw error;
    }
  }
);

const recentlyViewedSlice = createSlice({
  name: 'recentlyViewed',
  initialState,
  reducers: {
    addPropertyToRecentlyViewed: (state, action: PayloadAction<Property>) => {
      const property = action.payload;
      const propertyId = property._id || property.id;
      
      // Remove existing property if it exists
      state.properties = state.properties.filter(p => (p._id || p.id) !== propertyId);
      
      // Add property to the beginning of the list
      state.properties.unshift(property);
      
      // Keep only the first 10 properties
      if (state.properties.length > 10) {
        state.properties = state.properties.slice(0, 10);
      }
    },
    removePropertyFromRecentlyViewed: (state, action: PayloadAction<string>) => {
      const propertyId = action.payload;
      state.properties = state.properties.filter(p => (p._id || p.id) !== propertyId);
    },
    clearRecentlyViewed: (state) => {
      state.properties = [];
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchRecentlyViewedProperties.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchRecentlyViewedProperties.fulfilled, (state, action: PayloadAction<Property[]>) => {
        state.isLoading = false;
        state.properties = action.payload;
      })
      .addCase(fetchRecentlyViewedProperties.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to fetch recently viewed properties';
      })
      .addCase(clearRecentlyViewedProperties.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(clearRecentlyViewedProperties.fulfilled, (state) => {
        state.isLoading = false;
        state.properties = [];
      })
      .addCase(clearRecentlyViewedProperties.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to clear recently viewed properties';
      });
  },
});

export const { 
  addPropertyToRecentlyViewed, 
  removePropertyFromRecentlyViewed,
  clearRecentlyViewed
} = recentlyViewedSlice.actions;

export default recentlyViewedSlice.reducer;

 
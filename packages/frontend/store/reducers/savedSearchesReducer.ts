import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { OxyServices } from '@oxyhq/services';
import { api } from '@/utils/api';

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  filters?: {
    minPrice?: number;
    maxPrice?: number;
    bedrooms?: number;
    bathrooms?: number;
    propertyType?: string;
    location?: string;
    amenities?: string[];
  };
  createdAt: string;
  updatedAt: string;
  notificationsEnabled?: boolean;
}

interface SavedSearchesState {
  searches: SavedSearch[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  lastSynced: number | null;
}

const initialState: SavedSearchesState = {
  searches: [],
  isLoading: false,
  isSaving: false,
  error: null,
  lastSynced: null,
};

// Async thunks for backend integration
export const fetchSavedSearches = createAsyncThunk(
  'savedSearches/fetchSavedSearches',
  async ({ oxyServices, activeSessionId }: { oxyServices: OxyServices; activeSessionId: string }) => {
    console.log('Redux: Fetching saved searches from backend');
    const response = await api.get('/api/profiles/me/saved-searches', { oxyServices, activeSessionId });
    return response.data?.data || [];
  }
);

export const saveSavedSearch = createAsyncThunk(
  'savedSearches/saveSavedSearch',
  async ({ 
    searchData, 
    oxyServices, 
    activeSessionId 
  }: { 
    searchData: {
      name: string;
      query: string;
      filters?: any;
      notificationsEnabled?: boolean;
    }; 
    oxyServices: OxyServices; 
    activeSessionId: string;
  }) => {
    console.log('Redux: Saving search to backend:', searchData);
    const response = await api.post('/api/profiles/me/saved-searches', searchData, { oxyServices, activeSessionId });
    return response.data?.data;
  }
);

export const deleteSavedSearchAsync = createAsyncThunk(
  'savedSearches/deleteSavedSearch',
  async ({ 
    searchId, 
    oxyServices, 
    activeSessionId 
  }: { 
    searchId: string; 
    oxyServices: OxyServices; 
    activeSessionId: string;
  }) => {
    console.log('Redux: Deleting search from backend:', searchId);
    await api.delete(`/api/profiles/me/saved-searches/${searchId}`, { oxyServices, activeSessionId });
    return searchId;
  }
);

export const updateSavedSearchAsync = createAsyncThunk(
  'savedSearches/updateSavedSearch',
  async ({ 
    searchId, 
    searchData, 
    oxyServices, 
    activeSessionId 
  }: { 
    searchId: string; 
    searchData: Partial<SavedSearch>; 
    oxyServices: OxyServices; 
    activeSessionId: string;
  }) => {
    console.log('Redux: Updating search in backend:', searchId, searchData);
    const response = await api.put(`/api/profiles/me/saved-searches/${searchId}`, searchData, { oxyServices, activeSessionId });
    return response.data?.data;
  }
);

export const toggleSavedSearchNotifications = createAsyncThunk(
  'savedSearches/toggleNotifications',
  async ({ 
    searchId, 
    oxyServices, 
    activeSessionId 
  }: { 
    searchId: string; 
    oxyServices: OxyServices; 
    activeSessionId: string;
  }) => {
    console.log('Redux: Toggling search notifications in backend:', searchId);
    const response = await api.put(`/api/profiles/me/saved-searches/${searchId}/notifications`, {}, { oxyServices, activeSessionId });
    return response.data?.data;
  }
);

const savedSearchesSlice = createSlice({
  name: 'savedSearches',
  initialState,
  reducers: {
    // Add a new saved search (optimistic update)
    addSavedSearch: (state, action: PayloadAction<SavedSearch>) => {
      const existingSearch = state.searches.find(search => search.id === action.payload.id);
      if (!existingSearch) {
        state.searches.unshift(action.payload); // Add to beginning of array
      }
    },
    
    // Remove a saved search (optimistic update)
    removeSavedSearch: (state, action: PayloadAction<string>) => {
      state.searches = state.searches.filter(search => search.id !== action.payload);
    },
    
    // Update an existing saved search (optimistic update)
    updateSavedSearch: (state, action: PayloadAction<SavedSearch>) => {
      const index = state.searches.findIndex(search => search.id === action.payload.id);
      if (index !== -1) {
        state.searches[index] = action.payload;
      }
    },
    
    // Toggle notifications for a saved search (optimistic update)
    toggleSearchNotifications: (state, action: PayloadAction<string>) => {
      const search = state.searches.find(s => s.id === action.payload);
      if (search) {
        search.notificationsEnabled = !search.notificationsEnabled;
        search.updatedAt = new Date().toISOString();
      }
    },
    
    // Set all saved searches (for initial load)
    setSavedSearches: (state, action: PayloadAction<SavedSearch[]>) => {
      state.searches = action.payload;
    },
    
    // Clear all saved searches
    clearSavedSearches: (state) => {
      state.searches = [];
    },
    
    // Loading states
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    
    setSaving: (state, action: PayloadAction<boolean>) => {
      state.isSaving = action.payload;
    },
    
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    
    setLastSynced: (state, action: PayloadAction<number>) => {
      state.lastSynced = action.payload;
    },
    
    // Reset state
    resetSavedSearches: (state) => {
      state.searches = [];
      state.isLoading = false;
      state.isSaving = false;
      state.error = null;
      state.lastSynced = null;
    },
  },
  extraReducers: (builder) => {
    // Fetch saved searches
    builder
      .addCase(fetchSavedSearches.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchSavedSearches.fulfilled, (state, action) => {
        state.isLoading = false;
        state.searches = action.payload;
        state.lastSynced = Date.now();
        console.log(`Redux: Successfully loaded ${action.payload.length} saved searches`);
      })
      .addCase(fetchSavedSearches.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to fetch saved searches';
        console.error('Redux: Failed to fetch saved searches:', action.error);
      });

    // Save search
    builder
      .addCase(saveSavedSearch.pending, (state) => {
        state.isSaving = true;
        state.error = null;
      })
      .addCase(saveSavedSearch.fulfilled, (state, action) => {
        state.isSaving = false;
        const newSearch = action.payload;
        // Add to beginning of array if not already exists
        const existingIndex = state.searches.findIndex(s => s.id === newSearch.id);
        if (existingIndex === -1) {
          state.searches.unshift(newSearch);
        } else {
          state.searches[existingIndex] = newSearch;
        }
        state.lastSynced = Date.now();
        console.log('Redux: Successfully saved search:', newSearch.id);
      })
      .addCase(saveSavedSearch.rejected, (state, action) => {
        state.isSaving = false;
        state.error = action.error.message || 'Failed to save search';
        console.error('Redux: Failed to save search:', action.error);
      });

    // Delete search
    builder
      .addCase(deleteSavedSearchAsync.pending, (state) => {
        state.isSaving = true;
        state.error = null;
      })
      .addCase(deleteSavedSearchAsync.fulfilled, (state, action) => {
        state.isSaving = false;
        const searchId = action.payload;
        state.searches = state.searches.filter(s => s.id !== searchId);
        state.lastSynced = Date.now();
        console.log('Redux: Successfully deleted search:', searchId);
      })
      .addCase(deleteSavedSearchAsync.rejected, (state, action) => {
        state.isSaving = false;
        state.error = action.error.message || 'Failed to delete search';
        console.error('Redux: Failed to delete search:', action.error);
      });

    // Update search
    builder
      .addCase(updateSavedSearchAsync.pending, (state) => {
        state.isSaving = true;
        state.error = null;
      })
      .addCase(updateSavedSearchAsync.fulfilled, (state, action) => {
        state.isSaving = false;
        const updatedSearch = action.payload;
        const index = state.searches.findIndex(s => s.id === updatedSearch.id);
        if (index !== -1) {
          state.searches[index] = updatedSearch;
        }
        state.lastSynced = Date.now();
        console.log('Redux: Successfully updated search:', updatedSearch.id);
      })
      .addCase(updateSavedSearchAsync.rejected, (state, action) => {
        state.isSaving = false;
        state.error = action.error.message || 'Failed to update search';
        console.error('Redux: Failed to update search:', action.error);
      });

    // Toggle notifications
    builder
      .addCase(toggleSavedSearchNotifications.pending, (state) => {
        state.isSaving = true;
        state.error = null;
      })
      .addCase(toggleSavedSearchNotifications.fulfilled, (state, action) => {
        state.isSaving = false;
        const updatedSearch = action.payload;
        const index = state.searches.findIndex(s => s.id === updatedSearch.id);
        if (index !== -1) {
          state.searches[index] = updatedSearch;
        }
        state.lastSynced = Date.now();
        console.log('Redux: Successfully toggled notifications for search:', updatedSearch.id);
      })
      .addCase(toggleSavedSearchNotifications.rejected, (state, action) => {
        state.isSaving = false;
        state.error = action.error.message || 'Failed to toggle notifications';
        console.error('Redux: Failed to toggle notifications:', action.error);
      });
  },
});

export const {
  addSavedSearch,
  removeSavedSearch,
  updateSavedSearch,
  toggleSearchNotifications,
  setSavedSearches,
  clearSavedSearches,
  setLoading,
  setSaving,
  setError,
  setLastSynced,
  resetSavedSearches,
} = savedSearchesSlice.actions;

export default savedSearchesSlice.reducer; 
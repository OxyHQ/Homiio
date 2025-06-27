import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { roommateService, RoommateFilters, RoommatePreferences } from '@/services/roommateService';
import { api } from '@/utils/api';
import type { Profile } from '@/services/profileService';
import { OxyServices } from '@oxyhq/services';

// Types
export interface RoommateProfile extends Profile {
  matchPercentage?: number;
}

export interface RoommateState {
  profiles: RoommateProfile[];
  myPreferences: RoommatePreferences | null;
  hasRoommateMatching: boolean;
  isLoading: boolean;
  error: string | null;
  filters: RoommateFilters;
  total: number;
  page: number;
  totalPages: number;
}

// Async thunks
export const fetchRoommateProfiles = createAsyncThunk(
  'roommate/fetchProfiles',
  async ({ filters, oxyServices, activeSessionId }: { 
    filters?: RoommateFilters; 
    oxyServices: OxyServices; 
    activeSessionId: string; 
  }, { rejectWithValue }) => {
    try {
      console.log('Fetching roommate profiles with filters:', filters);
      const response = await api.get('/api/roommates', { 
        params: filters,
        oxyServices,
        activeSessionId
      });
      console.log('Roommate profiles response:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('Error fetching roommate profiles:', error);
      return rejectWithValue(error.message || 'Failed to fetch roommate profiles');
    }
  }
);

export const fetchMyRoommatePreferences = createAsyncThunk(
  'roommate/fetchPreferences',
  async ({ oxyServices, activeSessionId }: { 
    oxyServices: OxyServices; 
    activeSessionId: string; 
  }, { rejectWithValue }) => {
    try {
      const response = await api.get('/api/roommates/preferences', {
        oxyServices,
        activeSessionId
      });
      return response.data.data;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to fetch preferences');
    }
  }
);

export const updateRoommatePreferences = createAsyncThunk(
  'roommate/updatePreferences',
  async ({ preferences, oxyServices, activeSessionId }: { 
    preferences: RoommatePreferences; 
    oxyServices: OxyServices; 
    activeSessionId: string; 
  }, { rejectWithValue }) => {
    try {
      const response = await api.put('/api/roommates/preferences', preferences, {
        oxyServices,
        activeSessionId
      });
      return response.data.data;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to update preferences');
    }
  }
);

export const toggleRoommateMatching = createAsyncThunk(
  'roommate/toggleMatching',
  async ({ enabled, oxyServices, activeSessionId }: { 
    enabled: boolean; 
    oxyServices: OxyServices; 
    activeSessionId: string; 
  }, { rejectWithValue }) => {
    try {
      await api.patch('/api/roommates/toggle', { enabled }, {
        oxyServices,
        activeSessionId
      });
      return enabled;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to toggle roommate matching');
    }
  }
);

export const sendRoommateRequest = createAsyncThunk(
  'roommate/sendRequest',
  async ({ profileId, message, oxyServices, activeSessionId }: { 
    profileId: string; 
    message?: string; 
    oxyServices: OxyServices; 
    activeSessionId: string; 
  }, { rejectWithValue }) => {
    try {
      await api.post(`/api/roommates/${profileId}/request`, { message }, {
        oxyServices,
        activeSessionId
      });
      return profileId;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Failed to send roommate request');
    }
  }
);

export const checkRoommateMatchingStatus = createAsyncThunk(
  'roommate/checkStatus',
  async ({ oxyServices, activeSessionId }: { 
    oxyServices: OxyServices; 
    activeSessionId: string; 
  }, { rejectWithValue }) => {
    try {
      console.log('checkRoommateMatchingStatus: Starting API call');
      console.log('checkRoommateMatchingStatus: oxyServices available:', !!oxyServices);
      console.log('checkRoommateMatchingStatus: activeSessionId available:', !!activeSessionId);
      
      // Get the current user's roommate status with enriched Oxy data
      const response = await api.get('/api/roommates/status', {
        oxyServices,
        activeSessionId
      });
      
      console.log('checkRoommateMatchingStatus: API response:', response.data);
      
      const { hasRoommateMatching, userData, profile } = response.data;
      
      console.log('checkRoommateMatchingStatus: hasRoommateMatching:', hasRoommateMatching);
      console.log('checkRoommateMatchingStatus: userData:', userData);
      console.log('checkRoommateMatchingStatus: profile:', profile);
      
      return {
        hasRoommateMatching,
        userData,
        profile
      };
    } catch (error: any) {
      console.error('checkRoommateMatchingStatus: Error:', error);
      return rejectWithValue(error.message || 'Failed to check roommate matching status');
    }
  }
);

// Initial state
const initialState: RoommateState = {
  profiles: [],
  myPreferences: null,
  hasRoommateMatching: false,
  isLoading: false,
  error: null,
  filters: {
    minMatchPercentage: 70,
    maxBudget: 1000,
    withPets: false,
    nonSmoking: false,
    interests: [],
  },
  total: 0,
  page: 1,
  totalPages: 1,
};

// Slice
const roommateSlice = createSlice({
  name: 'roommate',
  initialState,
  reducers: {
    setFilters: (state, action: PayloadAction<Partial<RoommateFilters>>) => {
      state.filters = { ...state.filters, ...action.payload };
    },
    clearFilters: (state) => {
      state.filters = initialState.filters;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    clearError: (state) => {
      state.error = null;
    },
    setHasRoommateMatching: (state, action: PayloadAction<boolean>) => {
      state.hasRoommateMatching = action.payload;
    },
  },
  extraReducers: (builder) => {
    // Fetch profiles
    builder
      .addCase(fetchRoommateProfiles.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchRoommateProfiles.fulfilled, (state, action) => {
        state.isLoading = false;
        state.profiles = action.payload.profiles;
        state.total = action.payload.total;
        state.page = action.payload.page;
        state.totalPages = action.payload.totalPages;
      })
      .addCase(fetchRoommateProfiles.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      });

    // Fetch preferences
    builder
      .addCase(fetchMyRoommatePreferences.fulfilled, (state, action) => {
        state.myPreferences = action.payload;
      })
      .addCase(fetchMyRoommatePreferences.rejected, (state, action) => {
        state.error = action.payload as string;
      });

    // Update preferences
    builder
      .addCase(updateRoommatePreferences.fulfilled, (state, action) => {
        state.myPreferences = action.payload;
      })
      .addCase(updateRoommatePreferences.rejected, (state, action) => {
        state.error = action.payload as string;
      });

    // Toggle matching
    builder
      .addCase(toggleRoommateMatching.fulfilled, (state, action) => {
        state.hasRoommateMatching = action.payload;
      })
      .addCase(toggleRoommateMatching.rejected, (state, action) => {
        state.error = action.payload as string;
      });

    // Check roommate matching status
    builder
      .addCase(checkRoommateMatchingStatus.fulfilled, (state, action) => {
        state.hasRoommateMatching = action.payload.hasRoommateMatching;
      })
      .addCase(checkRoommateMatchingStatus.rejected, (state, action) => {
        state.error = action.payload as string;
      });

    // Send request
    builder
      .addCase(sendRoommateRequest.rejected, (state, action) => {
        state.error = action.payload as string;
      });
  },
});

export const {
  setFilters,
  clearFilters,
  setError,
  clearError,
  setHasRoommateMatching,
} = roommateSlice.actions;

export default roommateSlice.reducer; 
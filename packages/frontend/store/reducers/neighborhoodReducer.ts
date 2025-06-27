import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { OxyServices } from '@oxyhq/services';
import neighborhoodService, { NeighborhoodData, NeighborhoodFilters } from '@/services/neighborhoodService';

interface NeighborhoodState {
  currentNeighborhood: NeighborhoodData | null;
  popularNeighborhoods: NeighborhoodData[];
  searchResults: NeighborhoodData[];
  isLoading: boolean;
  isSearching: boolean;
  error: string | null;
  lastFetched: number | null;
}

const initialState: NeighborhoodState = {
  currentNeighborhood: null,
  popularNeighborhoods: [],
  searchResults: [],
  isLoading: false,
  isSearching: false,
  error: null,
  lastFetched: null,
};

// Async thunks
export const fetchNeighborhoodByLocation = createAsyncThunk(
  'neighborhood/fetchByLocation',
  async ({ 
    latitude, 
    longitude, 
    oxyServices, 
    activeSessionId 
  }: { 
    latitude: number; 
    longitude: number; 
    oxyServices?: OxyServices; 
    activeSessionId?: string; 
  }) => {
    console.log('Redux: Fetching neighborhood by location:', { latitude, longitude });
    const neighborhood = await neighborhoodService.getNeighborhoodByLocation(
      latitude, 
      longitude, 
      oxyServices, 
      activeSessionId
    );
    console.log('Redux: Fetched neighborhood:', neighborhood.name);
    return neighborhood;
  }
);

export const fetchNeighborhoodByName = createAsyncThunk(
  'neighborhood/fetchByName',
  async ({ 
    name, 
    city, 
    state, 
    oxyServices, 
    activeSessionId 
  }: { 
    name: string; 
    city?: string; 
    state?: string; 
    oxyServices?: OxyServices; 
    activeSessionId?: string; 
  }) => {
    console.log('Redux: Fetching neighborhood by name:', { name, city, state });
    const neighborhood = await neighborhoodService.getNeighborhoodByName(
      name, 
      city, 
      state, 
      oxyServices, 
      activeSessionId
    );
    console.log('Redux: Fetched neighborhood:', neighborhood.name);
    return neighborhood;
  }
);

export const fetchNeighborhoodByProperty = createAsyncThunk(
  'neighborhood/fetchByProperty',
  async ({ 
    propertyId, 
    oxyServices, 
    activeSessionId 
  }: { 
    propertyId: string; 
    oxyServices?: OxyServices; 
    activeSessionId?: string; 
  }) => {
    console.log('Redux: Fetching neighborhood by property:', propertyId);
    const neighborhood = await neighborhoodService.getNeighborhoodByProperty(
      propertyId, 
      oxyServices, 
      activeSessionId
    );
    console.log('Redux: Fetched neighborhood for property:', neighborhood.name);
    return neighborhood;
  }
);

export const searchNeighborhoods = createAsyncThunk(
  'neighborhood/search',
  async ({ 
    filters, 
    oxyServices, 
    activeSessionId 
  }: { 
    filters: NeighborhoodFilters; 
    oxyServices?: OxyServices; 
    activeSessionId?: string; 
  }) => {
    console.log('Redux: Searching neighborhoods with filters:', filters);
    const neighborhoods = await neighborhoodService.searchNeighborhoods(
      filters, 
      oxyServices, 
      activeSessionId
    );
    console.log('Redux: Found', neighborhoods.length, 'neighborhoods');
    return neighborhoods;
  }
);

export const fetchPopularNeighborhoods = createAsyncThunk(
  'neighborhood/fetchPopular',
  async ({ 
    city, 
    state, 
    limit, 
    oxyServices, 
    activeSessionId 
  }: { 
    city: string; 
    state?: string; 
    limit?: number; 
    oxyServices?: OxyServices; 
    activeSessionId?: string; 
  }) => {
    console.log('Redux: Fetching popular neighborhoods for:', city);
    const neighborhoods = await neighborhoodService.getPopularNeighborhoods(
      city, 
      state, 
      limit, 
      oxyServices, 
      activeSessionId
    );
    console.log('Redux: Fetched', neighborhoods.length, 'popular neighborhoods');
    return neighborhoods;
  }
);

const neighborhoodSlice = createSlice({
  name: 'neighborhood',
  initialState,
  reducers: {
    setCurrentNeighborhood: (state, action: PayloadAction<NeighborhoodData | null>) => {
      state.currentNeighborhood = action.payload;
      state.lastFetched = Date.now();
    },
    clearCurrentNeighborhood: (state) => {
      state.currentNeighborhood = null;
      state.lastFetched = null;
    },
    clearSearchResults: (state) => {
      state.searchResults = [];
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    clearError: (state) => {
      state.error = null;
    },
    resetNeighborhood: (state) => {
      state.currentNeighborhood = null;
      state.popularNeighborhoods = [];
      state.searchResults = [];
      state.isLoading = false;
      state.isSearching = false;
      state.error = null;
      state.lastFetched = null;
    },
  },
  extraReducers: (builder) => {
    // Fetch by location
    builder
      .addCase(fetchNeighborhoodByLocation.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchNeighborhoodByLocation.fulfilled, (state, action) => {
        state.isLoading = false;
        state.currentNeighborhood = action.payload;
        state.lastFetched = Date.now();
        state.error = null;
      })
      .addCase(fetchNeighborhoodByLocation.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to fetch neighborhood by location';
      });

    // Fetch by name
    builder
      .addCase(fetchNeighborhoodByName.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchNeighborhoodByName.fulfilled, (state, action) => {
        state.isLoading = false;
        state.currentNeighborhood = action.payload;
        state.lastFetched = Date.now();
        state.error = null;
      })
      .addCase(fetchNeighborhoodByName.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to fetch neighborhood by name';
      });

    // Fetch by property
    builder
      .addCase(fetchNeighborhoodByProperty.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchNeighborhoodByProperty.fulfilled, (state, action) => {
        state.isLoading = false;
        state.currentNeighborhood = action.payload;
        state.lastFetched = Date.now();
        state.error = null;
      })
      .addCase(fetchNeighborhoodByProperty.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to fetch neighborhood by property';
      });

    // Search neighborhoods
    builder
      .addCase(searchNeighborhoods.pending, (state) => {
        state.isSearching = true;
        state.error = null;
      })
      .addCase(searchNeighborhoods.fulfilled, (state, action) => {
        state.isSearching = false;
        state.searchResults = action.payload;
        state.error = null;
      })
      .addCase(searchNeighborhoods.rejected, (state, action) => {
        state.isSearching = false;
        state.error = action.error.message || 'Failed to search neighborhoods';
      });

    // Fetch popular neighborhoods
    builder
      .addCase(fetchPopularNeighborhoods.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchPopularNeighborhoods.fulfilled, (state, action) => {
        state.isLoading = false;
        state.popularNeighborhoods = action.payload;
        state.error = null;
      })
      .addCase(fetchPopularNeighborhoods.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to fetch popular neighborhoods';
      });
  },
});

export const {
  setCurrentNeighborhood,
  clearCurrentNeighborhood,
  clearSearchResults,
  setError,
  clearError,
  resetNeighborhood,
} = neighborhoodSlice.actions;

export default neighborhoodSlice.reducer; 
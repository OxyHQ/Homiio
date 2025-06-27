import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';

// Types
export interface LocationResult {
  place_id: string;
  display_name: string;
  lat: string;
  lon: string;
  address: {
    house_number?: string;
    road?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
}

export interface ReverseLocationResult {
  place_id: string;
  display_name: string;
  lat: string;
  lon: string;
  address: {
    house_number?: string;
    road?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
}

// Async thunks
export const searchLocation = createAsyncThunk(
  'location/searchLocation',
  async (query: string) => {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`
    );
    const data = await response.json();
    return data as LocationResult[];
  }
);

export const reverseGeocode = createAsyncThunk(
  'location/reverseGeocode',
  async ({ lat, lng }: { lat: number; lng: number }) => {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`
    );
    const data = await response.json();
    return data as ReverseLocationResult;
  }
);

// State interface
interface LocationState {
  searchResults: {
    results: LocationResult[];
    loading: boolean;
    error: string | null;
    query: string | null;
  };
  reverseGeocode: {
    result: ReverseLocationResult | null;
    loading: boolean;
    error: string | null;
    coordinates: { lat: number; lng: number } | null;
  };
}

// Initial state
const initialState: LocationState = {
  searchResults: {
    results: [],
    loading: false,
    error: null,
    query: null,
  },
  reverseGeocode: {
    result: null,
    loading: false,
    error: null,
    coordinates: null,
  },
};

// Slice
const locationSlice = createSlice({
  name: 'location',
  initialState,
  reducers: {
    clearSearchResults: (state) => {
      state.searchResults.results = [];
      state.searchResults.error = null;
      state.searchResults.query = null;
    },
    clearReverseGeocode: (state) => {
      state.reverseGeocode.result = null;
      state.reverseGeocode.error = null;
      state.reverseGeocode.coordinates = null;
    },
    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchResults.query = action.payload;
    },
    clearAllLocationData: (state) => {
      state.searchResults.results = [];
      state.searchResults.error = null;
      state.searchResults.query = null;
      state.reverseGeocode.result = null;
      state.reverseGeocode.error = null;
      state.reverseGeocode.coordinates = null;
    },
  },
  extraReducers: (builder) => {
    // Search Location
    builder
      .addCase(searchLocation.pending, (state) => {
        state.searchResults.loading = true;
        state.searchResults.error = null;
      })
      .addCase(searchLocation.fulfilled, (state, action) => {
        state.searchResults.loading = false;
        state.searchResults.results = action.payload;
      })
      .addCase(searchLocation.rejected, (state, action) => {
        state.searchResults.loading = false;
        state.searchResults.error = action.error.message || 'Failed to search location';
      });

    // Reverse Geocode
    builder
      .addCase(reverseGeocode.pending, (state) => {
        state.reverseGeocode.loading = true;
        state.reverseGeocode.error = null;
      })
      .addCase(reverseGeocode.fulfilled, (state, action) => {
        state.reverseGeocode.loading = false;
        state.reverseGeocode.result = action.payload;
      })
      .addCase(reverseGeocode.rejected, (state, action) => {
        state.reverseGeocode.loading = false;
        state.reverseGeocode.error = action.error.message || 'Failed to reverse geocode';
      });
  },
});

export const {
  clearSearchResults,
  clearReverseGeocode,
  setSearchQuery,
  clearAllLocationData,
} = locationSlice.actions;

export default locationSlice.reducer; 
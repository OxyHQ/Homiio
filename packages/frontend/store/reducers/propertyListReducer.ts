import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { propertyService, Property, PropertyFilters } from '@/services/propertyService';
import { useOxy } from '@oxyhq/services';

// Async thunks
export const fetchEcoProperties = createAsyncThunk(
  'propertyList/fetchEcoProperties',
  async (filters?: PropertyFilters) => {
    const ecoFilters = { ...filters, ecoFriendly: true };
    const response = await propertyService.getProperties(ecoFilters);
    return response;
  }
);

export const fetchCityProperties = createAsyncThunk(
  'propertyList/fetchCityProperties',
  async ({ cityId, filters }: { cityId: string; filters?: PropertyFilters }) => {
    const cityFilters = { ...filters, city: cityId };
    const response = await propertyService.getProperties(cityFilters);
    return response;
  }
);

export const fetchTypeProperties = createAsyncThunk(
  'propertyList/fetchTypeProperties',
  async ({ propertyType, filters }: { propertyType: string; filters?: PropertyFilters }) => {
    const typeFilters = { ...filters, type: propertyType };
    const response = await propertyService.getProperties(typeFilters);
    return response;
  }
);

// State interface
interface PropertyListState {
  ecoProperties: {
    properties: Property[];
    loading: boolean;
    error: string | null;
    filters: PropertyFilters;
  };
  cityProperties: {
    properties: Property[];
    loading: boolean;
    error: string | null;
    filters: PropertyFilters;
    currentCity: string | null;
  };
  typeProperties: {
    properties: Property[];
    loading: boolean;
    error: string | null;
    filters: PropertyFilters;
    currentType: string | null;
  };
}

// Initial state
const initialState: PropertyListState = {
  ecoProperties: {
    properties: [],
    loading: false,
    error: null,
    filters: {},
  },
  cityProperties: {
    properties: [],
    loading: false,
    error: null,
    filters: {},
    currentCity: null,
  },
  typeProperties: {
    properties: [],
    loading: false,
    error: null,
    filters: {},
    currentType: null,
  },
};

// Slice
const propertyListSlice = createSlice({
  name: 'propertyList',
  initialState,
  reducers: {
    clearEcoProperties: (state) => {
      state.ecoProperties.properties = [];
      state.ecoProperties.error = null;
    },
    clearCityProperties: (state) => {
      state.cityProperties.properties = [];
      state.cityProperties.error = null;
    },
    clearTypeProperties: (state) => {
      state.typeProperties.properties = [];
      state.typeProperties.error = null;
    },
    setEcoFilters: (state, action: PayloadAction<PropertyFilters>) => {
      state.ecoProperties.filters = action.payload;
    },
    setCityFilters: (state, action: PayloadAction<PropertyFilters>) => {
      state.cityProperties.filters = action.payload;
    },
    setTypeFilters: (state, action: PayloadAction<PropertyFilters>) => {
      state.typeProperties.filters = action.payload;
    },
    clearAllPropertyLists: (state) => {
      state.ecoProperties.properties = [];
      state.cityProperties.properties = [];
      state.typeProperties.properties = [];
      state.ecoProperties.error = null;
      state.cityProperties.error = null;
      state.typeProperties.error = null;
    },
  },
  extraReducers: (builder) => {
    // Eco Properties
    builder
      .addCase(fetchEcoProperties.pending, (state) => {
        state.ecoProperties.loading = true;
        state.ecoProperties.error = null;
      })
      .addCase(fetchEcoProperties.fulfilled, (state, action) => {
        state.ecoProperties.loading = false;
        state.ecoProperties.properties = action.payload.properties;
      })
      .addCase(fetchEcoProperties.rejected, (state, action) => {
        state.ecoProperties.loading = false;
        state.ecoProperties.error = action.error.message || 'Failed to fetch eco properties';
      });

    // City Properties
    builder
      .addCase(fetchCityProperties.pending, (state) => {
        state.cityProperties.loading = true;
        state.cityProperties.error = null;
      })
      .addCase(fetchCityProperties.fulfilled, (state, action) => {
        state.cityProperties.loading = false;
        state.cityProperties.properties = action.payload.properties;
      })
      .addCase(fetchCityProperties.rejected, (state, action) => {
        state.cityProperties.loading = false;
        state.cityProperties.error = action.error.message || 'Failed to fetch city properties';
      });

    // Type Properties
    builder
      .addCase(fetchTypeProperties.pending, (state) => {
        state.typeProperties.loading = true;
        state.typeProperties.error = null;
      })
      .addCase(fetchTypeProperties.fulfilled, (state, action) => {
        state.typeProperties.loading = false;
        state.typeProperties.properties = action.payload.properties;
      })
      .addCase(fetchTypeProperties.rejected, (state, action) => {
        state.typeProperties.loading = false;
        state.typeProperties.error = action.error.message || 'Failed to fetch type properties';
      });
  },
});

export const {
  clearEcoProperties,
  clearCityProperties,
  clearTypeProperties,
  setEcoFilters,
  setCityFilters,
  setTypeFilters,
  clearAllPropertyLists,
} = propertyListSlice.actions;

export default propertyListSlice.reducer; 
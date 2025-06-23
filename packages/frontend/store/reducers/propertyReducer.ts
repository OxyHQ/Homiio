import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { propertyService, Property, CreatePropertyData, PropertyFilters } from '@/services/propertyService';

interface PropertyState {
  properties: Property[];
  currentProperty: Property | null;
  isLoading: boolean;
  error: string | null;
}

const initialState: PropertyState = {
  properties: [],
  currentProperty: null,
  isLoading: false,
  error: null,
};

export const fetchProperties = createAsyncThunk(
  'properties/fetchProperties',
  async (filters: PropertyFilters | undefined) => {
    const result = await propertyService.getProperties(filters);
    return result.properties;
  },
);

export const fetchProperty = createAsyncThunk(
  'properties/fetchProperty',
  async (id: string) => {
    const property = await propertyService.getProperty(id);
    return property;
  },
);

export const createProperty = createAsyncThunk(
  'properties/createProperty',
  async (
    { data, oxyServices, activeSessionId }: { data: CreatePropertyData, oxyServices: any, activeSessionId: string }
  ) => {
    const property = await propertyService.createProperty(data, oxyServices, activeSessionId);
    return property;
  },
);

const propertySlice = createSlice({
  name: 'properties',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchProperties.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchProperties.fulfilled, (state, action: PayloadAction<Property[]>) => {
        state.isLoading = false;
        state.properties = action.payload;
      })
      .addCase(fetchProperties.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to fetch properties';
      })
      .addCase(fetchProperty.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchProperty.fulfilled, (state, action: PayloadAction<Property>) => {
        state.isLoading = false;
        state.currentProperty = action.payload;
      })
      .addCase(fetchProperty.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to fetch property';
      })
      .addCase(createProperty.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(createProperty.fulfilled, (state, action: PayloadAction<Property>) => {
        state.isLoading = false;
        state.properties.push(action.payload);
        state.currentProperty = action.payload;
      })
      .addCase(createProperty.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to create property';
      });
  },
});

export default propertySlice.reducer;

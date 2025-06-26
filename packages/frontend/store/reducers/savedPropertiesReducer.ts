import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { OxyServices } from '@oxyhq/services';
import savedPropertyService from '@/services/savedPropertyService';
import type { Property } from '@/services/propertyService';

// Enhanced interface for saved properties with full data
export interface SavedPropertyWithMeta extends Property {
  notes?: string;
  savedAt?: string;
}

interface SavedPropertiesState {
  properties: SavedPropertyWithMeta[];
  favoriteIds: string[]; // Keep for quick lookups
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  lastSynced: number | null;
}

const initialState: SavedPropertiesState = {
  properties: [],
  favoriteIds: [],
  isLoading: false,
  isSaving: false,
  error: null,
  lastSynced: null,
};

// Async thunks for API operations
export const loadSavedProperties = createAsyncThunk(
  'savedProperties/load',
  async ({ oxyServices, activeSessionId }: { oxyServices: OxyServices; activeSessionId: string }) => {
    console.log('Redux: Loading saved properties from API...');
    const savedProperties = await savedPropertyService.getSavedProperties(oxyServices, activeSessionId);
    console.log(`Redux: Loaded ${savedProperties.length} saved properties`);
    
    // Convert SavedProperty[] to SavedPropertyWithMeta[] by ensuring compatibility
    return savedProperties.map(prop => ({
      // Map SavedProperty fields to Property fields
      _id: prop._id,
      id: prop._id, // Use _id as fallback for id
      title: prop.title || 'Untitled Property',
      description: prop.description,
      address: {
        street: prop.location?.address || '',
        city: prop.location?.city || '',
        state: prop.location?.state || '',
        zipCode: prop.location?.zipCode || '',
        country: 'US' // Default country
      },
      type: 'apartment' as const, // Default type since it's not in SavedProperty
      rent: {
        amount: prop.price || 0,
        currency: 'USD',
        paymentFrequency: 'monthly' as const,
        deposit: 0,
        utilities: 'excluded' as const
      },
      status: 'available' as const,
      ownerId: '',
      images: prop.images || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      notes: prop.notes,
      savedAt: prop.savedAt
    } as SavedPropertyWithMeta));
  }
);

export const saveProperty = createAsyncThunk(
  'savedProperties/save',
  async ({ 
    propertyId, 
    notes, 
    oxyServices, 
    activeSessionId 
  }: { 
    propertyId: string; 
    notes?: string; 
    oxyServices: OxyServices; 
    activeSessionId: string;
  }) => {
    console.log('Redux: Saving property to API...', propertyId);
    await savedPropertyService.saveProperty({ propertyId, notes }, oxyServices, activeSessionId);
    
    // Return the saved property data for optimistic updates
    return {
      propertyId,
      notes: notes || '',
      savedAt: new Date().toISOString()
    };
  }
);

export const unsaveProperty = createAsyncThunk(
  'savedProperties/unsave',
  async ({ 
    propertyId, 
    oxyServices, 
    activeSessionId 
  }: { 
    propertyId: string; 
    oxyServices: OxyServices; 
    activeSessionId: string;
  }) => {
    console.log('Redux: Unsaving property from API...', propertyId);
    await savedPropertyService.unsaveProperty(propertyId, oxyServices, activeSessionId);
    return propertyId;
  }
);

export const updatePropertyNotes = createAsyncThunk(
  'savedProperties/updateNotes',
  async ({ 
    propertyId, 
    notes, 
    oxyServices, 
    activeSessionId 
  }: { 
    propertyId: string; 
    notes: string; 
    oxyServices: OxyServices; 
    activeSessionId: string;
  }) => {
    console.log('Redux: Updating property notes...', propertyId);
    await savedPropertyService.updateNotes(propertyId, { notes }, oxyServices, activeSessionId);
    return { propertyId, notes };
  }
);

const savedPropertiesSlice = createSlice({
  name: 'savedProperties',
  initialState,
  reducers: {
    // Manual actions for immediate UI updates
    addPropertyOptimistic: (state, action: PayloadAction<{ propertyId: string; propertyData?: Partial<SavedPropertyWithMeta> }>) => {
      const { propertyId, propertyData } = action.payload;
      
      // Don't add if already exists
      if (state.favoriteIds.includes(propertyId)) {
        return;
      }
      
      state.favoriteIds.push(propertyId);
      
      // Add full property data if provided, otherwise add placeholder
      if (propertyData) {
        state.properties.push({
          ...propertyData,
          _id: propertyId,
          savedAt: new Date().toISOString()
        } as SavedPropertyWithMeta);
      } else {
        // Add placeholder that will be replaced when full data loads
        state.properties.push({
          _id: propertyId,
          id: propertyId,
          title: 'Loading...',
          address: { street: '', city: '', state: '', zipCode: '', country: '' },
          type: 'apartment',
          rent: { amount: 0, currency: 'USD', paymentFrequency: 'monthly', deposit: 0, utilities: 'excluded' },
          status: 'available',
          ownerId: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          savedAt: new Date().toISOString(),
          notes: '',
        } as SavedPropertyWithMeta);
      }
    },
    
    removePropertyOptimistic: (state, action: PayloadAction<string>) => {
      const propertyId = action.payload;
      state.favoriteIds = state.favoriteIds.filter(id => id !== propertyId);
      state.properties = state.properties.filter(p => p._id !== propertyId && p.id !== propertyId);
    },
    
    updatePropertyNotesOptimistic: (state, action: PayloadAction<{ propertyId: string; notes: string }>) => {
      const { propertyId, notes } = action.payload;
      const property = state.properties.find(p => p._id === propertyId || p.id === propertyId);
      if (property) {
        property.notes = notes;
      }
    },
    
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    
    clearError: (state) => {
      state.error = null;
    },
    
    resetSavedProperties: (state) => {
      state.properties = [];
      state.favoriteIds = [];
      state.isLoading = false;
      state.isSaving = false;
      state.error = null;
      state.lastSynced = null;
    },
  },
  extraReducers: (builder) => {
    // Load saved properties
    builder
      .addCase(loadSavedProperties.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(loadSavedProperties.fulfilled, (state, action) => {
        state.isLoading = false;
        state.properties = action.payload;
        state.favoriteIds = action.payload.map(p => p._id || p.id || '').filter(Boolean);
        state.lastSynced = Date.now();
        state.error = null;
        console.log(`Redux: Successfully loaded ${action.payload.length} saved properties`);
      })
      .addCase(loadSavedProperties.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to load saved properties';
        console.error('Redux: Failed to load saved properties:', action.error);
      });

    // Save property
    builder
      .addCase(saveProperty.pending, (state) => {
        state.isSaving = true;
        state.error = null;
      })
      .addCase(saveProperty.fulfilled, (state, action) => {
        state.isSaving = false;
        const { propertyId, notes, savedAt } = action.payload;
        
        // Add to favorites if not already there
        if (!state.favoriteIds.includes(propertyId)) {
          state.favoriteIds.push(propertyId);
        }
        
        // Update or add the property in the list
        const existingIndex = state.properties.findIndex(p => p._id === propertyId || p.id === propertyId);
        if (existingIndex >= 0) {
          state.properties[existingIndex].notes = notes;
          state.properties[existingIndex].savedAt = savedAt;
        }
        
        state.lastSynced = Date.now();
        console.log(`Redux: Successfully saved property ${propertyId}`);
      })
      .addCase(saveProperty.rejected, (state, action) => {
        state.isSaving = false;
        state.error = action.error.message || 'Failed to save property';
        console.error('Redux: Failed to save property:', action.error);
      });

    // Unsave property
    builder
      .addCase(unsaveProperty.pending, (state) => {
        state.isSaving = true;
        state.error = null;
      })
      .addCase(unsaveProperty.fulfilled, (state, action) => {
        state.isSaving = false;
        const propertyId = action.payload;
        
        // Remove from favorites and properties
        state.favoriteIds = state.favoriteIds.filter(id => id !== propertyId);
        state.properties = state.properties.filter(p => p._id !== propertyId && p.id !== propertyId);
        
        state.lastSynced = Date.now();
        console.log(`Redux: Successfully unsaved property ${propertyId}`);
      })
      .addCase(unsaveProperty.rejected, (state, action) => {
        state.isSaving = false;
        state.error = action.error.message || 'Failed to unsave property';
        console.error('Redux: Failed to unsave property:', action.error);
      });

    // Update notes
    builder
      .addCase(updatePropertyNotes.pending, (state) => {
        state.isSaving = true;
        state.error = null;
      })
      .addCase(updatePropertyNotes.fulfilled, (state, action) => {
        state.isSaving = false;
        const { propertyId, notes } = action.payload;
        
        const property = state.properties.find(p => p._id === propertyId || p.id === propertyId);
        if (property) {
          property.notes = notes;
        }
        
        state.lastSynced = Date.now();
        console.log(`Redux: Successfully updated notes for property ${propertyId}`);
      })
      .addCase(updatePropertyNotes.rejected, (state, action) => {
        state.isSaving = false;
        state.error = action.error.message || 'Failed to update notes';
        console.error('Redux: Failed to update notes:', action.error);
      });
  },
});

export const {
  addPropertyOptimistic,
  removePropertyOptimistic,
  updatePropertyNotesOptimistic,
  setError,
  clearError,
  resetSavedProperties,
} = savedPropertiesSlice.actions;

export default savedPropertiesSlice.reducer; 
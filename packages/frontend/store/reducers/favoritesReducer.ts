import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface FavoritesState {
  favoriteIds: string[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  lastSynced: number | null;
}

const initialState: FavoritesState = {
  favoriteIds: [],
  isLoading: false,
  isSaving: false,
  error: null,
  lastSynced: null,
};

const favoritesSlice = createSlice({
  name: 'favorites',
  initialState,
  reducers: {
    addToFavorites: (state, action: PayloadAction<string>) => {
      const propertyId = action.payload;
      if (!state.favoriteIds.includes(propertyId)) {
        state.favoriteIds.push(propertyId);
      }
    },
    removeFromFavorites: (state, action: PayloadAction<string>) => {
      const propertyId = action.payload;
      state.favoriteIds = state.favoriteIds.filter(id => id !== propertyId);
    },
    toggleFavorite: (state, action: PayloadAction<string>) => {
      const propertyId = action.payload;
      const index = state.favoriteIds.indexOf(propertyId);
      if (index > -1) {
        state.favoriteIds.splice(index, 1);
      } else {
        state.favoriteIds.push(propertyId);
      }
    },
    setFavorites: (state, action: PayloadAction<string[]>) => {
      state.favoriteIds = action.payload;
    },
    clearFavorites: (state) => {
      state.favoriteIds = [];
    },
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
    resetFavorites: (state) => {
      state.favoriteIds = [];
      state.isLoading = false;
      state.isSaving = false;
      state.error = null;
      state.lastSynced = null;
    },
  },
});

export const {
  addToFavorites,
  removeFromFavorites,
  toggleFavorite,
  setFavorites,
  clearFavorites,
  setLoading,
  setSaving,
  setError,
  setLastSynced,
  resetFavorites,
} = favoritesSlice.actions;

export default favoritesSlice.reducer; 
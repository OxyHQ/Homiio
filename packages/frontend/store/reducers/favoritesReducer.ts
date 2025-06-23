import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface FavoritesState {
  favoriteIds: string[];
  isLoading: boolean;
  error: string | null;
}

const initialState: FavoritesState = {
  favoriteIds: [],
  isLoading: false,
  error: null,
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
  },
});

export const {
  addToFavorites,
  removeFromFavorites,
  toggleFavorite,
  setFavorites,
  clearFavorites,
} = favoritesSlice.actions;

export default favoritesSlice.reducer; 
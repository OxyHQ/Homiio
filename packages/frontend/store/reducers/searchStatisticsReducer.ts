import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface SearchStatistics {
  recentSearches: string[];
  popularSearches: string[];
  propertyTypeCounts: { [key: string]: number };
  cityCounts: { [key: string]: number };
}

interface SearchStatisticsState {
  data: SearchStatistics | null;
  loading: boolean;
  error: string | null;
}

const initialState: SearchStatisticsState = {
  data: null,
  loading: false,
  error: null,
};

const searchStatisticsSlice = createSlice({
  name: 'searchStatistics',
  initialState,
  reducers: {
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setData: (state, action: PayloadAction<SearchStatistics>) => {
      state.data = action.payload;
      state.loading = false;
      state.error = null;
    },
    setError: (state, action: PayloadAction<string>) => {
      state.error = action.payload;
      state.loading = false;
    },
    clearData: (state) => {
      state.data = null;
      state.loading = false;
      state.error = null;
    },
  },
});

export const { setLoading, setData, setError, clearData } = searchStatisticsSlice.actions;
export default searchStatisticsSlice.reducer; 
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Currency, getDefaultCurrency } from '@/utils/currency';

interface CurrencyState {
  currentCurrency: Currency;
  isLoading: boolean;
  error: string | null;
}

const initialState: CurrencyState = {
  currentCurrency: getDefaultCurrency(),
  isLoading: false,
  error: null,
};

const currencySlice = createSlice({
  name: 'currency',
  initialState,
  reducers: {
    setCurrency: (state, action: PayloadAction<Currency>) => {
      state.currentCurrency = action.payload;
      state.error = null;
    },
    setCurrencyByCode: (state, action: PayloadAction<string>) => {
      // This will be handled by a thunk or selector
      state.error = null;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
  },
});

export const { setCurrency, setCurrencyByCode, setLoading, setError } = currencySlice.actions;
export default currencySlice.reducer; 
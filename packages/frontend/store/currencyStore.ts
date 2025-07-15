import { create } from 'zustand';

// Currency State Interface
interface CurrencyState {
  // Data
  currentCurrency: string;
  exchangeRates: Record<string, number>;
  currencies: Array<{
    code: string;
    name: string;
    symbol: string;
  }>;
  
  // Loading states
  isLoading: boolean;
  error: string | null;
  
  // Actions
  setCurrentCurrency: (currency: string) => void;
  setExchangeRates: (rates: Record<string, number>) => void;
  setCurrencies: (currencies: CurrencyState['currencies']) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export const useCurrencyStore = create<CurrencyState>((set, get) => ({
  // Initial state
  currentCurrency: 'USD',
  exchangeRates: {},
  currencies: [
    { code: 'USD', name: 'US Dollar', symbol: '$' },
    { code: 'EUR', name: 'Euro', symbol: '€' },
    { code: 'GBP', name: 'British Pound', symbol: '£' },
    { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
  ],
  isLoading: false,
  error: null,
  
  // Actions
  setCurrentCurrency: (currency) => set({ currentCurrency: currency }),
  setExchangeRates: (rates) => set({ exchangeRates: rates }),
  setCurrencies: (currencies) => set({ currencies }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),
}));

// Selector hooks for easier access
export const useCurrencySelectors = () => {
  const currentCurrency = useCurrencyStore((state) => state.currentCurrency);
  const exchangeRates = useCurrencyStore((state) => state.exchangeRates);
  const currencies = useCurrencyStore((state) => state.currencies);
  const isLoading = useCurrencyStore((state) => state.isLoading);
  const error = useCurrencyStore((state) => state.error);

  return {
    currentCurrency,
    exchangeRates,
    currencies,
    isLoading,
    error,
  };
}; 
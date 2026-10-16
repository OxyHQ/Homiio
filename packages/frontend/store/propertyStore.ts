import { create } from 'zustand';

// Property State Interface
interface PropertyState {
  // Loading states
  loading: {
    delete: boolean;
  };

  // Error state
  error: string | null;

  // Actions
  setLoading: (key: keyof PropertyState['loading'], loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const usePropertyStore = create<PropertyState>()((set) => ({
  // Initial state
  loading: {
    delete: false,
  },
  error: null,

  // Actions
  setLoading: (key, loading) =>
    set((state) => ({
      loading: { ...state.loading, [key]: loading },
    })),
  setError: (error) => set({ error }),
}));

// Selector hooks for easier access
export const usePropertySelectors = () => {
  const loading = usePropertyStore((state) => state.loading);
  const error = usePropertyStore((state) => state.error);

  return {
    loading,
    error,
  };
};

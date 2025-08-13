import { create } from 'zustand';

// Trust Score State Interface
interface TrustScoreState {
  // Data
  score: number;
  factors: Array<{
    id: string;
    name: string;
    score: number;
    weight: number;
    description: string;
  }>;
  history: Array<{
    date: string;
    score: number;
    change: number;
  }>;

  // Loading states
  isLoading: boolean;
  error: string | null;

  // Actions
  setScore: (score: number) => void;
  setFactors: (factors: TrustScoreState['factors']) => void;
  setHistory: (history: TrustScoreState['history']) => void;
  addHistoryEntry: (entry: TrustScoreState['history'][0]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export const useTrustScoreStore = create<TrustScoreState>()((set, get) => ({
  // Initial state
  score: 0,
  factors: [],
  history: [],
  isLoading: false,
  error: null,

  // Actions
  setScore: (score) => set({ score }),
  setFactors: (factors) => set({ factors }),
  setHistory: (history) => set({ history }),
  addHistoryEntry: (entry) =>
    set((state) => ({
      history: [entry, ...state.history].slice(0, 30), // Keep last 30 entries
    })),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),
}));

// Selector hooks for easier access
export const useTrustScoreSelectors = () => {
  const score = useTrustScoreStore((state) => state.score);
  const factors = useTrustScoreStore((state) => state.factors);
  const history = useTrustScoreStore((state) => state.history);
  const isLoading = useTrustScoreStore((state) => state.isLoading);
  const error = useTrustScoreStore((state) => state.error);

  return {
    score,
    factors,
    history,
    isLoading,
    error,
  };
};

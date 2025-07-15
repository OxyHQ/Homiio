import { create } from 'zustand';

// Lease State Interface
interface LeaseState {
  // Data
  leases: any[];
  currentLease: any | null;
  filters: {
    propertyId: string;
    status: string[];
    startDate: string;
    endDate: string;
  } | null;
  
  // Loading states
  isLoading: boolean;
  error: string | null;
  
  // Actions
  setLeases: (leases: any[]) => void;
  setCurrentLease: (lease: any | null) => void;
  setFilters: (filters: LeaseState['filters']) => void;
  clearFilters: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export const useLeaseStore = create<LeaseState>()(
  (set, get) => ({
    // Initial state
    leases: [],
    currentLease: null,
    filters: null,
    isLoading: false,
    error: null,
    
    // Actions
    setLeases: (leases) => set({ leases }),
    setCurrentLease: (lease) => set({ currentLease: lease }),
    setFilters: (filters) => set({ filters }),
    clearFilters: () => set({ filters: null }),
    setLoading: (loading) => set({ isLoading: loading }),
    setError: (error) => set({ error }),
    clearError: () => set({ error: null }),
  })
);

// Selector hooks for easier access
export const useLeaseSelectors = () => {
  const leases = useLeaseStore((state) => state.leases);
  const currentLease = useLeaseStore((state) => state.currentLease);
  const filters = useLeaseStore((state) => state.filters);
  const isLoading = useLeaseStore((state) => state.isLoading);
  const error = useLeaseStore((state) => state.error);

  return {
    leases,
    currentLease,
    filters,
    isLoading,
    error,
  };
}; 
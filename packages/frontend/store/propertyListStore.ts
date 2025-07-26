import { create } from 'zustand';
import { Property } from '@homiio/shared-types';

// Property List State Interface
interface PropertyListState {
  // Data
  properties: Property[];
  pagination: {
    page: number;
    total: number;
    totalPages: number;
    limit: number;
  };
  filters: {
    priceRange: [number, number];
    bedrooms: number[];
    bathrooms: number[];
    propertyType: string[];
    amenities: string[];
    location: string;
  } | null;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  
  // Loading states
  isLoading: boolean;
  error: string | null;
  
  // Actions
  setProperties: (properties: Property[]) => void;
  setPagination: (pagination: Partial<PropertyListState['pagination']>) => void;
  setFilters: (filters: PropertyListState['filters']) => void;
  clearFilters: () => void;
  setSortBy: (sortBy: string) => void;
  setSortOrder: (order: 'asc' | 'desc') => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export const usePropertyListStore = create<PropertyListState>()(
  (set, get) => ({
      // Initial state
      properties: [],
      pagination: {
        page: 1,
        total: 0,
        totalPages: 1,
        limit: 20,
      },
      filters: null,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      isLoading: false,
      error: null,
      
      // Actions
      setProperties: (properties) => set({ properties }),
      setPagination: (pagination) => set((state) => ({
        pagination: { ...state.pagination, ...pagination }
      })),
      setFilters: (filters) => set({ filters }),
      clearFilters: () => set({ filters: null }),
      setSortBy: (sortBy) => set({ sortBy }),
      setSortOrder: (order) => set({ sortOrder: order }),
      setLoading: (loading) => set({ isLoading: loading }),
      setError: (error) => set({ error }),
      clearError: () => set({ error: null }),
    }
  )
);

// Selector hooks for easier access
export const usePropertyListSelectors = () => {
  const properties = usePropertyListStore((state) => state.properties);
  const pagination = usePropertyListStore((state) => state.pagination);
  const filters = usePropertyListStore((state) => state.filters);
  const sortBy = usePropertyListStore((state) => state.sortBy);
  const sortOrder = usePropertyListStore((state) => state.sortOrder);
  const isLoading = usePropertyListStore((state) => state.isLoading);
  const error = usePropertyListStore((state) => state.error);

  return {
    properties,
    pagination,
    filters,
    sortBy,
    sortOrder,
    isLoading,
    error,
  };
}; 
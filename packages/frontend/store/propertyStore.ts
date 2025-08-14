import { create } from 'zustand';
import { Property, CreatePropertyData, PropertyFilters } from '@homiio/shared-types';

// Property State Interface
interface PropertyState {
  // Data
  properties: Property[];
  currentProperty: Property | null;
  propertyStats: Record<string, any>;
  // energy removed
  searchResults: Property[];
  filters: PropertyFilters | null;
  pagination: {
    page: number;
    total: number;
    totalPages: number;
    limit: number;
  };

  // Loading states
  loading: {
    properties: boolean;
    currentProperty: boolean;
    stats: boolean;
    // energy: boolean;
    search: boolean;
    create: boolean;
    update: boolean;
    delete: boolean;
  };

  // Error state
  error: string | null;

  // Actions
  setProperties: (properties: Property[]) => void;
  setCurrentProperty: (property: Property | null) => void;
  setPropertyStats: (propertyId: string, stats: any) => void;
  // setPropertyEnergyStats: (propertyId: string, period: string, stats: any) => void;
  setSearchResults: (results: Property[]) => void;
  setFilters: (filters: PropertyFilters | null) => void;
  setPagination: (pagination: Partial<PropertyState['pagination']>) => void;
  setLoading: (key: keyof PropertyState['loading'], loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  clearCurrentProperty: () => void;
  clearSearchResults: () => void;
  clearFilters: () => void;
}

export const usePropertyStore = create<PropertyState>()((set, get) => ({
  // Initial state
  properties: [],
  currentProperty: null,
  propertyStats: {},
  // energy removed
  searchResults: [],
  filters: null,
  pagination: {
    page: 1,
    total: 0,
    totalPages: 1,
    limit: 10,
  },
  loading: {
    properties: false,
    currentProperty: false,
    stats: false,
    // energy: false,
    search: false,
    create: false,
    update: false,
    delete: false,
  },
  error: null,

  // Actions
  setProperties: (properties) => set({ properties }),
  setCurrentProperty: (property) => set({ currentProperty: property }),
  setPropertyStats: (propertyId, stats) =>
    set((state) => ({
      propertyStats: { ...state.propertyStats, [propertyId]: stats },
    })),
  // energy removed
  setSearchResults: (results) => set({ searchResults: results }),
  setFilters: (filters) => set({ filters }),
  setPagination: (pagination) =>
    set((state) => ({
      pagination: { ...state.pagination, ...pagination },
    })),
  setLoading: (key, loading) =>
    set((state) => ({
      loading: { ...state.loading, [key]: loading },
    })),
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),
  clearCurrentProperty: () => set({ currentProperty: null }),
  clearSearchResults: () => set({ searchResults: [] }),
  clearFilters: () => set({ filters: null }),
}));

// Selector hooks for easier access
export const usePropertySelectors = () => {
  const properties = usePropertyStore((state) => state.properties);
  const currentProperty = usePropertyStore((state) => state.currentProperty);
  const propertyStats = usePropertyStore((state) => state.propertyStats);
  // const propertyEnergyStats = usePropertyStore((state) => state.propertyEnergyStats);
  const searchResults = usePropertyStore((state) => state.searchResults);
  const filters = usePropertyStore((state) => state.filters);
  const pagination = usePropertyStore((state) => state.pagination);
  const loading = usePropertyStore((state) => state.loading);
  const error = usePropertyStore((state) => state.error);

  return {
    properties,
    currentProperty,
    propertyStats,
    // propertyEnergyStats,
    searchResults,
    filters,
    pagination,
    loading,
    error,
  };
};

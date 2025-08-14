import { useCallback, useState, useEffect } from 'react';
import { useOxy } from '@oxyhq/services';
import { usePropertyStore, usePropertySelectors } from '@/store/propertyStore';
import {
  Property,
  CreatePropertyData,
  PropertyFilters,
  propertyService,
} from '@/services/propertyService';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';

// Property Hooks
export const useProperties = () => {
  const { properties, loading, error, pagination } = usePropertySelectors();
  const { setProperties, clearError, setFilters, clearFilters, setPagination } = usePropertyStore();
  const queryClient = useQueryClient();

  const loadProperties = useCallback(
    async (filters?: PropertyFilters) => {
      const result = await queryClient.fetchQuery({
        queryKey: ['properties', { filters: filters ?? null }],
        queryFn: async () => propertyService.getProperties(filters),
        staleTime: 1000 * 30,
        gcTime: 1000 * 60 * 10,
      });
      setProperties(result.properties);
      setPagination({
        page: result.page,
        total: result.total,
        totalPages: result.totalPages,
        limit: 10,
      });
      if (filters) setFilters(filters);
      return result;
    },
    [queryClient, setPagination, setProperties, setFilters],
  );

  const clearErrorAction = useCallback(() => {
    clearError();
  }, [clearError]);

  const setFiltersAction = useCallback(
    (newFilters: PropertyFilters) => {
      setFilters(newFilters);
    },
    [setFilters],
  );

  const clearFiltersAction = useCallback(() => {
    clearFilters();
  }, [clearFilters]);

  return {
    properties,
    loading: loading.properties,
    error,
    pagination,
    loadProperties,
    clearError: clearErrorAction,
    setFilters: setFiltersAction,
    clearFilters: clearFiltersAction,
  };
};

export const useProperty = (id: string) => {
  const { currentProperty } = usePropertySelectors();
  const { setCurrentProperty, clearCurrentProperty } = usePropertyStore();
  const { oxyServices, activeSessionId } = useOxy();
  const queryClient = useQueryClient();

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['property', id],
    queryFn: async () =>
      propertyService.getProperty(id, oxyServices, activeSessionId || ''),
    enabled: Boolean(id),
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
  });

  useEffect(() => {
    if (data) setCurrentProperty(data);
  }, [data, setCurrentProperty]);

  const clearCurrentPropertyAction = useCallback(() => {
    clearCurrentProperty();
    if (id) {
      queryClient.removeQueries({ queryKey: ['property', id], exact: true });
    }
  }, [clearCurrentProperty, queryClient, id]);

  return {
    property: data ?? currentProperty,
    loading: isLoading,
    error: error instanceof Error ? error.message : null,
    loadProperty: refetch,
    clearCurrentProperty: clearCurrentPropertyAction,
  };
};

export const usePropertyStats = (id: string) => {
  const { propertyStats } = usePropertySelectors();
  const { setPropertyStats } = usePropertyStore();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['propertyStats', id],
    queryFn: async () => propertyService.getPropertyStats(id),
    enabled: Boolean(id),
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
  });

  useEffect(() => {
    if (data) {
      setPropertyStats(id, data);
    }
  }, [data, id, setPropertyStats]);

  return {
    stats: data ?? propertyStats[id] ?? null,
    loading: isLoading,
    error: error instanceof Error ? error.message : null,
    loadStats: refetch,
  };
};

export const usePropertyEnergyStats = (id: string, period: 'day' | 'week' | 'month' = 'day') => {
  const { propertyEnergyStats } = usePropertySelectors();
  const { setPropertyEnergyStats } = usePropertyStore();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['propertyEnergy', id, period],
    queryFn: async () => propertyService.getPropertyEnergyStats(id, period),
    enabled: Boolean(id && period),
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
  });

  useEffect(() => {
    if (data) {
      setPropertyEnergyStats(id, period, data);
    }
  }, [data, id, period, setPropertyEnergyStats]);

  return {
    stats: data ?? propertyEnergyStats[id]?.[period] ?? null,
    loading: isLoading,
    error: error instanceof Error ? error.message : null,
    loadEnergyStats: refetch,
  };
};

export const useSearchProperties = () => {
  const { searchResults, pagination, loading, error } = usePropertySelectors();
  const { setSearchResults, setLoading, setError, clearSearchResults, setPagination } =
    usePropertyStore();
  const queryClient = useQueryClient();

  const search = useCallback(
    async (query: string, filters?: PropertyFilters) => {
      if (!query || query.length === 0) return { properties: [], total: 0 };
      try {
        setLoading('search', true);
        setError(null);
        const response = await queryClient.fetchQuery({
          queryKey: ['propertiesSearch', { query, filters: filters ?? null }],
          queryFn: async () => propertyService.searchProperties(query, filters),
          staleTime: 1000 * 30,
          gcTime: 1000 * 60 * 10,
        });
        setSearchResults(response.properties || []);
        setPagination({
          page: 1,
          total: response.total || 0,
          totalPages: Math.ceil((response.total || 0) / 10),
          limit: 10,
        });
        return response;
      } catch (e: any) {
        setError(e.message || 'Failed to search properties');
        return { properties: [], total: 0 };
      } finally {
        setLoading('search', false);
      }
    },
    [queryClient, setSearchResults, setLoading, setError, setPagination],
  );

  const clearSearchResultsAction = useCallback(() => {
    clearSearchResults();
  }, [clearSearchResults]);

  return {
    searchResults,
    pagination,
    loading: loading.search,
    error,
    search,
    clearSearchResults: clearSearchResultsAction,
  };
};

export const useCreateProperty = () => {
  const { loading, error } = usePropertySelectors();
  const { setLoading, setError } = usePropertyStore();
  const { oxyServices, activeSessionId } = useOxy();

  const create = useCallback(
    async (data: CreatePropertyData) => {
      try {
        setLoading('create', true);
        setError(null);

        // Use the propertyService instead of propertyApi
        const response = await propertyService.createProperty(
          data,
          oxyServices,
          activeSessionId || '',
        );

        toast.success('Property created successfully');
        return response;
      } catch (error: any) {
        const errorMessage = error.message || 'Failed to create property';
        setError(errorMessage);
        toast.error(errorMessage);
        throw error;
      } finally {
        setLoading('create', false);
      }
    },
    [oxyServices, activeSessionId, setLoading, setError],
  );

  return {
    create,
    loading: loading.create,
    error,
  };
};

export const useUpdateProperty = () => {
  const { loading, error } = usePropertySelectors();
  const { setLoading, setError } = usePropertyStore();
  const { oxyServices, activeSessionId } = useOxy();

  const update = useCallback(
    async (id: string, data: Partial<CreatePropertyData>) => {
      try {
        setLoading('update', true);
        setError(null);

        // Use propertyService instead of propertyApi
        const response = await propertyService.updateProperty(
          id,
          data,
          oxyServices,
          activeSessionId || '',
        );

        toast.success('Property updated successfully');
        return response;
      } catch (error: any) {
        const errorMessage = error.message || 'Failed to update property';
        setError(errorMessage);
        toast.error(errorMessage);
        throw error;
      } finally {
        setLoading('update', false);
      }
    },
    [oxyServices, activeSessionId, setLoading, setError],
  );

  return {
    update,
    loading: loading.update,
    error,
  };
};

export const useDeleteProperty = () => {
  const { loading, error } = usePropertySelectors();
  const { setLoading, setError } = usePropertyStore();

  const deletePropertyHandler = useCallback(
    async (id: string) => {
      try {
        setLoading('delete', true);
        setError(null);

        // Use propertyService instead of propertyApi
        await propertyService.deleteProperty(id);

        toast.success('Property deleted successfully');
      } catch (error: any) {
        const errorMessage = error.message || 'Failed to delete property';
        setError(errorMessage);
        toast.error(errorMessage);
        throw error;
      } finally {
        setLoading('delete', false);
      }
    },
    [setLoading, setError],
  );

  return {
    deleteProperty: deletePropertyHandler,
    loading: loading.delete,
    error,
  };
};

// Hook for user's owned properties
export const useUserProperties = () => {
  const { loading, error } = usePropertySelectors();
  const { setLoading, setError } = usePropertyStore();
  const { oxyServices, activeSessionId } = useOxy();

  const [userProperties, setUserProperties] = useState<Property[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    total: 0,
    totalPages: 1,
  });

  const fetchUserProperties = useCallback(
    async (page = 1, limit = 10) => {
      if (!oxyServices || !activeSessionId) {
        console.log('OxyServices not available - returning empty properties');
        return { properties: [], total: 0, page: 1, totalPages: 1 };
      }

      try {
        setLoading('properties', true);
        setError(null);
        console.log('Fetching user properties with OxyServices authentication');

        // Import the API function
        const { userApi } = await import('@/utils/api');
        const response = await userApi.getUserProperties(page, limit, oxyServices, activeSessionId);

        const result = {
          properties: response.data?.properties || response.data || [],
          total: response.data?.total || 0,
          page: response.data?.page || 1,
          totalPages: response.data?.totalPages || 1,
        };

        setUserProperties(result.properties);
        setPagination({
          page: result.page,
          total: result.total,
          totalPages: result.totalPages,
        });

        console.log(`Successfully fetched ${result.properties.length} user properties`);
        return result;
      } catch (error: any) {
        const errorMessage = error.message || 'Failed to fetch user properties';
        setError(errorMessage);
        console.error('Error fetching user properties:', error);
        return { properties: [], total: 0, page: 1, totalPages: 1 };
      } finally {
        setLoading('properties', false);
      }
    },
    [oxyServices, activeSessionId, setLoading, setError],
  );

  // Load properties on mount
  useEffect(() => {
    fetchUserProperties();
  }, [fetchUserProperties]);

  return {
    data: {
      properties: userProperties,
      ...pagination,
    },
    isLoading: loading.properties,
    error,
    refetch: () => fetchUserProperties(),
  };
};

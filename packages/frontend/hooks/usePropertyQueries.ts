import { useCallback, useState, useEffect } from 'react';
import { useOxy } from '@oxyhq/services';
import { usePropertyStore, usePropertySelectors } from '@/store/propertyStore';
import { Property, CreatePropertyData, PropertyFilters, propertyService } from '@/services/propertyService';
import { toast } from 'sonner';

// Property Hooks
export const useProperties = () => {
  const { properties, loading, error, pagination } = usePropertySelectors();
  const { setProperties, setLoading, setError, clearError, setFilters, clearFilters, setPagination } = usePropertyStore();

  const loadProperties = useCallback(async (filters?: PropertyFilters) => {
    try {
      setLoading('properties', true);
      setError(null);
      
      const response = await propertyService.getProperties(filters);
      
      setProperties(response.properties);
      setPagination({
        page: response.page,
        total: response.total,
        totalPages: response.totalPages,
        limit: 10,
      });
    } catch (error: any) {
      setError(error.message || 'Failed to load properties');
    } finally {
      setLoading('properties', false);
    }
  }, [setProperties, setLoading, setError, setPagination]);

  const clearErrorAction = useCallback(() => {
    clearError();
  }, [clearError]);

  const setFiltersAction = useCallback((newFilters: PropertyFilters) => {
    setFilters(newFilters);
  }, [setFilters]);

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
  const { currentProperty, loading, error } = usePropertySelectors();
  const { setCurrentProperty, setLoading, setError, clearCurrentProperty } = usePropertyStore();
  const { oxyServices, activeSessionId } = useOxy();

  const loadProperty = useCallback(async () => {
    if (id) {
      try {
        setLoading('currentProperty', true);
        setError(null);
        
        const response = await propertyService.getProperty(id, oxyServices, activeSessionId || '');
        
        setCurrentProperty(response);
      } catch (error: any) {
        setError(error.message || 'Failed to load property');
      } finally {
        setLoading('currentProperty', false);
      }
    }
  }, [id, oxyServices, activeSessionId, setCurrentProperty, setLoading, setError]);

  const clearCurrentPropertyAction = useCallback(() => {
    clearCurrentProperty();
  }, [clearCurrentProperty]);

  return {
    property: currentProperty,
    loading: loading.currentProperty,
    error,
    loadProperty,
    clearCurrentProperty: clearCurrentPropertyAction,
  };
};

export const usePropertyStats = (id: string) => {
  const { propertyStats, loading, error } = usePropertySelectors();
  const { setPropertyStats, setLoading, setError } = usePropertyStore();

  const loadStats = useCallback(async () => {
    if (id) {
      try {
        setLoading('stats', true);
        setError(null);
        
        const response = await propertyService.getPropertyStats(id);
        
        setPropertyStats(id, response);
      } catch (error: any) {
        setError(error.message || 'Failed to load property stats');
      } finally {
        setLoading('stats', false);
      }
    }
  }, [id, setPropertyStats, setLoading, setError]);

  return {
    stats: propertyStats[id] || null,
    loading: loading.stats,
    error,
    loadStats,
  };
};

export const usePropertyEnergyStats = (id: string, period: 'day' | 'week' | 'month' = 'day') => {
  const { propertyEnergyStats, loading, error } = usePropertySelectors();
  const { setPropertyEnergyStats, setLoading, setError } = usePropertyStore();

  const loadEnergyStats = useCallback(async () => {
    if (id) {
      try {
        setLoading('energy', true);
        setError(null);
        
        const response = await propertyService.getPropertyEnergyStats(id, period);
        
        setPropertyEnergyStats(id, period, response);
      } catch (error: any) {
        setError(error.message || 'Failed to load energy stats');
      } finally {
        setLoading('energy', false);
      }
    }
  }, [id, period, setPropertyEnergyStats, setLoading, setError]);

  const stats = propertyEnergyStats[id]?.[period] || null;

  return {
    stats,
    loading: loading.energy,
    error,
    loadEnergyStats,
  };
};

export const useSearchProperties = () => {
  const { searchResults, pagination, loading, error } = usePropertySelectors();
  const { setSearchResults, setLoading, setError, clearSearchResults, setPagination } = usePropertyStore();

  const search = useCallback(async (query: string, filters?: PropertyFilters) => {
    if (query && query.length > 0) {
      try {
        setLoading('search', true);
        setError(null);
        
        // Use propertyService instead of propertyApi
        const response = await propertyService.searchProperties(query, filters);
        
        setSearchResults(response.properties || []);
        setPagination({
          page: 1,
          total: response.total || 0,
          totalPages: Math.ceil((response.total || 0) / 10),
          limit: 10,
        });
      } catch (error: any) {
        setError(error.message || 'Failed to search properties');
      } finally {
        setLoading('search', false);
      }
    }
  }, [setSearchResults, setLoading, setError, setPagination]);

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

  const create = useCallback(async (data: CreatePropertyData) => {
    try {
      setLoading('create', true);
      setError(null);
      
      // Use the propertyService instead of propertyApi
      const response = await propertyService.createProperty(data, oxyServices, activeSessionId || '');
      
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
  }, [oxyServices, activeSessionId, setLoading, setError]);

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

  const update = useCallback(async (id: string, data: Partial<CreatePropertyData>) => {
    try {
      setLoading('update', true);
      setError(null);
      
      // Use propertyService instead of propertyApi
      const response = await propertyService.updateProperty(id, data, oxyServices, activeSessionId || '');
      
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
  }, [oxyServices, activeSessionId, setLoading, setError]);

  return {
    update,
    loading: loading.update,
    error,
  };
};

export const useDeleteProperty = () => {
  const { loading, error } = usePropertySelectors();
  const { setLoading, setError } = usePropertyStore();

  const deletePropertyHandler = useCallback(async (id: string) => {
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
  }, [setLoading, setError]);

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

  const fetchUserProperties = useCallback(async (page = 1, limit = 10) => {
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
  }, [oxyServices, activeSessionId, setLoading, setError]);

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
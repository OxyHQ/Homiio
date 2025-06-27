import { useCallback, useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '@/store/store';
import { useOxy } from '@oxyhq/services';
import {
  fetchProperties,
  fetchProperty,
  fetchPropertyStats,
  fetchPropertyEnergyStats,
  searchProperties,
  createProperty,
  updateProperty,
  deleteProperty as deletePropertyAction,
  clearError,
  clearCurrentProperty,
  clearSearchResults,
  setFilters,
  clearFilters,
} from '@/store/reducers/propertyReducer';
import { Property, CreatePropertyData, PropertyFilters } from '@/services/propertyService';
import { toast } from 'sonner';

// Property Selectors
export const usePropertySelectors = () => {
  const properties = useSelector((state: RootState) => state.properties.properties);
  const currentProperty = useSelector((state: RootState) => state.properties.currentProperty);
  const propertyStats = useSelector((state: RootState) => state.properties.propertyStats);
  const propertyEnergyStats = useSelector((state: RootState) => state.properties.propertyEnergyStats);
  const searchResults = useSelector((state: RootState) => state.properties.searchResults);
  const filters = useSelector((state: RootState) => state.properties.filters);
  const pagination = useSelector((state: RootState) => state.properties.pagination);
  const loading = useSelector((state: RootState) => state.properties.loading);
  const error = useSelector((state: RootState) => state.properties.error);

  return {
    properties,
    currentProperty,
    propertyStats,
    propertyEnergyStats,
    searchResults,
    filters,
    pagination,
    loading,
    error,
  };
};

// Property Hooks
export const useProperties = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { properties, loading, error, pagination } = usePropertySelectors();

  const loadProperties = useCallback((filters?: PropertyFilters) => {
    dispatch(fetchProperties(filters));
  }, [dispatch]);

  const clearErrorAction = useCallback(() => {
    dispatch(clearError());
  }, [dispatch]);

  const setFiltersAction = useCallback((newFilters: PropertyFilters) => {
    dispatch(setFilters(newFilters));
  }, [dispatch]);

  const clearFiltersAction = useCallback(() => {
    dispatch(clearFilters());
  }, [dispatch]);

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
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();
  const { currentProperty, loading, error } = usePropertySelectors();

  const loadProperty = useCallback(() => {
    if (id) {
      dispatch(fetchProperty({ id, oxyServices, activeSessionId: activeSessionId || '' }));
    }
  }, [dispatch, id, oxyServices, activeSessionId]);

  const clearCurrentPropertyAction = useCallback(() => {
    dispatch(clearCurrentProperty());
  }, [dispatch]);

  return {
    property: currentProperty,
    loading: loading.currentProperty,
    error,
    loadProperty,
    clearCurrentProperty: clearCurrentPropertyAction,
  };
};

export const usePropertyStats = (id: string) => {
  const dispatch = useDispatch<AppDispatch>();
  const { propertyStats, loading, error } = usePropertySelectors();

  const loadStats = useCallback(() => {
    if (id) {
      dispatch(fetchPropertyStats(id));
    }
  }, [dispatch, id]);

  return {
    stats: propertyStats[id] || null,
    loading: loading.stats,
    error,
    loadStats,
  };
};

export const usePropertyEnergyStats = (id: string, period: 'day' | 'week' | 'month' = 'day') => {
  const dispatch = useDispatch<AppDispatch>();
  const { propertyEnergyStats, loading, error } = usePropertySelectors();

  const loadEnergyStats = useCallback(() => {
    if (id) {
      dispatch(fetchPropertyEnergyStats({ id, period }));
    }
  }, [dispatch, id, period]);

  const stats = propertyEnergyStats[id]?.[period] || null;

  return {
    stats,
    loading: loading.energy,
    error,
    loadEnergyStats,
  };
};

export const useSearchProperties = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { searchResults, pagination, loading, error } = usePropertySelectors();

  const search = useCallback((query: string, filters?: PropertyFilters) => {
    if (query && query.length > 0) {
      dispatch(searchProperties({ query, filters }));
    }
  }, [dispatch]);

  const clearSearchResultsAction = useCallback(() => {
    dispatch(clearSearchResults());
  }, [dispatch]);

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
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();
  const { loading, error } = usePropertySelectors();

  const create = useCallback(async (data: CreatePropertyData) => {
    try {
      const result = await dispatch(createProperty({ 
        data, 
        oxyServices, 
        activeSessionId: activeSessionId || '' 
      })).unwrap();
      toast.success('Property created successfully');
      return result;
    } catch (error: any) {
      toast.error(error.message || 'Failed to create property');
      throw error;
    }
  }, [dispatch, oxyServices, activeSessionId]);

  return {
    create,
    loading: loading.create,
    error,
  };
};

export const useUpdateProperty = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { loading, error } = usePropertySelectors();

  const update = useCallback(async (id: string, data: Partial<CreatePropertyData>) => {
    try {
      const result = await dispatch(updateProperty({ id, data })).unwrap();
      toast.success('Property updated successfully');
      return result;
    } catch (error: any) {
      toast.error(error.message || 'Failed to update property');
      throw error;
    }
  }, [dispatch]);

  return {
    update,
    loading: loading.update,
    error,
  };
};

export const useDeleteProperty = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { loading, error } = usePropertySelectors();

  const deletePropertyHandler = useCallback(async (id: string) => {
    try {
      await dispatch(deletePropertyAction(id)).unwrap();
      toast.success('Property deleted successfully');
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete property');
      throw error;
    }
  }, [dispatch]);

  return {
    deleteProperty: deletePropertyHandler,
    loading: loading.delete,
    error,
  };
};

// Hook for user's owned properties
export const useUserProperties = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();
  const { loading, error } = usePropertySelectors();
  
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
    } catch (error) {
      console.error('Error fetching user properties:', error);
      return { properties: [], total: 0, page: 1, totalPages: 1 };
    }
  }, [oxyServices, activeSessionId]);

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
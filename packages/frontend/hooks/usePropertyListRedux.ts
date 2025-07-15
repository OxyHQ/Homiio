import { useCallback } from 'react';
import { usePropertyListStore } from '@/store/propertyListStore';
import { PropertyFilters, propertyService } from '@/services/propertyService';

// Eco Properties Hook
export const useEcoProperties = () => {
  const { properties, isLoading, error, filters } = usePropertyListStore();
  const { setProperties, setLoading, setError, setFilters, clearFilters } = usePropertyListStore();

  const loadEcoProperties = useCallback(async (filters?: PropertyFilters) => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await propertyService.getProperties({ ...filters, eco: true });
      
      setProperties(response.properties);
      if (filters) {
        setFilters(filters as any);
      }
    } catch (error: any) {
      setError(error.message || 'Failed to load eco properties');
    } finally {
      setLoading(false);
    }
  }, [setProperties, setLoading, setError, setFilters]);

  const clearEcoPropertiesAction = useCallback(() => {
    setProperties([]);
    clearFilters();
  }, [setProperties, clearFilters]);

  const setEcoFiltersAction = useCallback((filters: PropertyFilters) => {
    setFilters(filters);
  }, [setFilters]);

  return {
    properties,
    loading,
    error,
    filters,
    loadProperties: loadEcoProperties,
    clearProperties: clearEcoPropertiesAction,
    setFilters: setEcoFiltersAction,
  };
};

// City Properties Hook
export const useCityProperties = () => {
  const { properties, loading, error, filters } = usePropertyListSelectors();
  const { setProperties, setLoading, setError, setFilters, clearFilters } = usePropertyListStore();

  const loadCityProperties = useCallback(async (cityId: string, filters?: PropertyFilters) => {
    try {
      setLoading(true);
      setError(null);
      
      // Import the API function
      const { propertyApi } = await import('@/utils/api');
      const response = await propertyApi.getProperties({ ...filters, city: cityId });
      
      setProperties(response.data?.properties || response.data || []);
      if (filters) {
        setFilters(filters);
      }
    } catch (error: any) {
      setError(error.message || 'Failed to load city properties');
    } finally {
      setLoading(false);
    }
  }, [setProperties, setLoading, setError, setFilters]);

  const clearCityPropertiesAction = useCallback(() => {
    setProperties([]);
    clearFilters();
  }, [setProperties, clearFilters]);

  const setCityFiltersAction = useCallback((filters: PropertyFilters) => {
    setFilters(filters);
  }, [setFilters]);

  return {
    properties,
    loading,
    error,
    filters,
    currentCity: null, // Not implemented in Zustand store yet
    loadProperties: loadCityProperties,
    clearProperties: clearCityPropertiesAction,
    setFilters: setCityFiltersAction,
  };
};

// Type Properties Hook
export const useTypeProperties = () => {
  const { properties, loading, error, filters } = usePropertyListSelectors();
  const { setProperties, setLoading, setError, setFilters, clearFilters } = usePropertyListStore();

  const loadTypeProperties = useCallback(async (propertyType: string, filters?: PropertyFilters) => {
    try {
      setLoading(true);
      setError(null);
      
      // Import the API function
      const { propertyApi } = await import('@/utils/api');
      const response = await propertyApi.getProperties({ ...filters, type: propertyType });
      
      setProperties(response.data?.properties || response.data || []);
      if (filters) {
        setFilters(filters);
      }
    } catch (error: any) {
      setError(error.message || 'Failed to load type properties');
    } finally {
      setLoading(false);
    }
  }, [setProperties, setLoading, setError, setFilters]);

  const clearTypePropertiesAction = useCallback(() => {
    setProperties([]);
    clearFilters();
  }, [setProperties, clearFilters]);

  const setTypeFiltersAction = useCallback((filters: PropertyFilters) => {
    setFilters(filters);
  }, [setFilters]);

  return {
    properties,
    loading,
    error,
    filters,
    currentType: null, // Not implemented in Zustand store yet
    loadProperties: loadTypeProperties,
    clearProperties: clearTypePropertiesAction,
    setFilters: setTypeFiltersAction,
  };
};

// Utility hook to clear all property lists
export const useClearAllPropertyLists = () => {
  const { setProperties, clearFilters } = usePropertyListStore();

  const clearAll = useCallback(() => {
    setProperties([]);
    clearFilters();
  }, [setProperties, clearFilters]);

  return { clearAll };
}; 
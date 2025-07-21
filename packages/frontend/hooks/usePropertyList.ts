import { useCallback } from 'react';
import { usePropertyListStore } from '@/store/propertyListStore';
import { propertyService } from '@/services/propertyService';

export const useEcoProperties = () => {
  const { properties, isLoading, error, filters } = usePropertyListStore();
  const { setProperties, setLoading, setError, setFilters, clearFilters } = usePropertyListStore();

  const loadEcoProperties = useCallback(async (propertyFilters?: any) => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await propertyService.getProperties(propertyFilters);
      
      setProperties(response.properties);
      if (propertyFilters) {
        setFilters(propertyFilters);
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

  const setEcoFiltersAction = useCallback((propertyFilters: any) => {
    setFilters(propertyFilters);
  }, [setFilters]);

  return {
    properties,
    loading: isLoading,
    error,
    filters,
    loadProperties: loadEcoProperties,
    clearProperties: clearEcoPropertiesAction,
    setFilters: setEcoFiltersAction,
  };
};

export const useCityProperties = () => {
  const { properties, isLoading, error, filters } = usePropertyListStore();
  const { setProperties, setLoading, setError, setFilters, clearFilters } = usePropertyListStore();

  const loadCityProperties = useCallback(async (cityId: string, propertyFilters?: any) => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await propertyService.getProperties({ ...propertyFilters, city: cityId });
      
      setProperties(response.properties || []);
      if (propertyFilters) {
        setFilters(propertyFilters);
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

  const setCityFiltersAction = useCallback((propertyFilters: any) => {
    setFilters(propertyFilters);
  }, [setFilters]);

  return {
    properties,
    loading: isLoading,
    error,
    filters,
    currentCity: null,
    loadProperties: loadCityProperties,
    clearProperties: clearCityPropertiesAction,
    setFilters: setCityFiltersAction,
  };
};

export const useTypeProperties = () => {
  const { properties, isLoading, error, filters } = usePropertyListStore();
  const { setProperties, setLoading, setError, setFilters, clearFilters } = usePropertyListStore();

  const loadTypeProperties = useCallback(async (propertyType: string, propertyFilters?: any) => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await propertyService.getProperties({ ...propertyFilters, type: propertyType });
      
      setProperties(response.properties || []);
      if (propertyFilters) {
        setFilters(propertyFilters);
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

  const setTypeFiltersAction = useCallback((propertyFilters: any) => {
    setFilters(propertyFilters);
  }, [setFilters]);

  return {
    properties,
    loading: isLoading,
    error,
    filters,
    currentType: null,
    loadProperties: loadTypeProperties,
    clearProperties: clearTypePropertiesAction,
    setFilters: setTypeFiltersAction,
  };
};

export const useClearAllPropertyLists = () => {
  const { setProperties, clearFilters } = usePropertyListStore();

  const clearAll = useCallback(() => {
    setProperties([]);
    clearFilters();
  }, [setProperties, clearFilters]);

  return { clearAll };
}; 
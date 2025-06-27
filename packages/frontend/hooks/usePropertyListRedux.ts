import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '@/store/store';
import {
  fetchEcoProperties,
  fetchCityProperties,
  fetchTypeProperties,
  clearEcoProperties,
  clearCityProperties,
  clearTypeProperties,
  setEcoFilters,
  setCityFilters,
  setTypeFilters,
  clearAllPropertyLists,
} from '@/store/reducers/propertyListReducer';
import { PropertyFilters } from '@/services/propertyService';

// Selectors
export const usePropertyListSelectors = () => {
  const ecoProperties = useSelector((state: RootState) => state.propertyList.ecoProperties);
  const cityProperties = useSelector((state: RootState) => state.propertyList.cityProperties);
  const typeProperties = useSelector((state: RootState) => state.propertyList.typeProperties);

  return {
    ecoProperties,
    cityProperties,
    typeProperties,
  };
};

// Eco Properties Hook
export const useEcoProperties = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { ecoProperties } = usePropertyListSelectors();

  const loadEcoProperties = useCallback((filters?: PropertyFilters) => {
    dispatch(fetchEcoProperties(filters));
  }, [dispatch]);

  const clearEcoPropertiesAction = useCallback(() => {
    dispatch(clearEcoProperties());
  }, [dispatch]);

  const setEcoFiltersAction = useCallback((filters: PropertyFilters) => {
    dispatch(setEcoFilters(filters));
  }, [dispatch]);

  return {
    properties: ecoProperties.properties,
    loading: ecoProperties.loading,
    error: ecoProperties.error,
    filters: ecoProperties.filters,
    loadProperties: loadEcoProperties,
    clearProperties: clearEcoPropertiesAction,
    setFilters: setEcoFiltersAction,
  };
};

// City Properties Hook
export const useCityProperties = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { cityProperties } = usePropertyListSelectors();

  const loadCityProperties = useCallback((cityId: string, filters?: PropertyFilters) => {
    dispatch(fetchCityProperties({ cityId, filters }));
  }, [dispatch]);

  const clearCityPropertiesAction = useCallback(() => {
    dispatch(clearCityProperties());
  }, [dispatch]);

  const setCityFiltersAction = useCallback((filters: PropertyFilters) => {
    dispatch(setCityFilters(filters));
  }, [dispatch]);

  return {
    properties: cityProperties.properties,
    loading: cityProperties.loading,
    error: cityProperties.error,
    filters: cityProperties.filters,
    currentCity: cityProperties.currentCity,
    loadProperties: loadCityProperties,
    clearProperties: clearCityPropertiesAction,
    setFilters: setCityFiltersAction,
  };
};

// Type Properties Hook
export const useTypeProperties = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { typeProperties } = usePropertyListSelectors();

  const loadTypeProperties = useCallback((propertyType: string, filters?: PropertyFilters) => {
    dispatch(fetchTypeProperties({ propertyType, filters }));
  }, [dispatch]);

  const clearTypePropertiesAction = useCallback(() => {
    dispatch(clearTypeProperties());
  }, [dispatch]);

  const setTypeFiltersAction = useCallback((filters: PropertyFilters) => {
    dispatch(setTypeFilters(filters));
  }, [dispatch]);

  return {
    properties: typeProperties.properties,
    loading: typeProperties.loading,
    error: typeProperties.error,
    filters: typeProperties.filters,
    currentType: typeProperties.currentType,
    loadProperties: loadTypeProperties,
    clearProperties: clearTypePropertiesAction,
    setFilters: setTypeFiltersAction,
  };
};

// Utility hook to clear all property lists
export const useClearAllPropertyLists = () => {
  const dispatch = useDispatch<AppDispatch>();

  const clearAll = useCallback(() => {
    dispatch(clearAllPropertyLists());
  }, [dispatch]);

  return { clearAll };
}; 
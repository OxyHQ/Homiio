import React, { createContext, useContext, useState, useRef, useCallback } from 'react';

export interface MapState {
  center: [number, number];
  zoom: number;
  bounds?: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
  markers?: Array<{
    id: string;
    coordinates: [number, number];
    priceLabel: string;
  }>;
  highlightedMarkerId?: string | null;
  filters?: {
    minPrice?: number;
    maxPrice?: number;
    bedrooms?: number | string;
    bathrooms?: number | string;
  };
  searchQuery?: string;
}

interface MapStateContextType {
  getMapState: (screenId: string) => MapState | null;
  setMapState: (screenId: string, state: Partial<MapState>) => void;
  clearMapState: (screenId: string) => void;
  clearAllMapStates: () => void;
}

const MapStateContext = createContext<MapStateContextType | undefined>(undefined);

export const useMapState = () => {
  const context = useContext(MapStateContext);
  if (!context) {
    throw new Error('useMapState must be used within a MapStateProvider');
  }
  return context;
};

interface MapStateProviderProps {
  children: React.ReactNode;
}

export const MapStateProvider: React.FC<MapStateProviderProps> = ({ children }) => {
  const mapStates = useRef<Map<string, MapState>>(new Map());

  const getMapState = useCallback((screenId: string): MapState | null => {
    return mapStates.current.get(screenId) || null;
  }, []);

  const setMapState = useCallback((screenId: string, state: Partial<MapState>) => {
    const currentState = mapStates.current.get(screenId) || {
      center: [2.16538, 41.38723], // Default center
      zoom: 12,
    };
    
    mapStates.current.set(screenId, {
      ...currentState,
      ...state,
    });
  }, []);

  const clearMapState = useCallback((screenId: string) => {
    mapStates.current.delete(screenId);
  }, []);

  const clearAllMapStates = useCallback(() => {
    mapStates.current.clear();
  }, []);

  const value: MapStateContextType = {
    getMapState,
    setMapState,
    clearMapState,
    clearAllMapStates,
  };

  return (
    <MapStateContext.Provider value={value}>
      {children}
    </MapStateContext.Provider>
  );
};

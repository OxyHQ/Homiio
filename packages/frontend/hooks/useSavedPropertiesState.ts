/**
 * Enterprise State Management for Saved Properties
 * Implements reducer pattern with immutable updates and proper error handling
 */

import { useReducer, useMemo } from 'react';
import type {
  SavedProperty,
  SavedPropertyFolder,
  SavedPropertiesState,
  SavedPropertiesAction,
  SavedPropertiesEventBus,
  OptimisticUpdate,
} from '@/types/savedProperties';
import { LoadingState } from '@/types/savedProperties';

/**
 * Initial state for saved properties
 */
const initialState: SavedPropertiesState = {
  properties: [],
  folders: [],
  propertyIds: new Set(),
  isInitialized: false,
  isLoading: false,
  isSaving: {},
  error: null,
  loadingState: LoadingState.IDLE,
  optimisticUpdates: new Map(),
  lastUpdated: null,
  savingPropertyIds: new Set(),
  deletingFolderIds: new Set(),
  updatingFolderIds: new Set(),
  cache: {
    properties: null,
    folders: null,
    propertiesTimestamp: null,
    foldersTimestamp: null,
  },
  ui: {
    expandedFolders: new Set(),
    selectedFolderId: null,
    sortBy: 'dateAdded',
    sortOrder: 'desc',
  },
};

/**
 * Immutable state updates using reducer pattern
 */
function savedPropertiesReducer(
  state: SavedPropertiesState,
  action: SavedPropertiesAction
): SavedPropertiesState {
  switch (action.type) {
    case 'SET_LOADING': {
      return {
        ...state,
        isLoading: action.payload.isLoading,
        loadingState: action.payload.loadingState || state.loadingState,
      };
    }

    case 'SET_PROPERTIES': {
      const newOptimisticUpdates = new Map(state.optimisticUpdates);
      
      // Remove applied optimistic updates
      action.payload.properties.forEach(property => {
        newOptimisticUpdates.delete(property.propertyId);
      });

      return {
        ...state,
        properties: action.payload.properties,
        isLoading: false,
        error: null,
        loadingState: LoadingState.SUCCESS,
        optimisticUpdates: newOptimisticUpdates,
        lastUpdated: new Date(),
        cache: {
          ...state.cache,
          properties: action.payload.properties,
          propertiesTimestamp: new Date(),
        },
      };
    }

    case 'SET_FOLDERS': {
      return {
        ...state,
        folders: action.payload.folders,
        error: null,
        cache: {
          ...state.cache,
          folders: action.payload.folders,
          foldersTimestamp: new Date(),
        },
      };
    }

    case 'SET_ERROR': {
      return {
        ...state,
        error: action.payload.error,
        isLoading: false,
        loadingState: LoadingState.ERROR,
      };
    }

    case 'SET_PROPERTY_SAVING': {
      return {
        ...state,
        isSaving: {
          ...state.isSaving,
          [action.payload.propertyId]: action.payload.isSaving,
        },
      };
    }

    case 'ADD_OPTIMISTIC_SAVE': {
      // Create minimal optimistic property - will be replaced with real data
      const optimisticProperty = {
        id: `optimistic-${action.payload.propertyId}`,
        _id: `optimistic-${action.payload.propertyId}`,
        propertyId: action.payload.propertyId,
        folderId: action.payload.folderId || null,
        notes: action.payload.notes || undefined,
        dateAdded: new Date(),
        dateModified: new Date(),
        savedAt: new Date().toISOString(),
      } as unknown as SavedProperty;

      const optimisticUpdate: OptimisticUpdate = {
        id: `save-${action.payload.propertyId}`,
        type: 'save',
        propertyId: action.payload.propertyId,
        data: optimisticProperty,
        timestamp: new Date(),
      };

      const newOptimisticUpdates = new Map(state.optimisticUpdates);
      newOptimisticUpdates.set(action.payload.propertyId, optimisticUpdate);

      return {
        ...state,
        properties: [...state.properties, optimisticProperty],
        optimisticUpdates: newOptimisticUpdates,
      };
    }

    case 'ADD_OPTIMISTIC_UNSAVE': {
      const optimisticUpdate: OptimisticUpdate = {
        id: `unsave-${action.payload.propertyId}`,
        type: 'unsave',
        propertyId: action.payload.propertyId,
        data: null,
        timestamp: new Date(),
      };

      const newOptimisticUpdates = new Map(state.optimisticUpdates);
      newOptimisticUpdates.set(action.payload.propertyId, optimisticUpdate);

      return {
        ...state,
        properties: state.properties.filter(p => p.propertyId !== action.payload.propertyId),
        optimisticUpdates: newOptimisticUpdates,
      };
    }

    case 'REMOVE_OPTIMISTIC_UPDATE': {
      const newOptimisticUpdates = new Map(state.optimisticUpdates);
      newOptimisticUpdates.delete(action.payload.propertyId);

      return {
        ...state,
        optimisticUpdates: newOptimisticUpdates,
      };
    }

    case 'REVERT_OPTIMISTIC_UPDATE': {
      const update = state.optimisticUpdates.get(action.payload.propertyId);
      if (!update) return state;

      const newOptimisticUpdates = new Map(state.optimisticUpdates);
      newOptimisticUpdates.delete(action.payload.propertyId);

      let newProperties = [...state.properties];
      
      if (update.type === 'save') {
        // Remove optimistically added property
        newProperties = newProperties.filter(p => p.propertyId !== action.payload.propertyId);
      } else if (update.type === 'unsave' && update.data) {
        // Re-add optimistically removed property
        newProperties = [...newProperties, update.data as SavedProperty];
      }

      return {
        ...state,
        properties: newProperties,
        optimisticUpdates: newOptimisticUpdates,
      };
    }

    case 'UPDATE_PROPERTY': {
      return {
        ...state,
        properties: state.properties.map(property =>
          property.propertyId === action.payload.propertyId
            ? { ...property, ...action.payload.updates, dateModified: new Date() }
            : property
        ),
      };
    }

    case 'ADD_FOLDER': {
      return {
        ...state,
        folders: [...state.folders, action.payload.folder],
      };
    }

    case 'UPDATE_FOLDER': {
      return {
        ...state,
        folders: state.folders.map(folder =>
          folder.id === action.payload.folderId
            ? { ...folder, ...action.payload.updates, dateModified: new Date() }
            : folder
        ),
      };
    }

    case 'REMOVE_FOLDER': {
      return {
        ...state,
        folders: state.folders.filter(folder => folder.id !== action.payload.folderId),
        properties: state.properties.map(property =>
          property.folderId === action.payload.folderId
            ? { ...property, folderId: null }
            : property
        ),
      };
    }

    case 'TOGGLE_FOLDER_EXPANDED': {
      const newExpandedFolders = new Set(state.ui.expandedFolders);
      if (newExpandedFolders.has(action.payload.folderId)) {
        newExpandedFolders.delete(action.payload.folderId);
      } else {
        newExpandedFolders.add(action.payload.folderId);
      }

      return {
        ...state,
        ui: {
          ...state.ui,
          expandedFolders: newExpandedFolders,
        },
      };
    }

    case 'SET_SELECTED_FOLDER': {
      return {
        ...state,
        ui: {
          ...state.ui,
          selectedFolderId: action.payload.folderId,
        },
      };
    }

    case 'SET_SORT_OPTIONS': {
      return {
        ...state,
        ui: {
          ...state.ui,
          sortBy: action.payload.sortBy || state.ui.sortBy,
          sortOrder: action.payload.sortOrder || state.ui.sortOrder,
        },
      };
    }

    case 'CLEAR_CACHE': {
      return {
        ...state,
        cache: {
          properties: null,
          folders: null,
          propertiesTimestamp: null,
          foldersTimestamp: null,
        },
      };
    }

    case 'RESET': {
      return initialState;
    }

    default:
      return state;
  }
}

/**
 * Custom hook for saved properties state management
 */
export function useSavedPropertiesState() {
  const [state, dispatch] = useReducer(savedPropertiesReducer, initialState);

  // Action creators with type safety
  const actions = useMemo(() => ({
    setLoading: (isLoading: boolean, loadingState?: LoadingState) =>
      dispatch({ type: 'SET_LOADING', payload: { isLoading, loadingState } }),

    setProperties: (properties: SavedProperty[]) =>
      dispatch({ type: 'SET_PROPERTIES', payload: { properties } }),

    setFolders: (folders: SavedPropertyFolder[]) =>
      dispatch({ type: 'SET_FOLDERS', payload: { folders } }),

    setError: (error: string | null) =>
      dispatch({ type: 'SET_ERROR', payload: { error } }),

    setPropertySaving: (propertyId: string, isSaving: boolean) =>
      dispatch({ type: 'SET_PROPERTY_SAVING', payload: { propertyId, isSaving } }),

    addOptimisticSave: (propertyId: string, folderId?: string | null, notes?: string) =>
      dispatch({ type: 'ADD_OPTIMISTIC_SAVE', payload: { propertyId, folderId, notes } }),

    addOptimisticUnsave: (propertyId: string) =>
      dispatch({ type: 'ADD_OPTIMISTIC_UNSAVE', payload: { propertyId } }),

    removeOptimisticUpdate: (propertyId: string) =>
      dispatch({ type: 'REMOVE_OPTIMISTIC_UPDATE', payload: { propertyId } }),

    revertOptimisticUpdate: (propertyId: string) =>
      dispatch({ type: 'REVERT_OPTIMISTIC_UPDATE', payload: { propertyId } }),

    updateProperty: (propertyId: string, updates: Partial<SavedProperty>) =>
      dispatch({ type: 'UPDATE_PROPERTY', payload: { propertyId, updates } }),

    addFolder: (folder: SavedPropertyFolder) =>
      dispatch({ type: 'ADD_FOLDER', payload: { folder } }),

    updateFolder: (folderId: string, updates: Partial<SavedPropertyFolder>) =>
      dispatch({ type: 'UPDATE_FOLDER', payload: { folderId, updates } }),

    removeFolder: (folderId: string) =>
      dispatch({ type: 'REMOVE_FOLDER', payload: { folderId } }),

    toggleFolderExpanded: (folderId: string) =>
      dispatch({ type: 'TOGGLE_FOLDER_EXPANDED', payload: { folderId } }),

    setSelectedFolder: (folderId: string | null) =>
      dispatch({ type: 'SET_SELECTED_FOLDER', payload: { folderId } }),

    setSortOptions: (sortBy?: string, sortOrder?: 'asc' | 'desc') =>
      dispatch({ type: 'SET_SORT_OPTIONS', payload: { sortBy, sortOrder } }),

    clearCache: () =>
      dispatch({ type: 'CLEAR_CACHE', payload: {} as Record<string, never> }),

    reset: () =>
      dispatch({ type: 'RESET', payload: {} as Record<string, never> }),
  }), []);

  // Computed values with memoization
  const computedValues = useMemo(() => {
    const propertiesByFolder = state.properties.reduce((acc, property) => {
      const key = property.folderId || 'uncategorized';
      if (!acc[key]) acc[key] = [];
      acc[key].push(property);
      return acc;
    }, {} as Record<string, SavedProperty[]>);

    const sortedProperties = [...state.properties].sort((a, b) => {
      const { sortBy, sortOrder } = state.ui;
      const multiplier = sortOrder === 'asc' ? 1 : -1;

      switch (sortBy) {
        case 'dateAdded':
          return (new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime()) * multiplier;
        case 'dateModified':
          return (new Date(a.dateModified).getTime() - new Date(b.dateModified).getTime()) * multiplier;
        default:
          return 0;
      }
    });

    return {
      propertiesByFolder,
      sortedProperties,
      totalSavedProperties: state.properties.length,
      totalFolders: state.folders.length,
      hasOptimisticUpdates: state.optimisticUpdates.size > 0,
      isAnythingSaving: Object.values(state.isSaving).some(Boolean),
    };
  }, [state.properties, state.folders, state.ui, state.isSaving, state.optimisticUpdates]);

  return {
    state,
    actions,
    ...computedValues,
  };
}

/**
 * Simple event bus for cross-component communication
 */
class SavedPropertiesEventBusImpl implements SavedPropertiesEventBus {
  private listeners = new Map<string, Set<Function>>();

  on(event: string, callback: Function): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    // Return unsubscribe function
    return () => {
      const eventListeners = this.listeners.get(event);
      if (eventListeners) {
        eventListeners.delete(callback);
        if (eventListeners.size === 0) {
          this.listeners.delete(event);
        }
      }
    };
  }

  emit(event: string, data?: any): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
    }
  }

  off(event: string, callback?: Function): void {
    if (!callback) {
      this.listeners.delete(event);
      return;
    }

    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.delete(callback);
      if (eventListeners.size === 0) {
        this.listeners.delete(event);
      }
    }
  }
}

export const savedPropertiesEventBus = new SavedPropertiesEventBusImpl();

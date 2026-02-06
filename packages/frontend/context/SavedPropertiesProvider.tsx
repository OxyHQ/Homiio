/**
 * Enterprise Saved Properties Context Provider
 * Implements comprehensive state management with React Query integration
 */

import React, { createContext, useContext, useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';

import { savedPropertiesApi } from '@/services/savedPropertiesApi';
import { useSavedPropertiesState, savedPropertiesEventBus } from '@/hooks/useSavedPropertiesState';
import type {
  SavedPropertiesError,
  SavePropertyOperation,
  UnsavePropertyOperation,
  CreateFolderData,
  UpdateFolderData,
  UseSavedPropertiesReturn,
} from '@/types/savedProperties';
import { LoadingState } from '@/types/savedProperties';

/**
 * Query keys for consistent cache management
 */
export const SAVED_PROPERTIES_QUERY_KEYS = {
  all: ['saved-properties'] as const,
  properties: () => [...SAVED_PROPERTIES_QUERY_KEYS.all, 'properties'] as const,
  folders: () => [...SAVED_PROPERTIES_QUERY_KEYS.all, 'folders'] as const,
  property: (id: string) => [...SAVED_PROPERTIES_QUERY_KEYS.properties(), id] as const,
  folder: (id: string) => [...SAVED_PROPERTIES_QUERY_KEYS.folders(), id] as const,
};

/**
 * Context for saved properties state and operations
 */
const SavedPropertiesContext = createContext<UseSavedPropertiesReturn | null>(null);

/**
 * Hook to access saved properties context
 */
export function useSavedProperties(): UseSavedPropertiesReturn {
  const context = useContext(SavedPropertiesContext);
  if (!context) {
    throw new Error('useSavedProperties must be used within SavedPropertiesProvider');
  }
  return context;
}

/**
 * Props for SavedPropertiesProvider
 */
interface SavedPropertiesProviderProps {
  children: React.ReactNode;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

/**
 * Enterprise-level provider for saved properties management
 */
export function SavedPropertiesProvider({
  children,
  autoRefresh = true,
  refreshInterval = 5 * 60 * 1000, // 5 minutes
}: SavedPropertiesProviderProps) {
  const queryClient = useQueryClient();
  const { state, actions, ...computedValues } = useSavedPropertiesState();

  // Load saved properties from backend
  const propertiesQuery = useQuery({
    queryKey: SAVED_PROPERTIES_QUERY_KEYS.properties(),
    queryFn: async () => {
      const response = await savedPropertiesApi.getSavedProperties();
      return response.properties;
    },
    refetchInterval: autoRefresh ? refreshInterval : false,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });

  // Load folders from backend
  const foldersQuery = useQuery({
    queryKey: SAVED_PROPERTIES_QUERY_KEYS.folders(),
    queryFn: async () => {
      const response = await savedPropertiesApi.getFolders();
      return response.folders;
    },
    refetchInterval: autoRefresh ? refreshInterval : false,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 15 * 60 * 1000, // 15 minutes
  });

  // Save property mutation
  const savePropertyMutation = useMutation({
    mutationFn: async (operation: SavePropertyOperation) => {
      return await savedPropertiesApi.saveProperty(
        operation.propertyId,
        operation.folderId,
        operation.notes
      );
    },
    onMutate: async (operation) => {
      // Set loading state
      actions.setPropertySaving(operation.propertyId, true);
      
      // Add optimistic update
      actions.addOptimisticSave(operation.propertyId, operation.folderId, operation.notes);
      
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: SAVED_PROPERTIES_QUERY_KEYS.properties() });
      
      return { operation };
    },
    onSuccess: (data, operation) => {
      // Update the property in state
      actions.removeOptimisticUpdate(operation.propertyId);
      
      // Invalidate and refetch
      queryClient.invalidateQueries({ queryKey: SAVED_PROPERTIES_QUERY_KEYS.properties() });
      
      // Emit event
      savedPropertiesEventBus.emit('PROPERTY_SAVED', {
        propertyId: operation.propertyId,
        folderId: operation.folderId,
      });
    },
    onError: (error: SavedPropertiesError, operation) => {
      // Revert optimistic update
      actions.revertOptimisticUpdate(operation.propertyId);
      
      // Set error state
      actions.setError(error.message);
      
      // Emit error event
      savedPropertiesEventBus.emit('ERROR', { error });
    },
    onSettled: (_, __, operation) => {
      // Always clear loading state
      actions.setPropertySaving(operation.propertyId, false);
    },
  });

  // Unsave property mutation
  const unsavePropertyMutation = useMutation({
    mutationFn: async (operation: UnsavePropertyOperation) => {
      await savedPropertiesApi.unsaveProperty(operation.propertyId);
    },
    onMutate: async (operation) => {
      // Set loading state
      actions.setPropertySaving(operation.propertyId, true);
      
      // Add optimistic update
      actions.addOptimisticUnsave(operation.propertyId);
      
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: SAVED_PROPERTIES_QUERY_KEYS.properties() });
      
      return { operation };
    },
    onSuccess: (_, operation) => {
      // Remove optimistic update
      actions.removeOptimisticUpdate(operation.propertyId);
      
      // Invalidate and refetch
      queryClient.invalidateQueries({ queryKey: SAVED_PROPERTIES_QUERY_KEYS.properties() });
      
      // Emit event
      savedPropertiesEventBus.emit('PROPERTY_UNSAVED', {
        propertyId: operation.propertyId,
      });
    },
    onError: (error: SavedPropertiesError, operation) => {
      // Revert optimistic update
      actions.revertOptimisticUpdate(operation.propertyId);
      
      // Set error state
      actions.setError(error.message);
      
      // Emit error event
      savedPropertiesEventBus.emit('ERROR', { error });
    },
    onSettled: (_, __, operation) => {
      // Always clear loading state
      actions.setPropertySaving(operation.propertyId, false);
    },
  });

  // Create folder mutation
  const createFolderMutation = useMutation({
    mutationFn: async (data: CreateFolderData) => {
      return await savedPropertiesApi.createFolder(data);
    },
    onSuccess: (folder) => {
      actions.addFolder(folder);
      queryClient.invalidateQueries({ queryKey: SAVED_PROPERTIES_QUERY_KEYS.folders() });
      
      savedPropertiesEventBus.emit('FOLDER_CREATED', { folder });
    },
    onError: (error: SavedPropertiesError) => {
      actions.setError(error.message);
      savedPropertiesEventBus.emit('ERROR', { error });
    },
  });

  // Update folder mutation
  const updateFolderMutation = useMutation({
    mutationFn: async ({ folderId, data }: { folderId: string; data: UpdateFolderData }) => {
      return await savedPropertiesApi.updateFolder(folderId, data);
    },
    onSuccess: (folder, { folderId }) => {
      actions.updateFolder(folderId, folder);
      queryClient.invalidateQueries({ queryKey: SAVED_PROPERTIES_QUERY_KEYS.folders() });
      
      savedPropertiesEventBus.emit('FOLDER_UPDATED', { folder });
    },
    onError: (error: SavedPropertiesError) => {
      actions.setError(error.message);
      savedPropertiesEventBus.emit('ERROR', { error });
    },
  });

  // Delete folder mutation
  const deleteFolderMutation = useMutation({
    mutationFn: async (folderId: string) => {
      await savedPropertiesApi.deleteFolder(folderId);
      return folderId;
    },
    onSuccess: (folderId) => {
      actions.removeFolder(folderId);
      queryClient.invalidateQueries({ queryKey: SAVED_PROPERTIES_QUERY_KEYS.folders() });
      
      savedPropertiesEventBus.emit('FOLDER_DELETED', { folderId });
    },
    onError: (error: SavedPropertiesError) => {
      actions.setError(error.message);
      savedPropertiesEventBus.emit('ERROR', { error });
    },
  });

  // Update state when queries resolve
  useEffect(() => {
    if (propertiesQuery.data) {
      actions.setProperties(propertiesQuery.data);
    }
  }, [propertiesQuery.data, actions]);

  useEffect(() => {
    if (foldersQuery.data) {
      actions.setFolders(foldersQuery.data);
    }
  }, [foldersQuery.data, actions]);

  // Handle loading states
  useEffect(() => {
    const isLoading = propertiesQuery.isLoading || foldersQuery.isLoading;
    let loadingState = LoadingState.IDLE;

    if (propertiesQuery.isLoading || foldersQuery.isLoading) {
      loadingState = LoadingState.LOADING;
    } else if (propertiesQuery.isError || foldersQuery.isError) {
      loadingState = LoadingState.ERROR;
    } else if (propertiesQuery.isSuccess && foldersQuery.isSuccess) {
      loadingState = LoadingState.SUCCESS;
    }

    actions.setLoading(isLoading, loadingState);
  }, [
    propertiesQuery.isLoading,
    foldersQuery.isLoading,
    propertiesQuery.isError,
    foldersQuery.isError,
    propertiesQuery.isSuccess,
    foldersQuery.isSuccess,
    actions,
  ]);

  // Handle errors
  useEffect(() => {
    const error = propertiesQuery.error || foldersQuery.error;
    if (error) {
      actions.setError(error.message);
    }
  }, [propertiesQuery.error, foldersQuery.error, actions]);

  // Context value with memoized operations
  const contextValue: UseSavedPropertiesReturn = React.useMemo(() => ({
    // State
    properties: state.properties,
    folders: state.folders,
    propertiesCount: computedValues.totalSavedProperties,
    isInitialized: !propertiesQuery.isLoading && !foldersQuery.isLoading,
    isLoading: state.isLoading,
    error: state.error ? { name: 'SavedPropertiesError', message: state.error, code: 'UNKNOWN' } : null,

    // Property Operations
    saveProperty: async (operation: SavePropertyOperation) => {
      await savePropertyMutation.mutateAsync(operation);
    },

    unsaveProperty: async (operation: UnsavePropertyOperation) => {
      await unsavePropertyMutation.mutateAsync(operation);
    },

    isPropertySaved: (propertyId: string) => {
      return state.properties.some(p => p.propertyId === propertyId);
    },

    isPropertySaving: (propertyId: string) => {
      return state.isSaving[propertyId] || false;
    },

    // Folder Operations
    createFolder: async (data: CreateFolderData) => {
      return await createFolderMutation.mutateAsync(data);
    },

    updateFolder: async (folderId: string, data: UpdateFolderData) => {
      return await updateFolderMutation.mutateAsync({ folderId, data });
    },

    deleteFolder: async (folderId: string) => {
      await deleteFolderMutation.mutateAsync(folderId);
    },

    getFolder: (folderId: string) => {
      return state.folders.find(f => f.id === folderId);
    },

    getDefaultFolder: () => {
      return state.folders.find(f => f.isDefault);
    },

    // Utilities
    refresh: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SAVED_PROPERTIES_QUERY_KEYS.properties() }),
        queryClient.invalidateQueries({ queryKey: SAVED_PROPERTIES_QUERY_KEYS.folders() }),
      ]);
    },

    clearError: () => {
      actions.setError(null);
    },
  }), [
    state,
    computedValues,
    propertiesQuery.isLoading,
    foldersQuery.isLoading,
    savePropertyMutation,
    unsavePropertyMutation,
    createFolderMutation,
    updateFolderMutation,
    deleteFolderMutation,
    queryClient,
    actions,
  ]);

  return (
    <SavedPropertiesContext.Provider value={contextValue}>
      {children}
    </SavedPropertiesContext.Provider>
  );
}

/**
 * HOC for components that need saved properties context
 */
export function withSavedProperties<P extends object>(
  Component: React.ComponentType<P>
): React.ComponentType<P> {
  return function WithSavedPropertiesComponent(props: P) {
    return (
      <SavedPropertiesProvider>
        <Component {...props} />
      </SavedPropertiesProvider>
    );
  };
}

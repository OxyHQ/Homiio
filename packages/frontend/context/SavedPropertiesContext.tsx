import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  ReactNode,
} from 'react';
import { toast } from 'sonner';
import savedPropertyFolderService, {
  SavedPropertyFolder,
} from '@/services/savedPropertyFolderService';
import savedPropertyService, { SavedProperty } from '@/services/savedPropertyService';

import { useQueryClient } from '@tanstack/react-query';

interface SavedPropertiesContextType {
  // State
  folders: SavedPropertyFolder[];
  savedProperties: SavedProperty[];
  savedPropertyIds: Set<string>;
  savedPropertiesCount: number;
  savingPropertyIds: Set<string>;
  isLoading: boolean;
  error: string | null;

  // Actions
  loadFolders: () => Promise<void>;
  loadSavedProperties: () => Promise<void>;
  createFolder: (folderData: {
    name: string;
    description?: string;
    color?: string;
    icon?: string;
  }) => Promise<SavedPropertyFolder | undefined>;
  updateFolder: (
    folderId: string,
    folderData: { name?: string; description?: string; color?: string; icon?: string },
  ) => Promise<SavedPropertyFolder | undefined>;
  deleteFolder: (folderId: string) => Promise<void>;
  savePropertyToFolder: (propertyId: string, folderId: string | null, property?: any) => Promise<void>;
  unsaveProperty: (propertyId: string) => Promise<void>;
  getDefaultFolder: () => SavedPropertyFolder | undefined;
  getFolderById: (folderId: string) => SavedPropertyFolder | undefined;
  isPropertySaved: (propertyId: string) => boolean;
  isPropertySaving: (propertyId: string) => boolean;

  // Initialization
  isInitialized: boolean;
}

const SavedPropertiesContext = createContext<SavedPropertiesContextType | undefined>(undefined);

export const useSavedPropertiesContext = () => {
  const context = useContext(SavedPropertiesContext);
  if (!context) {
    throw new Error('useSavedPropertiesContext must be used within a SavedPropertiesProvider');
  }
  return context;
};

interface SavedPropertiesProviderProps {
  children: ReactNode;
}

export const SavedPropertiesProvider: React.FC<SavedPropertiesProviderProps> = ({ children }) => {
  // Remove unused authentication imports since we use clean api now
  const queryClient = useQueryClient();
  const [folders, setFolders] = useState<SavedPropertyFolder[]>([]);
  const [savedProperties, setSavedProperties] = useState<any[]>([]);
  const [_savingPropertyIds, setSavingPropertyIds] = useState<Set<string>>(new Set());
  const [savedPropertyIds, setSavedPropertyIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Memoize the saved properties count to prevent unnecessary recalculations
  const savedPropertiesCount = useMemo(() => savedProperties.length, [savedProperties.length]);

  const loadFolders = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await queryClient.fetchQuery({
        queryKey: ['savedFolders'],
        queryFn: async () =>
          savedPropertyFolderService.getSavedPropertyFolders(),
        staleTime: 1000 * 60,
        gcTime: 1000 * 60 * 10,
      });
      setFolders(response.folders);
    } catch (error: any) {
      setError(error.message || 'Failed to load folders');
      toast.error('Failed to load folders');
    } finally {
      setIsLoading(false);
    }
  }, [queryClient]);

  const loadSavedProperties = useCallback(async () => {
    try {
      const response = await queryClient.fetchQuery({
        queryKey: ['savedProperties'],
        queryFn: async () => savedPropertyService.getSavedProperties(),
        staleTime: 1000 * 60,
        gcTime: 1000 * 60 * 10,
      });

      if (!response || !response.properties || !Array.isArray(response.properties)) {
        console.error('Invalid response structure:', response);
        setSavedProperties([]);
        setSavedPropertyIds(new Set());
        return;
      }

      setSavedProperties(response.properties as any);

      // Sync the saved property IDs set
      const propertyIds = new Set(
        response.properties.map((p) => p._id || p.id).filter((id): id is string => Boolean(id)),
      );
      setSavedPropertyIds(propertyIds);
    } catch (error: any) {
      console.error('Failed to load saved properties:', error);
    }
  }, [queryClient]);

  const createFolder = useCallback(
    async (folderData: { name: string; description?: string; color?: string; icon?: string }) => {
      try {
        setIsLoading(true);
        setError(null);

        const newFolder = await savedPropertyFolderService.createSavedPropertyFolder(
          folderData,
        );
        setFolders((prev) => [...prev, newFolder]);
        toast.success('Folder created successfully');
        return newFolder;
      } catch (error: any) {
        setError(error.message || 'Failed to create folder');
        toast.error('Failed to create folder');
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const updateFolder = useCallback(
    async (
      folderId: string,
      folderData: { name?: string; description?: string; color?: string; icon?: string },
    ) => {
      try {
        setIsLoading(true);
        setError(null);

        const updatedFolder = await savedPropertyFolderService.updateSavedPropertyFolder(
          folderId,
          folderData,
        );
        setFolders((prev) =>
          prev.map((folder) => (folder._id === folderId ? updatedFolder : folder)),
        );
        toast.success('Folder updated successfully');
        return updatedFolder;
      } catch (error: any) {
        setError(error.message || 'Failed to update folder');
        toast.error('Failed to update folder');
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const deleteFolder = useCallback(
    async (folderId: string) => {
      try {
        setIsLoading(true);
        setError(null);

        await savedPropertyFolderService.deleteSavedPropertyFolder(
          folderId,
        );
        setFolders((prev) => prev.filter((folder) => folder._id !== folderId));
        toast.success('Folder deleted successfully');
      } catch (error: any) {
        setError(error.message || 'Failed to delete folder');
        toast.error('Failed to delete folder');
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const savePropertyToFolder = useCallback(
    async (propertyId: string, folderId: string | null, property?: any) => {
      try {
        setError(null);

        console.log('Saving property to folder:', { propertyId, folderId });

        // Optimistic update - add property ID to saved set and show saving state
        setSavedPropertyIds((prev) => {
          if (prev.has(propertyId)) {
            // Already in set, return same reference
            return prev;
          }
          return new Set([...prev, propertyId]);
        });
        setSavingPropertyIds((prev) => {
          if (prev.has(propertyId)) {
            // Already saving, return same reference
            return prev;
          }
          return new Set([...prev, propertyId]);
        });
        // Save property directly to the specified folder using the unified save API
        const saveResponse = await savedPropertyService.saveProperty(
          propertyId,
          undefined, // notes
          folderId || undefined, // folderId
        );

        // Update local state with the saved property
        if (saveResponse?.success) {
          // Add the property to the saved properties list
          const newProperty = {
            _id: propertyId,
            id: propertyId,
            savedAt: new Date().toISOString(),
            folderId: folderId,
            // Include other property data if available
            ...(property || {})
          };

          setSavedProperties((prev: any[]) => {
            // Check if property already exists
            const existingIndex = prev.findIndex(p => (p._id || p.id) === propertyId);
            if (existingIndex >= 0) {
              // Check if the property data actually changed
              const existingProperty = prev[existingIndex];
              const hasChanges = (
                existingProperty.folderId !== newProperty.folderId ||
                existingProperty.savedAt !== newProperty.savedAt ||
                JSON.stringify(existingProperty) !== JSON.stringify(newProperty)
              );

              if (!hasChanges) {
                // No changes, return the same array reference to prevent unnecessary re-renders
                return prev;
              }

              // Update existing
              const updated = [...prev];
              updated[existingIndex] = { ...existingProperty, ...newProperty };
              return updated;
            } else {
              // Add new
              return [...prev, newProperty];
            }
          });

          // Update the saved property IDs set (only if not already present)
          setSavedPropertyIds((prev) => {
            if (prev.has(propertyId)) {
              // Already in set, return same reference
              return prev;
            }
            return new Set([...prev, propertyId]);
          });
        }

        console.log('Property saved successfully');
        setSavingPropertyIds((prev) => {
          const newSet = new Set(prev);
          newSet.delete(propertyId);
          return newSet;
        });
        toast.success('Property saved successfully');
        // Refresh folders to update counts immediately
        await loadFolders();
        await queryClient.invalidateQueries({ queryKey: ['savedFolders'] });
      } catch (error: any) {
        console.error('Failed to save property:', error);

        // Revert optimistic update on error
        setSavedPropertyIds((prev) => {
          const newSet = new Set(prev);
          newSet.delete(propertyId);
          return newSet;
        });
        setSavingPropertyIds((prev) => {
          const newSet = new Set(prev);
          newSet.delete(propertyId);
          return newSet;
        });

        setError(error.message || 'Failed to save property');
        toast.error('Failed to save property');
        throw error;
      }
    },
    [loadFolders, queryClient, setSavedProperties, setSavedPropertyIds, setSavingPropertyIds, setError],
  );

  const unsaveProperty = useCallback(
    async (propertyId: string) => {
      try {
        setError(null);

        console.log('Unsaving property:', { propertyId });

        // Optimistic update - remove property ID from saved set immediately
        setSavedPropertyIds((prev) => {
          const newSet = new Set(prev);
          newSet.delete(propertyId);
          return newSet;
        });
        setSavingPropertyIds((prev) => new Set([...prev, propertyId]));

        // Unsave property using the API
        const unsaveResponse = await savedPropertyService.unsaveProperty(propertyId);

        // Update local state by removing the property
        if (unsaveResponse?.success || unsaveResponse === undefined) {
          // Remove from saved properties list - only if the property exists
          setSavedProperties((prev: any[]) => {
            const propertyExists = prev.some(p => (p._id || p.id) === propertyId);
            if (!propertyExists) {
              // Property not in list, return same array reference
              return prev;
            }
            return prev.filter(p => (p._id || p.id) !== propertyId);
          });

          // Remove from saved property IDs set
          setSavedPropertyIds((prev) => {
            if (!prev.has(propertyId)) {
              // Property ID not in set, return same set reference
              return prev;
            }
            const newSet = new Set(prev);
            newSet.delete(propertyId);
            return newSet;
          });
        }

        console.log('Property unsaved successfully');
        setSavingPropertyIds((prev) => {
          const newSet = new Set(prev);
          newSet.delete(propertyId);
          return newSet;
        });
        toast.success('Property removed from saved');
        // Decrement count in the folder that held this property
        // Try to find the property in local state to get its folderId
        const existing = savedProperties.find((p: any) => (p._id || p.id) === propertyId);
        // TODO: Implement folder count adjustment with local state
        // For now, we'll refresh folders to update counts
        if (existing?.folderId) {
          setFolders((prevFolders) =>
            prevFolders.map((folder) =>
              folder._id === existing.folderId
                ? { ...folder, propertyCount: Math.max(0, (folder.propertyCount || 0) - 1) }
                : folder
            )
          );
        }
        // Refresh folders to update counts immediately
        await loadFolders();
        await queryClient.invalidateQueries({ queryKey: ['savedFolders'] });
      } catch (error: any) {
        // If we get a 404, the property is already not saved, so treat as success
        if (error?.status === 404 || error?.message?.includes('not found')) {
          console.log('Property already unsaved (404), updating UI state');
          setSavingPropertyIds((prev) => {
            const newSet = new Set(prev);
            newSet.delete(propertyId);
            return newSet;
          });
          // Don't revert optimistic update since the property is actually unsaved
          // Don't show error toast since this is expected behavior
          return; // Success - don't throw error
        }

        console.error('Failed to unsave property:', error);

        // Revert optimistic update on error
        setSavedPropertyIds((prev) => new Set([...prev, propertyId]));
        setSavingPropertyIds((prev) => {
          const newSet = new Set(prev);
          newSet.delete(propertyId);
          return newSet;
        });

        setError(error.message || 'Failed to unsave property');
        toast.error('Failed to unsave property');
        throw error;
      }
    },
    [loadFolders, queryClient, setSavedProperties, setSavedPropertyIds, setSavingPropertyIds, setError, savedProperties],
  );

  const getDefaultFolder = useCallback(() => {
    return folders.find((folder) => folder.isDefault);
  }, [folders]);

  const getFolderById = useCallback(
    (folderId: string) => {
      return folders.find((folder) => folder._id === folderId);
    },
    [folders],
  );

  const isPropertySaved = useCallback(
    (propertyId: string) => {
      return savedPropertyIds.has(propertyId);
    },
    [savedPropertyIds],
  );

  const isPropertySaving = useCallback(
    (propertyId: string) => {
      return _savingPropertyIds.has(propertyId);
    },
    [_savingPropertyIds],
  );

  // Initialize data when auth is available
  useEffect(() => {
    if (!isInitialized) {
      const initializeData = async () => {
        try {
          // Load both folders and saved properties in parallel
          await Promise.all([loadFolders(), loadSavedProperties()]);
          setIsInitialized(true);
        } catch (error) {
          console.error('Failed to initialize saved properties data:', error);
          // Set initialized to true even on failure to prevent infinite loading
          // SaveButton components can still function with prop values
          setIsInitialized(true);
        }
      };

      initializeData();
    }
  }, [isInitialized, loadFolders, loadSavedProperties]);

  const value: SavedPropertiesContextType = {
    folders,
    savedProperties,
    savedPropertyIds,
    savedPropertiesCount,
    savingPropertyIds: _savingPropertyIds,
    isLoading,
    error,
    loadFolders,
    loadSavedProperties,
    createFolder,
    updateFolder,
    deleteFolder,
    savePropertyToFolder,
    unsaveProperty,
    getDefaultFolder,
    getFolderById,
    isPropertySaved,
    isPropertySaving,
    isInitialized,
  };

  return (
    <SavedPropertiesContext.Provider value={value}>{children}</SavedPropertiesContext.Provider>
  );
};

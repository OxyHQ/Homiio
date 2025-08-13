import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from 'react';
import { useOxy } from '@oxyhq/services';
import { toast } from 'sonner';
import savedPropertyFolderService, {
  SavedPropertyFolder,
} from '@/services/savedPropertyFolderService';
import savedPropertyService, { SavedProperty } from '@/services/savedPropertyService';
import { useSavedPropertiesStore } from '@/store/savedPropertiesStore';

interface SavedPropertiesContextType {
  // State
  folders: SavedPropertyFolder[];
  savedProperties: SavedProperty[];
  savedPropertyIds: Set<string>;
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
  savePropertyToFolder: (propertyId: string, folderId: string | null) => Promise<void>;
  unsaveProperty: (propertyId: string) => Promise<void>;
  getDefaultFolder: () => SavedPropertyFolder | undefined;
  getFolderById: (folderId: string) => SavedPropertyFolder | undefined;
  isPropertySaved: (propertyId: string) => boolean;

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
  const { oxyServices, activeSessionId } = useOxy();
  const [folders, setFolders] = useState<SavedPropertyFolder[]>([]);
  const savedProperties = useSavedPropertiesStore((s) => s.properties) as any as SavedProperty[];
  const setSavedPropertiesZ = useSavedPropertiesStore((s) => s.setProperties);
  const foldersZ = useSavedPropertiesStore((s) => s.folders);
  const setFoldersZ = useSavedPropertiesStore((s) => s.setFolders);
  const addFolderLocal = useSavedPropertiesStore((s) => s.addFolder);
  const updateFolderLocal = useSavedPropertiesStore((s) => s.updateFolderLocal);
  const removeFolderLocal = useSavedPropertiesStore((s) => s.removeFolderLocal);
  const savingPropertyIds = useSavedPropertiesStore((s) => s.savingPropertyIds);
  const addSavingPropertyId = useSavedPropertiesStore((s) => s.addSavingPropertyId);
  const removeSavingPropertyId = useSavedPropertiesStore((s) => s.removeSavingPropertyId);
  const adjustFolderCount = useSavedPropertiesStore((s) => s.adjustFolderCount);
  const [savedPropertyIds, setSavedPropertyIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  const loadFolders = useCallback(async () => {
    if (!oxyServices || !activeSessionId) return;

    try {
      setIsLoading(true);
      setError(null);

      const response = await savedPropertyFolderService.getSavedPropertyFolders(
        oxyServices,
        activeSessionId,
      );
      setFolders(response.folders);
      setFoldersZ(response.folders as any);
    } catch (error: any) {
      setError(error.message || 'Failed to load folders');
      toast.error('Failed to load folders');
    } finally {
      setIsLoading(false);
    }
  }, [oxyServices, activeSessionId]);

  const loadSavedProperties = useCallback(async () => {
    if (!oxyServices || !activeSessionId) return;

    try {
      const response = await savedPropertyService.getSavedProperties(oxyServices, activeSessionId);
      setSavedPropertiesZ(response.properties as any);

      // Sync the saved property IDs set
      const propertyIds = new Set(
        response.properties.map((p) => p._id || p.id).filter((id): id is string => Boolean(id)),
      );
      setSavedPropertyIds(propertyIds);
    } catch (error: any) {
      console.error('Failed to load saved properties:', error);
    }
  }, [oxyServices, activeSessionId]);

  const createFolder = useCallback(
    async (folderData: { name: string; description?: string; color?: string; icon?: string }) => {
      if (!oxyServices || !activeSessionId) return;

      try {
        setIsLoading(true);
        setError(null);

        const newFolder = await savedPropertyFolderService.createSavedPropertyFolder(
          folderData,
          oxyServices,
          activeSessionId,
        );
        setFolders((prev) => [...prev, newFolder]);
        addFolderLocal(newFolder as any);
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
    [oxyServices, activeSessionId],
  );

  const updateFolder = useCallback(
    async (
      folderId: string,
      folderData: { name?: string; description?: string; color?: string; icon?: string },
    ) => {
      if (!oxyServices || !activeSessionId) return;

      try {
        setIsLoading(true);
        setError(null);

        const updatedFolder = await savedPropertyFolderService.updateSavedPropertyFolder(
          folderId,
          folderData,
          oxyServices,
          activeSessionId,
        );
        setFolders((prev) =>
          prev.map((folder) => (folder._id === folderId ? updatedFolder : folder)),
        );
        updateFolderLocal(folderId, updatedFolder as any);
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
    [oxyServices, activeSessionId],
  );

  const deleteFolder = useCallback(
    async (folderId: string) => {
      if (!oxyServices || !activeSessionId) return;

      try {
        setIsLoading(true);
        setError(null);

        await savedPropertyFolderService.deleteSavedPropertyFolder(
          folderId,
          oxyServices,
          activeSessionId,
        );
        setFolders((prev) => prev.filter((folder) => folder._id !== folderId));
        removeFolderLocal(folderId);
        toast.success('Folder deleted successfully');
      } catch (error: any) {
        setError(error.message || 'Failed to delete folder');
        toast.error('Failed to delete folder');
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [oxyServices, activeSessionId],
  );

  const savePropertyToFolder = useCallback(
    async (propertyId: string, folderId: string | null) => {
      if (!oxyServices || !activeSessionId) return;

      try {
        setError(null);

        console.log('Saving property to folder:', { propertyId, folderId });

        // Optimistic update - add property ID to saved set and show saving state
        setSavedPropertyIds((prev) => new Set([...prev, propertyId]));
        addSavingPropertyId(propertyId);

        // Optimistically adjust folder counts (if target folder known)
        if (folderId) {
          adjustFolderCount(folderId, 1);
        }
        // Save property directly to the specified folder using the unified save API
        await savedPropertyService.saveProperty(
          propertyId,
          undefined,
          oxyServices,
          activeSessionId,
          folderId,
        );

        // Refresh saved properties so folder views update immediately
        await loadSavedProperties();

        console.log('Property saved successfully');
        removeSavingPropertyId(propertyId);
        toast.success('Property saved successfully');
        // Refresh folders to update counts immediately
        await loadFolders();
      } catch (error: any) {
        console.error('Failed to save property:', error);

        // Revert optimistic update on error
        setSavedPropertyIds((prev) => {
          const newSet = new Set(prev);
          newSet.delete(propertyId);
          return newSet;
        });
        removeSavingPropertyId(propertyId);
        if (folderId) {
          adjustFolderCount(folderId, -1);
        }

        setError(error.message || 'Failed to save property');
        toast.error('Failed to save property');
        throw error;
      }
    },
    [oxyServices, activeSessionId, folders],
  );

  const unsaveProperty = useCallback(
    async (propertyId: string) => {
      if (!oxyServices || !activeSessionId) return;

      try {
        setError(null);

        console.log('Unsaving property:', { propertyId });

        // Optimistic update - remove property ID from saved set immediately
        setSavedPropertyIds((prev) => {
          const newSet = new Set(prev);
          newSet.delete(propertyId);
          return newSet;
        });
        addSavingPropertyId(propertyId);

        // Unsave property using the API
        await savedPropertyService.unsaveProperty(propertyId, oxyServices, activeSessionId);

        // Refresh saved properties so folder views update immediately
        await loadSavedProperties();

        console.log('Property unsaved successfully');
        removeSavingPropertyId(propertyId);
        toast.success('Property removed from saved');
        // Decrement count in the folder that held this property
        // Try to find the property in store to get its folderId
        const existing = (useSavedPropertiesStore.getState().properties as any[]).find(
          (p: any) => (p._id || p.id) === propertyId,
        );
        if (existing?.folderId) {
          adjustFolderCount(existing.folderId, -1);
        }
        // Refresh folders to update counts immediately
        await loadFolders();
      } catch (error: any) {
        console.error('Failed to unsave property:', error);

        // Revert optimistic update on error
        setSavedPropertyIds((prev) => new Set([...prev, propertyId]));
        removeSavingPropertyId(propertyId);

        setError(error.message || 'Failed to unsave property');
        toast.error('Failed to unsave property');
        throw error;
      }
    },
    [oxyServices, activeSessionId],
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

  // Initialize data when auth is available
  useEffect(() => {
    if (oxyServices && activeSessionId && !isInitialized) {
      const initializeData = async () => {
        try {
          // Load both folders and saved properties in parallel
          await Promise.all([loadFolders(), loadSavedProperties()]);
          setIsInitialized(true);
        } catch (error) {
          console.error('Failed to initialize saved properties data:', error);
        }
      };

      initializeData();
    }
  }, [oxyServices, activeSessionId, isInitialized, loadFolders, loadSavedProperties]);

  const value: SavedPropertiesContextType = {
    folders,
    savedProperties,
    savedPropertyIds,
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
    isInitialized,
  };

  return (
    <SavedPropertiesContext.Provider value={value}>{children}</SavedPropertiesContext.Provider>
  );
};

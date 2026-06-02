import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  ReactNode,
} from 'react';
import { toast } from '@/lib/sonner';
import { useOxy } from '@oxyhq/services';
import savedPropertyFolderService, {
  SavedPropertyFolder,
  SavedPropertyFoldersResponse,
} from '@/services/savedPropertyFolderService';
import savedPropertyService, {
  SavedProperty,
  SavedPropertiesResponse,
} from '@/services/savedPropertyService';

import { useQuery, useQueryClient } from '@tanstack/react-query';

const SAVED_FOLDERS_KEY = ['savedFolders'] as const;
const SAVED_PROPERTIES_KEY = ['savedProperties'] as const;

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
  savePropertyToFolder: (propertyId: string, folderId: string | null, property?: Partial<SavedProperty>) => Promise<void>;
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

const propertyKey = (property: Pick<SavedProperty, '_id' | 'id'>): string | undefined =>
  property._id || property.id;

export const SavedPropertiesProvider: React.FC<SavedPropertiesProviderProps> = ({ children }) => {
  const queryClient = useQueryClient();
  // `isAuthenticated` is the app-wide auth signal exposed by the Oxy provider
  // (same value `ProfileContext`, `TrustScoreWidget`, etc. gate on). The two
  // saved-* reads below hit auth-only `/me/...` endpoints, so they must not run
  // logged out — `enabled: isAuthenticated` gates them declaratively (no
  // useEffect) and TanStack Query re-runs them automatically once the user
  // signs in (and clears them on sign-out via the changing query state).
  const { isAuthenticated } = useOxy();

  const [_savingPropertyIds, setSavingPropertyIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const foldersQuery = useQuery<SavedPropertyFoldersResponse>({
    queryKey: SAVED_FOLDERS_KEY,
    queryFn: () => savedPropertyFolderService.getSavedPropertyFolders(),
    enabled: isAuthenticated,
    staleTime: 1000 * 60,
    gcTime: 1000 * 60 * 10,
  });

  const savedPropertiesQuery = useQuery<SavedPropertiesResponse>({
    queryKey: SAVED_PROPERTIES_KEY,
    queryFn: () => savedPropertyService.getSavedProperties(),
    enabled: isAuthenticated,
    staleTime: 1000 * 60,
    gcTime: 1000 * 60 * 10,
  });

  const folders = useMemo<SavedPropertyFolder[]>(
    () => foldersQuery.data?.folders ?? [],
    [foldersQuery.data],
  );

  const savedProperties = useMemo<SavedProperty[]>(
    () => savedPropertiesQuery.data?.properties ?? [],
    [savedPropertiesQuery.data],
  );

  const savedPropertyIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    for (const property of savedProperties) {
      const id = propertyKey(property);
      if (id) ids.add(id);
    }
    return ids;
  }, [savedProperties]);

  const savedPropertiesCount = savedProperties.length;

  // Server data is owned by TanStack Query; these imperative loaders remain on
  // the public API for callers that want to force a refresh (e.g. pull-to-
  // refresh). They no-op while logged out so they never hit auth-only routes.
  const loadFolders = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      setError(null);
      await queryClient.refetchQueries({ queryKey: SAVED_FOLDERS_KEY });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to load folders';
      setError(message);
      toast.error('Failed to load folders');
    }
  }, [isAuthenticated, queryClient]);

  const loadSavedProperties = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      setError(null);
      await queryClient.refetchQueries({ queryKey: SAVED_PROPERTIES_KEY });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to load saved properties';
      setError(message);
    }
  }, [isAuthenticated, queryClient]);

  const createFolder = useCallback(
    async (folderData: { name: string; description?: string; color?: string; icon?: string }) => {
      try {
        setError(null);

        const newFolder = await savedPropertyFolderService.createSavedPropertyFolder(folderData);
        queryClient.setQueryData<SavedPropertyFoldersResponse>(SAVED_FOLDERS_KEY, (prev) => ({
          folders: [...(prev?.folders ?? []), newFolder],
        }));
        toast.success('Folder created successfully');
        return newFolder;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to create folder';
        setError(message);
        toast.error('Failed to create folder');
        throw error;
      }
    },
    [queryClient],
  );

  const updateFolder = useCallback(
    async (
      folderId: string,
      folderData: { name?: string; description?: string; color?: string; icon?: string },
    ) => {
      try {
        setError(null);

        const updatedFolder = await savedPropertyFolderService.updateSavedPropertyFolder(
          folderId,
          folderData,
        );
        queryClient.setQueryData<SavedPropertyFoldersResponse>(SAVED_FOLDERS_KEY, (prev) => ({
          folders: (prev?.folders ?? []).map((folder) =>
            folder._id === folderId ? updatedFolder : folder,
          ),
        }));
        toast.success('Folder updated successfully');
        return updatedFolder;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to update folder';
        setError(message);
        toast.error('Failed to update folder');
        throw error;
      }
    },
    [queryClient],
  );

  const deleteFolder = useCallback(
    async (folderId: string) => {
      try {
        setError(null);

        await savedPropertyFolderService.deleteSavedPropertyFolder(folderId);
        queryClient.setQueryData<SavedPropertyFoldersResponse>(SAVED_FOLDERS_KEY, (prev) => ({
          folders: (prev?.folders ?? []).filter((folder) => folder._id !== folderId),
        }));
        toast.success('Folder deleted successfully');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to delete folder';
        setError(message);
        toast.error('Failed to delete folder');
        throw error;
      }
    },
    [queryClient],
  );

  const savePropertyToFolder = useCallback(
    async (propertyId: string, folderId: string | null, property?: Partial<SavedProperty>) => {
      // Snapshot for rollback on failure.
      const previous = queryClient.getQueryData<SavedPropertiesResponse>(SAVED_PROPERTIES_KEY);
      try {
        setError(null);

        // Optimistic update to the query cache (drives `savedProperties` +
        // `savedPropertyIds` via the memos above).
        const optimistic: SavedProperty = {
          _id: propertyId,
          id: propertyId,
          savedAt: new Date().toISOString(),
          folderId: folderId || undefined,
          ...(property || {}),
        } as SavedProperty;

        queryClient.setQueryData<SavedPropertiesResponse>(SAVED_PROPERTIES_KEY, (prev) => {
          const list = prev?.properties ?? [];
          const existingIndex = list.findIndex((p) => propertyKey(p) === propertyId);
          const nextList =
            existingIndex >= 0
              ? list.map((p, index) =>
                  index === existingIndex ? ({ ...p, ...optimistic } as SavedProperty) : p,
                )
              : [...list, optimistic];
          return {
            properties: nextList,
            total: nextList.length,
            page: 1,
            totalPages: 1,
          };
        });

        setSavingPropertyIds((prev) => {
          if (prev.has(propertyId)) return prev;
          return new Set([...prev, propertyId]);
        });

        await savedPropertyService.saveProperty(propertyId, undefined, folderId || undefined);

        setSavingPropertyIds((prev) => {
          const newSet = new Set(prev);
          newSet.delete(propertyId);
          return newSet;
        });
        toast.success('Property saved successfully');
        // Refresh folders to update counts immediately.
        await queryClient.invalidateQueries({ queryKey: SAVED_FOLDERS_KEY });
      } catch (error: unknown) {
        // Revert optimistic update on error.
        if (previous) {
          queryClient.setQueryData<SavedPropertiesResponse>(SAVED_PROPERTIES_KEY, previous);
        }
        setSavingPropertyIds((prev) => {
          const newSet = new Set(prev);
          newSet.delete(propertyId);
          return newSet;
        });

        const message = error instanceof Error ? error.message : 'Failed to save property';
        setError(message);
        toast.error('Failed to save property');
        throw error;
      }
    },
    [queryClient],
  );

  const unsaveProperty = useCallback(
    async (propertyId: string) => {
      const previous = queryClient.getQueryData<SavedPropertiesResponse>(SAVED_PROPERTIES_KEY);
      const removed = previous?.properties.find((p) => propertyKey(p) === propertyId);
      try {
        setError(null);

        // Optimistic removal from the query cache.
        queryClient.setQueryData<SavedPropertiesResponse>(SAVED_PROPERTIES_KEY, (prev) => {
          const list = prev?.properties ?? [];
          const nextList = list.filter((p) => propertyKey(p) !== propertyId);
          return {
            properties: nextList,
            total: nextList.length,
            page: 1,
            totalPages: 1,
          };
        });
        setSavingPropertyIds((prev) => new Set([...prev, propertyId]));

        await savedPropertyService.unsaveProperty(propertyId);

        setSavingPropertyIds((prev) => {
          const newSet = new Set(prev);
          newSet.delete(propertyId);
          return newSet;
        });
        toast.success('Property removed from saved');

        // Update folder counts locally.
        if (removed?.folderId) {
          queryClient.setQueryData<SavedPropertyFoldersResponse>(SAVED_FOLDERS_KEY, (prev) => ({
            folders: (prev?.folders ?? []).map((folder) =>
              folder._id === removed.folderId
                ? { ...folder, propertyCount: Math.max(0, (folder.propertyCount || 0) - 1) }
                : folder,
            ),
          }));
        }

        await queryClient.invalidateQueries({ queryKey: SAVED_FOLDERS_KEY });
      } catch (error: unknown) {
        const status = (error as { status?: number })?.status;
        const message = error instanceof Error ? error.message : 'Failed to unsave property';
        if (status === 404 || message.includes('not found')) {
          setSavingPropertyIds((prev) => {
            const newSet = new Set(prev);
            newSet.delete(propertyId);
            return newSet;
          });
          return;
        }

        // Revert optimistic update on error.
        if (previous) {
          queryClient.setQueryData<SavedPropertiesResponse>(SAVED_PROPERTIES_KEY, previous);
        }
        setSavingPropertyIds((prev) => {
          const newSet = new Set(prev);
          newSet.delete(propertyId);
          return newSet;
        });

        setError(message);
        toast.error('Failed to unsave property');
        throw error;
      }
    },
    [queryClient],
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

  // Logged out: nothing is requested, so the saved state is empty but settled.
  // Logged in: "initialized" once both reads have resolved at least once.
  const isInitialized = isAuthenticated
    ? !foldersQuery.isPending && !savedPropertiesQuery.isPending
    : true;

  const isLoading = isAuthenticated && (foldersQuery.isFetching || savedPropertiesQuery.isFetching);

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

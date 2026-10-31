import type React from 'react';
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { toast } from '@oxy.so/bloom/toast';
import i18next from 'i18next';
import {
  useAccountOwner,
  accountOwnerKey,
  assertAccountOwner,
  sameAccountProjection,
  type AccountOwner,
} from '@/hooks/useAccountOwner';
import { savedKeys, useSavedFoldersQuery, useSavedPropertiesQuery } from '@/hooks/useSavedQueries';
import { SavedPropertyChangeSupersededError } from '@/hooks/savedPropertyErrors';
import savedPropertyFolderService, {
  type SavedPropertyFolder,
  type SavedPropertyFoldersResponse,
} from '@/services/savedPropertyFolderService';
import savedPropertyService, {
  type SavedProperty,
  type SavedPropertiesResponse,
} from '@/services/savedPropertyService';

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
  savePropertyToFolder: (
    propertyId: string,
    folderId: string | null,
    property?: Partial<SavedProperty>,
  ) => Promise<void>;
  unsaveProperty: (propertyId: string) => Promise<void>;
  updateNotes: (propertyId: string, notes: string) => Promise<void>;
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

const propertyKey = (property: Pick<SavedProperty, 'id' | 'id'>): string | undefined => property.id;

export const SavedPropertiesProvider: React.FC<SavedPropertiesProviderProps> = ({ children }) => {
  const queryClient = useQueryClient();
  const owner = useAccountOwner();
  const committedOwner = useRef<AccountOwner | null>(null);
  const pendingPropertyChanges = useRef(new Map<string, number>());
  const latestPropertyChange = useRef(new Map<string, number>());
  const nextPropertyChange = useRef(0);
  useLayoutEffect(() => {
    committedOwner.current = owner;
    return () => {
      if (committedOwner.current === owner) committedOwner.current = null;
    };
  }, [owner]);
  const currentOwner = useCallback((expected: AccountOwner | null): AccountOwner => {
    assertAccountOwner(expected);
    if (!sameAccountProjection(expected, committedOwner.current))
      throw new Error('The active account changed');
    assertAccountOwner(committedOwner.current);
    return committedOwner.current;
  }, []);
  const isAuthenticated = Boolean(owner);
  const foldersKey = useMemo(() => savedKeys.folders(owner), [owner]);
  const propertiesKey = useMemo(() => savedKeys.properties(owner), [owner]);
  const ownerKey = JSON.stringify(propertiesKey);
  const [savingState, setSavingState] = useState<{ key: string; ids: Set<string> }>({
    key: ownerKey,
    ids: new Set(),
  });
  const [errorState, setErrorState] = useState<{ key: string; message: string | null }>({
    key: ownerKey,
    message: null,
  });
  const _savingPropertyIds = savingState.key === ownerKey ? savingState.ids : new Set<string>();
  const error = errorState.key === ownerKey ? errorState.message : null;
  const setError = useCallback(
    (message: string | null) => setErrorState({ key: ownerKey, message }),
    [ownerKey],
  );
  const setSavingPropertyIds = useCallback(
    (updater: (previous: Set<string>) => Set<string>) =>
      setSavingState((previous) => ({
        key: ownerKey,
        ids: updater(previous.key === ownerKey ? previous.ids : new Set()),
      })),
    [ownerKey],
  );
  const isCurrentOwner = useCallback(
    (expected: AccountOwner | null) => {
      try {
        currentOwner(expected);
        return true;
      } catch {
        return false;
      }
    },
    [currentOwner],
  );
  const finishPropertyChange = useCallback(
    (captured: AccountOwner, ownerKey: string, changeKey: string, changeId: number) => {
      if (latestPropertyChange.current.get(changeKey) === changeId) {
        latestPropertyChange.current.delete(changeKey);
      }
      const remaining = (pendingPropertyChanges.current.get(ownerKey) ?? 1) - 1;
      if (remaining > 0) pendingPropertyChanges.current.set(ownerKey, remaining);
      else {
        pendingPropertyChanges.current.delete(ownerKey);
        if (isCurrentOwner(captured)) {
          const key = savedKeys.properties(currentOwner(captured));
          void queryClient
            .cancelQueries({ queryKey: key, exact: true }, { revert: false })
            .then(() => {
              if (!pendingPropertyChanges.current.has(ownerKey) && isCurrentOwner(captured)) {
                void queryClient.invalidateQueries({ queryKey: key, exact: true });
              }
            });
        }
      }
    },
    [currentOwner, isCurrentOwner, queryClient],
  );
  const foldersQuery = useSavedFoldersQuery();
  const savedPropertiesQuery = useSavedPropertiesQuery();

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
      currentOwner(owner);
      setError(null);
      await queryClient.refetchQueries({ queryKey: foldersKey, exact: true });
    } catch (error: unknown) {
      if (!isCurrentOwner(owner)) return;
      const message = error instanceof Error ? error.message : 'Failed to load folders';
      setError(message);
      toast.error(i18next.t('saved.toast.loadFoldersFailed'));
    }
  }, [isAuthenticated, queryClient, currentOwner, owner, setError, foldersKey, isCurrentOwner]);

  const loadSavedProperties = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      currentOwner(owner);
      setError(null);
      await queryClient.refetchQueries({ queryKey: propertiesKey, exact: true });
    } catch (error: unknown) {
      if (!isCurrentOwner(owner)) return;
      const message = error instanceof Error ? error.message : 'Failed to load saved properties';
      setError(message);
    }
  }, [isAuthenticated, queryClient, currentOwner, owner, setError, propertiesKey, isCurrentOwner]);

  const createFolder = useCallback(
    async (folderData: { name: string; description?: string; color?: string; icon?: string }) => {
      try {
        const captured = currentOwner(owner);
        setError(null);
        const newFolder = await savedPropertyFolderService.createSavedPropertyFolder(
          captured,
          folderData,
        );
        const current = currentOwner(captured);
        queryClient.setQueryData<SavedPropertyFoldersResponse>(
          savedKeys.folders(current),
          (prev) => ({
            folders: [...(prev?.folders ?? []), newFolder],
          }),
        );
        if (captured.sessionId !== current.sessionId) {
          void queryClient.invalidateQueries({ queryKey: savedKeys.folders(current), exact: true });
        }
        toast.success(i18next.t('saved.toast.folderCreated'));
        return newFolder;
      } catch (error: unknown) {
        if (!isCurrentOwner(owner)) throw error;
        const message = error instanceof Error ? error.message : 'Failed to create folder';
        setError(message);
        toast.error(i18next.t('saved.toast.folderCreateFailed'));
        throw error;
      }
    },
    [queryClient, currentOwner, owner, setError, isCurrentOwner],
  );

  const updateFolder = useCallback(
    async (
      folderId: string,
      folderData: { name?: string; description?: string; color?: string; icon?: string },
    ) => {
      try {
        const captured = currentOwner(owner);
        setError(null);

        const updatedFolder = await savedPropertyFolderService.updateSavedPropertyFolder(
          captured,
          folderId,
          folderData,
        );
        const current = currentOwner(captured);
        queryClient.setQueryData<SavedPropertyFoldersResponse>(
          savedKeys.folders(current),
          (prev) => ({
            folders: (prev?.folders ?? []).map((folder) =>
              folder.id === folderId ? updatedFolder : folder,
            ),
          }),
        );
        if (captured.sessionId !== current.sessionId) {
          void queryClient.invalidateQueries({ queryKey: savedKeys.folders(current), exact: true });
        }
        toast.success(i18next.t('saved.toast.folderUpdated'));
        return updatedFolder;
      } catch (error: unknown) {
        if (!isCurrentOwner(owner)) throw error;
        const message = error instanceof Error ? error.message : 'Failed to update folder';
        setError(message);
        toast.error(i18next.t('saved.toast.folderUpdateFailed'));
        throw error;
      }
    },
    [queryClient, currentOwner, owner, setError, isCurrentOwner],
  );

  const deleteFolder = useCallback(
    async (folderId: string) => {
      try {
        const captured = currentOwner(owner);
        setError(null);

        await savedPropertyFolderService.deleteSavedPropertyFolder(captured, folderId);
        const current = currentOwner(captured);
        queryClient.setQueryData<SavedPropertyFoldersResponse>(
          savedKeys.folders(current),
          (prev) => ({
            folders: (prev?.folders ?? []).filter((folder) => folder.id !== folderId),
          }),
        );
        if (captured.sessionId !== current.sessionId) {
          void queryClient.invalidateQueries({ queryKey: savedKeys.folders(current), exact: true });
        }
        toast.success(i18next.t('saved.toast.folderDeleted'));
      } catch (error: unknown) {
        if (!isCurrentOwner(owner)) throw error;
        const message = error instanceof Error ? error.message : 'Failed to delete folder';
        setError(message);
        toast.error(i18next.t('saved.toast.folderDeleteFailed'));
        throw error;
      }
    },
    [queryClient, currentOwner, owner, setError, isCurrentOwner],
  );

  const savePropertyToFolder = useCallback(
    async (propertyId: string, folderId: string | null, property?: Partial<SavedProperty>) => {
      const captured = currentOwner(owner);
      const identity = accountOwnerKey(captured);
      const groupKey = JSON.stringify([identity[0], identity[2], identity[3], identity[4]]);
      const changeKey = JSON.stringify([groupKey, propertyId]);
      const changeId = ++nextPropertyChange.current;
      latestPropertyChange.current.set(changeKey, changeId);
      pendingPropertyChanges.current.set(
        groupKey,
        (pendingPropertyChanges.current.get(groupKey) ?? 0) + 1,
      );
      try {
        await queryClient.cancelQueries(
          { queryKey: propertiesKey, exact: true },
          { revert: false },
        );
        currentOwner(captured);
        if (latestPropertyChange.current.get(changeKey) !== changeId) {
          throw new SavedPropertyChangeSupersededError();
        }
        // Snapshot for rollback on failure.
        const previous = queryClient.getQueryData<SavedPropertiesResponse>(propertiesKey);
        const previousProperty = previous?.properties.find((p) => propertyKey(p) === propertyId);

        try {
          setError(null);

          // Optimistic update to the query cache (drives `savedProperties` +
          // `savedPropertyIds` via the memos above).
          const optimistic: SavedProperty = {
            id: propertyId,
            savedAt: new Date().toISOString(),
            folderId: folderId || undefined,
            ...(property || {}),
          } as SavedProperty;

          queryClient.setQueryData<SavedPropertiesResponse>(propertiesKey, (prev) => {
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

          await savedPropertyService.saveProperty(
            captured,
            propertyId,
            undefined,
            folderId || undefined,
          );
          const current = currentOwner(captured);
          if (latestPropertyChange.current.get(changeKey) !== changeId) {
            throw new SavedPropertyChangeSupersededError();
          }

          setSavingPropertyIds((prev) => {
            const newSet = new Set(prev);
            newSet.delete(propertyId);
            return newSet;
          });
          toast.success(i18next.t('saved.toast.propertySaved'));
          // Refresh folders to update counts immediately.
          await queryClient.invalidateQueries({
            queryKey: savedKeys.folders(current),
            exact: true,
          });
        } catch (error: unknown) {
          if (!isCurrentOwner(captured)) throw error;
          if (latestPropertyChange.current.get(changeKey) !== changeId) {
            throw new SavedPropertyChangeSupersededError();
          }
          // Revert optimistic update on error.
          if (latestPropertyChange.current.get(changeKey) === changeId) {
            queryClient.setQueryData<SavedPropertiesResponse>(propertiesKey, (current) => {
              if (!current) return current;
              const withoutProperty = current.properties.filter(
                (p) => propertyKey(p) !== propertyId,
              );
              const properties = previousProperty
                ? [...withoutProperty, previousProperty]
                : withoutProperty;
              return { ...current, properties, total: properties.length };
            });
          }
          setSavingPropertyIds((prev) => {
            const newSet = new Set(prev);
            newSet.delete(propertyId);
            return newSet;
          });

          const message = error instanceof Error ? error.message : 'Failed to save property';
          setError(message);
          toast.error(i18next.t('saved.toast.propertySaveFailed'));
          throw error;
        }
      } finally {
        finishPropertyChange(captured, groupKey, changeKey, changeId);
      }
    },
    [
      queryClient,
      currentOwner,
      owner,
      propertiesKey,
      ownerKey,
      setError,
      setSavingPropertyIds,
      isCurrentOwner,
      finishPropertyChange,
    ],
  );

  const unsaveProperty = useCallback(
    async (propertyId: string) => {
      const captured = currentOwner(owner);
      const identity = accountOwnerKey(captured);
      const groupKey = JSON.stringify([identity[0], identity[2], identity[3], identity[4]]);
      const changeKey = JSON.stringify([groupKey, propertyId]);
      const changeId = ++nextPropertyChange.current;
      latestPropertyChange.current.set(changeKey, changeId);
      pendingPropertyChanges.current.set(
        groupKey,
        (pendingPropertyChanges.current.get(groupKey) ?? 0) + 1,
      );
      try {
        await queryClient.cancelQueries(
          { queryKey: propertiesKey, exact: true },
          { revert: false },
        );
        currentOwner(captured);
        if (latestPropertyChange.current.get(changeKey) !== changeId) {
          throw new SavedPropertyChangeSupersededError();
        }
        const previous = queryClient.getQueryData<SavedPropertiesResponse>(propertiesKey);
        const removed = previous?.properties.find((p) => propertyKey(p) === propertyId);

        try {
          setError(null);

          // Optimistic removal from the query cache.
          queryClient.setQueryData<SavedPropertiesResponse>(propertiesKey, (prev) => {
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

          await savedPropertyService.unsaveProperty(captured, propertyId);
          const current = currentOwner(captured);
          if (latestPropertyChange.current.get(changeKey) !== changeId) {
            throw new SavedPropertyChangeSupersededError();
          }

          setSavingPropertyIds((prev) => {
            const newSet = new Set(prev);
            newSet.delete(propertyId);
            return newSet;
          });
          toast.success(i18next.t('saved.toast.propertyRemoved'));

          // Update folder counts locally.
          if (removed?.folderId) {
            queryClient.setQueryData<SavedPropertyFoldersResponse>(
              savedKeys.folders(current),
              (prev) => ({
                folders: (prev?.folders ?? []).map((folder) =>
                  folder.id === removed.folderId
                    ? { ...folder, propertyCount: Math.max(0, (folder.propertyCount || 0) - 1) }
                    : folder,
                ),
              }),
            );
          }

          await queryClient.invalidateQueries({
            queryKey: savedKeys.folders(current),
            exact: true,
          });
        } catch (error: unknown) {
          if (!isCurrentOwner(captured)) throw error;
          if (latestPropertyChange.current.get(changeKey) !== changeId) {
            throw new SavedPropertyChangeSupersededError();
          }
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
          if (latestPropertyChange.current.get(changeKey) === changeId) {
            queryClient.setQueryData<SavedPropertiesResponse>(propertiesKey, (current) => {
              if (!current) return current;
              const withoutProperty = current.properties.filter(
                (p) => propertyKey(p) !== propertyId,
              );
              const properties = removed ? [...withoutProperty, removed] : withoutProperty;
              return { ...current, properties, total: properties.length };
            });
          }
          setSavingPropertyIds((prev) => {
            const newSet = new Set(prev);
            newSet.delete(propertyId);
            return newSet;
          });

          setError(message);
          toast.error(i18next.t('saved.toast.propertyUnsaveFailed'));
          throw error;
        }
      } finally {
        finishPropertyChange(captured, groupKey, changeKey, changeId);
      }
    },
    [
      queryClient,
      currentOwner,
      owner,
      propertiesKey,
      ownerKey,
      setError,
      setSavingPropertyIds,
      isCurrentOwner,
      finishPropertyChange,
    ],
  );

  const updateNotes = useCallback(
    async (propertyId: string, notes: string) => {
      const captured = currentOwner(owner);
      const identity = accountOwnerKey(captured);
      const groupKey = JSON.stringify([identity[0], identity[2], identity[3], identity[4]]);
      const changeKey = JSON.stringify([groupKey, propertyId]);
      const changeId = ++nextPropertyChange.current;
      latestPropertyChange.current.set(changeKey, changeId);
      pendingPropertyChanges.current.set(
        groupKey,
        (pendingPropertyChanges.current.get(groupKey) ?? 0) + 1,
      );
      try {
        await queryClient.cancelQueries(
          { queryKey: propertiesKey, exact: true },
          { revert: false },
        );
        currentOwner(captured);
        if (latestPropertyChange.current.get(changeKey) !== changeId) {
          throw new SavedPropertyChangeSupersededError();
        }
        const previous = queryClient.getQueryData<SavedPropertiesResponse>(propertiesKey);
        const previousProperty = previous?.properties.find(
          (property) => property.id === propertyId,
        );

        if (previous) {
          queryClient.setQueryData<SavedPropertiesResponse>(propertiesKey, {
            ...previous,
            properties: previous.properties.map((property) =>
              property.id === propertyId ? { ...property, notes } : property,
            ),
          });
        }
        try {
          await savedPropertyService.updateNotes(captured, propertyId, notes);
          currentOwner(captured);
          if (latestPropertyChange.current.get(changeKey) !== changeId) {
            throw new SavedPropertyChangeSupersededError();
          }
        } catch (error) {
          if (
            isCurrentOwner(captured) &&
            latestPropertyChange.current.get(changeKey) !== changeId
          ) {
            throw new SavedPropertyChangeSupersededError();
          }
          if (
            isCurrentOwner(captured) &&
            previousProperty &&
            latestPropertyChange.current.get(changeKey) === changeId
          ) {
            queryClient.setQueryData<SavedPropertiesResponse>(propertiesKey, (current) => {
              if (!current) return current;
              return {
                ...current,
                properties: current.properties.map((property) =>
                  property.id === propertyId
                    ? { ...property, notes: previousProperty.notes }
                    : property,
                ),
              };
            });
          }
          throw error;
        }
      } finally {
        finishPropertyChange(captured, groupKey, changeKey, changeId);
      }
    },
    [
      currentOwner,
      owner,
      queryClient,
      propertiesKey,
      ownerKey,
      isCurrentOwner,
      finishPropertyChange,
    ],
  );

  const getDefaultFolder = useCallback(() => {
    return folders.find((folder) => folder.isDefault);
  }, [folders]);

  const getFolderById = useCallback(
    (folderId: string) => {
      return folders.find((folder) => folder.id === folderId);
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
    updateNotes,
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

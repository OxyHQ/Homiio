/**
 * Enterprise Hooks for Saved Properties
 * Provides convenient hooks for specific use cases
 */

import { useCallback, useMemo } from 'react';
import { useSavedProperties } from '@/context/SavedPropertiesProvider';
import type { SavedProperty, SavePropertyOperation } from '@/types/savedProperties';

/**
 * Hook for quick property save/unsave operations
 */
export function usePropertySaver() {
  const { saveProperty, unsaveProperty, isPropertySaved, isPropertySaving } = useSavedProperties();

  const toggleProperty = useCallback(async (
    propertyId: string,
    options?: {
      folderId?: string | null;
      notes?: string;
      onSuccess?: (saved: boolean) => void;
      onError?: (error: Error) => void;
    }
  ) => {
    try {
      const isSaved = isPropertySaved(propertyId);
      
      if (isSaved) {
        await unsaveProperty({ propertyId });
        options?.onSuccess?.(false);
      } else {
        const operation: SavePropertyOperation = {
          propertyId,
          folderId: options?.folderId,
          notes: options?.notes,
        };
        await saveProperty(operation);
        options?.onSuccess?.(true);
      }
    } catch (error) {
      const errorInstance = error instanceof Error 
        ? error 
        : new Error('Failed to toggle property save state');
      options?.onError?.(errorInstance);
    }
  }, [saveProperty, unsaveProperty, isPropertySaved]);

  return {
    toggleProperty,
    isPropertySaved,
    isPropertySaving,
  };
}

/**
 * Hook for folder-specific operations
 */
export function useFolderOperations() {
  const { 
    properties,
    folders, 
    createFolder, 
    updateFolder, 
    deleteFolder, 
    getFolder, 
    getDefaultFolder 
  } = useSavedProperties();

  const getFolderWithProperties = useCallback((folderId: string) => {
    const folder = getFolder(folderId);
    const folderProperties = properties.filter((p: SavedProperty) => p.folderId === folderId);
    
    return {
      folder,
      properties: folderProperties,
      count: folderProperties.length,
    };
  }, [getFolder, properties]);

  const createFolderWithDefaults = useCallback(async (
    name: string,
    options?: {
      description?: string;
      color?: string;
      icon?: string;
    }
  ) => {
    return await createFolder({
      name,
      description: options?.description,
      color: options?.color || '#3B82F6', // Default blue
      icon: options?.icon || 'folder',
    });
  }, [createFolder]);

  return {
    folders,
    createFolder: createFolderWithDefaults,
    updateFolder,
    deleteFolder,
    getFolder,
    getDefaultFolder,
    getFolderWithProperties,
  };
}

/**
 * Hook for property filtering and sorting
 */
export function usePropertyFilters() {
  const { properties } = useSavedProperties();

  const getPropertiesByFolder = useCallback((folderId?: string | null) => {
    if (folderId === undefined) {
      return properties;
    }
    
    if (folderId === null) {
      // Uncategorized properties
      return properties.filter(p => !p.folderId);
    }
    
    return properties.filter(p => p.folderId === folderId);
  }, [properties]);

  const searchProperties = useCallback((query: string) => {
    if (!query.trim()) return properties;
    
    const lowercaseQuery = query.toLowerCase();
    return properties.filter(property => {
      // Search in notes
      if (property.notes?.toLowerCase().includes(lowercaseQuery)) {
        return true;
      }
      
      // Search in property data if available
      if (property.propertyData) {
        const dataString = JSON.stringify(property.propertyData).toLowerCase();
        return dataString.includes(lowercaseQuery);
      }
      
      return false;
    });
  }, [properties]);

  const sortProperties = useCallback((
    propertiesToSort: SavedProperty[],
    sortBy: 'dateAdded' | 'dateModified' | 'notes' = 'dateAdded',
    sortOrder: 'asc' | 'desc' = 'desc'
  ) => {
    return [...propertiesToSort].sort((a, b) => {
      const multiplier = sortOrder === 'asc' ? 1 : -1;
      
      switch (sortBy) {
        case 'dateAdded':
          return (new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime()) * multiplier;
        case 'dateModified':
          return (new Date(a.dateModified).getTime() - new Date(b.dateModified).getTime()) * multiplier;
        case 'notes':
          const aNote = a.notes || '';
          const bNote = b.notes || '';
          return aNote.localeCompare(bNote) * multiplier;
        default:
          return 0;
      }
    });
  }, []);

  const getPropertiesStats = useMemo(() => {
    const totalProperties = properties.length;
    const propertiesWithNotes = properties.filter(p => p.notes && p.notes.trim()).length;
    const propertiesByFolder = properties.reduce((acc, property) => {
      const key = property.folderId || 'uncategorized';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      total: totalProperties,
      withNotes: propertiesWithNotes,
      withoutNotes: totalProperties - propertiesWithNotes,
      byFolder: propertiesByFolder,
    };
  }, [properties]);

  return {
    getPropertiesByFolder,
    searchProperties,
    sortProperties,
    stats: getPropertiesStats,
  };
}

/**
 * Hook for bulk operations on saved properties
 */
export function useBulkOperations() {
  const { properties, saveProperty, unsaveProperty } = useSavedProperties();

  const moveToFolder = useCallback(async (
    propertyIds: string[],
    targetFolderId: string | null,
    options?: {
      onProgress?: (completed: number, total: number) => void;
      onError?: (error: Error, propertyId: string) => void;
    }
  ) => {
    const errors: { propertyId: string; error: Error }[] = [];
    
    for (let i = 0; i < propertyIds.length; i++) {
      const propertyId = propertyIds[i];
      const property = properties.find(p => p.propertyId === propertyId);
      
      if (!property) {
        const error = new Error(`Property ${propertyId} not found`);
        errors.push({ propertyId, error });
        options?.onError?.(error, propertyId);
        continue;
      }

      try {
        // Update the property with new folder
        await saveProperty({
          propertyId,
          folderId: targetFolderId,
          notes: property.notes,
        });
        
        options?.onProgress?.(i + 1, propertyIds.length);
      } catch (error) {
        const errorInstance = error instanceof Error 
          ? error 
          : new Error(`Failed to move property ${propertyId}`);
        errors.push({ propertyId, error: errorInstance });
        options?.onError?.(errorInstance, propertyId);
      }
    }

    return {
      successful: propertyIds.length - errors.length,
      failed: errors.length,
      errors,
    };
  }, [properties, saveProperty]);

  const bulkUnsave = useCallback(async (
    propertyIds: string[],
    options?: {
      onProgress?: (completed: number, total: number) => void;
      onError?: (error: Error, propertyId: string) => void;
    }
  ) => {
    const errors: { propertyId: string; error: Error }[] = [];
    
    for (let i = 0; i < propertyIds.length; i++) {
      const propertyId = propertyIds[i];
      
      try {
        await unsaveProperty({ propertyId });
        options?.onProgress?.(i + 1, propertyIds.length);
      } catch (error) {
        const errorInstance = error instanceof Error 
          ? error 
          : new Error(`Failed to unsave property ${propertyId}`);
        errors.push({ propertyId, error: errorInstance });
        options?.onError?.(errorInstance, propertyId);
      }
    }

    return {
      successful: propertyIds.length - errors.length,
      failed: errors.length,
      errors,
    };
  }, [unsaveProperty]);

  return {
    moveToFolder,
    bulkUnsave,
  };
}

/**
 * Hook for saved properties statistics and analytics
 */
export function useSavedPropertiesAnalytics() {
  const { properties, folders } = useSavedProperties();

  const analytics = useMemo(() => {
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const recentProperties = properties.filter(p => new Date(p.dateAdded) >= oneWeekAgo);
    const monthlyProperties = properties.filter(p => new Date(p.dateAdded) >= oneMonthAgo);

    const folderUsage = folders.map(folder => ({
      folder,
      count: properties.filter(p => p.folderId === folder.id).length,
      percentage: properties.length > 0 
        ? (properties.filter(p => p.folderId === folder.id).length / properties.length) * 100 
        : 0,
    }));

    const uncategorizedCount = properties.filter(p => !p.folderId).length;

    return {
      total: properties.length,
      recentlyAdded: recentProperties.length,
      addedThisMonth: monthlyProperties.length,
      withNotes: properties.filter(p => p.notes && p.notes.trim()).length,
      folderUsage,
      uncategorized: {
        count: uncategorizedCount,
        percentage: properties.length > 0 ? (uncategorizedCount / properties.length) * 100 : 0,
      },
      averagePropertiesPerFolder: folders.length > 0 
        ? properties.filter(p => p.folderId).length / folders.length 
        : 0,
    };
  }, [properties, folders]);

  return analytics;
}

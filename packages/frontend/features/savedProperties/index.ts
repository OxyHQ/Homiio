/**
 * Enterprise Saved Properties System
 * Complete export index for all saved properties functionality
 */

// Import for re-export and dev tools
import { useSavedProperties } from '@/context/SavedPropertiesProvider';
import { SaveButton } from '@/components/SaveButton/SaveButton';

// Core Types
export type {
  SavedProperty,
  SavedPropertyFolder,
  SavedPropertiesState,
  SavedPropertiesAction,
  SavedPropertiesEventBus,
  SavedPropertiesResponse,
  SavedPropertyFoldersResponse,
  SavedPropertiesError,
  SavePropertyOperation,
  UnsavePropertyOperation,
  CreateFolderData,
  UpdateFolderData,
  UseSavedPropertiesReturn,
  SavedPropertiesEvent,
  OptimisticUpdate,
} from '@/types/savedProperties';

export { LoadingState } from '@/types/savedProperties';

// API Services
export { 
  savedPropertiesApi,
  SavedPropertiesApiService 
} from '@/services/savedPropertiesApi';

// State Management
export { 
  useSavedPropertiesState,
  savedPropertiesEventBus 
} from '@/hooks/useSavedPropertiesState';

// Context Provider
export {
  SavedPropertiesProvider,
  useSavedProperties,
  withSavedProperties,
  SAVED_PROPERTIES_QUERY_KEYS,
} from '@/context/SavedPropertiesProvider';

// UI Components
export {
  SaveButton,
  CompactSaveButton,
  CardSaveButton,
  DetailsSaveButton,
} from '@/components/SaveButton/SaveButton';

// Utility Hooks
export {
  usePropertySaver,
  useFolderOperations,
  usePropertyFilters,
  useBulkOperations,
  useSavedPropertiesAnalytics,
} from '@/hooks/useSavedPropertiesHelpers';

/**
 * Quick access exports for common patterns
 */

// Main context hook - most commonly used
export { useSavedProperties as useMainSavedProperties };

// Main component - most commonly used
export { SaveButton as MainSaveButton };

/**
 * Enterprise configuration constants
 */
export const SAVED_PROPERTIES_CONFIG = {
  // Cache settings
  CACHE_STALE_TIME: 2 * 60 * 1000, // 2 minutes
  CACHE_GC_TIME: 10 * 60 * 1000, // 10 minutes
  FOLDERS_STALE_TIME: 5 * 60 * 1000, // 5 minutes
  FOLDERS_GC_TIME: 15 * 60 * 1000, // 15 minutes
  
  // Auto refresh settings
  AUTO_REFRESH_INTERVAL: 5 * 60 * 1000, // 5 minutes
  
  // UI settings
  DEFAULT_BUTTON_SIZE: 'medium' as const,
  DEFAULT_BUTTON_VARIANT: 'filled' as const,
  
  // Folder settings
  DEFAULT_FOLDER_COLOR: '#3B82F6',
  DEFAULT_FOLDER_ICON: 'folder',
  
  // Error retry settings
  MAX_RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000, // 1 second
  
  // Bulk operation settings
  BULK_OPERATION_CHUNK_SIZE: 10,
  BULK_OPERATION_DELAY: 100, // 100ms between chunks
} as const;

/**
 * Utility functions for saved properties
 */
export const savedPropertiesUtils = {
  /**
   * Generate a unique operation ID
   */
  generateOperationId: () => `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  
  /**
   * Format error message for display
   */
  formatErrorMessage: (error: unknown): string => {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return 'An unexpected error occurred';
  },
  
  /**
   * Check if a property ID is valid
   */
  isValidPropertyId: (propertyId: unknown): propertyId is string => {
    return typeof propertyId === 'string' && propertyId.trim().length > 0;
  },
  
  /**
   * Check if a folder name is valid
   */
  isValidFolderName: (name: unknown): name is string => {
    return typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 100;
  },
  
  /**
   * Sanitize folder name
   */
  sanitizeFolderName: (name: string): string => {
    return name.trim().substring(0, 100);
  },
  
  /**
   * Generate folder color from name (deterministic)
   */
  generateFolderColor: (name: string): string => {
    const colors = [
      '#3B82F6', '#EF4444', '#10B981', '#F59E0B',
      '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16',
      '#F97316', '#6366F1', '#14B8A6', '#F43F5E'
    ];
    
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = ((hash << 5) - hash) + name.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }
    
    return colors[Math.abs(hash) % colors.length];
  },
} as const;



/**
 * Version information
 */
export const SAVED_PROPERTIES_VERSION = '1.0.0';

/**
 * Feature flags (can be used for gradual rollouts)
 */
export const SAVED_PROPERTIES_FEATURES = {
  OPTIMISTIC_UPDATES: true,
  BULK_OPERATIONS: true,
  FOLDER_MANAGEMENT: true,
  ANALYTICS: true,
  AUTO_REFRESH: true,
  BACKGROUND_SYNC: false, // Future feature
  OFFLINE_SUPPORT: false, // Future feature
} as const;

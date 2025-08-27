/**
 * Enterprise-level type definitions for the Saved Properties system
 * Provides comprehensive type safety and clear contracts
 */

import type { SavedProperty as SharedSavedProperty } from '@homiio/shared-types';

// Core Types
export interface SavedProperty extends SharedSavedProperty {
  id: string;
  _id: string;
  propertyId: string; // Add this field for consistency
  userId: string;
  savedAt: string;
  folderId?: string | null;
  notes?: string;
  propertyData?: Record<string, any>;
  dateAdded: Date;
  dateModified: Date;
}

export interface SavedPropertyFolder {
  _id: string;
  id: string;
  profileId: string;
  name: string;
  description?: string;
  color: string;
  icon: string;
  isDefault: boolean;
  propertyCount: number;
  createdAt: string;
  updatedAt: string;
}

// API Response Types
export interface SavedPropertiesResponse {
  properties: SavedProperty[];
  total: number;
  page: number;
  totalPages: number;
}

export interface SavedPropertyFoldersResponse {
  folders: SavedPropertyFolder[];
  total: number;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data: T;
  message: string;
  meta?: {
    page?: number;
    totalPages?: number;
    total?: number;
  };
}

// Folder Management Types
export interface CreateFolderData {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
}

export interface UpdateFolderData {
  name?: string;
  description?: string;
  color?: string;
  icon?: string;
}

// Operation Types
export interface SavePropertyOperation {
  propertyId: string;
  folderId?: string | null;
  notes?: string;
  propertyData?: Partial<SavedProperty>;
}

export interface UnsavePropertyOperation {
  propertyId: string;
}

// State Types
export enum LoadingState {
  IDLE = 'idle',
  LOADING = 'loading', 
  SUCCESS = 'success',
  ERROR = 'error',
}

export interface OptimisticUpdate {
  id: string;
  type: 'save' | 'unsave' | 'update';
  propertyId: string;
  data: SavedProperty | null;
  timestamp: Date;
}

export interface SavedPropertiesState {
  // Data
  properties: SavedProperty[];
  folders: SavedPropertyFolder[];
  propertyIds: Set<string>;
  
  // UI State
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;
  loadingState: LoadingState;
  optimisticUpdates: Map<string, OptimisticUpdate>;
  lastUpdated: Date | null;
  
  // Operation State
  savingPropertyIds: Set<string>;
  isSaving: Record<string, boolean>;
  deletingFolderIds: Set<string>;
  updatingFolderIds: Set<string>;
  
  // Cache
  cache: {
    properties: SavedProperty[] | null;
    folders: SavedPropertyFolder[] | null;
    propertiesTimestamp: Date | null;
    foldersTimestamp: Date | null;
  };
  
  // UI
  ui: {
    expandedFolders: Set<string>;
    selectedFolderId: string | null;
    sortBy: string;
    sortOrder: 'asc' | 'desc';
  };
}

export type SavedPropertiesAction =
  | { type: 'SET_LOADING'; payload: { isLoading: boolean; loadingState?: LoadingState } }
  | { type: 'SET_PROPERTIES'; payload: { properties: SavedProperty[] } }
  | { type: 'SET_FOLDERS'; payload: { folders: SavedPropertyFolder[] } }
  | { type: 'SET_ERROR'; payload: { error: string | null } }
  | { type: 'SET_PROPERTY_SAVING'; payload: { propertyId: string; isSaving: boolean } }
  | { type: 'ADD_OPTIMISTIC_SAVE'; payload: { propertyId: string; folderId?: string | null; notes?: string } }
  | { type: 'ADD_OPTIMISTIC_UNSAVE'; payload: { propertyId: string } }
  | { type: 'REMOVE_OPTIMISTIC_UPDATE'; payload: { propertyId: string } }
  | { type: 'REVERT_OPTIMISTIC_UPDATE'; payload: { propertyId: string } }
  | { type: 'UPDATE_PROPERTY'; payload: { propertyId: string; updates: Partial<SavedProperty> } }
  | { type: 'ADD_FOLDER'; payload: { folder: SavedPropertyFolder } }
  | { type: 'UPDATE_FOLDER'; payload: { folderId: string; updates: Partial<SavedPropertyFolder> } }
  | { type: 'REMOVE_FOLDER'; payload: { folderId: string } }
  | { type: 'TOGGLE_FOLDER_EXPANDED'; payload: { folderId: string } }
  | { type: 'SET_SELECTED_FOLDER'; payload: { folderId: string | null } }
  | { type: 'SET_SORT_OPTIONS'; payload: { sortBy?: string; sortOrder?: 'asc' | 'desc' } }
  | { type: 'CLEAR_CACHE'; payload: Record<string, never> }
  | { type: 'RESET'; payload: Record<string, never> };

/**
 * Event bus for cross-component communication
 */
export interface SavedPropertiesEventBus {
  on(event: string, callback: Function): () => void;
  emit(event: string, data?: any): void;
  off(event: string, callback?: Function): void;
}

// Error Types
export interface SavedPropertiesError extends Error {
  code: string;
  context?: Record<string, any>;
}

// Hook Types
export interface UseSavedPropertiesReturn {
  // State
  properties: SavedProperty[];
  folders: SavedPropertyFolder[];
  propertiesCount: number;
  isInitialized: boolean;
  isLoading: boolean;
  error: SavedPropertiesError | null;
  
  // Property Operations
  saveProperty: (operation: SavePropertyOperation) => Promise<void>;
  unsaveProperty: (operation: UnsavePropertyOperation) => Promise<void>;
  isPropertySaved: (propertyId: string) => boolean;
  isPropertySaving: (propertyId: string) => boolean;
  
  // Folder Operations
  createFolder: (data: CreateFolderData) => Promise<SavedPropertyFolder>;
  updateFolder: (folderId: string, data: UpdateFolderData) => Promise<SavedPropertyFolder>;
  deleteFolder: (folderId: string) => Promise<void>;
  getFolder: (folderId: string) => SavedPropertyFolder | undefined;
  getDefaultFolder: () => SavedPropertyFolder | undefined;
  
  // Utilities
  refresh: () => Promise<void>;
  clearError: () => void;
}

// Event Types
export type SavedPropertiesEvent = 
  | { type: 'PROPERTY_SAVED'; payload: { propertyId: string; folderId?: string } }
  | { type: 'PROPERTY_UNSAVED'; payload: { propertyId: string } }
  | { type: 'FOLDER_CREATED'; payload: { folder: SavedPropertyFolder } }
  | { type: 'FOLDER_UPDATED'; payload: { folder: SavedPropertyFolder } }
  | { type: 'FOLDER_DELETED'; payload: { folderId: string } }
  | { type: 'ERROR'; payload: { error: SavedPropertiesError } };

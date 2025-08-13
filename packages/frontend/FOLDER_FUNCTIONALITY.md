# Saved Property Folders Feature

## Overview

This feature allows users to organize their saved properties into custom folders. Users can long-press the save button on any property to open a bottom sheet where they can choose or create a folder to organize their saved properties.

## Features

### 1. Long Press Save Button

- Long press on any save button (heart icon) opens a bottom sheet
- Users can choose from existing folders or create a new one
- Properties can be saved without a folder (default behavior)

### 2. Folder Management

- Create custom folders with names, descriptions, colors, and icons
- Update folder properties (name, description, color, icon)
- Delete folders (properties are moved to "no folder" when folder is deleted)
- Default folder is automatically created for new users

### 3. Folder Organization

- Properties can be moved between folders
- Folder view shows only properties that are organized in folders
- Folder indicators are displayed on property cards
- Property counts are maintained per folder

## Implementation Details

### Backend

- **Models**: `SavedPropertyFolder` schema with folder metadata
- **API Endpoints**:
  - `GET /api/profiles/me/saved-property-folders` - Get user's folders
  - `POST /api/profiles/me/saved-property-folders` - Create new folder
  - `PUT /api/profiles/me/saved-property-folders/:folderId` - Update folder
  - `DELETE /api/profiles/me/saved-property-folders/:folderId` - Delete folder
  - `POST /api/profiles/me/move-property-to-folder` - Move property to folder

### Frontend

- **Components**:
  - `SaveToFolderBottomSheet` - Bottom sheet for folder selection
  - Updated `SaveButton` - Supports long press
  - Updated `PropertyCard` - Shows folder indicators
- **Hooks**:
  - `useSavedPropertyFolders` - Manages folder state and operations
- **Services**:
  - `savedPropertyFolderService` - API calls for folder operations

### Database Schema

```typescript
interface SavedPropertyFolder {
  _id: string;
  profileId: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  isDefault: boolean;
  propertyCount: number;
  createdAt: string;
  updatedAt: string;
}

interface SavedProperty extends Property {
  notes?: string;
  savedAt?: string;
  folderId?: string; // New field
}
```

## Usage

### For Users

1. **Save to Folder**: Long press the heart icon on any property
2. **Choose Folder**: Select from existing folders or create a new one
3. **View Organized Properties**: Use the "Folders" filter in saved properties
4. **Manage Folders**: Create, edit, and delete folders as needed

### For Developers

1. **Add Long Press**: Use `onSaveButtonLongPress` prop on PropertyCard
2. **Open Bottom Sheet**: Use the BottomSheetContext to open folder selection
3. **Handle Folder Operations**: Use the `useSavedPropertyFolders` hook

## Future Enhancements

- Bulk folder operations
- Folder sharing between users
- Folder templates
- Advanced folder organization (subfolders, tags)
- Folder export/import functionality

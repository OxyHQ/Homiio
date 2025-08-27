/**
 * SaveButton Component
 * 
 * A button component for saving/unsaving properties with React Query integration.
 * 
 * Features:
 * - Save/unsave properties with optimistic updates
 * - React Query integration for data management
 * - Loading states with spinner
 * - Optional count display (badge or inline)
 * - Heart and bookmark variants
 * - Folder organization support
 * 
 * Usage:
 * ```tsx
 * // Basic usage
 * <SaveButton property={propertyObject} />
 * 
 * // With count badge (default)
 * <SaveButton property={propertyObject} showCount={true} />
 * 
 * // With inline count (count displayed on button)
 * <SaveButton property={propertyObject} showCount={true} countDisplayMode="inline" />
 * 
 * // Custom styling
 * <SaveButton 
 *   property={propertyObject} 
 *   showCount={true}
 *   countDisplayMode="badge"
 *   countBadgeStyle={{ backgroundColor: '#ff0000' }}
 * />
 * ```
 */

import React, { useState, useContext, useRef } from 'react';
import { TouchableOpacity, StyleSheet, ViewStyle, View, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import LoadingSpinner from './LoadingSpinner';
import { SaveToFolderBottomSheet } from './SaveToFolderBottomSheet';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { Property } from '@homiio/shared-types';
import { useSavedProfiles } from '@/store/savedProfilesStore';
import { getPropertyTitle } from '@/utils/propertyUtils';
import { ThemedText } from '@/components/ThemedText';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';

const IconComponent = Ionicons as any;

interface SaveButtonProps {
  isSaved?: boolean; // Made optional since we'll determine this from React Query
  onPress?: () => void;
  onLongPress?: () => void;
  size?: number;
  style?: ViewStyle;
  disabled?: boolean;
  variant?: 'heart' | 'bookmark';
  color?: string;
  activeColor?: string;
  showLoading?: boolean;
  isLoading?: boolean;
  // Only need the property object
  property?: Property;
  // For saving profiles instead of properties
  profileId?: string;
  showCount?: boolean;
  countBadgeStyle?: any;
  countDisplayMode?: 'badge' | 'inline';
}

export function SaveButton({
  isSaved: propIsSaved,
  onPress,
  onLongPress,
  size = 24,
  style,
  disabled = false,
  variant = 'heart',
  color = '#ccc',
  activeColor = '#EF4444',
  showLoading = true,
  isLoading = false,
  // Only need the property object
  property,
  profileId,
  showCount = false,
  countBadgeStyle,
  countDisplayMode = 'badge',
}: SaveButtonProps) {
  const [isPressed, setIsPressed] = useState(false);
  const bottomSheetContext = useContext(BottomSheetContext);
  const { saveProfile, unsaveProfile } = useSavedProfiles();
  const sizeAll = Math.max(10, size * 1);

  // Use SavedPropertiesContext for all state management
  const {
    savePropertyToFolder,
    unsaveProperty,
    isPropertySaved,
    isPropertySaving,
    savedPropertiesCount,
    isInitialized
  } = useSavedPropertiesContext();

  // Determine property ID
  const propertyId = property?._id || property?.id;

  // Determine initial saved state from prop or property object
  const initialSavedState =
    typeof propIsSaved === 'boolean'
      ? propIsSaved
      : (property as any)?.isSaved;

  // Use context state when initialized, otherwise fall back to initial state
  const isSaved = propertyId
    ? isInitialized
      ? isPropertySaved(propertyId)
      : initialSavedState
    : initialSavedState;

  // Use the memoized count from context, but freeze it on first render
  // This prevents other buttons from updating when this button isn't the one being pressed
  const frozenCountRef = useRef<number | null>(null);
  
  // Initialize frozen count on first render when context is ready
  if (frozenCountRef.current === null && isInitialized) {
    frozenCountRef.current = savedPropertiesCount;
  }
  
  // Update frozen count only when this specific property's save state changes
  const [lastSavedState, setLastSavedState] = useState<boolean>(isSaved);
  if (lastSavedState !== isSaved && frozenCountRef.current !== null) {
    // This property's state changed, update the frozen count
    frozenCountRef.current = savedPropertiesCount;
    setLastSavedState(isSaved);
  }
  
  const savedCount = frozenCountRef.current ?? savedPropertiesCount;



  // Extract propertyTitle from property object
  const propertyTitle = property ? getPropertyTitle(property) : '';

  const getIconName = () => {
    if (variant === 'heart') {
      return isSaved ? 'heart' : 'heart-outline';
    } else {
      return isSaved ? 'bookmark' : 'bookmark-outline';
    }
  };

  const getIconColor = () => {
    return isSaved ? activeColor : color;
  };

  const renderInlineCount = () => {
    if (showCount && countDisplayMode === 'inline' && savedCount > 0) {
      return (
        <View>
          <ThemedText
            style={{
              color: isSaved ? activeColor : color,
              fontSize: sizeAll,
              fontWeight: 'bold',
              textAlign: 'center',
            }}
          >
            {savedCount > 99 ? '99+' : savedCount}
          </ThemedText>
        </View>
      );
    }
    return null;
  };

  const isButtonDisabled = disabled || isLoading || isPressed || Boolean(propertyId && isPropertySaving(propertyId));

  const handleInternalSave = async () => {
    if (!propertyId) return;

    try {
      if (profileId) {
        if (isSaved) {
          await unsaveProfile(profileId);
        } else {
          await saveProfile(profileId);
        }
      } else if (propertyId) {
        if (isSaved) {
          await unsaveProperty(propertyId);
        } else {
          await savePropertyToFolder(propertyId, null, property);
        }
      }
    } catch (error) {
      console.error('Failed to toggle save:', error);
      throw error;
    }
  };

  const handlePress = () => {
    if (isButtonDisabled) return;

    setIsPressed(true);

    if (profileId || propertyId) {
      handleInternalSave()
        .catch((error) => {
          console.error('Save operation failed:', error);
        })
        .finally(() => {
          setIsPressed(false);
        });
    } else if (onPress) {
      onPress();
      setIsPressed(false);
    }
  };

  const handleLongPress = () => {
    if (isButtonDisabled) return;

    // If custom onLongPress is provided, use it
    if (onLongPress) {
      onLongPress();
      return;
    }

    // If we have property info, show folder selection
    if (propertyId && propertyTitle && bottomSheetContext) {
      // If property is not saved, save it first, then open folder selection
      if (!isSaved) {
        handleInternalSave().then(() => {
          setIsPressed(false);
          bottomSheetContext.openBottomSheet(
            <SaveToFolderBottomSheet
              propertyId={propertyId}
              propertyTitle={propertyTitle}
              property={property}
              onClose={() => {
                bottomSheetContext?.closeBottomSheet();
              }}
              onSave={(_folderId: string | null) => {
                // The bottom sheet will auto-close after saving
              }}
            />,
          );
        }).catch(() => {
          setIsPressed(false);
        });
      } else {
        // Property is already saved, just open folder selection
        setIsPressed(false);
        bottomSheetContext.openBottomSheet(
          <SaveToFolderBottomSheet
            propertyId={propertyId}
            propertyTitle={propertyTitle}
            property={property}
            onClose={() => {
              bottomSheetContext?.closeBottomSheet();
            }}
            onSave={(_folderId: string | null) => {
              // The bottom sheet will auto-close after saving
            }}
          />,
        );
      }
    }
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      onLongPress={handleLongPress}
      activeOpacity={0.7}
      disabled={isButtonDisabled}
      style={[
        styles.saveButton,
        isButtonDisabled && styles.disabledButton,
        style,
        {
          paddingHorizontal: sizeAll / (countDisplayMode === 'inline' ? 6 : 3),
          paddingVertical: sizeAll / (countDisplayMode === 'inline' ? 2 : 3),
        },
      ]}
    >
      <View
        style={{
          width: sizeAll,
          height: sizeAll,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: showCount && countDisplayMode === 'inline' ? 'row' : 'column',
          minWidth: showCount && countDisplayMode === 'inline' ? size + 20 : size,
        }}
      >
        {showLoading && (isLoading || (propertyId && isPropertySaving(propertyId))) ? (
          <LoadingSpinner size={sizeAll} color={getIconColor()} showText={false} />
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sizeAll / 4 }}>
            <IconComponent name={getIconName()} size={sizeAll} color={getIconColor()} />
            {renderInlineCount()}
          </View>
        )}
      </View>

      {/* Saved Count Badge */}
      {showCount && savedCount > 0 && countDisplayMode === 'badge' && (
        <View
          style={[
            {
              position: 'absolute',
              top: -4,
              right: -4,
              backgroundColor: activeColor,
              borderRadius: 10,
              minWidth: 20,
              height: 20,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 4,
              borderWidth: 2,
              borderColor: colors.primaryLight,
            },
            countBadgeStyle,
          ]}
        >
          <ThemedText
            style={{
              color: '#fff',
              fontSize: 10,
              fontWeight: 'bold',
              textAlign: 'center',
            }}
          >
            {savedCount > 99 ? '99+' : savedCount}
          </ThemedText>
        </View>
      )}
    </TouchableOpacity>
  );
}

const webShadow = Platform.select({
  web: { boxShadow: '0 2px 8px rgba(0,0,0,0.08)' },
  default: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
});

const styles = StyleSheet.create({
  saveButton: {
    backgroundColor: colors.primaryLight,
    borderRadius: 25,
    ...webShadow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledButton: {
    opacity: 0.6,
  },
});

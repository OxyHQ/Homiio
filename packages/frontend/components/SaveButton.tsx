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

import React, { useState, useContext } from 'react';
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
    isLoading: contextLoading,
    isPropertySaved,
    savedProperties,
    isInitialized
  } = useSavedPropertiesContext();

  // Determine property ID
  const propertyId = property?._id || property?.id;

  // Use context's isPropertySaved method for reliable state, but only after initialization
  // If not initialized, use the prop value or show loading state
  const isSaved = propertyId && isInitialized ? isPropertySaved(propertyId) : propIsSaved;

  // Calculate saved properties count from context
  const savedCount = savedProperties.length;



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

  const isButtonDisabled = disabled || isLoading || isPressed || contextLoading;

  // Show loading state if we're waiting for initialization and no prop value is provided
  const shouldShowLoading = showLoading && (isLoading || contextLoading || (!isInitialized && propertyId && propIsSaved === undefined));

  const handleInternalSave = async () => {
    if (!propertyId) return;

    console.log('SaveButton: handleInternalSave called, isSaved:', isSaved, 'propertyId:', propertyId, 'profileId:', profileId);

    try {
      if (profileId) {
        console.log('SaveButton: Handling profile save/unsave');
        if (isSaved) {
          await unsaveProfile(profileId);
        } else {
          await saveProfile(profileId);
        }
      } else if (propertyId) {
        console.log('SaveButton: Handling property save/unsave, current isSaved:', isSaved);
        if (isSaved) {
          console.log('SaveButton: Calling unsave from context');
          // Use context method for proper state management
          await unsaveProperty(propertyId);
        } else {
          console.log('SaveButton: Calling save from context');
          // Use context method for proper state management
          await savePropertyToFolder(propertyId, null, property); // Pass property object
        }
      }
    } catch (error) {
      console.error('Failed to toggle save:', error);
      // Re-throw the error so it can be handled by the caller
      throw error;
    }
  };

  const handlePress = () => {
    console.log('SaveButton: handlePress called, isButtonDisabled:', isButtonDisabled, 'propertyId:', propertyId, 'isSaved:', isSaved);

    if (isButtonDisabled) {
      console.log('SaveButton: Button disabled, ignoring press');
      return;
    }

    setIsPressed(true);

    // Use internal save logic if propertyId is provided, otherwise use external onPress
    if (profileId || propertyId) {
      console.log('SaveButton: Using internal save logic');
      handleInternalSave()
        .catch((error) => {
          // Error is already handled by mutation onError handlers
          console.log('Save operation failed:', error);
        })
        .finally(() => {
          setIsPressed(false);
        });
    } else if (onPress) {
      console.log('SaveButton: Using external onPress');
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
              onSave={(folderId: string | null) => {
                console.log('Property saved to folder:', folderId);
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
            onSave={(folderId: string | null) => {
              console.log('Property saved to folder:', folderId);
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
        {shouldShowLoading ? (
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

import React, { useState, useContext } from 'react';
import { TouchableOpacity, StyleSheet, ViewStyle, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import LoadingSpinner from './LoadingSpinner';
import { SaveToFolderBottomSheet } from './SaveToFolderBottomSheet';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { Property } from '@homiio/shared-types';
import { useSavedProfiles } from '@/store/savedProfilesStore';
import { getPropertyTitle } from '@/utils/propertyUtils';
import { useFavorites } from '@/hooks/useFavorites';

const IconComponent = Ionicons as any;

interface SaveButtonProps {
  isSaved?: boolean; // Made optional since we'll determine this from React Query
  onPress?: () => void; // Optional for backward compatibility
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
}: SaveButtonProps) {
  const [isPressed, setIsPressed] = useState(false);
  const bottomSheetContext = useContext(BottomSheetContext);
  const { saveProfile, unsaveProfile } = useSavedProfiles();
  
  // Use the useFavorites hook for consistent state management
  const { isFavorite, toggleFavorite, isPropertySaving } = useFavorites();

  // Extract propertyTitle and propertyId from property object
  const propertyId = property?._id || property?.id;
  const propertyTitle = property ? getPropertyTitle(property) : '';
  
  // Determine if property is saved using the favorites hook
  const isSaved = propertyId ? isFavorite(propertyId) : propIsSaved;

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

  const isButtonDisabled = disabled || isLoading || isPressed ||
    (propertyId ? isPropertySaving(propertyId) : false);

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
        // Use the favorites hook for consistent state management
        await toggleFavorite(propertyId, property);
      }
    } catch (error) {
      console.error('Failed to toggle save:', error);
    }
  };

  const handlePress = () => {
    if (isButtonDisabled) return;

    setIsPressed(true);

    // Use internal save logic if propertyId is provided, otherwise use external onPress
    if (profileId || propertyId) {
      handleInternalSave().finally(() => {
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
      style={[styles.saveButton, isButtonDisabled && styles.disabledButton, style]}
    >
      <View
        style={{
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {showLoading && (isLoading || (propertyId && isPropertySaving(propertyId))) ? (
          <LoadingSpinner size={size * 0.8} color={getIconColor()} showText={false} />
        ) : (
          <IconComponent name={getIconName()} size={size} color={getIconColor()} />
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  saveButton: {
    backgroundColor: colors.primaryLight,
    borderRadius: 25,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledButton: {
    opacity: 0.6,
  },
});

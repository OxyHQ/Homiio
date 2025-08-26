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
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
import savedPropertyService from '@/services/savedPropertyService';
import { toast } from 'sonner';
import { ThemedText } from '@/components/ThemedText';

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
  const { oxyServices, activeSessionId } = useOxy();
  const queryClient = useQueryClient();
  const sizeAll = Math.max(10, size * 1);

  // Get saved properties from React Query to determine saved state
  const { data: savedPropertiesData } = useQuery({
    queryKey: ['savedProperties'],
    queryFn: () => savedPropertyService.getSavedProperties(oxyServices!, activeSessionId!),
    enabled: !!oxyServices && !!activeSessionId && !!property,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
  });

  // Determine if property is saved from React Query data
  const savedProperties = savedPropertiesData?.properties || [];
  const propertyId = property?._id || property?.id;
  const isSaved = propertyId
    ? savedProperties.some((p: any) => (p._id || p.id) === propertyId)
    : propIsSaved; // Fallback to prop if no propertyId

  // Calculate saved properties count
  const savedCount = savedProperties.length;

  // React Query mutations for instant updates
  const savePropertyMutation = useMutation({
    mutationFn: async (propertyId: string) => {
      if (!oxyServices || !activeSessionId) {
        throw new Error('Authentication required');
      }
      try {
        return await savedPropertyService.saveProperty(propertyId, undefined, oxyServices, activeSessionId);
      } catch (error: any) {
        // If the property is already saved (409 conflict), treat it as success
        if (error?.status === 409 || error?.message?.includes('already saved') || error?.message?.includes('already exists')) {
          console.log('Property already saved (409), treating as success');
          // Return a mock success response
          return { success: true, message: 'Property already saved' };
        }
        throw error;
      }
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['savedProperties'] });
      queryClient.invalidateQueries({ queryKey: ['savedFolders'] });
      // Only show toast if it's a real save operation, not a 409
      if (!data?.message?.includes('already saved')) {
        toast.success('Property saved successfully');
      }
    },
    onError: (error: any) => {
      console.error('Failed to save property:', error);
      toast.error('Failed to save property');
    },
  });

  const unsavePropertyMutation = useMutation({
    mutationFn: async (propertyId: string) => {
      if (!oxyServices || !activeSessionId) {
        throw new Error('Authentication required');
      }
      try {
        return await savedPropertyService.unsaveProperty(propertyId, oxyServices, activeSessionId);
      } catch (error: any) {
        // If the property is already unsaved (404), treat it as success
        if (error?.status === 404 || error?.message?.includes('not found')) {
          console.log('Property already unsaved (404), treating as success');
          // Return a mock success response
          return { success: true, message: 'Property already unsaved' };
        }
        throw error;
      }
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['savedProperties'] });
      queryClient.invalidateQueries({ queryKey: ['savedFolders'] });
      // Only show toast if it's a real unsave operation, not a 404
      if (!data?.message?.includes('already unsaved')) {
        toast.success('Property removed from saved');
      }
    },
    onError: (error: any) => {
      console.error('Failed to unsave property:', error);
      toast.error('Failed to unsave property');
    },
  });

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

  const isButtonDisabled = disabled || isLoading || isPressed ||
    savePropertyMutation.isPending || unsavePropertyMutation.isPending;

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
          await unsavePropertyMutation.mutateAsync(propertyId);
        } else {
          await savePropertyMutation.mutateAsync(propertyId);
        }
      }
    } catch (error) {
      console.error('Failed to toggle save:', error);
      // Re-throw the error so the mutation's onError handler can process it
      throw error;
    }
  };

  const handlePress = () => {
    if (isButtonDisabled) return;

    setIsPressed(true);

    // Use internal save logic if propertyId is provided, otherwise use external onPress
    if (profileId || propertyId) {
      handleInternalSave()
        .catch((error) => {
          // Error is already handled by mutation onError handlers
          console.log('Save operation failed:', error);
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
        {showLoading && (isLoading || savePropertyMutation.isPending || unsavePropertyMutation.isPending) ? (
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

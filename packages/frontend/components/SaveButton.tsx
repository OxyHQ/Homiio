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
  const { oxyServices, activeSessionId } = useOxy();
  const queryClient = useQueryClient();

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

  // React Query mutations for instant updates
  const savePropertyMutation = useMutation({
    mutationFn: async (propertyId: string) => {
      if (!oxyServices || !activeSessionId) {
        throw new Error('Authentication required');
      }
      return savedPropertyService.saveProperty(propertyId, undefined, oxyServices, activeSessionId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['savedProperties'] });
      queryClient.invalidateQueries({ queryKey: ['savedFolders'] });
      toast.success('Property saved successfully');
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
      return savedPropertyService.unsaveProperty(propertyId, oxyServices, activeSessionId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['savedProperties'] });
      queryClient.invalidateQueries({ queryKey: ['savedFolders'] });
      toast.success('Property removed from saved');
    },
    onError: (error: any) => {
      console.error('Failed to unsave property:', error);
      if (error?.status === 404 || error?.message?.includes('not found')) {
        console.log('Property already unsaved (404), updating UI state');
        queryClient.invalidateQueries({ queryKey: ['savedProperties'] });
        queryClient.invalidateQueries({ queryKey: ['savedFolders'] });
        return; // Don't show error toast for 404
      }
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
        {showLoading && (isLoading || savePropertyMutation.isPending || unsavePropertyMutation.isPending) ? (
          <LoadingSpinner size={size * 0.8} color={getIconColor()} showText={false} />
        ) : (
          <IconComponent name={getIconName()} size={size} color={getIconColor()} />
        )}
      </View>
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
    padding: 8,
    ...webShadow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledButton: {
    opacity: 0.6,
  },
});

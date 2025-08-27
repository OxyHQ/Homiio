/**
 * Enterprise SaveButton Component
 * Implements isolated state management with optimistic updates
 */

import React, { useMemo, useCallback } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useSavedProperties } from '@/context/SavedPropertiesProvider';
import type { SavePropertyOperation } from '@/types/savedProperties';

/**
 * Props for SaveButton component
 */
interface SaveButtonProps {
  propertyId: string;
  folderId?: string | null;
  notes?: string;
  size?: 'small' | 'medium' | 'large';
  variant?: 'filled' | 'outlined' | 'minimal';
  showCount?: boolean;
  onSaveComplete?: (saved: boolean) => void;
  onError?: (error: Error) => void;
  disabled?: boolean;
  className?: string;
  testID?: string;
}

/**
 * Size configurations for different button sizes
 */
const SIZE_CONFIGS = {
  small: {
    container: 'h-8 px-2',
    icon: 16,
    text: 'text-xs',
    countText: 'text-[10px]',
  },
  medium: {
    container: 'h-10 px-3',
    icon: 20,
    text: 'text-sm',
    countText: 'text-xs',
  },
  large: {
    container: 'h-12 px-4',
    icon: 24,
    text: 'text-base',
    countText: 'text-sm',
  },
} as const;

/**
 * Variant configurations for different button styles
 */
const VARIANT_CONFIGS = {
  filled: {
    saved: 'bg-red-500 border-red-500',
    unsaved: 'bg-gray-100 border-gray-200',
    loading: 'bg-gray-200 border-gray-300',
    text: {
      saved: 'text-white',
      unsaved: 'text-gray-700',
      loading: 'text-gray-500',
    },
  },
  outlined: {
    saved: 'bg-transparent border-red-500',
    unsaved: 'bg-transparent border-gray-300',
    loading: 'bg-transparent border-gray-400',
    text: {
      saved: 'text-red-500',
      unsaved: 'text-gray-700',
      loading: 'text-gray-500',
    },
  },
  minimal: {
    saved: 'bg-transparent border-transparent',
    unsaved: 'bg-transparent border-transparent',
    loading: 'bg-transparent border-transparent',
    text: {
      saved: 'text-red-500',
      unsaved: 'text-gray-500',
      loading: 'text-gray-400',
    },
  },
} as const;

/**
 * Enterprise SaveButton component with isolated state management
 */
export function SaveButton({
  propertyId,
  folderId = null,
  notes,
  size = 'medium',
  variant = 'filled',
  showCount = true,
  onSaveComplete,
  onError,
  disabled = false,
  className = '',
  testID = 'save-button',
}: SaveButtonProps) {
  const {
    isPropertySaved,
    isPropertySaving,
    saveProperty,
    unsaveProperty,
    propertiesCount,
  } = useSavedProperties();

  // Compute stable state for this specific property
  const isSaved = useMemo(() => isPropertySaved(propertyId), [isPropertySaved, propertyId]);
  const isLoading = useMemo(() => isPropertySaving(propertyId), [isPropertySaving, propertyId]);
  
  // Freeze the count when this button was first rendered to prevent flickering
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const frozenCount = useMemo(() => propertiesCount, []);

  // Get configuration for current size and variant
  const sizeConfig = SIZE_CONFIGS[size];
  const variantConfig = VARIANT_CONFIGS[variant];

  // Determine current visual state
  const visualState = isLoading ? 'loading' : isSaved ? 'saved' : 'unsaved';
  const isInteractionDisabled = disabled || isLoading;

  // Handle save/unsave action
  const handlePress = useCallback(async () => {
    if (isInteractionDisabled) return;

    try {
      if (isSaved) {
        // Unsave property
        await unsaveProperty({ propertyId });
        onSaveComplete?.(false);
      } else {
        // Save property
        const operation: SavePropertyOperation = {
          propertyId,
          folderId,
          notes,
        };
        await saveProperty(operation);
        onSaveComplete?.(true);
      }
    } catch (error) {
      const errorInstance = error instanceof Error 
        ? error 
        : new Error(typeof error === 'string' ? error : 'Failed to save property');
      
      onError?.(errorInstance);
      console.error('SaveButton error:', errorInstance);
    }
  }, [
    isInteractionDisabled,
    isSaved,
    unsaveProperty,
    saveProperty,
    propertyId,
    folderId,
    notes,
    onSaveComplete,
    onError,
  ]);

  // Compute styles
  const containerStyles = [
    'flex-row items-center justify-center border rounded-lg',
    sizeConfig.container,
    variantConfig[visualState],
    isInteractionDisabled ? 'opacity-50' : '',
    className,
  ].filter(Boolean).join(' ');

  const textColor = variantConfig.text[visualState];

  // Render content based on loading state
  const renderContent = () => {
    if (isLoading) {
      return (
        <View className="flex-row items-center gap-2">
          <ActivityIndicator size="small" color={textColor.includes('white') ? '#ffffff' : '#666666'} />
          {showCount && (
            <Text className={`${sizeConfig.countText} ${textColor} font-medium`}>
              {frozenCount}
            </Text>
          )}
        </View>
      );
    }

    return (
      <View className="flex-row items-center gap-2">
        <Ionicons
          name={isSaved ? 'heart' : 'heart-outline'}
          size={sizeConfig.icon}
          color={textColor.includes('red') ? '#ef4444' : textColor.includes('white') ? '#ffffff' : '#666666'}
        />
        {showCount && (
          <Text className={`${sizeConfig.countText} ${textColor} font-medium`}>
            {frozenCount}
          </Text>
        )}
      </View>
    );
  };

  return (
    <Pressable
      className={containerStyles}
      onPress={handlePress}
      disabled={isInteractionDisabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={
        isLoading 
          ? 'Saving property...' 
          : isSaved 
            ? 'Remove from saved properties' 
            : 'Save property'
      }
      accessibilityState={{
        disabled: isInteractionDisabled,
        selected: isSaved,
      }}
      style={({ pressed }) => ({
        opacity: pressed && !isInteractionDisabled ? 0.8 : 1,
        transform: pressed && !isInteractionDisabled ? [{ scale: 0.98 }] : [{ scale: 1 }],
      })}
    >
      {renderContent()}
    </Pressable>
  );
}

/**
 * Compact save button for use in lists and grids
 */
export function CompactSaveButton(props: Omit<SaveButtonProps, 'size' | 'variant' | 'showCount'>) {
  return (
    <SaveButton
      {...props}
      size="small"
      variant="minimal"
      showCount={false}
    />
  );
}

/**
 * Save button with count for use in property cards
 */
export function CardSaveButton(props: Omit<SaveButtonProps, 'size' | 'variant'>) {
  return (
    <SaveButton
      {...props}
      size="medium"
      variant="filled"
      showCount={true}
    />
  );
}

/**
 * Large save button for property details pages
 */
export function DetailsSaveButton(props: Omit<SaveButtonProps, 'size' | 'variant'>) {
  return (
    <SaveButton
      {...props}
      size="large"
      variant="outlined"
      showCount={true}
    />
  );
}

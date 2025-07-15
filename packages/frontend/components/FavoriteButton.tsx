import React, { memo } from 'react';
import { TouchableOpacity, View, AccessibilityInfo } from 'react-native';
import LoadingSpinner from './LoadingSpinner';
import { useFavorites } from '@/hooks/useFavorites';
import { HeartIcon, HeartIconActive } from '@/assets/icons/heart-icon';
import { Bookmark, BookmarkActive } from '@/assets/icons/bookmark-icon';

interface FavoriteButtonProps {
    propertyId: string;
    size?: number;
    color?: string;
    activeColor?: string;
    onPress?: () => void;
    onError?: (error: string) => void;
    showLoading?: boolean;
    variant?: 'heart' | 'bookmark';
    style?: any;
    accessibilityLabel?: string;
    testID?: string;
}

export const FavoriteButton: React.FC<FavoriteButtonProps> = memo(({
    propertyId,
    size = 24,
    color = '#6B7280',
    activeColor = '#EF4444',
    onPress,
    onError,
    showLoading = true,
    variant = 'heart',
    style,
    accessibilityLabel,
    testID,
}) => {
    const { isFavorite, toggleFavorite, isPropertySaving, error } = useFavorites();
    const isFavorited = isFavorite(propertyId);
    const isLoading = showLoading && isPropertySaving(propertyId);
    const [isScreenReaderEnabled, setIsScreenReaderEnabled] = React.useState(false);

    // Check if screen reader is enabled
    React.useEffect(() => {
        AccessibilityInfo.isScreenReaderEnabled().then(setIsScreenReaderEnabled);
    }, []);

    // Handle errors
    React.useEffect(() => {
        if (error && onError) {
            onError(error);
        }
    }, [error, onError]);

    const handlePress = async () => {
        if (!propertyId || isLoading) {
            return;
        }

        try {
            await toggleFavorite(propertyId);
            onPress?.();

            // Provide haptic feedback
            if (isScreenReaderEnabled) {
                AccessibilityInfo.announceForAccessibility(
                    isFavorited ? 'Removed from favorites' : 'Added to favorites'
                );
            }
        } catch (error) {
            console.error('FavoriteButton: Error toggling favorite:', error);
            onError?.(error instanceof Error ? error.message : 'Failed to update favorite');
        }
    };

    const renderIcon = () => {
        if (variant === 'heart') {
            return isFavorited ? (
                <HeartIconActive size={size} color={activeColor} />
            ) : (
                <HeartIcon size={size} color={color} />
            );
        } else {
            return isFavorited ? (
                <BookmarkActive size={size} color={activeColor} />
            ) : (
                <Bookmark size={size} color={color} />
            );
        }
    };

    const defaultAccessibilityLabel = accessibilityLabel ||
        `${isFavorited ? 'Remove from' : 'Add to'} ${variant === 'heart' ? 'favorites' : 'saved'}`;

    return (
        <TouchableOpacity
            onPress={handlePress}
            disabled={isLoading}
            style={[
                {
                    padding: 8,
                    borderRadius: 20,
                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.1,
                    shadowRadius: 4,
                    elevation: 3,
                    // Ensure consistent dimensions
                    minWidth: size + 16, // size + padding
                    minHeight: size + 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                },
                style,
            ]}
            accessibilityLabel={defaultAccessibilityLabel}
            accessibilityRole="button"
            accessibilityState={{
                disabled: isLoading,
                selected: isFavorited
            }}
            testID={testID}
        >
            <View style={{
                width: size,
                height: size,
                alignItems: 'center',
                justifyContent: 'center'
            }}>
                {isLoading ? (
                    <LoadingSpinner
                        size={size * 0.8}
                        color={isFavorited ? activeColor : color}
                        showText={false}
                    />
                ) : (
                    renderIcon()
                )}
            </View>
        </TouchableOpacity>
    );
});

FavoriteButton.displayName = 'FavoriteButton';

export default FavoriteButton; 
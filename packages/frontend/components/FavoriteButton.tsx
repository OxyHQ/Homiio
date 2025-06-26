import React from 'react';
import { TouchableOpacity, View } from 'react-native';
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
    showLoading?: boolean;
    variant?: 'heart' | 'bookmark';
    style?: any;
}

export const FavoriteButton: React.FC<FavoriteButtonProps> = ({
    propertyId,
    size = 24,
    color = '#6B7280',
    activeColor = '#EF4444',
    onPress,
    showLoading = true,
    variant = 'heart',
    style,
}) => {
    const { isFavorite, toggleFavorite, isSaving } = useFavorites();
    const isFavorited = isFavorite(propertyId);
    const isLoading = showLoading && isSaving;

    const handlePress = async () => {
        try {
            await toggleFavorite(propertyId);
            onPress?.();
        } catch (error) {
            console.error('Error toggling favorite:', error);
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
};

export default FavoriteButton; 
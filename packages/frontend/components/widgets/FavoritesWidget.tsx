import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useFavorites } from '@/hooks/useFavorites';
import { ThemedText } from '@/components/ThemedText';
import { HeartIcon, HeartIconActive } from '@/assets/icons/heart-icon';
import { colors } from '@/styles/colors';

interface FavoritesWidgetProps {
  style?: any;
}

export const FavoritesWidget: React.FC<FavoritesWidgetProps> = ({ style }) => {
  const { favoriteIds } = useFavorites();
  const favoriteCount = favoriteIds.length;

  const handlePress = () => {
    router.push('/saved');
  };

  return (
    <TouchableOpacity style={[styles.container, style]} onPress={handlePress} activeOpacity={0.8}>
      <View style={styles.iconContainer}>
        {favoriteCount > 0 ? (
          <HeartIconActive size={24} color={colors.primaryColor} />
        ) : (
          <HeartIcon size={24} color={colors.primaryDark_2} />
        )}
        {favoriteCount > 0 && (
          <View style={styles.badge}>
            <ThemedText style={styles.badgeText}>
              {favoriteCount > 99 ? '99+' : favoriteCount}
            </ThemedText>
          </View>
        )}
      </View>
      <ThemedText style={styles.label}>
        {favoriteCount === 0
          ? 'No Favorites'
          : favoriteCount === 1
            ? '1 Favorite'
            : `${favoriteCount} Favorites`}
      </ThemedText>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.primaryLight,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  iconContainer: {
    position: 'relative',
    marginBottom: 8,
  },
  badge: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#EF4444',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.primaryDark_1,
    textAlign: 'center',
  },
});

export default FavoritesWidget;

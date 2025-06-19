import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors } from '@/styles/colors';
import { PropertyList, Property } from '@/components/PropertyList';
import { SearchBar } from '@/components/SearchBar';

const SAMPLE_PROPERTIES: Property[] = [
  {
    id: '1',
    title: 'Modern Apartment in City Center',
    location: 'Barcelona, Spain',
    price: 1200,
    type: 'apartment',
    imageUrl: 'https://picsum.photos/600/400',
    bedrooms: 2,
    bathrooms: 1,
    size: 75,
    isVerified: true,
  },
  {
    id: '2',
    title: 'Cozy House with Garden',
    location: 'Berlin, Germany',
    price: 1800,
    type: 'house',
    imageUrl: 'https://picsum.photos/600/401',
    bedrooms: 3,
    bathrooms: 2,
    size: 120,
    isVerified: true,
  },
  {
    id: '3',
    title: 'Student Co-living Space',
    location: 'Amsterdam, Netherlands',
    price: 800,
    type: 'coliving',
    imageUrl: 'https://picsum.photos/600/402',
    bedrooms: 1,
    bathrooms: 1,
    size: 30,
    isVerified: false,
  },
  {
    id: '4',
    title: 'Eco-friendly Tiny House',
    location: 'Stockholm, Sweden',
    price: 1000,
    type: 'eco',
    imageUrl: 'https://picsum.photos/600/403',
    bedrooms: 1,
    bathrooms: 1,
    size: 40,
    isVerified: true,
  },
];

export default function PropertiesScreen() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  const handlePropertyPress = (property: Property) => {
    router.push(`/properties/${property.id}`);
  };

  const handleFavoritePress = (property: Property) => {
    setFavorites((prev) => {
      const newFavorites = new Set(prev);
      if (newFavorites.has(property.id)) {
        newFavorites.delete(property.id);
      } else {
        newFavorites.add(property.id);
      }
      return newFavorites;
    });
  };

  const filteredProperties = SAMPLE_PROPERTIES.map(property => ({
    ...property,
    isFavorite: favorites.has(property.id),
  })).filter(property =>
    searchQuery === '' ||
    property.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    property.location.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.searchContainer}>
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search properties..."
        />
      </View>

      <PropertyList
        properties={filteredProperties}
        onPropertyPress={handlePropertyPress}
        onFavoritePress={handleFavoritePress}
        numColumns={2}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primaryLight,
  },
  searchContainer: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.primaryLight_1,
  },
});
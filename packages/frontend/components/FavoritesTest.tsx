import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useFavorites } from '@/hooks/useFavorites';
import { PropertyCard } from './PropertyCard';
import { Property } from '@/services/propertyService';

const testProperty: Property = {
    _id: 'test-1',
    address: {
        street: '789 Test St',
        city: 'Test City',
        state: 'TS',
        zipCode: '12345',
        country: 'USA',
    },
    type: 'apartment',
    description: 'Test property for Redux favorites',
    squareFootage: 1000,
    bedrooms: 1,
    bathrooms: 1,
    rent: {
        amount: 2000,
        currency: '$',
        paymentFrequency: 'monthly',
        deposit: 2000,
        utilities: 'included',
    },
    amenities: ['Test'],
    images: ['https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=500'],
    status: 'available',
    ownerId: 'test-owner',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
};

export function FavoritesTest() {
    const {
        favoriteIds,
        isFavorite,
        addFavorite,
        removeFavorite,
        toggleFavoriteProperty,
        getFavoriteCount,
        clearFavorites
    } = useFavorites();

    const propertyId = testProperty._id;

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Redux Favorites Test</Text>

            <View style={styles.stats}>
                <Text style={styles.stat}>Total Favorites: {getFavoriteCount()}</Text>
                <Text style={styles.stat}>Is Test Property Favorite: {isFavorite(propertyId) ? 'Yes' : 'No'}</Text>
                <Text style={styles.stat}>All Favorite IDs: {favoriteIds.join(', ') || 'None'}</Text>
            </View>

            <View style={styles.buttons}>
                <TouchableOpacity
                    style={styles.button}
                    onPress={() => addFavorite(propertyId)}
                >
                    <Text style={styles.buttonText}>Add to Favorites</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.button}
                    onPress={() => removeFavorite(propertyId)}
                >
                    <Text style={styles.buttonText}>Remove from Favorites</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.button}
                    onPress={() => toggleFavoriteProperty(propertyId)}
                >
                    <Text style={styles.buttonText}>Toggle Favorite</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.button, styles.clearButton]}
                    onPress={clearFavorites}
                >
                    <Text style={styles.buttonText}>Clear All Favorites</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.cardContainer}>
                <Text style={styles.sectionTitle}>Test Property Card</Text>
                <PropertyCard
                    property={testProperty}
                    variant="default"
                    onPress={() => console.log('Test property pressed')}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 16,
        backgroundColor: '#f8f8f8',
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: 20,
        color: '#333',
    },
    stats: {
        backgroundColor: '#fff',
        padding: 16,
        borderRadius: 8,
        marginBottom: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    stat: {
        fontSize: 16,
        marginBottom: 8,
        color: '#333',
    },
    buttons: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        marginBottom: 20,
    },
    button: {
        backgroundColor: '#007AFF',
        padding: 12,
        borderRadius: 8,
        marginBottom: 8,
        minWidth: '48%',
    },
    clearButton: {
        backgroundColor: '#FF3B30',
    },
    buttonText: {
        color: '#fff',
        textAlign: 'center',
        fontWeight: '600',
    },
    cardContainer: {
        alignItems: 'center',
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 12,
        color: '#333',
    },
}); 
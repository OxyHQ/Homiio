import React from 'react';
import { View, ScrollView, StyleSheet, Text } from 'react-native';
import { PropertyCard } from './PropertyCard';
import { Property } from '@/services/propertyService';
import { useFavorites } from '@/hooks/useFavorites';

// Example property data
const exampleProperty: Property = {
    _id: '1',
    address: {
        street: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        zipCode: '94102',
        country: 'USA',
    },
    type: 'apartment',
    description: 'Beautiful modern apartment in the heart of the city',
    squareFootage: 1200,
    bedrooms: 2,
    bathrooms: 1,
    rent: {
        amount: 3500,
        currency: '$',
        paymentFrequency: 'monthly',
        deposit: 3500,
        utilities: 'included',
    },
    amenities: ['WiFi', 'Gym', 'Pool'],
    images: ['https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=500'],
    status: 'available',
    ownerId: 'owner1',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
};

const exampleProperty2: Property = {
    _id: '2',
    address: {
        street: '456 Oak Ave',
        city: 'Los Angeles',
        state: 'CA',
        zipCode: '90210',
        country: 'USA',
    },
    type: 'house',
    description: 'Spacious family home with garden',
    squareFootage: 2500,
    bedrooms: 4,
    bathrooms: 3,
    rent: {
        amount: 5500,
        currency: '$',
        paymentFrequency: 'monthly',
        deposit: 5500,
        utilities: 'partial',
    },
    amenities: ['Garden', 'Parking', 'Fireplace'],
    images: ['https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=500'],
    status: 'available',
    ownerId: 'owner2',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
};

export function PropertyCardExample() {
    const { favoriteIds, getFavoriteCount } = useFavorites();

    return (
        <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
            <View style={styles.content}>
                <Text style={styles.header}>PropertyCard Examples</Text>
                <Text style={styles.subtitle}>Favorites Count: {getFavoriteCount()}</Text>
                <Text style={styles.subtitle}>Favorite IDs: {favoriteIds.join(', ') || 'None'}</Text>

                <Text style={styles.sectionTitle}>Default Size</Text>
                <PropertyCard
                    property={exampleProperty}
                    variant="default"
                    onPress={() => console.log('Property 1 pressed')}
                />

                <Text style={styles.sectionTitle}>Featured Size</Text>
                <PropertyCard
                    property={exampleProperty2}
                    variant="featured"
                    onPress={() => console.log('Property 2 pressed')}
                />

                <Text style={styles.sectionTitle}>Compact Size</Text>
                <PropertyCard
                    property={exampleProperty}
                    variant="compact"
                    onPress={() => console.log('Property 3 pressed')}
                />

                <Text style={styles.sectionTitle}>Saved Size</Text>
                <PropertyCard
                    property={exampleProperty2}
                    variant="saved"
                    onPress={() => console.log('Property 4 pressed')}
                />
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8f8f8',
    },
    content: {
        padding: 16,
        alignItems: 'center',
    },
    header: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#333',
        marginBottom: 8,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 14,
        color: '#666',
        marginBottom: 20,
        textAlign: 'center',
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#333',
        marginTop: 20,
        marginBottom: 12,
        alignSelf: 'flex-start',
    },
}); 
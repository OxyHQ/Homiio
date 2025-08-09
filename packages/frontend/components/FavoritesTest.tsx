import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useFavorites } from '@/hooks/useFavorites';
import FavoriteButton from './FavoriteButton';
import { ThemedView } from './ThemedView';
import { ThemedText } from './ThemedText';
import { colors } from '@/styles/colors';

export const FavoritesTest: React.FC = () => {
    const {
        favoriteIds,
        isLoading,
        isSaving,
        error
    } = useFavorites();

    // Sample property IDs for testing
    const sampleProperties = [
        { id: 'prop1', title: 'Downtown Apartment' },
        { id: 'prop2', title: 'Suburban House' },
        { id: 'prop3', title: 'Eco-Friendly Studio' },
        { id: 'prop4', title: 'Luxury Penthouse' },
    ];

    return (
        <ThemedView style={styles.container}>
            <ScrollView contentContainerStyle={styles.scrollContent}>
                <ThemedText style={styles.title}>Favorites System Test</ThemedText>

                {/* Status Information */}
                <View style={styles.statusSection}>
                    <ThemedText style={styles.sectionTitle}>Status</ThemedText>
                    <ThemedText>Loading: {isLoading ? 'Yes' : 'No'}</ThemedText>
                    <ThemedText>Saving: {isSaving ? 'Yes' : 'No'}</ThemedText>
                    <ThemedText>Total Favorites: {favoriteIds.length}</ThemedText>
                    {error && (
                        <ThemedText style={styles.errorText}>Error: {error}</ThemedText>
                    )}
                </View>

                {/* Favorite IDs */}
                <View style={styles.favoritesSection}>
                    <ThemedText style={styles.sectionTitle}>Favorite IDs</ThemedText>
                    {favoriteIds.length === 0 ? (
                        <ThemedText style={styles.emptyText}>No favorites yet</ThemedText>
                    ) : (
                        favoriteIds.map((id, index) => (
                            <ThemedText key={index} style={styles.favoriteId}>
                                • {id}
                            </ThemedText>
                        ))
                    )}
                </View>

                {/* Test Properties */}
                <View style={styles.testSection}>
                    <ThemedText style={styles.sectionTitle}>Test Properties</ThemedText>
                    <ThemedText style={styles.subtitle}>
                        Tap the heart icons to add/remove favorites
                    </ThemedText>

                    {sampleProperties.map((property) => (
                        <View key={property.id} style={styles.propertyRow}>
                            <View style={styles.propertyInfo}>
                                <ThemedText style={styles.propertyTitle}>{property.title}</ThemedText>
                                <ThemedText style={styles.propertyId}>ID: {property.id}</ThemedText>
                            </View>
                            <FavoriteButton
                                propertyId={property.id}
                                size={28}
                                variant="heart"
                                showLoading={true}
                            />
                        </View>
                    ))}
                </View>

                {/* Actions */}
                <View style={styles.actionsSection}>
                    <ThemedText style={styles.sectionTitle}>Actions</ThemedText>
                    <View style={styles.actionButtons}>
                        <FavoriteButton
                            propertyId="test-clear"
                            size={24}
                            variant="bookmark"
                            style={styles.actionButton}
                        />
                        <ThemedText style={styles.actionLabel}>Clear All</ThemedText>
                    </View>
                </View>
            </ScrollView>
        </ThemedView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 16,
    },
    scrollContent: {
        paddingBottom: 32,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 24,
        textAlign: 'center',
    },
    statusSection: {
        backgroundColor: colors.primaryLight,
        padding: 16,
        borderRadius: 12,
        marginBottom: 16,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 12,
        color: colors.primaryColor,
    },
    errorText: {
        color: '#EF4444',
        fontWeight: '500',
    },
    favoritesSection: {
        backgroundColor: colors.primaryLight,
        padding: 16,
        borderRadius: 12,
        marginBottom: 16,
    },
    emptyText: {
        fontStyle: 'italic',
        color: colors.primaryDark_2,
    },
    favoriteId: {
        fontSize: 14,
        marginBottom: 4,
        fontFamily: 'monospace',
    },
    testSection: {
        backgroundColor: colors.primaryLight,
        padding: 16,
        borderRadius: 12,
        marginBottom: 16,
    },
    subtitle: {
        fontSize: 14,
        color: colors.primaryDark_2,
        marginBottom: 16,
    },
    propertyRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
    },
    propertyInfo: {
        flex: 1,
    },
    propertyTitle: {
        fontSize: 16,
        fontWeight: '500',
        marginBottom: 4,
    },
    propertyId: {
        fontSize: 12,
        color: colors.primaryDark_2,
        fontFamily: 'monospace',
    },
    actionsSection: {
        backgroundColor: colors.primaryLight,
        padding: 16,
        borderRadius: 12,
    },
    actionButtons: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    actionButton: {
        backgroundColor: '#F3F4F6',
    },
    actionLabel: {
        fontSize: 14,
        color: colors.primaryDark_1,
    },
});

export default FavoritesTest; 
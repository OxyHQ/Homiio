import React, { useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Alert, TextInput, Modal } from 'react-native';
import { useSavedProperties, useUnsaveProperty, useUpdateSavedPropertyNotes } from '@/hooks/useUserQueries';
import { useOxy } from '@oxyhq/services';
import { router } from 'expo-router';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { PropertyCard } from '@/components/PropertyCard';
import Button from '@/components/Button';
import LoadingTopSpinner from '@/components/LoadingTopSpinner';
import { Header } from '@/components/Header';
import { IconButton } from '@/components/IconButton';
import { colors } from '@/styles/colors';
import type { Property } from '@/services/propertyService';
import { useSEO } from '@/hooks/useDocumentTitle';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { getPropertyImageSource } from '@/utils/propertyUtils';

interface SavedProperty extends Property {
    savedAt: string;
    notes?: string;
    savedPropertyId: string;
    title: string;
}

export default function SavedPropertiesScreen() {
    const { oxyServices, activeSessionId } = useOxy();
    const { data: savedProperties = [], isLoading, error, refetch } = useSavedProperties();
    const unsaveProperty = useUnsaveProperty();
    const updateNotes = useUpdateSavedPropertyNotes();

    // Set enhanced SEO for saved properties page
    useSEO({
        title: 'Saved Properties',
        description: 'View and manage your saved properties. Add notes, organize your favorites, and keep track of properties you love.',
        keywords: 'saved properties, property favorites, housing bookmarks, property notes, real estate favorites',
        type: 'website'
    });

    const [selectedProperty, setSelectedProperty] = useState<SavedProperty | null>(null);
    const [notesModalVisible, setNotesModalVisible] = useState(false);
    const [notesText, setNotesText] = useState('');

    const handleUnsaveProperty = (property: SavedProperty) => {
        Alert.alert(
            'Unsave Property',
            `Are you sure you want to remove "${property.title}" from your saved properties?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Unsave',
                    style: 'destructive',
                    onPress: () => {
                        unsaveProperty.mutate(property._id, {
                            onSuccess: () => {
                                console.log('Property unsaved successfully');
                            },
                            onError: (error) => {
                                Alert.alert('Error', error.message || 'Failed to unsave property');
                            },
                        });
                    },
                },
            ]
        );
    };

    const handleEditNotes = (property: SavedProperty) => {
        setSelectedProperty(property);
        setNotesText(property.notes || '');
        setNotesModalVisible(true);
    };

    const handleSaveNotes = () => {
        if (!selectedProperty) return;

        updateNotes.mutate(
            { propertyId: selectedProperty._id, notes: notesText },
            {
                onSuccess: () => {
                    setNotesModalVisible(false);
                    setSelectedProperty(null);
                    setNotesText('');
                    console.log('Notes updated successfully');
                },
                onError: (error) => {
                    Alert.alert('Error', error.message || 'Failed to update notes');
                },
            }
        );
    };

    const handlePropertyPress = (property: SavedProperty) => {
        router.push(`/properties/${property._id}`);
    };

    const renderPropertyItem = ({ item }: { item: SavedProperty }) => (
        <TouchableOpacity onPress={() => handlePropertyPress(item)} style={styles.cardContainer}>
            <PropertyCard
                id={item._id}
                title={item.title}
                location={`${item.address.city}, ${item.address.state}`}
                price={item.rent.amount}
                type={item.type === 'room' ? 'apartment' : item.type === 'studio' ? 'apartment' : item.type === 'house' ? 'house' : 'apartment'}
                imageSource={getPropertyImageSource(item.images)}
                bedrooms={item.bedrooms || 0}
                bathrooms={item.bathrooms || 0}
                size={item.squareFootage || 0}
            />
            <View style={styles.cardFooter}>
                <View style={styles.notesSection}>
                    <ThemedText style={styles.notesLabel}>My Notes:</ThemedText>
                    <ThemedText style={styles.notesText} numberOfLines={2}>
                        {item.notes || 'No notes yet. Tap to add some.'}
                    </ThemedText>
                </View>
                <View style={styles.cardActions}>
                    <IconButton
                        name="create-outline"
                        size={22}
                        color={colors.primaryColor}
                        onPress={() => handleEditNotes(item)}
                    />
                    <IconButton
                        name="bookmark"
                        size={22}
                        color={colors.chatUnreadBadge}
                        onPress={() => handleUnsaveProperty(item)}
                    />
                </View>
            </View>
        </TouchableOpacity>
    );

    const renderEmptyState = () => (
        <View style={styles.emptyStateContainer}>
            <View style={styles.emptyStateContent}>
                <Text style={styles.emptyStateIcon}>🔖</Text>
                <ThemedText style={styles.emptyStateTitle}>No Saved Properties Yet</ThemedText>
                <ThemedText style={styles.emptyStateSubtitle}>
                    Tap the bookmark icon on any property to save it here for later.
                </ThemedText>
                <Button
                    onPress={() => router.push('/properties')}
                    style={styles.browseButton}
                >
                    <ThemedText style={styles.browseButtonText}>Start Browsing</ThemedText>
                </Button>
            </View>
        </View>
    );

    const renderAuthRequired = () => (
        <View style={styles.emptyStateContainer}>
            <View style={styles.emptyStateContent}>
                <Text style={styles.emptyStateIcon}>🔒</Text>
                <ThemedText style={styles.emptyStateTitle}>Authentication Required</ThemedText>
                <ThemedText style={styles.emptyStateSubtitle}>
                    Please sign in to view and manage your saved properties
                </ThemedText>
            </View>
        </View>
    );

    if (!oxyServices || !activeSessionId) {
        return (
            <ThemedView style={styles.container} lightColor="transparent" darkColor="transparent">
                <Header options={{ title: 'Saved Properties', showBackButton: true }} />
                {renderAuthRequired()}
            </ThemedView>
        );
    }

    return (
        <ThemedView style={styles.container} lightColor="transparent" darkColor="transparent">
            <Header
                options={{
                    title: 'Saved Properties',
                    showBackButton: true,
                    rightComponents: [
                        <IconButton
                            key="refresh"
                            name="refresh-outline"
                            size={20}
                            color={colors.primaryColor}
                            backgroundColor="transparent"
                            onPress={() => refetch()}
                        />
                    ]
                }}
            />

            {isLoading && <LoadingTopSpinner showLoading={true} />}

            {error && (
                <View style={styles.errorContainer}>
                    <ThemedText style={styles.errorText}>
                        Failed to load saved properties. Please try again.
                    </ThemedText>
                    <Button onPress={() => refetch()}>
                        Retry
                    </Button>
                </View>
            )}

            {!isLoading && !error && (
                <FlatList
                    data={savedProperties as SavedProperty[]}
                    renderItem={renderPropertyItem}
                    keyExtractor={(item) => item._id}
                    contentContainerStyle={styles.listContainer}
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={renderEmptyState}
                />
            )}

            {/* Notes Modal */}
            <Modal
                visible={notesModalVisible}
                animationType="slide"
                transparent={true}
                onRequestClose={() => setNotesModalVisible(false)}
            >
                <TouchableOpacity
                    style={styles.modalOverlay}
                    activeOpacity={1}
                    onPressOut={() => setNotesModalVisible(false)}
                >
                    <View style={styles.modalContent}>
                        <ThemedText style={styles.modalTitle}>Edit Notes</ThemedText>
                        <ThemedText style={styles.modalSubtitle}>
                            Add a personal note for "{selectedProperty?.title}"
                        </ThemedText>
                        <TextInput
                            style={styles.notesInput}
                            value={notesText}
                            onChangeText={setNotesText}
                            placeholder="e.g., 'Love the big kitchen, but the backyard is small.'"
                            placeholderTextColor={colors.primaryDark_2}
                            multiline
                        />
                        <Button onPress={handleSaveNotes} style={styles.saveButton}>
                            <ThemedText style={styles.saveButtonText}>Save Notes</ThemedText>
                        </Button>
                    </View>
                </TouchableOpacity>
            </Modal>
        </ThemedView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    listContainer: {
        padding: 16,
    },
    cardContainer: {
        backgroundColor: 'white',
        borderRadius: 12,
        marginBottom: 16,
        overflow: 'hidden',
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    cardFooter: {
        padding: 12,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: '#f0f0f0',
    },
    notesSection: {
        flex: 1,
        marginRight: 12,
    },
    notesLabel: {
        fontSize: 12,
        color: colors.primaryDark_2,
        marginBottom: 4,
        fontWeight: '500',
    },
    notesText: {
        fontSize: 14,
        color: colors.primaryDark_1,
    },
    cardActions: {
        flexDirection: 'row',
        gap: 8,
    },
    emptyStateContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    emptyStateContent: {
        alignItems: 'center',
        textAlign: 'center',
    },
    emptyStateIcon: {
        fontSize: 48,
        marginBottom: 16,
    },
    emptyStateTitle: {
        fontSize: 22,
        fontWeight: '600',
        marginBottom: 8,
    },
    emptyStateSubtitle: {
        fontSize: 16,
        color: colors.primaryDark_2,
        marginBottom: 24,
        paddingHorizontal: 16,
    },
    browseButton: {
        backgroundColor: colors.primaryColor,
        paddingVertical: 12,
        paddingHorizontal: 32,
        borderRadius: 50,
    },
    browseButtonText: {
        color: 'white',
        fontWeight: '600',
        fontSize: 16,
    },
    errorContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
    },
    errorText: {
        fontSize: 16,
        textAlign: 'center',
        marginBottom: 16,
        opacity: 0.7,
        color: colors.primaryDark_1,
    },
    modalOverlay: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    modalContent: {
        backgroundColor: 'white',
        borderRadius: 16,
        padding: 24,
        width: '90%',
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: '600',
        marginBottom: 8,
    },
    modalSubtitle: {
        fontSize: 14,
        color: colors.primaryDark_2,
        marginBottom: 16,
    },
    notesInput: {
        backgroundColor: '#f0f0f0',
        borderRadius: 8,
        padding: 16,
        minHeight: 100,
        fontSize: 16,
        textAlignVertical: 'top',
        marginBottom: 16,
    },
    saveButton: {
        backgroundColor: colors.primaryColor,
        borderRadius: 50,
        paddingVertical: 12,
    },
    saveButtonText: {
        color: 'white',
        fontWeight: '600',
        textAlign: 'center',
    },
}); 
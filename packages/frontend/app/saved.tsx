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

interface SavedProperty extends Property {
    savedAt: string;
    notes?: string;
    savedPropertyId: string;
}

export default function SavedPropertiesScreen() {
    const { oxyServices, activeSessionId } = useOxy();
    const { data: savedProperties = [], isLoading, error, refetch } = useSavedProperties();
    const unsaveProperty = useUnsaveProperty();
    const updateNotes = useUpdateSavedPropertyNotes();

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
        <View style={styles.propertyContainer}>
            <PropertyCard
                id={item._id}
                title={item.title}
                location={`${item.address.city}, ${item.address.state}`}
                price={item.rent.amount}
                type={item.type === 'room' ? 'apartment' : item.type === 'studio' ? 'apartment' : item.type === 'house' ? 'house' : 'apartment'}
                imageUrl={item.images?.[0] || ''}
                bedrooms={item.bedrooms || 0}
                bathrooms={item.bathrooms || 0}
                size={item.squareFootage || 0}
                onPress={() => handlePropertyPress(item)}
                style={styles.propertyCard}
            />
            <View style={styles.propertyActions}>
                <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => handleEditNotes(item)}
                >
                    <IconButton
                        name="create-outline"
                        size={18}
                        color={colors.primaryColor}
                        backgroundColor="transparent"
                        style={styles.actionIcon}
                    />
                    <Text style={styles.actionText}>Notes</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.actionButton, styles.unsaveButton]}
                    onPress={() => handleUnsaveProperty(item)}
                >
                    <IconButton
                        name="bookmark"
                        size={18}
                        color={colors.chatUnreadBadge}
                        backgroundColor="transparent"
                        style={styles.actionIcon}
                    />
                    <Text style={[styles.actionText, styles.unsaveText]}>Unsave</Text>
                </TouchableOpacity>
            </View>
            {item.notes && (
                <View style={styles.notesContainer}>
                    <Text style={styles.notesLabel}>Notes:</Text>
                    <Text style={styles.notesText}>{item.notes}</Text>
                </View>
            )}
        </View>
    );

    const renderEmptyState = () => (
        <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🔖</Text>
            <ThemedText style={styles.emptyTitle}>No Saved Properties</ThemedText>
            <ThemedText style={styles.emptySubtitle}>
                Properties you save will appear here for easy access
            </ThemedText>
            <Button onPress={() => router.push('/properties')}>
                Browse Properties
            </Button>
        </View>
    );

    const renderAuthRequired = () => (
        <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🔒</Text>
            <ThemedText style={styles.emptyTitle}>Authentication Required</ThemedText>
            <ThemedText style={styles.emptySubtitle}>
                Please sign in to view and manage your saved properties
            </ThemedText>
        </View>
    );

    if (!oxyServices || !activeSessionId) {
        return (
            <ThemedView style={styles.container}>
                <Header options={{ title: 'Saved Properties', showBackButton: true }} />
                {renderAuthRequired()}
            </ThemedView>
        );
    }

    return (
        <ThemedView style={styles.container}>
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
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <ThemedText style={styles.modalTitle}>
                                Notes for {selectedProperty?.title}
                            </ThemedText>
                            <TouchableOpacity
                                onPress={() => setNotesModalVisible(false)}
                                style={styles.closeButton}
                            >
                                <IconButton
                                    name="close"
                                    size={20}
                                    color={colors.primaryDark_1}
                                    backgroundColor="transparent"
                                />
                            </TouchableOpacity>
                        </View>
                        <TextInput
                            style={styles.notesInput}
                            value={notesText}
                            onChangeText={setNotesText}
                            placeholder="Add your notes about this property..."
                            placeholderTextColor={colors.primaryDark_2}
                            multiline
                            numberOfLines={4}
                            textAlignVertical="top"
                        />
                        <View style={styles.modalActions}>
                            <Button
                                onPress={() => setNotesModalVisible(false)}
                                style={styles.cancelButton}
                            >
                                Cancel
                            </Button>
                            <Button
                                onPress={handleSaveNotes}
                                style={styles.saveButton}
                            >
                                Save Notes
                            </Button>
                        </View>
                    </View>
                </View>
            </Modal>
        </ThemedView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.primaryLight,
    },
    listContainer: {
        padding: 16,
    },
    propertyContainer: {
        marginBottom: 16,
        backgroundColor: colors.primaryLight,
        borderRadius: 12,
        overflow: 'hidden',
        shadowColor: colors.primaryDark,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
        borderWidth: 1,
        borderColor: colors.primaryLight_1,
    },
    propertyCard: {
        marginBottom: 0,
    },
    propertyActions: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderTopWidth: 1,
        borderTopColor: colors.primaryLight_1,
        gap: 12,
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: colors.primaryLight_1,
        flex: 1,
        justifyContent: 'center',
    },
    actionIcon: {
        marginRight: 6,
    },
    actionText: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.primaryColor,
    },
    unsaveButton: {
        backgroundColor: colors.primaryLight_2,
    },
    unsaveText: {
        color: colors.chatUnreadBadge,
    },
    notesContainer: {
        paddingHorizontal: 16,
        paddingBottom: 12,
        borderTopWidth: 1,
        borderTopColor: colors.primaryLight_1,
        backgroundColor: colors.primaryLight_1,
    },
    notesLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.primaryDark,
        marginBottom: 4,
    },
    notesText: {
        fontSize: 14,
        color: colors.primaryDark_1,
        lineHeight: 20,
    },
    emptyState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
        paddingVertical: 64,
    },
    emptyIcon: {
        fontSize: 64,
        marginBottom: 16,
    },
    emptyTitle: {
        fontSize: 20,
        fontWeight: '600',
        marginBottom: 8,
        textAlign: 'center',
        color: colors.primaryDark,
    },
    emptySubtitle: {
        fontSize: 16,
        textAlign: 'center',
        marginBottom: 24,
        opacity: 0.7,
        color: colors.primaryDark_1,
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
        backgroundColor: colors.overlay,
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalContent: {
        backgroundColor: colors.primaryLight,
        borderRadius: 12,
        padding: 20,
        margin: 20,
        width: '90%',
        maxWidth: 400,
        shadowColor: colors.primaryDark,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 5,
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: '600',
        flex: 1,
        color: colors.primaryDark,
    },
    closeButton: {
        padding: 4,
    },
    notesInput: {
        borderWidth: 1,
        borderColor: colors.primaryLight_1,
        borderRadius: 8,
        padding: 12,
        fontSize: 16,
        color: colors.primaryDark,
        backgroundColor: colors.primaryLight,
        minHeight: 100,
        marginBottom: 16,
    },
    modalActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 12,
    },
    cancelButton: {
        backgroundColor: colors.primaryLight_1,
    },
    saveButton: {
        backgroundColor: colors.primaryColor,
    },
}); 
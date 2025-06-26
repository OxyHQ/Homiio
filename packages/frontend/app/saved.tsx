import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Alert, TextInput, Modal } from 'react-native';
import { useOxy } from '@oxyhq/services';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
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
import { getPropertyTitle } from '@/utils/propertyUtils';
import useSavedProperties from '@/hooks/useSavedPropertiesRedux';
import { useFavorites } from '@/hooks/useFavorites';

interface SavedPropertyWithNotes extends Property {
    notes?: string;
    savedAt?: string;
}

export default function SavedPropertiesScreen() {
    const { t } = useTranslation();
    const { oxyServices, activeSessionId } = useOxy();

    // Use Redux-based saved properties hook
    const {
        properties: savedProperties = [],
        isLoading,
        isSaving,
        error,
        loadProperties,
        updateNotes,
        isPropertySaving,
        clearError
    } = useSavedProperties();

    // Use the same favorites hook that works on property cards
    const { toggleFavorite } = useFavorites();

    // Enhanced SEO for saved properties page
    useSEO({
        title: t('saved.title'),
        description: t('saved.emptyDescription'),
        keywords: 'saved properties, property favorites, housing bookmarks, property notes, real estate favorites',
        type: 'website'
    });

    const [selectedProperty, setSelectedProperty] = useState<SavedPropertyWithNotes | null>(null);
    const [notesModalVisible, setNotesModalVisible] = useState(false);
    const [notesText, setNotesText] = useState('');

    const handleUnsaveProperty = useCallback(async (property: SavedPropertyWithNotes) => {
        const propertyId = property._id || property.id || '';

        if (!propertyId) {
            Alert.alert('Error', 'Unable to unsave property - missing ID.');
            return;
        }

        try {
            await toggleFavorite(propertyId);
        } catch (error) {
            Alert.alert(
                'Error',
                `Failed to unsave property. ${error instanceof Error ? error.message : 'Please try again.'}`
            );
        }
    }, [toggleFavorite]);

    const handleEditNotes = useCallback((property: SavedPropertyWithNotes) => {
        setSelectedProperty(property);
        setNotesText(property.notes || '');
        setNotesModalVisible(true);
    }, []);

    const handleSaveNotes = useCallback(async () => {
        if (!selectedProperty) return;

        const propertyId = selectedProperty._id || selectedProperty.id || '';
        if (!propertyId) {
            Alert.alert('Error', 'Unable to update notes - missing property ID.');
            return;
        }

        try {
            await updateNotes(propertyId, notesText);
            setNotesModalVisible(false);
            setSelectedProperty(null);
            setNotesText('');
        } catch (error) {
            Alert.alert('Error', 'Failed to update notes. Please try again.');
        }
    }, [selectedProperty, notesText, updateNotes]);

    const handlePropertyPress = useCallback((property: SavedPropertyWithNotes) => {
        const propertyId = property._id || property.id || '';
        if (propertyId) {
            router.push(`/properties/${propertyId}`);
        }
    }, [router]);

    const handleRefresh = useCallback(async () => {
        clearError();
        await loadProperties();
    }, [clearError, loadProperties]);

    const renderPropertyItem = useCallback(({ item }: { item: SavedPropertyWithNotes }) => {
        const propertyId = item._id || item.id || '';
        const isProcessing = isPropertySaving(propertyId);

        return (
            <View style={[styles.cardContainer, isProcessing && styles.cardLoading]}>
                <PropertyCard
                    property={item as any}
                    variant="saved"
                    onPress={() => !isProcessing && handlePropertyPress(item)}
                    footerContent={
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
                                    color={isProcessing ? colors.COLOR_BLACK_LIGHT_4 : colors.primaryColor}
                                    onPress={() => !isProcessing && handleEditNotes(item)}
                                />
                                <Button
                                    onPress={() => !isProcessing && handleUnsaveProperty(item)}
                                    style={isProcessing ? styles.saveButtonDisabled : styles.saveButton}
                                    disabled={isProcessing}
                                >
                                    {isProcessing ? 'Processing...' : 'Unsave'}
                                </Button>
                            </View>
                        </View>
                    }
                />
                {isProcessing && (
                    <View style={styles.loadingOverlay}>
                        <ThemedText style={styles.loadingText}>
                            Processing...
                        </ThemedText>
                    </View>
                )}
            </View>
        );
    }, [isPropertySaving, handlePropertyPress, handleEditNotes, handleUnsaveProperty]);

    const keyExtractor = useCallback((item: SavedPropertyWithNotes) =>
        item._id || item.id || Math.random().toString(), []);

    const renderEmptyState = useCallback(() => (
        <View style={styles.emptyStateContainer}>
            <View style={styles.emptyStateContent}>
                <Text style={styles.emptyStateIcon}>🔖</Text>
                <ThemedText style={styles.emptyStateTitle}>No Saved Properties Yet</ThemedText>
                <ThemedText style={styles.emptyStateSubtitle}>
                    Save properties you love by tapping the bookmark icon. They'll appear here for easy access.
                </ThemedText>
                <Button
                    onPress={() => router.push('/properties')}
                    style={styles.browseButton}
                >
                    <ThemedText style={styles.browseButtonText}>Start Browsing</ThemedText>
                </Button>
            </View>
        </View>
    ), [router]);

    const renderAuthRequired = useCallback(() => (
        <View style={styles.emptyStateContainer}>
            <View style={styles.emptyStateContent}>
                <Text style={styles.emptyStateIcon}>🔒</Text>
                <ThemedText style={styles.emptyStateTitle}>Authentication Required</ThemedText>
                <ThemedText style={styles.emptyStateSubtitle}>
                    Please sign in to view and manage your saved properties
                </ThemedText>
            </View>
        </View>
    ), []);

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
                            onPress={handleRefresh}
                        />
                    ]
                }}
            />

            {/* Show loading spinner when initially loading or when global save/unsave operations are happening */}
            {isLoading && <LoadingTopSpinner showLoading={true} />}

            {error && (
                <View style={styles.errorContainer}>
                    <ThemedText style={styles.errorText}>
                        Failed to load saved properties. Please try again.
                        {error && ` Error: ${error}`}
                    </ThemedText>
                    <Button onPress={handleRefresh}>
                        Retry
                    </Button>
                </View>
            )}

            {!isLoading && !error && (
                <FlatList
                    data={savedProperties as SavedPropertyWithNotes[]}
                    renderItem={renderPropertyItem}
                    keyExtractor={keyExtractor}
                    contentContainerStyle={styles.listContainer}
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={renderEmptyState}
                    refreshing={isLoading}
                    onRefresh={handleRefresh}
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
                            Add a personal note for "{selectedProperty ? getPropertyTitle(selectedProperty as any) : ''}"
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
    cardLoading: {
        opacity: 0.5,
    },
    loadingOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    loadingText: {
        fontSize: 16,
        fontWeight: '600',
        color: 'white',
    },
    saveButtonDisabled: {
        backgroundColor: colors.COLOR_BLACK_LIGHT_4,
    },
}); 
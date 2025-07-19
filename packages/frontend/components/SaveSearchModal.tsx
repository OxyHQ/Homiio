import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    TouchableOpacity,
    TextInput,
    Switch,
    Alert,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { useSavedSearches } from '@/hooks/useSavedSearches';

// Type assertion for Ionicons compatibility
const IconComponent = Ionicons as any;

interface SaveSearchModalProps {
    visible: boolean;
    onClose: () => void;
    searchQuery: string;
    filters?: any;
    onSaveSuccess?: () => void;
}

export const SaveSearchModal: React.FC<SaveSearchModalProps> = ({
    visible,
    onClose,
    searchQuery,
    filters,
    onSaveSuccess,
}) => {
    const { t } = useTranslation();
    const { saveSearch, isSaving, searchExists } = useSavedSearches();

    const [searchName, setSearchName] = useState('');
    const [notificationsEnabled, setNotificationsEnabled] = useState(false);
    const [error, setError] = useState('');

    const handleSave = async () => {
        setError('');

        if (!searchName.trim()) {
            setError('Search name is required');
            return;
        }

        if (searchExists(searchName.trim())) {
            setError('A search with this name already exists');
            return;
        }

        const success = await saveSearch(
            searchName.trim(),
            searchQuery,
            filters,
            notificationsEnabled
        );

        if (success) {
            handleClose();
            onSaveSuccess?.();
        }
    };

    const handleClose = () => {
        setSearchName('');
        setNotificationsEnabled(false);
        setError('');
        onClose();
    };

    const formatSearchQuery = () => {
        if (!searchQuery) return 'Current search';
        return searchQuery.length > 30 ? `${searchQuery.slice(0, 30)}...` : searchQuery;
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={handleClose}
        >
            <View style={styles.modalOverlay}>
                <View style={styles.modalContent}>
                    {/* Header */}
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>{t('search.saveSearch')}</Text>
                        <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
                            <IconComponent name="close" size={24} color={colors.COLOR_BLACK_LIGHT_3} />
                        </TouchableOpacity>
                    </View>

                    {/* Search Preview */}
                    <View style={styles.searchPreview}>
                        <View style={styles.searchPreviewHeader}>
                            <IconComponent name="search" size={16} color={colors.primaryColor} />
                            <Text style={styles.searchPreviewLabel}>{t('search.searchQuery')}</Text>
                        </View>
                        <Text style={styles.searchPreviewText}>{formatSearchQuery()}</Text>
                        {filters && Object.keys(filters).length > 0 && (
                            <Text style={styles.filtersText}>
                                {t('search.withFilters')} ({Object.keys(filters).length})
                            </Text>
                        )}
                    </View>

                    {/* Search Name Input */}
                    <View style={styles.inputSection}>
                        <Text style={styles.inputLabel}>{t('search.searchName')}</Text>
                        <TextInput
                            style={[styles.textInput, error ? styles.textInputError : null]}
                            placeholder={t('search.searchNamePlaceholder')}
                            value={searchName}
                            onChangeText={(text) => {
                                setSearchName(text);
                                if (error) setError('');
                            }}
                            maxLength={50}
                            autoFocus
                        />
                        {error ? <Text style={styles.errorText}>{error}</Text> : null}
                    </View>

                    {/* Notifications Toggle */}
                    <View style={styles.toggleSection}>
                        <View style={styles.toggleContent}>
                            <View style={styles.toggleTextContainer}>
                                <Text style={styles.toggleTitle}>{t('search.enableNotifications')}</Text>
                                <Text style={styles.toggleDescription}>
                                    {t('search.notificationsDescription')}
                                </Text>
                            </View>
                            <Switch
                                value={notificationsEnabled}
                                onValueChange={setNotificationsEnabled}
                                trackColor={{ false: colors.COLOR_BLACK_LIGHT_5, true: colors.primaryColor + '40' }}
                                thumbColor={notificationsEnabled ? colors.primaryColor : '#ffffff'}
                            />
                        </View>
                    </View>

                    {/* Actions */}
                    <View style={styles.actionButtons}>
                        <TouchableOpacity
                            style={styles.cancelButton}
                            onPress={handleClose}
                            disabled={isSaving}
                        >
                            <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
                            onPress={handleSave}
                            disabled={isSaving || !searchName.trim()}
                        >
                            {isSaving && (
                                <IconComponent name="refresh" size={16} color="white" style={styles.loadingIcon} />
                            )}
                            <Text style={styles.saveButtonText}>
                                {isSaving ? t('common.saving') : t('common.save')}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    modalContent: {
        backgroundColor: 'white',
        borderRadius: 16,
        padding: 24,
        width: '100%',
        maxWidth: 400,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 16,
        elevation: 8,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: '600',
        color: colors.primaryDark,
    },
    closeButton: {
        padding: 4,
    },
    searchPreview: {
        backgroundColor: colors.primaryLight,
        padding: 16,
        borderRadius: 12,
        marginBottom: 20,
        borderWidth: 1,
        borderColor: colors.primaryColor + '20',
    },
    searchPreviewHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    searchPreviewLabel: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.primaryColor,
        marginLeft: 6,
    },
    searchPreviewText: {
        fontSize: 16,
        fontWeight: '500',
        color: colors.primaryDark,
        marginBottom: 4,
    },
    filtersText: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_3,
        fontStyle: 'italic',
    },
    inputSection: {
        marginBottom: 20,
    },
    inputLabel: {
        fontSize: 16,
        fontWeight: '500',
        color: colors.primaryDark,
        marginBottom: 8,
    },
    textInput: {
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_5,
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        fontSize: 16,
        color: colors.primaryDark,
        backgroundColor: '#ffffff',
    },
    textInputError: {
        borderColor: '#EF4444',
    },
    errorText: {
        color: '#EF4444',
        fontSize: 14,
        marginTop: 6,
    },
    toggleSection: {
        marginBottom: 24,
    },
    toggleContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    toggleTextContainer: {
        flex: 1,
        marginRight: 16,
    },
    toggleTitle: {
        fontSize: 16,
        fontWeight: '500',
        color: colors.primaryDark,
        marginBottom: 4,
    },
    toggleDescription: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        lineHeight: 18,
    },
    actionButtons: {
        flexDirection: 'row',
        gap: 12,
    },
    cancelButton: {
        flex: 1,
        paddingVertical: 14,
        paddingHorizontal: 20,
        borderRadius: 25,
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_5,
        alignItems: 'center',
    },
    cancelButtonText: {
        fontSize: 16,
        fontWeight: '500',
        color: colors.COLOR_BLACK_LIGHT_3,
        fontFamily: 'Phudu',
    },
    saveButton: {
        flex: 1,
        paddingVertical: 14,
        paddingHorizontal: 20,
        borderRadius: 25,
        backgroundColor: colors.primaryColor,
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 8,
    },
    saveButtonDisabled: {
        backgroundColor: colors.COLOR_BLACK_LIGHT_4,
    },
    saveButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: 'white',
        fontFamily: 'Phudu',
    },
    loadingIcon: {
        marginRight: 4,
    },
}); 
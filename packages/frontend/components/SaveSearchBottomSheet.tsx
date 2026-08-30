import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TextInput, Switch, TouchableOpacity } from 'react-native';

import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { colors } from '@/styles/colors';
import { useSavedSearches } from '@/hooks/useSavedSearches';
import type { SavedSearchFilters } from '@/store/savedSearchesStore';
import type { LocationSelection } from '@homiio/shared-types';

interface SaveSearchBottomSheetProps {
    defaultName?: string;
    /** The FREE-TEXT dimension, which is usually empty for a place search. */
    query: string;
    /**
     * The geographic scope, stored alongside the row so reopening it resolves
     * by IDENTITY rather than re-geocoding its own name. A legacy row has none,
     * which is what the lazy confirmed migration keys on.
     */
    location?: LocationSelection | null;
    filters?: SavedSearchFilters;
    onClose: () => void;
    onSaved?: () => void;
}

export const SaveSearchBottomSheet: React.FC<SaveSearchBottomSheetProps> = ({
    defaultName,
    query,
    location = null,
    filters,
    onClose,
    onSaved,
}) => {
    const { t } = useTranslation();
    const { saveSearch, isAuthenticated } = useSavedSearches();

    const [name, setName] = useState(defaultName || query || '');
    const [notificationsEnabled, setNotificationsEnabled] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const handleSave = useCallback(async () => {
        if (!isAuthenticated) return;
        // A name, and SOMETHING to search: a place, free text, or both. This
        // used to require non-empty `query`, which was the location's label —
        // so once `query` became the free-text dimension (usually empty for a
        // place search) that guard would have silently refused every save of a
        // city, with no message, by returning early.
        if (!name.trim() || (!location && !query.trim())) return;
        try {
            setSubmitting(true);
            const ok = await saveSearch(name.trim(), query.trim(), filters, notificationsEnabled, location);
            if (ok) {
                onSaved?.();
                onClose();
            }
        } finally {
            setSubmitting(false);
        }
    }, [isAuthenticated, name, query, location, filters, notificationsEnabled, saveSearch, onClose, onSaved]);

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>{t('search.save.title')}</Text>
                <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                    <Ionicons name="close" size={22} color={colors.COLOR_BLACK_LIGHT_4} />
                </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t('common.name')}</Text>
                <TextInput
                    style={styles.input}
                    placeholder={t('search.save.namePlaceholder')}
                    value={name}
                    onChangeText={setName}
                    maxLength={60}
                />
            </View>

            <View style={styles.row}>
                <Text style={styles.toggleLabel}>{t('search.save.enableNotifications')}</Text>
                <Switch
                    value={notificationsEnabled}
                    onValueChange={setNotificationsEnabled}
                    trackColor={{ false: colors.COLOR_BLACK_LIGHT_5, true: colors.primaryColor + '40' }}
                    thumbColor={notificationsEnabled ? colors.primaryColor : colors.white}
                />
            </View>

            <View style={styles.actions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
                    <Text style={styles.cancelText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.saveBtn, (!name.trim() || !query.trim()) && styles.saveBtnDisabled]}
                    disabled={!name.trim() || !query.trim() || submitting}
                    onPress={handleSave}
                >
                    <Text style={styles.saveText}>{submitting ? t('common.saving') : t('common.save')}</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 20,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    title: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
    },
    closeBtn: {
        padding: 4,
    },
    inputGroup: {
        marginTop: 8,
        marginBottom: 14,
    },
    inputLabel: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_4,
        marginBottom: 6,
    },
    input: {
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_5,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 16,
        backgroundColor: colors.primaryLight,
        color: colors.COLOR_BLACK,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
    },
    toggleLabel: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_4,
    },
    actions: {
        flexDirection: 'row',
        gap: 10,
    },
    cancelBtn: {
        flex: 1,
        paddingVertical: 10,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_5,
        alignItems: 'center',
    },
    cancelText: {
        color: colors.COLOR_BLACK_LIGHT_4,
        fontWeight: '600',
    },
    saveBtn: {
        flex: 1,
        paddingVertical: 10,
        borderRadius: 10,
        backgroundColor: colors.primaryColor,
        alignItems: 'center',
    },
    saveBtnDisabled: {
        backgroundColor: colors.COLOR_BLACK_LIGHT_5,
    },
    saveText: {
        color: colors.primaryForeground,
        fontWeight: '600',
    },
});



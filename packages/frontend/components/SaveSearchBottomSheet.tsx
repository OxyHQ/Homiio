import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TextInput, Switch, TouchableOpacity } from 'react-native';
import { BottomSheetView } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors } from '@/styles/colors';
import { useSavedSearches } from '@/hooks/useSavedSearches';

interface SaveSearchBottomSheetProps {
    defaultName?: string;
    query: string;
    filters?: Record<string, any>;
    onClose: () => void;
    onSaved?: () => void;
}

export const SaveSearchBottomSheet: React.FC<SaveSearchBottomSheetProps> = ({
    defaultName,
    query,
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
        if (!name.trim() || !query.trim()) return;
        try {
            setSubmitting(true);
            const ok = await saveSearch(name.trim(), query.trim(), filters, notificationsEnabled);
            if (ok) {
                onSaved?.();
                onClose();
            }
        } finally {
            setSubmitting(false);
        }
    }, [isAuthenticated, name, query, filters, notificationsEnabled, saveSearch, onClose, onSaved]);

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>{t('Save this search')}</Text>
                <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                    <Ionicons name="close" size={22} color={colors.COLOR_BLACK_LIGHT_4} />
                </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t('Name')}</Text>
                <TextInput
                    style={styles.input}
                    placeholder={t('Give your search a name')}
                    value={name}
                    onChangeText={setName}
                    maxLength={60}
                />
            </View>

            <View style={styles.row}>
                <Text style={styles.toggleLabel}>{t('Enable notifications')}</Text>
                <Switch
                    value={notificationsEnabled}
                    onValueChange={setNotificationsEnabled}
                    trackColor={{ false: colors.COLOR_BLACK_LIGHT_5, true: colors.primaryColor + '40' }}
                    thumbColor={notificationsEnabled ? colors.primaryColor : '#ffffff'}
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
                    <Text style={styles.saveText}>{submitting ? t('Saving...') : t('common.save')}</Text>
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
        color: 'white',
        fontWeight: '600',
    },
});



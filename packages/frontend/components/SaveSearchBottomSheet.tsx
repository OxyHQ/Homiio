import React, { useState, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, CloseButton } from '@oxy.so/bloom/button';
import { Item } from '@oxy.so/bloom/item';
import { Switch } from '@oxy.so/bloom/switch';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { H3 } from '@oxy.so/bloom/typography';

import { spacing } from '@/constants/styles';
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

    // A name, and SOMETHING to search: a place, free text, or both. The button
    // used to require non-empty `query`, which is the free-text dimension and
    // empty for every place search — so saving a city was impossible from here.
    const canSave = name.trim().length > 0 && (location !== null || query.trim().length > 0);

    const handleSave = useCallback(async () => {
        if (!isAuthenticated || !canSave) return;
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
    }, [isAuthenticated, canSave, name, query, location, filters, notificationsEnabled, saveSearch, onClose, onSaved]);

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <H3>{t('search.save.title')}</H3>
                <CloseButton onPress={onClose} accessibilityLabel={t('common.close')} />
            </View>

            <TextFieldInput
                label={t('common.name')}
                placeholder={t('search.save.namePlaceholder')}
                value={name}
                onChangeText={setName}
                maxLength={60}
            />

            <Item
                title={t('search.save.enableNotifications')}
                trailing={
                    <Switch
                        value={notificationsEnabled}
                        onValueChange={setNotificationsEnabled}
                        accessibilityLabel={t('search.save.enableNotifications')}
                    />
                }
            />

            <View style={styles.actions}>
                <Button variant="secondary" size="medium" onPress={onClose} style={styles.action}>
                    {t('common.cancel')}
                </Button>
                <Button
                    variant="primary"
                    size="medium"
                    disabled={!canSave || submitting}
                    loading={submitting}
                    onPress={handleSave}
                    style={styles.action}
                >
                    {submitting ? t('common.saving') : t('common.save')}
                </Button>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: spacing.xl,
        gap: spacing.lg,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    actions: {
        flexDirection: 'row',
        gap: spacing.md,
    },
    action: {
        flex: 1,
    },
});

import React, { useState, useCallback } from 'react';
import {
    View,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Switch,
    Alert,
    Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNotifications } from '@/context/NotificationContext';
import { ThemedText } from '@/components/ThemedText';
import { colors } from '@/styles/colors';
import { toast } from 'sonner';
import {
    createPropertyNotification,
    createMessageNotification,
    createReminderNotification,
    createRepeatingNotification,
} from '@/utils/notifications';

export default function NotificationSettingsScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const {
        preferences,
        hasPermission,
        updatePreferences,
        requestPermissions,
        createLocalNotification,
        clearBadgeCount,
    } = useNotifications();

    const [isUpdating, setIsUpdating] = useState(false);

    // Handle preference change
    const handlePreferenceChange = useCallback(async (
        key: keyof typeof preferences,
        value: boolean
    ) => {
        try {
            setIsUpdating(true);
            await updatePreferences({ [key]: value });
            toast.success(t('notification.settings.updated', 'Settings updated'));
        } catch (error) {
            toast.error(t('notification.settings.error', 'Failed to update settings'));
        } finally {
            setIsUpdating(false);
        }
    }, [updatePreferences, t]);

    // Handle request permissions
    const handleRequestPermissions = useCallback(async () => {
        try {
            const granted = await requestPermissions();
            if (granted) {
                toast.success(t('notification.permissions.granted', 'Notification permissions granted'));
            } else {
                toast.error(t('notification.permissions.denied', 'Notification permissions denied'));
            }
        } catch (error) {
            toast.error(t('notification.permissions.error', 'Failed to request permissions'));
        }
    }, [requestPermissions, t]);

    // Test notification functions
    const testPropertyNotification = useCallback(async () => {
        try {
            await createPropertyNotification(
                'test-property-id',
                'New Property Available',
                'A new property matching your search criteria is now available.',
                { test: true }
            );
            toast.success(t('notification.test.property.success', 'Property notification sent'));
        } catch (error) {
            toast.error(t('notification.test.error', 'Failed to send test notification'));
        }
    }, [t]);

    const testMessageNotification = useCallback(async () => {
        try {
            await createMessageNotification(
                'test-message-id',
                'John Doe',
                'Hi! I\'m interested in your property.',
                { test: true }
            );
            toast.success(t('notification.test.message.success', 'Message notification sent'));
        } catch (error) {
            toast.error(t('notification.test.error', 'Failed to send test notification'));
        }
    }, [t]);

    const testReminderNotification = useCallback(async () => {
        try {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(10, 0, 0, 0);

            await createReminderNotification(
                'Property Viewing Reminder',
                'You have a property viewing scheduled for tomorrow at 10:00 AM.',
                tomorrow,
                { test: true }
            );
            toast.success(t('notification.test.reminder.success', 'Reminder notification scheduled'));
        } catch (error) {
            toast.error(t('notification.test.error', 'Failed to send test notification'));
        }
    }, [t]);

    const testRepeatingNotification = useCallback(async () => {
        try {
            await createRepeatingNotification(
                'Daily Property Update',
                'Check out the latest properties in your area!',
                'day',
                { test: true }
            );
            toast.success(t('notification.test.repeating.success', 'Repeating notification scheduled'));
        } catch (error) {
            toast.error(t('notification.test.error', 'Failed to send test notification'));
        }
    }, [t]);

    // Clear all notifications
    const handleClearAllNotifications = useCallback(async () => {
        Alert.alert(
            t('notification.clearAll.title', 'Clear All Notifications'),
            t('notification.clearAll.message', 'This will clear all notifications and reset the badge count. This action cannot be undone.'),
            [
                { text: t('common.cancel', 'Cancel'), style: 'cancel' },
                {
                    text: t('common.clear', 'Clear All'),
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await clearBadgeCount();
                            toast.success(t('notification.clearAll.success', 'All notifications cleared'));
                        } catch (error) {
                            toast.error(t('notification.clearAll.error', 'Failed to clear notifications'));
                        }
                    },
                },
            ]
        );
    }, [clearBadgeCount, t]);

    // Render preference item
    const renderPreferenceItem = useCallback((
        key: keyof typeof preferences,
        title: string,
        description: string,
        icon: string
    ) => (
        <View style={styles.preferenceItem}>
            <View style={styles.preferenceHeader}>
                <View style={styles.preferenceIcon}>
                    <Ionicons name={icon as any} size={20} color={colors.primary} />
                </View>
                <View style={styles.preferenceContent}>
                    <ThemedText style={styles.preferenceTitle}>{title}</ThemedText>
                    <ThemedText style={styles.preferenceDescription}>{description}</ThemedText>
                </View>
                <Switch
                    value={preferences[key]}
                    onValueChange={(value) => handlePreferenceChange(key, value)}
                    trackColor={{ false: colors.border, true: colors.primaryLight }}
                    thumbColor={preferences[key] ? colors.primary : colors.textSecondary}
                    disabled={isUpdating}
                />
            </View>
        </View>
    ), [preferences, handlePreferenceChange, isUpdating]);

    // Render test button
    const renderTestButton = useCallback((
        title: string,
        onPress: () => void,
        icon: string
    ) => (
        <TouchableOpacity style={styles.testButton} onPress={onPress}>
            <Ionicons name={icon as any} size={20} color={colors.primary} />
            <ThemedText style={styles.testButtonText}>{title}</ThemedText>
        </TouchableOpacity>
    ), []);

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color={colors.text} />
                </TouchableOpacity>
                <ThemedText style={styles.headerTitle}>
                    {t('notification.settings.title', 'Notification Settings')}
                </ThemedText>
                <View style={styles.headerSpacer} />
            </View>

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                {/* Permission Status */}
                <View style={styles.section}>
                    <ThemedText style={styles.sectionTitle}>
                        {t('notification.settings.permissions', 'Permissions')}
                    </ThemedText>
                    <View style={styles.permissionStatus}>
                        <View style={styles.permissionInfo}>
                            <Ionicons
                                name={hasPermission ? "checkmark-circle" : "close-circle"}
                                size={24}
                                color={hasPermission ? colors.success : colors.error}
                            />
                            <View style={styles.permissionText}>
                                <ThemedText style={styles.permissionTitle}>
                                    {hasPermission
                                        ? t('notification.permissions.enabled', 'Notifications Enabled')
                                        : t('notification.permissions.disabled', 'Notifications Disabled')
                                    }
                                </ThemedText>
                                <ThemedText style={styles.permissionDescription}>
                                    {hasPermission
                                        ? t('notification.permissions.enabled.description', 'You will receive notifications for enabled categories.')
                                        : t('notification.permissions.disabled.description', 'Enable notifications to receive updates about properties, messages, and more.')
                                    }
                                </ThemedText>
                            </View>
                        </View>
                        {!hasPermission && (
                            <TouchableOpacity onPress={handleRequestPermissions} style={styles.enableButton}>
                                <ThemedText style={styles.enableButtonText}>
                                    {t('notification.permissions.enable', 'Enable Notifications')}
                                </ThemedText>
                            </TouchableOpacity>
                        )}
                    </View>
                </View>

                {/* Notification Categories */}
                <View style={styles.section}>
                    <ThemedText style={styles.sectionTitle}>
                        {t('notification.settings.categories', 'Notification Categories')}
                    </ThemedText>
                    {renderPreferenceItem(
                        'property',
                        t('notification.settings.property.title', 'Property Notifications'),
                        t('notification.settings.property.description', 'New properties, price changes, and viewing reminders'),
                        'home-outline'
                    )}
                    {renderPreferenceItem(
                        'message',
                        t('notification.settings.message.title', 'Message Notifications'),
                        t('notification.settings.message.description', 'New messages from agents, landlords, and other users'),
                        'chatbubble-outline'
                    )}
                    {renderPreferenceItem(
                        'contract',
                        t('notification.settings.contract.title', 'Contract Notifications'),
                        t('notification.settings.contract.description', 'Contract updates, signatures, and important deadlines'),
                        'document-text-outline'
                    )}
                    {renderPreferenceItem(
                        'payment',
                        t('notification.settings.payment.title', 'Payment Notifications'),
                        t('notification.settings.payment.description', 'Payment confirmations, reminders, and receipts'),
                        'card-outline'
                    )}
                    {renderPreferenceItem(
                        'reminder',
                        t('notification.settings.reminder.title', 'Reminder Notifications'),
                        t('notification.settings.reminder.description', 'Viewing reminders, application deadlines, and follow-ups'),
                        'alarm-outline'
                    )}
                    {renderPreferenceItem(
                        'system',
                        t('notification.settings.system.title', 'System Notifications'),
                        t('notification.settings.system.description', 'App updates, maintenance, and important announcements'),
                        'settings-outline'
                    )}
                    {renderPreferenceItem(
                        'marketing',
                        t('notification.settings.marketing.title', 'Marketing Notifications'),
                        t('notification.settings.marketing.description', 'Promotional offers, newsletters, and special deals'),
                        'megaphone-outline'
                    )}
                </View>

                {/* Notification Behavior */}
                <View style={styles.section}>
                    <ThemedText style={styles.sectionTitle}>
                        {t('notification.settings.behavior', 'Notification Behavior')}
                    </ThemedText>
                    {renderPreferenceItem(
                        'sound',
                        t('notification.settings.sound.title', 'Sound'),
                        t('notification.settings.sound.description', 'Play sound when notifications arrive'),
                        'volume-high-outline'
                    )}
                    {renderPreferenceItem(
                        'badge',
                        t('notification.settings.badge.title', 'Badge Count'),
                        t('notification.settings.badge.description', 'Show unread count on app icon'),
                        'notifications-outline'
                    )}
                    {renderPreferenceItem(
                        'push',
                        t('notification.settings.push.title', 'Push Notifications'),
                        t('notification.settings.push.description', 'Receive notifications even when app is closed'),
                        'phone-portrait-outline'
                    )}
                </View>

                {/* Test Notifications */}
                {hasPermission && (
                    <View style={styles.section}>
                        <ThemedText style={styles.sectionTitle}>
                            {t('notification.settings.test', 'Test Notifications')}
                        </ThemedText>
                        <ThemedText style={styles.sectionDescription}>
                            {t('notification.settings.test.description', 'Send test notifications to verify your settings are working correctly.')}
                        </ThemedText>
                        <View style={styles.testButtons}>
                            {renderTestButton(
                                t('notification.test.property', 'Test Property'),
                                testPropertyNotification,
                                'home-outline'
                            )}
                            {renderTestButton(
                                t('notification.test.message', 'Test Message'),
                                testMessageNotification,
                                'chatbubble-outline'
                            )}
                            {renderTestButton(
                                t('notification.test.reminder', 'Test Reminder'),
                                testReminderNotification,
                                'alarm-outline'
                            )}
                            {renderTestButton(
                                t('notification.test.repeating', 'Test Repeating'),
                                testRepeatingNotification,
                                'repeat-outline'
                            )}
                        </View>
                    </View>
                )}

                {/* Clear All */}
                <View style={styles.section}>
                    <ThemedText style={styles.sectionTitle}>
                        {t('notification.settings.manage', 'Manage Notifications')}
                    </ThemedText>
                    <TouchableOpacity onPress={handleClearAllNotifications} style={styles.clearAllButton}>
                        <Ionicons name="trash-outline" size={20} color={colors.error} />
                        <ThemedText style={styles.clearAllButtonText}>
                            {t('notification.settings.clearAll', 'Clear All Notifications')}
                        </ThemedText>
                    </TouchableOpacity>
                </View>

                {/* Platform-specific info */}
                {Platform.OS === 'ios' && (
                    <View style={styles.section}>
                        <ThemedText style={styles.sectionTitle}>
                            {t('notification.settings.ios.title', 'iOS Settings')}
                        </ThemedText>
                        <View style={styles.iosInfo}>
                            <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} />
                            <ThemedText style={styles.iosInfoText}>
                                {t('notification.settings.ios.description', 'For more granular control, you can also manage notification settings in your device\'s Settings app under Notifications > Homiio.')}
                            </ThemedText>
                        </View>
                    </View>
                )}

                {Platform.OS === 'android' && (
                    <View style={styles.section}>
                        <ThemedText style={styles.sectionTitle}>
                            {t('notification.settings.android.title', 'Android Settings')}
                        </ThemedText>
                        <View style={styles.androidInfo}>
                            <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} />
                            <ThemedText style={styles.androidInfoText}>
                                {t('notification.settings.android.description', 'You can manage notification channels and advanced settings in your device\'s Settings app under Apps > Homiio > Notifications.')}
                            </ThemedText>
                        </View>
                    </View>
                )}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    backButton: {
        padding: 8,
    },
    headerTitle: {
        fontSize: 18,
        fontFamily: 'Cereal-Bold',
        color: colors.text,
    },
    headerSpacer: {
        width: 40,
    },
    content: {
        flex: 1,
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 16,
        fontFamily: 'Cereal-Bold',
        color: colors.text,
        marginHorizontal: 16,
        marginBottom: 12,
    },
    sectionDescription: {
        fontSize: 14,
        fontFamily: 'Inter-Regular',
        color: colors.textSecondary,
        marginHorizontal: 16,
        marginBottom: 16,
        lineHeight: 20,
    },
    permissionStatus: {
        marginHorizontal: 16,
        padding: 16,
        backgroundColor: colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
    },
    permissionInfo: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 12,
    },
    permissionText: {
        flex: 1,
        marginLeft: 12,
    },
    permissionTitle: {
        fontSize: 16,
        fontFamily: 'Cereal-Medium',
        color: colors.text,
        marginBottom: 4,
    },
    permissionDescription: {
        fontSize: 14,
        fontFamily: 'Inter-Regular',
        color: colors.textSecondary,
        lineHeight: 20,
    },
    enableButton: {
        backgroundColor: colors.primary,
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 8,
        alignSelf: 'flex-start',
    },
    enableButtonText: {
        fontSize: 14,
        fontFamily: 'Inter-Medium',
        color: colors.white,
    },
    preferenceItem: {
        marginHorizontal: 16,
        marginBottom: 8,
    },
    preferenceHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        backgroundColor: colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
    },
    preferenceIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: colors.primaryLight,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    preferenceContent: {
        flex: 1,
    },
    preferenceTitle: {
        fontSize: 16,
        fontFamily: 'Cereal-Medium',
        color: colors.text,
        marginBottom: 4,
    },
    preferenceDescription: {
        fontSize: 14,
        fontFamily: 'Inter-Regular',
        color: colors.textSecondary,
        lineHeight: 18,
    },
    testButtons: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginHorizontal: 16,
        gap: 8,
    },
    testButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 12,
        backgroundColor: colors.primaryLight,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.primary,
    },
    testButtonText: {
        fontSize: 14,
        fontFamily: 'Inter-Medium',
        color: colors.primary,
        marginLeft: 6,
    },
    clearAllButton: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 16,
        padding: 16,
        backgroundColor: colors.errorLight,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.error,
    },
    clearAllButtonText: {
        fontSize: 16,
        fontFamily: 'Inter-Medium',
        color: colors.error,
        marginLeft: 8,
    },
    iosInfo: {
        flexDirection: 'row',
        marginHorizontal: 16,
        padding: 16,
        backgroundColor: colors.infoLight,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.info,
    },
    iosInfoText: {
        flex: 1,
        fontSize: 14,
        fontFamily: 'Inter-Regular',
        color: colors.textSecondary,
        marginLeft: 8,
        lineHeight: 20,
    },
    androidInfo: {
        flexDirection: 'row',
        marginHorizontal: 16,
        padding: 16,
        backgroundColor: colors.infoLight,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.info,
    },
    androidInfoText: {
        flex: 1,
        fontSize: 14,
        fontFamily: 'Inter-Regular',
        color: colors.textSecondary,
        marginLeft: 8,
        lineHeight: 20,
    },
});

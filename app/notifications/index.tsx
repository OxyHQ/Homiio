import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/styles/colors';
import { useRouter } from 'expo-router';
import { IconButton } from '@/components/IconButton';
import { NotificationItem } from '@/components/NotificationItem';

export default function NotificationsScreen() {
    const { t } = useTranslation();
    const router = useRouter();

    const notifications = [
        {
            id: '1',
            type: 'message',
            title: 'New Message',
            description: 'You have a new message from your landlord',
            time: '2 hours ago',
            read: false,
        },
        {
            id: '2',
            type: 'contract',
            title: 'Contract Update',
            description: 'Your rental agreement has been updated',
            time: '1 day ago',
            read: true,
        },
        {
            id: '3',
            type: 'payment',
            title: 'Payment Reminder',
            description: 'Your rent payment is due in 3 days',
            time: '2 days ago',
            read: true,
        },
    ];

    return (
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
            <ScrollView style={styles.container}>
                <View style={styles.header}>
                    <Text style={styles.title}>{t("Notifications")}</Text>
                    <IconButton
                        name="settings-outline"
                        color={colors.primaryDark}
                        backgroundColor="transparent"
                        onPress={() => router.push('/settings')}
                    />
                </View>

                <View style={styles.notificationsContainer}>
                    {notifications.map((notification) => (
                        <NotificationItem
                            key={notification.id}
                            type={notification.type}
                            title={t(notification.title)}
                            description={t(notification.description)}
                            time={notification.time}
                            read={notification.read}
                            onPress={() => {
                                // Handle notification press
                            }}
                        />
                    ))}
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.primaryLight,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 20,
        backgroundColor: colors.primaryLight,
        borderBottomWidth: 1,
        borderBottomColor: colors.primaryLight_1,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: colors.primaryDark,
    },
    notificationsContainer: {
        padding: 16,
    },
}); 
import React, { useState, Dispatch, SetStateAction } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/styles/colors';
import { useRouter } from 'expo-router';
import { ListItem } from '@/components/ListItem';

type RouteSettingItem = {
    id: string;
    title: string;
    icon: string;
    route: string;
    toggle?: never;
    value?: never;
    onToggle?: never;
};

type ToggleSettingItem = {
    id: string;
    title: string;
    icon: string;
    route?: never;
    toggle: true;
    value: boolean;
    onToggle: Dispatch<SetStateAction<boolean>>;
};

type SettingItem = RouteSettingItem | ToggleSettingItem;

type SettingsSection = {
    title: string;
    items: SettingItem[];
};

export default function SettingsScreen() {
    const { t } = useTranslation();
    const router = useRouter();

    const [notificationsEnabled, setNotificationsEnabled] = useState(true);
    const [darkModeEnabled, setDarkModeEnabled] = useState(false);
    const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(true);

    const settingsSections: SettingsSection[] = [
        {
            title: 'Account',
            items: [
                { id: '1', title: 'Personal Information', icon: 'person-outline', route: '/settings/personal' },
                { id: '2', title: 'Security', icon: 'shield-outline', route: '/settings/security' },
                { id: '3', title: 'Payment Methods', icon: 'card-outline', route: '/settings/payment' },
            ],
        },
        {
            title: 'Preferences',
            items: [
                {
                    id: '4',
                    title: 'Push Notifications',
                    icon: 'notifications-outline',
                    toggle: true,
                    value: notificationsEnabled,
                    onToggle: setNotificationsEnabled,
                },
                {
                    id: '5',
                    title: 'Dark Mode',
                    icon: 'moon-outline',
                    toggle: true,
                    value: darkModeEnabled,
                    onToggle: setDarkModeEnabled,
                },
                {
                    id: '6',
                    title: 'Email Notifications',
                    icon: 'mail-outline',
                    toggle: true,
                    value: emailNotificationsEnabled,
                    onToggle: setEmailNotificationsEnabled,
                },
            ],
        },
        {
            title: 'Support',
            items: [
                { id: '7', title: 'Help Center', icon: 'help-circle-outline', route: '/settings/help' },
                { id: '8', title: 'Contact Us', icon: 'chatbubble-outline', route: '/settings/contact' },
                { id: '9', title: 'Terms of Service', icon: 'document-text-outline', route: '/settings/terms' },
                { id: '10', title: 'Privacy Policy', icon: 'lock-closed-outline', route: '/settings/privacy' },
            ],
        },
    ];

    return (
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
            <ScrollView style={styles.container}>
                <View style={styles.header}>
                    <Text style={styles.title}>{t("Settings")}</Text>
                </View>

                {settingsSections.map((section) => (
                    <View key={section.title} style={styles.section}>
                        <Text style={styles.sectionTitle}>{t(section.title)}</Text>
                        <View style={styles.sectionContent}>
                            {section.items.map((item) => (
                                <ListItem
                                    key={item.id}
                                    title={t(item.title)}
                                    icon={item.icon}
                                    onPress={item.route ? () => router.push(item.route) : undefined}
                                    rightElement={
                                        item.toggle && (
                                            <Switch
                                                value={item.value}
                                                onValueChange={item.onToggle}
                                                trackColor={{ false: colors.primaryLight_1, true: colors.primaryColor }}
                                                thumbColor={colors.primaryLight}
                                            />
                                        )
                                    }
                                    showChevron={!item.toggle}
                                />
                            ))}
                        </View>
                    </View>
                ))}

                <View style={styles.versionContainer}>
                    <Text style={styles.versionText}>Version 1.0.0</Text>
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
    section: {
        marginTop: 24,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryDark_1,
        marginBottom: 8,
        paddingHorizontal: 16,
    },
    sectionContent: {
        backgroundColor: colors.primaryLight,
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: colors.primaryLight_1,
    },
    versionContainer: {
        padding: 24,
        alignItems: 'center',
    },
    versionText: {
        fontSize: 14,
        color: colors.primaryDark_1,
    },
}); 
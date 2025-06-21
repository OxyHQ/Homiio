import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/styles/colors';
import { useRouter } from 'expo-router';
import { IconButton } from '@/components/IconButton';
import { ListItem } from '@/components/ListItem';

export default function ProfileScreen() {
    const { t } = useTranslation();
    const router = useRouter();

    const profileSections = [
        { id: '1', title: 'profile.myProperties', icon: 'home-outline' as const, route: '/properties/my' },
        { id: '2', title: 'profile.savedProperties', icon: 'bookmark-outline' as const, route: '/properties/saved' },
        { id: '3', title: 'profile.myContracts', icon: 'document-text-outline' as const, route: '/contracts' },
        { id: '4', title: 'profile.trustScore', icon: 'shield-checkmark-outline' as const, route: '/profile/trust-score' },
    ];

    return (
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
            <ScrollView style={styles.container}>
                {/* Profile Header */}
                <View style={styles.header}>
                    <View style={styles.profileImageContainer}>
                        <Image
                            source={{ uri: 'https://via.placeholder.com/100' }}
                            style={styles.profileImage}
                        />
                        <IconButton
                            name="camera"
                            size={20}
                            color={colors.primaryLight}
                            style={styles.editImageButton}
                            onPress={() => {
                                // Handle image edit
                            }}
                        />
                    </View>
                    <Text style={styles.name}>John Doe</Text>
                    <Text style={styles.email}>john.doe@example.com</Text>
                    <TouchableOpacity style={styles.editProfileButton}>
                        <Text style={styles.editProfileText}>{t("profile.editProfile")}</Text>
                    </TouchableOpacity>
                </View>

                {/* Profile Sections */}
                <View style={styles.sectionsContainer}>
                    {profileSections.map((section) => (
                        <ListItem
                            key={section.id}
                            title={t(section.title)}
                            icon={section.icon}
                            onPress={() => router.push(section.route)}
                            style={styles.sectionButton}
                        />
                    ))}
                </View>

                {/* Logout Button */}
                <TouchableOpacity style={styles.logoutButton}>
                    <IconButton
                        name="log-out-outline"
                        color={colors.chatUnreadBadge}
                        backgroundColor="transparent"
                    />
                    <Text style={styles.logoutText}>{t("profile.logOut")}</Text>
                </TouchableOpacity>
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
        alignItems: 'center',
        padding: 20,
        backgroundColor: colors.primaryLight,
        borderBottomWidth: 1,
        borderBottomColor: colors.primaryLight_1,
    },
    profileImageContainer: {
        position: 'relative',
        marginBottom: 16,
    },
    profileImage: {
        width: 100,
        height: 100,
        borderRadius: 50,
    },
    editImageButton: {
        position: 'absolute',
        right: 0,
        bottom: 0,
        backgroundColor: colors.primaryColor,
    },
    name: {
        fontSize: 24,
        fontWeight: 'bold',
        color: colors.primaryDark,
        marginBottom: 4,
    },
    email: {
        fontSize: 16,
        color: colors.primaryDark_1,
        marginBottom: 16,
    },
    editProfileButton: {
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 20,
        backgroundColor: colors.primaryColor,
    },
    editProfileText: {
        color: colors.primaryLight,
        fontSize: 16,
        fontWeight: '600',
    },
    sectionsContainer: {
        padding: 16,
    },
    sectionButton: {
        marginBottom: 12,
        borderRadius: 12,
        shadowColor: colors.primaryDark,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
        borderBottomWidth: 0,
    },
    logoutButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        marginHorizontal: 16,
        marginTop: 20,
        marginBottom: 32,
        borderWidth: 1,
        borderColor: colors.chatUnreadBadge,
        borderRadius: 12,
    },
    logoutText: {
        marginLeft: 8,
        fontSize: 16,
        fontWeight: '600',
        color: colors.chatUnreadBadge,
    },
}); 
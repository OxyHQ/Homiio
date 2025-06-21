import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/styles/colors';
import { useRouter } from 'expo-router';
import { IconButton } from '@/components/IconButton';
import { ListItem } from '@/components/ListItem';
import { useOxy } from '@oxyhq/services';
import { Avatar } from '@oxyhq/services/ui';
import { usePrimaryProfile, useUserProfiles, useDeleteProfile, useUpdateProfile } from '@/hooks/useProfileQueries';
import { TrustScore } from '@/components/TrustScore';
import { Profile } from '@/services/profileService';
import { useQueryClient } from '@tanstack/react-query';

export default function ProfileScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const { user, showBottomSheet, logout } = useOxy();
    const { data: primaryProfile, isLoading: profileLoading, error: profileError } = usePrimaryProfile();
    const { data: allProfiles, isLoading: profilesLoading } = useUserProfiles();
    const deleteProfile = useDeleteProfile();
    const updateProfile = useUpdateProfile();
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const queryClient = useQueryClient();

    console.log('ProfileScreen - user:', user ? 'authenticated' : 'not authenticated');
    console.log('ProfileScreen - profileError:', profileError);
    console.log('ProfileScreen - primaryProfile:', primaryProfile);
    console.log('ProfileScreen - allProfiles:', allProfiles);
    console.log('ProfileScreen - profileLoading:', profileLoading);
    console.log('ProfileScreen - profilesLoading:', profilesLoading);

    const handleLogout = async () => {
        Alert.alert(
            'Logout',
            'Are you sure you want to logout?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Logout',
                    style: 'destructive',
                    onPress: async () => {
                        setIsLoggingOut(true);
                        try {
                            await logout?.();
                        } catch (error) {
                            console.error('Logout error:', error);
                            Alert.alert('Error', 'Failed to logout. Please try again.');
                        } finally {
                            setIsLoggingOut(false);
                        }
                    }
                }
            ]
        );
    };

    const handleDeleteProfile = async (profileId: string, profileType: string) => {
        Alert.alert(
            'Delete Profile',
            `Are you sure you want to delete your ${profileType} profile? This action cannot be undone.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await deleteProfile.mutateAsync(profileId);
                            Alert.alert('Success', `${profileType} profile deleted successfully.`);
                        } catch (error) {
                            Alert.alert('Error', 'Failed to delete profile. Please try again.');
                        }
                    }
                }
            ]
        );
    };

    const handleProfileAction = (action: string, profileId?: string) => {
        switch (action) {
            case 'create':
                router.push('/profile/create');
                break;
            case 'edit':
                if (profileId) {
                    router.push(`/profile/edit/${profileId}`);
                } else {
                    router.push('/profile/edit');
                }
                break;
            case 'trust-score':
                router.push('/profile/trust-score');
                break;
            default:
                break;
        }
    };

    const handleRefresh = async () => {
        try {
            console.log('Manually refreshing profile data...');
            await queryClient.invalidateQueries({ queryKey: ['profiles'] });
            console.log('Profile data refreshed successfully');
        } catch (error) {
            console.error('Error refreshing profile data:', error);
        }
    };

    const handleSwitchProfile = async (profileId: string) => {
        try {
            await updateProfile.mutateAsync({ profileId, updateData: { isPrimary: true } });
            await handleRefresh();
        } catch (error) {
            Alert.alert('Error', 'Failed to switch profile. Please try again.');
        }
    };

    const handleSetAsDefault = async (profileId: string, profileType: string) => {
        Alert.alert(
            'Set as Default Profile',
            `Are you sure you want to set this ${profileType} profile as your default profile? This will make it your primary profile.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Set as Default',
                    onPress: async () => {
                        try {
                            await updateProfile.mutateAsync({ profileId, updateData: { isPrimary: true } });
                            await handleRefresh();
                            Alert.alert('Success', `${profileType} profile is now your default profile.`);
                        } catch (error) {
                            Alert.alert('Error', 'Failed to set profile as default. Please try again.');
                        }
                    }
                }
            ]
        );
    };

    const getProfileTypeLabel = (type: string) => {
        switch (type) {
            case 'personal':
                return 'Personal';
            case 'roommate':
                return 'Roommate';
            case 'agency':
                return 'Agency';
            default:
                return 'Unknown';
        }
    };

    const getProfileTypeIcon = (type: string) => {
        switch (type) {
            case 'personal':
                return 'user';
            case 'roommate':
                return 'users';
            case 'agency':
                return 'building';
            default:
                return 'user';
        }
    };

    const profileSections = [
        { id: '1', title: 'profile.myProperties', icon: 'home-outline' as const, route: '/properties/my' },
        { id: '2', title: 'profile.savedProperties', icon: 'bookmark-outline' as const, route: '/properties/saved' },
        { id: '3', title: 'profile.myContracts', icon: 'document-text-outline' as const, route: '/contracts' },
        { id: '4', title: 'profile.trustScore', icon: 'shield-checkmark-outline' as const, action: 'trust-score' },
        { id: '5', title: 'profile.notifications', icon: 'notifications-outline' as const, route: '/notifications' },
        { id: '6', title: 'profile.settings', icon: 'settings-outline' as const, route: '/settings' },
    ];

    if (profileLoading) {
        return (
            <SafeAreaView style={{ flex: 1 }} edges={['top']}>
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.primaryColor} />
                    <Text style={styles.loadingText}>Loading profile...</Text>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
            <ScrollView style={styles.container}>
                {/* Profile Header */}
                <View style={styles.header}>
                    <View style={styles.profileImageContainer}>
                        {(Avatar as any)({
                            user: user,
                            size: 100,
                            style: styles.profileImage
                        })}
                        <IconButton
                            name="camera"
                            size={20}
                            color={colors.primaryLight}
                            style={styles.editImageButton}
                            onPress={() => {
                                // Handle image edit
                                Alert.alert('Coming Soon', 'Profile image editing will be available soon.');
                            }}
                        />
                    </View>

                    <Text style={styles.name}>
                        {user?.firstName && user?.lastName
                            ? `${user.firstName} ${user.lastName}`
                            : user?.username || 'Welcome'
                        }
                    </Text>

                    <Text style={styles.email}>{user?.email || 'Manage your profiles and preferences'}</Text>

                    {/* Trust Score Display */}
                    {primaryProfile?.personalProfile && (
                        <View style={styles.trustScoreContainer}>
                            <TrustScore
                                score={primaryProfile.personalProfile.trustScore.score}
                                size="medium"
                                showLabel={true}
                            />
                            <Text style={styles.trustScoreText}>
                                Trust Score: {primaryProfile.personalProfile.trustScore.score}/100
                            </Text>
                        </View>
                    )}

                    {/* Business Verification Display for Agency Profiles */}
                    {primaryProfile?.profileType === 'agency' && primaryProfile?.agencyProfile && (
                        <View style={styles.trustScoreContainer}>
                            <View style={styles.businessVerificationContainer}>
                                <Text style={styles.businessVerificationTitle}>Agency Verification</Text>
                                <View style={styles.verificationStatusGrid}>
                                    {Object.entries(primaryProfile.agencyProfile.verification || {}).map(([key, value]) => (
                                        <View key={key} style={styles.verificationStatusItem}>
                                            <Text style={[
                                                styles.verificationStatusIcon,
                                                { color: value ? colors.online : colors.busy }
                                            ]}>
                                                {value ? '✓' : '○'}
                                            </Text>
                                            <Text style={styles.verificationStatusLabel}>
                                                {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                                            </Text>
                                        </View>
                                    ))}
                                </View>
                                <Text style={styles.businessInfoText}>
                                    {primaryProfile.agencyProfile.businessType?.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())} • {primaryProfile.agencyProfile.businessDetails?.employeeCount || '1-10'} employees
                                </Text>
                            </View>
                        </View>
                    )}

                    <View style={styles.editProfileButtonContainer}>
                        <TouchableOpacity
                            style={styles.editProfileButton}
                            onPress={() => handleProfileAction('edit')}
                        >
                            <Text style={styles.editProfileText}>{t("profile.editProfile")}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.editProfileButton, styles.refreshButton]}
                            onPress={handleRefresh}
                        >
                            <Text style={styles.editProfileText}>Refresh Data</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Profile Management Section */}
                <View style={styles.profileManagementSection}>
                    <Text style={styles.sectionTitle}>Profile Management</Text>
                    <Text style={styles.sectionSubtitle}>
                        Manage your different profile types
                    </Text>

                    {/* Current Default Profile Display */}
                    {primaryProfile && (
                        <View style={styles.defaultProfileCard}>
                            <View style={styles.defaultProfileHeader}>
                                <IconButton
                                    name={getProfileTypeIcon(primaryProfile.profileType)}
                                    size={24}
                                    color={colors.primaryColor}
                                    backgroundColor="transparent"
                                />
                                <View style={styles.defaultProfileInfo}>
                                    <Text style={styles.defaultProfileTitle}>
                                        Current Default: {getProfileTypeLabel(primaryProfile.profileType)}
                                    </Text>
                                    <Text style={styles.defaultProfileSubtitle}>
                                        This is your active profile for the app
                                    </Text>
                                </View>
                                <View style={styles.defaultBadge}>
                                    <IconButton
                                        name="checkmark-circle"
                                        size={20}
                                        color={colors.primaryLight}
                                        backgroundColor="transparent"
                                    />
                                </View>
                            </View>
                        </View>
                    )}

                    {/* Debug Info */}
                    {/* Quick Profile Switcher */}
                    {allProfiles && allProfiles.length > 1 && (
                        <View style={styles.quickSwitcherContainer}>
                            <Text style={styles.quickSwitcherTitle}>Quick Switch Profile</Text>
                            <View style={styles.quickSwitcherButtons}>
                                {allProfiles.map((profile: Profile) => (
                                    <TouchableOpacity
                                        key={profile.id || profile._id}
                                        style={[
                                            styles.quickSwitchButton,
                                            profile.isPrimary && styles.quickSwitchButtonActive
                                        ]}
                                        onPress={() => {
                                            const profileId = profile.id || profile._id;
                                            if (profileId && !profile.isPrimary) {
                                                handleSetAsDefault(profileId, profile.profileType);
                                            }
                                        }}
                                        disabled={profile.isPrimary || updateProfile.isPending}
                                    >
                                        <Text style={[
                                            styles.quickSwitchButtonText,
                                            profile.isPrimary && styles.quickSwitchButtonTextActive
                                        ]}>
                                            {getProfileTypeLabel(profile.profileType)}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>
                    )}

                    {allProfiles && allProfiles.length > 0 ? (
                        allProfiles.map((profile: Profile) => (
                            <View key={profile.id || profile._id || `profile-${profile.profileType}-${profile.createdAt}`} style={styles.profileCard}>
                                <View style={styles.profileCardHeader}>
                                    <IconButton
                                        name={getProfileTypeIcon(profile.profileType)}
                                        size={24}
                                        color={colors.primaryColor}
                                        backgroundColor="transparent"
                                    />
                                    <View style={styles.profileCardInfo}>
                                        <Text style={styles.profileCardTitle}>
                                            {getProfileTypeLabel(profile.profileType)}
                                        </Text>
                                        <Text style={styles.profileCardStatus}>
                                            {profile.isPrimary ? (
                                                <View style={styles.defaultStatusContainer}>
                                                    <IconButton
                                                        name="checkmark-circle"
                                                        size={16}
                                                        color={colors.online}
                                                        backgroundColor="transparent"
                                                    />
                                                    <Text style={styles.defaultStatusText}>Default Profile</Text>
                                                </View>
                                            ) : (
                                                'Secondary Profile'
                                            )}
                                        </Text>
                                    </View>
                                    <View style={styles.profileCardActions}>
                                        <TouchableOpacity
                                            style={styles.profileActionButton}
                                            onPress={() => {
                                                const profileId = profile.id || profile._id;
                                                if (profileId) {
                                                    handleProfileAction('edit', profileId);
                                                }
                                            }}
                                        >
                                            <Text style={styles.profileActionText}>Edit</Text>
                                        </TouchableOpacity>
                                        {!profile.isPrimary && (
                                            <>
                                                <TouchableOpacity
                                                    style={[styles.profileActionButton, styles.switchButton]}
                                                    onPress={() => {
                                                        const profileId = profile.id || profile._id;
                                                        if (profileId) {
                                                            handleSetAsDefault(profileId, profile.profileType);
                                                        }
                                                    }}
                                                    disabled={updateProfile.isPending}
                                                >
                                                    <Text style={styles.profileActionText}>
                                                        {updateProfile.isPending ? 'Switching...' : 'Set as Default'}
                                                    </Text>
                                                </TouchableOpacity>
                                                <TouchableOpacity
                                                    style={[styles.profileActionButton, styles.deleteButton]}
                                                    onPress={() => {
                                                        const profileId = profile.id || profile._id;
                                                        if (profileId) {
                                                            handleDeleteProfile(profileId, profile.profileType);
                                                        }
                                                    }}
                                                >
                                                    <Text style={[styles.profileActionText, styles.deleteButtonText]}>
                                                        Delete
                                                    </Text>
                                                </TouchableOpacity>
                                            </>
                                        )}
                                    </View>
                                </View>
                            </View>
                        ))
                    ) : (
                        <View style={styles.noProfilesContainer}>
                            <Text style={styles.noProfilesText}>
                                {profilesLoading ? 'Loading profiles...' : 'No profiles found'}
                            </Text>
                            {primaryProfile && (
                                <Text style={styles.noProfilesSubtext}>
                                    Primary profile exists but not in list. This might be a data sync issue.
                                </Text>
                            )}
                        </View>
                    )}

                    <TouchableOpacity
                        style={styles.createProfileButton}
                        onPress={() => handleProfileAction('create')}
                    >
                        <Text style={styles.createProfileText}>+ Create New Profile</Text>
                    </TouchableOpacity>
                </View>

                {/* Profile Sections */}
                <View style={styles.sectionsContainer}>
                    <Text style={styles.sectionTitle}>Quick Actions</Text>
                    {profileSections.map((section) => (
                        <ListItem
                            key={section.id}
                            title={t(section.title)}
                            icon={section.icon}
                            onPress={() => {
                                if (section.action) {
                                    handleProfileAction(section.action);
                                } else if (section.route) {
                                    router.push(section.route);
                                }
                            }}
                            style={styles.sectionButton}
                        />
                    ))}
                </View>

                {/* Logout Button */}
                <TouchableOpacity
                    style={styles.logoutButton}
                    onPress={handleLogout}
                    disabled={isLoggingOut}
                >
                    {isLoggingOut ? (
                        <ActivityIndicator size="small" color={colors.chatUnreadBadge} />
                    ) : (
                        <IconButton
                            name="log-out-outline"
                            color={colors.chatUnreadBadge}
                            backgroundColor="transparent"
                        />
                    )}
                    <Text style={styles.logoutText}>
                        {isLoggingOut ? 'Logging out...' : t("profile.logOut")}
                    </Text>
                </TouchableOpacity>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_5,
        marginTop: 12,
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
    trustScoreContainer: {
        alignItems: 'center',
        marginBottom: 16,
    },
    trustScoreText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_5,
        marginTop: 4,
    },
    editProfileButtonContainer: {
        flexDirection: 'row',
        gap: 8,
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
    refreshButton: {
        backgroundColor: colors.primaryLight_1,
    },
    profileManagementSection: {
        padding: 16,
        backgroundColor: colors.primaryLight_1,
        margin: 16,
        borderRadius: 12,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: colors.primaryDark,
        marginBottom: 8,
    },
    sectionSubtitle: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_5,
        marginBottom: 16,
    },
    profileCard: {
        backgroundColor: colors.primaryLight,
        padding: 16,
        borderRadius: 8,
        marginBottom: 12,
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    profileCardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    profileCardInfo: {
        flex: 1,
        marginLeft: 12,
    },
    profileCardTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryDark,
        marginBottom: 4,
    },
    profileCardStatus: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_5,
    },
    profileCardActions: {
        flexDirection: 'row',
        gap: 8,
    },
    profileActionButton: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 15,
        backgroundColor: colors.primaryLight_1,
        borderWidth: 1,
        borderColor: colors.primaryColor,
    },
    profileActionText: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.primaryColor,
    },
    deleteButton: {
        borderColor: colors.busy,
        backgroundColor: colors.primaryLight,
    },
    deleteButtonText: {
        color: colors.busy,
    },
    createProfileButton: {
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 8,
        backgroundColor: colors.primaryColor,
        alignItems: 'center',
        marginTop: 8,
    },
    createProfileText: {
        color: colors.primaryLight,
        fontSize: 14,
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
    noProfilesContainer: {
        padding: 20,
        alignItems: 'center',
        backgroundColor: colors.primaryLight_1,
        borderRadius: 8,
        marginBottom: 12,
    },
    noProfilesText: {
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_5,
        marginBottom: 4,
        textAlign: 'center',
    },
    noProfilesSubtext: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_5,
        textAlign: 'center',
    },
    switchButton: {
        borderColor: colors.online,
        backgroundColor: colors.primaryLight,
    },
    businessVerificationContainer: {
        alignItems: 'center',
        marginBottom: 16,
    },
    businessVerificationTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: colors.primaryDark,
        marginBottom: 8,
    },
    verificationStatusGrid: {
        flexDirection: 'row',
        gap: 8,
    },
    verificationStatusItem: {
        alignItems: 'center',
    },
    verificationStatusIcon: {
        fontSize: 20,
        marginBottom: 4,
    },
    verificationStatusLabel: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_5,
    },
    businessInfoText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_5,
        marginTop: 8,
    },
    defaultProfileCard: {
        backgroundColor: colors.primaryLight,
        padding: 16,
        borderRadius: 8,
        marginBottom: 12,
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    defaultProfileHeader: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    defaultProfileInfo: {
        flex: 1,
        marginLeft: 12,
    },
    defaultProfileTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryDark,
    },
    defaultProfileSubtitle: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_5,
    },
    defaultBadge: {
        padding: 4,
        borderRadius: 12,
        backgroundColor: colors.primaryColor,
    },
    quickSwitcherContainer: {
        marginBottom: 16,
    },
    quickSwitcherTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: colors.primaryDark,
        marginBottom: 8,
    },
    quickSwitcherButtons: {
        flexDirection: 'row',
        gap: 8,
    },
    quickSwitchButton: {
        padding: 12,
        borderRadius: 12,
        backgroundColor: colors.primaryLight,
        borderWidth: 1,
        borderColor: colors.primaryColor,
    },
    quickSwitchButtonActive: {
        borderColor: colors.online,
        backgroundColor: colors.primaryLight,
    },
    quickSwitchButtonText: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.primaryColor,
    },
    quickSwitchButtonTextActive: {
        color: colors.online,
    },
    defaultStatusContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    defaultStatusText: {
        marginLeft: 4,
        fontSize: 12,
        fontWeight: '600',
        color: colors.online,
    },
}); 
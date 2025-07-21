import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    StyleSheet,
    Alert,
    ActivityIndicator,
    Platform,
} from 'react-native';
import { useOxy } from '@oxyhq/services';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors } from '@/styles/colors';
import { toast } from 'sonner';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useProfile } from '@/hooks/useProfile';
import type { Profile } from '@/services/profileService';

// Type assertion for Ionicons compatibility with React 19
const IconComponent = Ionicons as any;

// Helper function to get profile display name
const getProfileDisplayName = (profile: Profile): string => {
    switch (profile.profileType) {
        case 'personal':
            // Personal profiles are unique and linked to the Oxy account
            return 'Personal Profile';
        case 'agency':
            return profile.agencyProfile?.legalCompanyName || 'Agency Profile';
        case 'business':
            return profile.businessProfile?.legalCompanyName || 'Business Profile';
        default:
            return 'Profile';
    }
};

// Helper function to get profile description
const getProfileDescription = (profile: Profile): string | undefined => {
    switch (profile.profileType) {
        case 'agency':
            return profile.agencyProfile?.description;
        case 'business':
            return profile.businessProfile?.description;
        default:
            return undefined;
    }
};

// Web-compatible alert function
const webAlert = (
    title: string,
    message: string,
    buttons: Array<{
        text: string;
        style?: 'default' | 'cancel' | 'destructive';
        onPress?: () => void;
    }>
) => {
    if (Platform.OS === 'web') {
        const result = window.confirm(`${title}\n\n${message}`);
        if (result) {
            const confirmButton = buttons.find(btn => btn.style !== 'cancel');
            confirmButton?.onPress?.();
        }
    } else {
        Alert.alert(title, message, buttons);
    }
};

export default function ProfileScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const { user, logout, oxyServices, activeSessionId } = useOxy();

    // Use Redux hooks consistently
    const {
        allProfiles: profiles,
        primaryProfile,
        isLoading,
        error,
        loadProfiles,
        updateProfile,
        deleteProfile
    } = useProfile();

    const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
    const [isSwitching, setIsSwitching] = useState(false);

    // Check if user has a primary profile
    const hasPrimaryProfile = !!primaryProfile;

    useEffect(() => {
        if (oxyServices && activeSessionId) {
            loadProfiles();
        }
    }, [oxyServices, activeSessionId, loadProfiles]);

    useEffect(() => {
        if (profiles && profiles.length > 0) {
            const activeProfile = profiles.find(p => p.isActive);
            const profileId = activeProfile?.id || activeProfile?._id || profiles[0].id || profiles[0]._id;
            if (profileId) {
                setActiveProfileId(profileId);
            }
        }
    }, [profiles]);

    const handleProfileSwitch = async (profileId: string) => {
        if (!profileId) {
            toast.error('Invalid profile ID');
            return;
        }

        const profile = profiles?.find(p => p.id === profileId || p._id === profileId);
        if (!profile) {
            toast.error('Profile not found');
            return;
        }

        // Check if this profile is already active
        if (profile.isActive) {
            return;
        }

        const profileName = getProfileDisplayName(profile);
        const finalProfileId = profile.id || profile._id;

        if (!finalProfileId) {
            toast.error('Invalid profile data');
            return;
        }

        webAlert(
            'Switch Profile',
            `Are you sure you want to switch to "${profileName}"?`,
            [
                {
                    text: 'Cancel',
                    style: 'cancel',
                },
                {
                    text: 'Switch',
                    onPress: async () => {
                        setIsSwitching(true);

                        try {
                            // TODO: Implement activateProfile functionality
                            console.log('Activate profile functionality not implemented yet');

                            // Update local state immediately
                            setActiveProfileId(finalProfileId);
                            toast.success(`Switched to ${profileName}`);

                        } catch (error: any) {
                            console.error('Profile switch failed:', error);
                            toast.error(error.message || 'Failed to switch profile');
                        } finally {
                            setIsSwitching(false);
                        }
                    },
                },
            ]
        );
    };

    const handleProfileDelete = async (profileId: string) => {
        const profile = profiles?.find(p => p.id === profileId);
        if (!profile) return;

        // Prevent deletion of personal profiles
        if (profile.profileType === 'personal') {
            toast.info('Personal profiles cannot be deleted as they are linked to your main account');
            return;
        }

        const profileName = getProfileDisplayName(profile);

        webAlert(
            'Delete Profile',
            `Are you sure you want to delete "${profileName}"? This action cannot be undone.`,
            [
                {
                    text: 'Cancel',
                    style: 'cancel',
                },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await deleteProfile(profileId);
                            toast.success(`Profile "${profileName}" deleted`);
                        } catch (error: any) {
                            console.error('Profile deletion failed:', error);
                            toast.error(error.message || 'Failed to delete profile');
                        }
                    },
                },
            ]
        );
    };

    const handleLogout = () => {
        webAlert(
            'Sign Out',
            'Are you sure you want to sign out?',
            [
                {
                    text: 'Cancel',
                    style: 'cancel',
                },
                {
                    text: 'Sign Out',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await logout();
                            router.replace('/');
                            toast.success('Signed out successfully');
                        } catch (error) {
                            console.error('Logout failed:', error);
                            toast.error('Failed to sign out');
                        }
                    },
                },
            ]
        );
    };

    if (isLoading) {
        return (
            <SafeAreaView style={styles.container} edges={['top']}>
                <View style={styles.header}>
                    <Text style={styles.headerTitle}>Profile Management</Text>
                </View>
                <View style={styles.loadingContainer}>
                    <LoadingSpinner size={32} text="Loading profiles..." />
                </View>
            </SafeAreaView>
        );
    }

    if (error) {
        return (
            <SafeAreaView style={styles.container} edges={['top']}>
                <View style={styles.header}>
                    <Text style={styles.headerTitle}>Profile Management</Text>
                </View>
                <View style={styles.errorContainer}>
                    <IconComponent name="alert-circle" size={48} color="#ff4757" />
                    <Text style={styles.errorTitle}>Failed to load profiles</Text>
                    <Text style={styles.errorMessage}>Please try again later</Text>
                    <TouchableOpacity style={styles.retryButton} onPress={() => loadProfiles()}>
                        <Text style={styles.retryButtonText}>Retry</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    const activeProfile = profiles?.find(p => p.isActive);
    const personalProfiles = profiles?.filter(p => p.profileType === 'personal') || [];
    const businessProfiles = profiles?.filter(p => p.profileType === 'business') || [];
    const agencyProfiles = profiles?.filter(p => p.profileType === 'agency') || [];

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            {/* Header */}
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Profile Management</Text>
            </View>

            <ScrollView style={styles.content}>
                {/* No Profile Section - Show when no primary profile exists */}
                {!activeProfile && !isLoading && (
                    <View style={styles.section}>
                        <View style={[styles.settingItem, styles.firstSettingItem, styles.lastSettingItem, styles.noProfileCard]}>
                            <View style={styles.settingInfo}>
                                <IconComponent name="person-add" size={24} color={colors.primaryColor} style={styles.settingIcon} />
                                <View style={styles.settingTextContainer}>
                                    <Text style={styles.settingLabel}>No Profile Found</Text>
                                    <Text style={styles.settingDescription}>
                                        You don't have any profiles yet. Create your first profile to get started.
                                    </Text>
                                </View>
                            </View>
                            <TouchableOpacity
                                style={styles.createProfileButton}
                                onPress={() => router.push('/profile/create')}
                            >
                                <Text style={styles.createProfileButtonText}>Create Profile</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                )}

                {/* Active Profile Section */}
                {activeProfile && (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Active Profile</Text>

                        <View style={[styles.settingItem, styles.firstSettingItem, styles.lastSettingItem]}>
                            <View style={styles.settingInfo}>
                                <IconComponent
                                    name={activeProfile.profileType === 'personal' ? 'person' : 'business'}
                                    size={20}
                                    color="#666"
                                    style={styles.settingIcon}
                                />
                                <View>
                                    <Text style={styles.settingLabel}>{getProfileDisplayName(activeProfile)}</Text>
                                    <Text style={styles.settingDescription}>
                                        {activeProfile.profileType === 'personal' ? 'Personal Profile' :
                                            activeProfile.profileType === 'agency' ? 'Agency Profile' : 'Business Profile'}
                                        {getProfileDescription(activeProfile) && ` • ${getProfileDescription(activeProfile)}`}
                                    </Text>
                                </View>
                            </View>
                            <View style={styles.activeBadge}>
                                <Text style={styles.activeBadgeText}>Active</Text>
                            </View>
                        </View>
                    </View>
                )}

                {/* Info Card */}
                <View style={styles.section}>
                    <View style={[styles.settingItem, styles.firstSettingItem, styles.lastSettingItem]}>
                        <View style={styles.settingInfo}>
                            <IconComponent name="information-circle" size={20} color="#666" style={styles.settingIcon} />
                            <View style={styles.settingTextContainer}>
                                <Text style={styles.settingLabel}>Profile Management</Text>
                                <Text style={styles.settingDescription}>
                                    Personal profiles are unique and linked to your Oxy account. You can have multiple business or agency profiles. Inactive profiles are shown and can be reactivated.
                                </Text>
                            </View>
                        </View>
                    </View>
                </View>

                {/* Personal Profiles Section */}
                {personalProfiles.length > 0 && (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Personal Profiles</Text>
                        {personalProfiles.map((profile, index) => {
                            return (
                                <TouchableOpacity
                                    key={profile.id || profile._id}
                                    style={[
                                        styles.settingItem,
                                        index === 0 && styles.firstSettingItem,
                                        index === personalProfiles.length - 1 && styles.lastSettingItem,
                                    ]}
                                    onPress={() => {
                                        const profileId = profile.id || profile._id;
                                        if (profileId) {
                                            handleProfileSwitch(profileId);
                                        } else {
                                            toast.error('Invalid profile data');
                                        }
                                    }}
                                    disabled={isSwitching}
                                >
                                    <View style={styles.settingInfo}>
                                        <IconComponent name="person" size={20} color="#666" style={styles.settingIcon} />
                                        <View style={styles.settingTextContainer}>
                                            <Text style={styles.settingLabel}>{getProfileDisplayName(profile)}</Text>
                                            <Text style={styles.settingDescription}>
                                                Personal Profile
                                                {getProfileDescription(profile) && ` • ${getProfileDescription(profile)}`}
                                                {' • Linked to Oxy Account'}
                                                {!profile.isActive && ' • Inactive'}
                                            </Text>
                                        </View>
                                    </View>
                                    <View style={styles.itemActions}>
                                        {profile.isActive && (
                                            <View style={styles.activeBadge}>
                                                <Text style={styles.activeBadgeText}>Active</Text>
                                            </View>
                                        )}
                                        {isSwitching && (profile.id || profile._id) === activeProfileId && (
                                            <ActivityIndicator size="small" color={colors.primaryColor} />
                                        )}
                                        <IconComponent name="chevron-forward" size={16} color="#ccc" />
                                    </View>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                )}

                {/* Business Profiles Section */}
                {businessProfiles.length > 0 && (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Business Profiles</Text>
                        {businessProfiles.map((profile, index) => {
                            return (
                                <TouchableOpacity
                                    key={profile.id || profile._id}
                                    style={[
                                        styles.settingItem,
                                        index === 0 && styles.firstSettingItem,
                                        index === businessProfiles.length - 1 && styles.lastSettingItem,
                                    ]}
                                    onPress={() => {
                                        const profileId = profile.id || profile._id;
                                        if (profileId) {
                                            handleProfileSwitch(profileId);
                                        } else {
                                            toast.error('Invalid profile data');
                                        }
                                    }}
                                    disabled={isSwitching}
                                >
                                    <View style={styles.settingInfo}>
                                        <IconComponent name="business" size={20} color="#666" style={styles.settingIcon} />
                                        <View style={styles.settingTextContainer}>
                                            <Text style={styles.settingLabel}>{getProfileDisplayName(profile)}</Text>
                                            <Text style={styles.settingDescription}>
                                                Business Profile
                                                {getProfileDescription(profile) && ` • ${getProfileDescription(profile)}`}
                                                {!profile.isActive && ' • Inactive'}
                                            </Text>
                                        </View>
                                    </View>
                                    <View style={styles.itemActions}>
                                        {profile.isActive && (
                                            <View style={styles.activeBadge}>
                                                <Text style={styles.activeBadgeText}>Active</Text>
                                            </View>
                                        )}
                                        {isSwitching && (profile.id || profile._id) === activeProfileId && (
                                            <ActivityIndicator size="small" color={colors.primaryColor} />
                                        )}
                                        <IconComponent name="chevron-forward" size={16} color="#ccc" />
                                    </View>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                )}

                {/* Agency Profiles Section */}
                {agencyProfiles.length > 0 && (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Agency Profiles</Text>
                        {agencyProfiles.map((profile, index) => {
                            return (
                                <TouchableOpacity
                                    key={profile.id || profile._id}
                                    style={[
                                        styles.settingItem,
                                        index === 0 && styles.firstSettingItem,
                                        index === agencyProfiles.length - 1 && styles.lastSettingItem,
                                    ]}
                                    onPress={() => {
                                        const profileId = profile.id || profile._id;
                                        if (profileId) {
                                            handleProfileSwitch(profileId);
                                        } else {
                                            toast.error('Invalid profile data');
                                        }
                                    }}
                                    disabled={isSwitching}
                                >
                                    <View style={styles.settingInfo}>
                                        <IconComponent name="business" size={20} color="#666" style={styles.settingIcon} />
                                        <View style={styles.settingTextContainer}>
                                            <Text style={styles.settingLabel}>{getProfileDisplayName(profile)}</Text>
                                            <Text style={styles.settingDescription}>
                                                Agency Profile
                                                {getProfileDescription(profile) && ` • ${getProfileDescription(profile)}`}
                                                {!profile.isActive && ' • Inactive'}
                                            </Text>
                                        </View>
                                    </View>
                                    <View style={styles.itemActions}>
                                        {profile.isActive && (
                                            <View style={styles.activeBadge}>
                                                <Text style={styles.activeBadgeText}>Active</Text>
                                            </View>
                                        )}
                                        {isSwitching && (profile.id || profile._id) === activeProfileId && (
                                            <ActivityIndicator size="small" color={colors.primaryColor} />
                                        )}
                                        <IconComponent name="chevron-forward" size={16} color="#ccc" />
                                    </View>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                )}

                {/* Actions Section */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Actions</Text>

                    <TouchableOpacity
                        style={[styles.settingItem, styles.firstSettingItem]}
                        onPress={() => router.push('/profile/edit')}
                    >
                        <View style={styles.settingInfo}>
                            <IconComponent name="create" size={20} color="#666" style={styles.settingIcon} />
                            <View>
                                <Text style={styles.settingLabel}>Edit Current Profile</Text>
                                <Text style={styles.settingDescription}>Modify profile information</Text>
                            </View>
                        </View>
                        <IconComponent name="chevron-forward" size={16} color="#ccc" />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.settingItem, styles.lastSettingItem]}
                        onPress={() => router.push('/profile/create')}
                    >
                        <View style={styles.settingInfo}>
                            <IconComponent name="add-circle" size={20} color="#666" style={styles.settingIcon} />
                            <View>
                                <Text style={styles.settingLabel}>Create New Profile</Text>
                                <Text style={styles.settingDescription}>Add a new business or agency profile</Text>
                            </View>
                        </View>
                        <IconComponent name="chevron-forward" size={16} color="#ccc" />
                    </TouchableOpacity>
                </View>

                {/* Sign Out Section */}
                <View style={styles.section}>
                    <TouchableOpacity
                        style={[styles.settingItem, styles.firstSettingItem, styles.lastSettingItem, styles.signOutButton]}
                        onPress={handleLogout}
                    >
                        <View style={styles.settingInfo}>
                            <IconComponent name="log-out" size={20} color="#ff4757" style={styles.settingIcon} />
                            <View>
                                <Text style={[styles.settingLabel, { color: '#ff4757' }]}>Sign Out</Text>
                                <Text style={styles.settingDescription}>Sign out of your account</Text>
                            </View>
                        </View>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f2f2f2',
    },
    header: {
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 16,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#000',
    },
    content: {
        flex: 1,
        padding: 16,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    loadingText: {
        marginTop: 12,
        fontSize: 16,
        color: '#666',
    },
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    errorTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#333',
        marginTop: 12,
        marginBottom: 4,
    },
    errorMessage: {
        fontSize: 14,
        color: '#666',
        marginBottom: 20,
    },
    retryButton: {
        backgroundColor: colors.primaryColor,
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 8,
    },
    retryButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '500',
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
        marginBottom: 12,
    },
    settingItem: {
        backgroundColor: '#fff',
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 2,
    },
    firstSettingItem: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        marginBottom: 2,
    },
    lastSettingItem: {
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
        marginBottom: 8,
    },
    settingInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    settingIcon: {
        marginRight: 12,
    },
    settingLabel: {
        fontSize: 16,
        fontWeight: '500',
        color: '#333',
        marginBottom: 2,
    },
    settingDescription: {
        fontSize: 14,
        color: '#666',
    },
    activeBadge: {
        backgroundColor: colors.primaryColor,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 12,
    },
    activeBadgeText: {
        fontSize: 10,
        fontWeight: '600',
        color: '#fff',
    },
    itemActions: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    activeItem: {
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: colors.primaryColor,
    },
    signOutButton: {
        borderWidth: 1,
        borderColor: '#ff4757',
    },
    settingTextContainer: {
        flex: 1,
    },
    noProfileCard: {
        backgroundColor: '#fff',
        padding: 16,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: '#e0e0e0',
    },
    createProfileButton: {
        backgroundColor: colors.primaryColor,
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 8,
        marginTop: 16,
        alignSelf: 'flex-start',
    },
    createProfileButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '500',
        textAlign: 'center',
    },
}); 
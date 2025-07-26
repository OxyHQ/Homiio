import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useProfile } from '@/hooks/useProfile';
import { useOxy } from '@oxyhq/services';
import { CreateProfileData, UpdateProfileData, ProfileType, PropertyType, ProfileVisibility, BusinessType } from '@homiio/shared-types';

export function ProfileManager() {
    const { oxyServices, activeSessionId } = useOxy();
    const {
        primaryProfile,
        allProfiles,
        isLoading,
        error,
        createProfile,
        updateProfile,
        deleteProfile
    } = useProfile();

    const [selectedProfileType, setSelectedProfileType] = useState<ProfileType>(ProfileType.PERSONAL);

    // Get personal and agency profiles from allProfiles
    const personalProfile = allProfiles.find((p: any) => p.profileType === ProfileType.PERSONAL);
    const agencyProfiles = allProfiles.filter((p: any) => p.profileType === ProfileType.AGENCY);

    if (!oxyServices || !activeSessionId) {
        return (
            <View style={styles.container}>
                <Text style={styles.title}>Profile Manager</Text>
                <Text style={styles.message}>Please sign in to manage your profiles</Text>
            </View>
        );
    }

    if (isLoading) {
        return (
            <View style={styles.container}>
                <Text style={styles.title}>Profile Manager</Text>
                <Text style={styles.message}>Loading profiles...</Text>
            </View>
        );
    }

    if (error) {
        return (
            <View style={styles.container}>
                <Text style={styles.title}>Profile Manager</Text>
                <Text style={styles.message}>Error loading profiles: {error}</Text>
            </View>
        );
    }

    const handleCreateProfile = async (profileType: ProfileType) => {
        try {
            const profileData: CreateProfileData = {
                profileType,
                data: {}
            };

            // Add specific data based on profile type
            switch (profileType) {
                case ProfileType.PERSONAL:
                    profileData.data = {
                        preferences: {
                            propertyTypes: [PropertyType.APARTMENT, PropertyType.HOUSE],
                            maxRent: 2000,
                            minBedrooms: 1,
                            minBathrooms: 1,
                            petFriendly: true,
                            smokingAllowed: false
                        },
                        settings: {
                            notifications: { email: true, push: true, sms: false },
                            privacy: { profileVisibility: ProfileVisibility.PUBLIC, showContactInfo: true, showIncome: false },
                            language: 'en',
                            timezone: 'UTC'
                        }
                    };
                    break;

                case ProfileType.AGENCY:
                    profileData.data = {
                        businessType: BusinessType.REAL_ESTATE_AGENCY,
                        description: 'Professional real estate services',
                        businessDetails: {
                            employeeCount: '1-10',
                            specialties: ['residential', 'commercial']
                        }
                    };
                    break;
            }

            await createProfile(profileData);
            Alert.alert('Success', `${profileType} profile created successfully!`);
        } catch (error: any) {
            Alert.alert('Error', `Failed to create ${profileType} profile: ${error.message || 'Unknown error'}`);
        }
    };

    const handleUpdateProfile = async (profileId: string, updateData: UpdateProfileData) => {
        try {
            await updateProfile(profileId, updateData as any);
            Alert.alert('Success', 'Profile updated successfully!');
        } catch (error: any) {
            Alert.alert('Error', `Failed to update profile: ${error.message || 'Unknown error'}`);
        }
    };

    const handleDeleteProfile = async (profileId: string) => {
        Alert.alert(
            'Confirm Delete',
            'Are you sure you want to delete this profile?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await deleteProfile(profileId);
                            Alert.alert('Success', 'Profile deleted successfully!');
                        } catch (error: any) {
                            Alert.alert('Error', `Failed to delete profile: ${error.message || 'Unknown error'}`);
                        }
                    }
                }
            ]
        );
    };

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Profile Manager</Text>

            {/* Profile Type Selector */}
            <View style={styles.selector}>
                <TouchableOpacity
                    style={[styles.selectorButton, selectedProfileType === ProfileType.PERSONAL && styles.selectorButtonActive]}
                    onPress={() => setSelectedProfileType(ProfileType.PERSONAL)}
                >
                    <Text style={[styles.selectorButtonText, selectedProfileType === ProfileType.PERSONAL && styles.selectorButtonTextActive]}>
                        Personal
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.selectorButton, selectedProfileType === ProfileType.AGENCY && styles.selectorButtonActive]}
                    onPress={() => setSelectedProfileType(ProfileType.AGENCY)}
                >
                    <Text style={[styles.selectorButtonText, selectedProfileType === ProfileType.AGENCY && styles.selectorButtonTextActive]}>
                        Agency
                    </Text>
                </TouchableOpacity>
            </View>

            {/* Profile Status */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Profile Status</Text>
                <Text style={styles.statusText}>
                    Primary Profile: {primaryProfile ? `${primaryProfile.profileType} (${primaryProfile.isPrimary ? 'Primary' : 'Secondary'})` : 'None'}
                </Text>
                <Text style={styles.statusText}>
                    Total Profiles: {allProfiles.length}
                </Text>
                <Text style={styles.statusText}>
                    Personal: {personalProfile ? '✓' : '✗'}
                </Text>
                <Text style={styles.statusText}>
                    Agency: {agencyProfiles.length}
                </Text>
            </View>

            {/* Profile Actions */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Actions</Text>

                {/* Create Profile Button */}
                {selectedProfileType === 'personal' && !personalProfile && (
                    <TouchableOpacity
                        style={styles.button}
                        onPress={() => handleCreateProfile('personal')}
                    >
                        <Text style={styles.buttonText}>
                            Create Personal Profile
                        </Text>
                    </TouchableOpacity>
                )}

                {selectedProfileType === 'agency' && (
                    <TouchableOpacity
                        style={styles.button}
                        onPress={() => handleCreateProfile('agency')}
                    >
                        <Text style={styles.buttonText}>
                            Create Agency Profile
                        </Text>
                    </TouchableOpacity>
                )}

                {/* Update Profile Button */}
                {((selectedProfileType === 'personal' && personalProfile) ||
                    (selectedProfileType === 'agency' && agencyProfiles.length > 0)) && (
                        <TouchableOpacity
                            style={[styles.button, styles.buttonSecondary]}
                            onPress={() => {
                                const profile = selectedProfileType === 'personal' ? personalProfile :
                                    agencyProfiles[0];

                                if (profile) {
                                    handleUpdateProfile(profile.id, {
                                        isActive: !profile.isActive
                                    });
                                }
                            }}
                        >
                            <Text style={styles.buttonText}>
                                Toggle Profile Active Status
                            </Text>
                        </TouchableOpacity>
                    )}

                {/* Delete Profile Button */}
                {((selectedProfileType === 'personal' && personalProfile && !personalProfile.isPrimary) ||
                    (selectedProfileType === 'agency' && agencyProfiles.length > 0)) && (
                        <TouchableOpacity
                            style={[styles.button, styles.buttonDanger]}
                            onPress={() => {
                                const profile = selectedProfileType === 'personal' ? personalProfile :
                                    agencyProfiles[0];

                                if (profile) {
                                    handleDeleteProfile(profile.id);
                                }
                            }}
                        >
                            <Text style={styles.buttonText}>
                                Delete Profile
                            </Text>
                        </TouchableOpacity>
                    )}
            </View>

            {/* Profile Details */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Profile Details</Text>
                {selectedProfileType === 'personal' && personalProfile && (
                    <View style={styles.profileDetails}>
                        <Text style={styles.detailText}>Trust Score: {personalProfile.personalProfile?.trustScore.score || 0}</Text>
                        <Text style={styles.detailText}>Verified: {personalProfile.personalProfile?.verification.identity ? '✓' : '✗'}</Text>
                        <Text style={styles.detailText}>Max Rent: ${personalProfile.personalProfile?.preferences.maxRent || 'Not set'}</Text>
                    </View>
                )}

                {selectedProfileType === 'agency' && agencyProfiles.length > 0 && (
                    <View style={styles.profileDetails}>
                        <Text style={styles.detailText}>Business Type: {agencyProfiles[0].agencyProfile?.businessType || 'Not set'}</Text>
                        <Text style={styles.detailText}>Members: {agencyProfiles[0].agencyProfile?.members.length || 0}</Text>
                        <Text style={styles.detailText}>Rating: {agencyProfiles[0].agencyProfile?.ratings.average || 0}/5</Text>
                    </View>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 20,
        backgroundColor: '#f5f5f5',
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 20,
        textAlign: 'center',
    },
    message: {
        fontSize: 16,
        textAlign: 'center',
        color: '#666',
    },
    selector: {
        flexDirection: 'row',
        marginBottom: 20,
        backgroundColor: '#fff',
        borderRadius: 8,
        padding: 4,
    },
    selectorButton: {
        flex: 1,
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 25,
        alignItems: 'center',
    },
    selectorButtonActive: {
        backgroundColor: '#007AFF',
    },
    selectorButtonText: {
        fontSize: 14,
        fontWeight: '500',
        color: '#666',
        fontFamily: 'Phudu',
    },
    selectorButtonTextActive: {
        color: '#fff',
        fontFamily: 'Phudu',
    },
    section: {
        backgroundColor: '#fff',
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 12,
    },
    statusText: {
        fontSize: 14,
        marginBottom: 4,
        color: '#333',
    },
    button: {
        backgroundColor: '#007AFF',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 25,
        alignItems: 'center',
        marginBottom: 8,
    },
    buttonSecondary: {
        backgroundColor: '#34C759',
    },
    buttonDanger: {
        backgroundColor: '#FF3B30',
    },
    buttonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '500',
        fontFamily: 'Phudu',
    },
    profileDetails: {
        marginTop: 8,
    },
    detailText: {
        fontSize: 14,
        marginBottom: 4,
        color: '#666',
    },
}); 
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/styles/colors';
import { useRouter } from 'expo-router';
import { IconButton } from '@/components/IconButton';
import { TrustScore } from '@/components/TrustScore';
import { usePrimaryProfile, useUpdatePrimaryProfile } from '@/hooks/useProfileQueries';
import { UpdateProfileData } from '@/services/profileService';

export default function ProfileEditScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const { data: primaryProfile, isLoading: profileLoading, refetch: refetchProfile } = usePrimaryProfile();
    const updateProfileMutation = useUpdatePrimaryProfile();
    const [isSaving, setIsSaving] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [activeSection, setActiveSection] = useState('personal');

    // Debug logging for component lifecycle
    useEffect(() => {
        console.log('ProfileEditScreen: Component mounted');
    }, []);

    useEffect(() => {
        console.log('ProfileEditScreen: profileLoading changed to:', profileLoading);
    }, [profileLoading]);

    // Form state
    const [personalInfo, setPersonalInfo] = useState({
        bio: '',
        occupation: '',
        employer: '',
        annualIncome: '',
        employmentStatus: 'employed' as 'employed' | 'self_employed' | 'student' | 'retired' | 'unemployed' | 'other',
        moveInDate: '',
        leaseDuration: 'yearly' as 'monthly' | '3_months' | '6_months' | 'yearly' | 'flexible',
    });

    const [preferences, setPreferences] = useState({
        propertyTypes: [] as string[],
        maxRent: '',
        minBedrooms: '',
        minBathrooms: '',
        preferredAmenities: [] as string[],
        petFriendly: false,
        smokingAllowed: false,
        furnished: false,
        parkingRequired: false,
        accessibility: false,
    });

    const [settings, setSettings] = useState({
        notifications: {
            email: true,
            push: true,
            sms: false,
            propertyAlerts: true,
            viewingReminders: true,
            leaseUpdates: true,
        },
        privacy: {
            profileVisibility: 'public' as 'public' | 'private' | 'contacts_only',
            showContactInfo: true,
            showIncome: false,
            showRentalHistory: false,
            showReferences: false,
        },
        language: 'en',
        timezone: 'UTC',
        currency: 'USD',
    });

    const [references, setReferences] = useState<Array<{
        name: string;
        relationship: 'landlord' | 'employer' | 'personal' | 'other';
        phone?: string;
        email?: string;
    }>>([]);

    const [rentalHistory, setRentalHistory] = useState<Array<{
        address: string;
        startDate: string;
        endDate?: string;
        monthlyRent?: string;
        reasonForLeaving: 'lease_ended' | 'bought_home' | 'job_relocation' | 'family_reasons' | 'upgrade' | 'other';
        landlordContact: {
            name: string;
            phone: string;
            email: string;
        };
    }>>([]);

    // Update form state when profile data loads
    useEffect(() => {
        console.log('ProfileEditScreen: primaryProfile changed:', primaryProfile);

        if (primaryProfile?.personalProfile) {
            const profile = primaryProfile.personalProfile;
            console.log('ProfileEditScreen: Updating form state with profile data:', profile);
            console.log('ProfileEditScreen: personalInfo from profile:', profile.personalInfo);

            // Update personal info
            const newPersonalInfo = {
                bio: profile.personalInfo?.bio || '',
                occupation: profile.personalInfo?.occupation || '',
                employer: profile.personalInfo?.employer || '',
                annualIncome: profile.personalInfo?.annualIncome?.toString() || '',
                employmentStatus: profile.personalInfo?.employmentStatus || 'employed',
                moveInDate: profile.personalInfo?.moveInDate ? new Date(profile.personalInfo.moveInDate).toISOString().split('T')[0] : '',
                leaseDuration: profile.personalInfo?.leaseDuration || 'yearly',
            };

            console.log('ProfileEditScreen: Setting personalInfo to:', newPersonalInfo);
            setPersonalInfo(newPersonalInfo);

            // Update preferences
            setPreferences({
                propertyTypes: profile.preferences?.propertyTypes || [],
                maxRent: profile.preferences?.maxRent?.toString() || '',
                minBedrooms: profile.preferences?.minBedrooms?.toString() || '',
                minBathrooms: profile.preferences?.minBathrooms?.toString() || '',
                preferredAmenities: profile.preferences?.preferredAmenities || [],
                petFriendly: profile.preferences?.petFriendly || false,
                smokingAllowed: profile.preferences?.smokingAllowed || false,
                furnished: profile.preferences?.furnished || false,
                parkingRequired: profile.preferences?.parkingRequired || false,
                accessibility: profile.preferences?.accessibility || false,
            });

            // Update settings
            setSettings({
                notifications: {
                    email: profile.settings?.notifications?.email ?? true,
                    push: profile.settings?.notifications?.push ?? true,
                    sms: profile.settings?.notifications?.sms ?? false,
                    propertyAlerts: profile.settings?.notifications?.propertyAlerts ?? true,
                    viewingReminders: profile.settings?.notifications?.viewingReminders ?? true,
                    leaseUpdates: profile.settings?.notifications?.leaseUpdates ?? true,
                },
                privacy: {
                    profileVisibility: profile.settings?.privacy?.profileVisibility || 'public',
                    showContactInfo: profile.settings?.privacy?.showContactInfo ?? true,
                    showIncome: profile.settings?.privacy?.showIncome ?? false,
                    showRentalHistory: profile.settings?.privacy?.showRentalHistory ?? false,
                    showReferences: profile.settings?.privacy?.showReferences ?? false,
                },
                language: profile.settings?.language || 'en',
                timezone: profile.settings?.timezone || 'UTC',
                currency: profile.settings?.currency || 'USD',
            });

            // Update references
            const newReferences = profile.references?.map(ref => ({
                name: ref.name,
                relationship: ref.relationship,
                phone: ref.phone || '',
                email: ref.email || '',
            })) || [];

            console.log('ProfileEditScreen: Setting references to:', newReferences);
            setReferences(newReferences);

            // Update rental history
            const newRentalHistory = profile.rentalHistory?.map(history => ({
                address: history.address,
                startDate: new Date(history.startDate).toISOString().split('T')[0],
                endDate: history.endDate ? new Date(history.endDate).toISOString().split('T')[0] : undefined,
                monthlyRent: history.monthlyRent?.toString() || undefined,
                reasonForLeaving: history.reasonForLeaving || 'lease_ended',
                landlordContact: {
                    name: history.landlordContact?.name || '',
                    phone: history.landlordContact?.phone || '',
                    email: history.landlordContact?.email || '',
                },
            })) || [];

            console.log('ProfileEditScreen: Setting rentalHistory to:', newRentalHistory);
            setRentalHistory(newRentalHistory);

            setHasUnsavedChanges(false);
        } else {
            console.log('ProfileEditScreen: No personalProfile found in primaryProfile');
        }
    }, [primaryProfile?.personalProfile]);

    // Memoize trust score data to prevent unnecessary re-renders
    const trustScoreData = useMemo(() => {
        if (!primaryProfile?.personalProfile?.trustScore) {
            return { score: 0, factors: [] };
        }

        const trustScore = primaryProfile.personalProfile.trustScore;
        return {
            score: trustScore.score || 0,
            factors: trustScore.factors?.map(factor => ({
                type: factor.type,
                value: factor.value,
                maxValue: 20, // Default max value, should come from backend
                label: factor.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            })) || []
        };
    }, [primaryProfile?.personalProfile?.trustScore]);

    // Memoize the handleSave function to prevent unnecessary re-renders
    const handleSave = useCallback(async () => {
        if (!primaryProfile) {
            Alert.alert('Error', 'No profile found to update.');
            return;
        }

        setIsSaving(true);
        try {
            const updateData: UpdateProfileData = {
                personalProfile: {
                    personalInfo: {
                        ...personalInfo,
                        annualIncome: personalInfo.annualIncome ? parseInt(personalInfo.annualIncome) : undefined,
                        moveInDate: personalInfo.moveInDate || undefined,
                    },
                    preferences: {
                        ...preferences,
                        maxRent: preferences.maxRent ? parseInt(preferences.maxRent) : undefined,
                        minBedrooms: preferences.minBedrooms ? parseInt(preferences.minBedrooms) : undefined,
                        minBathrooms: preferences.minBathrooms ? parseInt(preferences.minBathrooms) : undefined,
                    },
                    references: references.filter(ref => ref.name.trim()).map(ref => ({
                        name: ref.name,
                        relationship: ref.relationship,
                        phone: ref.phone,
                        email: ref.email,
                    })),
                    rentalHistory: rentalHistory.filter(history => history.address.trim()).map(history => ({
                        address: history.address,
                        startDate: history.startDate,
                        endDate: history.endDate,
                        monthlyRent: history.monthlyRent ? parseInt(history.monthlyRent) : undefined,
                        reasonForLeaving: history.reasonForLeaving,
                        landlordContact: {
                            name: history.landlordContact.name,
                            phone: history.landlordContact.phone,
                            email: history.landlordContact.email,
                        },
                    })),
                    settings,
                },
            };

            const result = await updateProfileMutation.mutateAsync(updateData);
            console.log('Updated profile data:', result);

            Alert.alert(
                'Success',
                'Profile updated successfully! Your changes have been saved.',
                [{ text: 'OK' }]
            );

            setHasUnsavedChanges(false);
        } catch (error) {
            console.error('Error updating profile:', error);
            Alert.alert(
                'Error',
                'Failed to update profile. Please try again.',
                [{ text: 'OK' }]
            );
        } finally {
            setIsSaving(false);
        }
    }, [primaryProfile, personalInfo, preferences, references, rentalHistory, settings, updateProfileMutation]);

    // Track changes
    const updatePersonalInfo = (updates: Partial<typeof personalInfo>) => {
        setPersonalInfo(prev => ({ ...prev, ...updates }));
        setHasUnsavedChanges(true);
    };

    const updatePreferences = (updates: Partial<typeof preferences>) => {
        setPreferences(prev => ({ ...prev, ...updates }));
        setHasUnsavedChanges(true);
    };

    const updateSettings = (updates: Partial<typeof settings>) => {
        setSettings(prev => ({ ...prev, ...updates }));
        setHasUnsavedChanges(true);
    };

    const toggleAmenity = (amenity: string) => {
        setPreferences(prev => ({
            ...prev,
            preferredAmenities: prev.preferredAmenities.includes(amenity)
                ? prev.preferredAmenities.filter(a => a !== amenity)
                : [...prev.preferredAmenities, amenity]
        }));
        setHasUnsavedChanges(true);
    };

    const togglePropertyType = (type: string) => {
        setPreferences(prev => ({
            ...prev,
            propertyTypes: prev.propertyTypes.includes(type)
                ? prev.propertyTypes.filter(t => t !== type)
                : [...prev.propertyTypes, type]
        }));
        setHasUnsavedChanges(true);
    };

    const addReference = () => {
        setReferences(prev => [...prev, {
            name: '',
            relationship: 'personal',
            phone: '',
            email: '',
        }]);
        setHasUnsavedChanges(true);
    };

    const updateReference = (index: number, updates: Partial<typeof references[0]>) => {
        setReferences(prev => prev.map((ref, i) => i === index ? { ...ref, ...updates } : ref));
        setHasUnsavedChanges(true);
    };

    const removeReference = (index: number) => {
        setReferences(prev => prev.filter((_, i) => i !== index));
        setHasUnsavedChanges(true);
    };

    const addRentalHistory = () => {
        setRentalHistory(prev => [...prev, {
            address: '',
            startDate: '',
            endDate: '',
            monthlyRent: '',
            reasonForLeaving: 'lease_ended',
            landlordContact: {
                name: '',
                phone: '',
                email: '',
            },
        }]);
        setHasUnsavedChanges(true);
    };

    const updateRentalHistory = (index: number, updates: Partial<typeof rentalHistory[0]>) => {
        setRentalHistory(prev => prev.map((history, i) => i === index ? { ...history, ...updates } : history));
        setHasUnsavedChanges(true);
    };

    const removeRentalHistory = (index: number) => {
        setRentalHistory(prev => prev.filter((_, i) => i !== index));
        setHasUnsavedChanges(true);
    };

    // Manual refresh function
    const handleRefresh = async () => {
        try {
            console.log('Manually refreshing profile data...');
            await refetchProfile();
            console.log('Profile data refreshed successfully');
        } catch (error) {
            console.error('Error refreshing profile data:', error);
        }
    };

    const renderSection = () => {
        console.log('ProfileEditScreen: Rendering section with personalInfo:', personalInfo);
        console.log('ProfileEditScreen: Rendering section with references:', references);
        console.log('ProfileEditScreen: Rendering section with rentalHistory:', rentalHistory);

        switch (activeSection) {
            case 'personal':
                return (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Personal Information</Text>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Bio</Text>
                            <TextInput
                                style={[styles.input, styles.textArea]}
                                value={personalInfo.bio}
                                onChangeText={(text) => updatePersonalInfo({ bio: text })}
                                placeholder="Tell us about yourself..."
                                multiline
                                numberOfLines={4}
                            />
                        </View>

                        <View style={styles.row}>
                            <View style={[styles.inputGroup, styles.halfWidth]}>
                                <Text style={styles.label}>Occupation</Text>
                                <TextInput
                                    style={styles.input}
                                    value={personalInfo.occupation}
                                    onChangeText={(text) => updatePersonalInfo({ occupation: text })}
                                    placeholder="e.g., Software Engineer"
                                />
                            </View>
                            <View style={[styles.inputGroup, styles.halfWidth]}>
                                <Text style={styles.label}>Employer</Text>
                                <TextInput
                                    style={styles.input}
                                    value={personalInfo.employer}
                                    onChangeText={(text) => updatePersonalInfo({ employer: text })}
                                    placeholder="e.g., Tech Corp"
                                />
                            </View>
                        </View>

                        <View style={styles.row}>
                            <View style={[styles.inputGroup, styles.halfWidth]}>
                                <Text style={styles.label}>Annual Income ($)</Text>
                                <TextInput
                                    style={styles.input}
                                    value={personalInfo.annualIncome}
                                    onChangeText={(text) => updatePersonalInfo({ annualIncome: text })}
                                    placeholder="e.g., 75000"
                                    keyboardType="numeric"
                                />
                            </View>
                            <View style={[styles.inputGroup, styles.halfWidth]}>
                                <Text style={styles.label}>Employment Status</Text>
                                <View style={styles.pickerContainer}>
                                    {['employed', 'self_employed', 'student', 'retired', 'unemployed', 'other'].map((status) => (
                                        <TouchableOpacity
                                            key={status}
                                            style={[
                                                styles.pickerOption,
                                                personalInfo.employmentStatus === status && styles.pickerOptionSelected
                                            ]}
                                            onPress={() => updatePersonalInfo({ employmentStatus: status as any })}
                                        >
                                            <Text style={[
                                                styles.pickerOptionText,
                                                personalInfo.employmentStatus === status && styles.pickerOptionTextSelected
                                            ]}>
                                                {status.replace('_', ' ').toUpperCase()}
                                            </Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            </View>
                        </View>

                        <View style={styles.row}>
                            <View style={[styles.inputGroup, styles.halfWidth]}>
                                <Text style={styles.label}>Move-in Date</Text>
                                <TextInput
                                    style={styles.input}
                                    value={personalInfo.moveInDate}
                                    onChangeText={(text) => updatePersonalInfo({ moveInDate: text })}
                                    placeholder="YYYY-MM-DD"
                                />
                            </View>
                            <View style={[styles.inputGroup, styles.halfWidth]}>
                                <Text style={styles.label}>Lease Duration</Text>
                                <View style={styles.pickerContainer}>
                                    {['monthly', '3_months', '6_months', 'yearly', 'flexible'].map((duration) => (
                                        <TouchableOpacity
                                            key={duration}
                                            style={[
                                                styles.pickerOption,
                                                personalInfo.leaseDuration === duration && styles.pickerOptionSelected
                                            ]}
                                            onPress={() => updatePersonalInfo({ leaseDuration: duration as any })}
                                        >
                                            <Text style={[
                                                styles.pickerOptionText,
                                                personalInfo.leaseDuration === duration && styles.pickerOptionTextSelected
                                            ]}>
                                                {duration.replace('_', ' ').toUpperCase()}
                                            </Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            </View>
                        </View>
                    </View>
                );

            case 'preferences':
                return (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Property Preferences</Text>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Maximum Rent ($)</Text>
                            <TextInput
                                style={styles.input}
                                value={preferences.maxRent}
                                onChangeText={(text) => updatePreferences({ maxRent: text })}
                                placeholder="Enter maximum rent"
                                keyboardType="numeric"
                            />
                        </View>

                        <View style={styles.row}>
                            <View style={[styles.inputGroup, styles.halfWidth]}>
                                <Text style={styles.label}>Min Bedrooms</Text>
                                <TextInput
                                    style={styles.input}
                                    value={preferences.minBedrooms}
                                    onChangeText={(text) => updatePreferences({ minBedrooms: text })}
                                    placeholder="0"
                                    keyboardType="numeric"
                                />
                            </View>
                            <View style={[styles.inputGroup, styles.halfWidth]}>
                                <Text style={styles.label}>Min Bathrooms</Text>
                                <TextInput
                                    style={styles.input}
                                    value={preferences.minBathrooms}
                                    onChangeText={(text) => updatePreferences({ minBathrooms: text })}
                                    placeholder="0"
                                    keyboardType="numeric"
                                />
                            </View>
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Property Types</Text>
                            <View style={styles.checkboxGroup}>
                                {['apartment', 'house', 'room', 'studio'].map((type) => (
                                    <TouchableOpacity
                                        key={type}
                                        style={[
                                            styles.checkbox,
                                            preferences.propertyTypes.includes(type) && styles.checkboxSelected
                                        ]}
                                        onPress={() => togglePropertyType(type)}
                                    >
                                        <Text style={[
                                            styles.checkboxText,
                                            preferences.propertyTypes.includes(type) && styles.checkboxTextSelected
                                        ]}>
                                            {type.charAt(0).toUpperCase() + type.slice(1)}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Preferred Amenities</Text>
                            <View style={styles.checkboxGroup}>
                                {['parking', 'gym', 'pool', 'washer', 'dishwasher', 'balcony', 'elevator', 'ac', 'heating', 'internet'].map((amenity) => (
                                    <TouchableOpacity
                                        key={amenity}
                                        style={[
                                            styles.checkbox,
                                            preferences.preferredAmenities.includes(amenity) && styles.checkboxSelected
                                        ]}
                                        onPress={() => toggleAmenity(amenity)}
                                    >
                                        <Text style={[
                                            styles.checkboxText,
                                            preferences.preferredAmenities.includes(amenity) && styles.checkboxTextSelected
                                        ]}>
                                            {amenity.charAt(0).toUpperCase() + amenity.slice(1)}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Additional Preferences</Text>
                            <View style={styles.switchGroup}>
                                <TouchableOpacity
                                    style={[
                                        styles.switch,
                                        preferences.petFriendly && styles.switchActive
                                    ]}
                                    onPress={() => updatePreferences({ petFriendly: !preferences.petFriendly })}
                                >
                                    <Text style={[
                                        styles.switchText,
                                        preferences.petFriendly && styles.switchTextActive
                                    ]}>
                                        Pet Friendly
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[
                                        styles.switch,
                                        preferences.smokingAllowed && styles.switchActive
                                    ]}
                                    onPress={() => updatePreferences({ smokingAllowed: !preferences.smokingAllowed })}
                                >
                                    <Text style={[
                                        styles.switchText,
                                        preferences.smokingAllowed && styles.switchTextActive
                                    ]}>
                                        Smoking Allowed
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[
                                        styles.switch,
                                        preferences.furnished && styles.switchActive
                                    ]}
                                    onPress={() => updatePreferences({ furnished: !preferences.furnished })}
                                >
                                    <Text style={[
                                        styles.switchText,
                                        preferences.furnished && styles.switchTextActive
                                    ]}>
                                        Furnished
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[
                                        styles.switch,
                                        preferences.parkingRequired && styles.switchActive
                                    ]}
                                    onPress={() => updatePreferences({ parkingRequired: !preferences.parkingRequired })}
                                >
                                    <Text style={[
                                        styles.switchText,
                                        preferences.parkingRequired && styles.switchTextActive
                                    ]}>
                                        Parking Required
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[
                                        styles.switch,
                                        preferences.accessibility && styles.switchActive
                                    ]}
                                    onPress={() => updatePreferences({ accessibility: !preferences.accessibility })}
                                >
                                    <Text style={[
                                        styles.switchText,
                                        preferences.accessibility && styles.switchTextActive
                                    ]}>
                                        Accessibility Features
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                );

            case 'references':
                return (
                    <View style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <Text style={styles.sectionTitle}>References</Text>
                            <TouchableOpacity style={styles.addButton} onPress={addReference}>
                                <Text style={styles.addButtonText}>+ Add Reference</Text>
                            </TouchableOpacity>
                        </View>

                        {references.map((reference, index) => (
                            <View key={index} style={styles.referenceCard}>
                                <View style={styles.cardHeader}>
                                    <Text style={styles.cardTitle}>Reference {index + 1}</Text>
                                    <TouchableOpacity onPress={() => removeReference(index)}>
                                        <Text style={styles.removeButton}>Remove</Text>
                                    </TouchableOpacity>
                                </View>

                                <View style={styles.inputGroup}>
                                    <Text style={styles.label}>Name</Text>
                                    <TextInput
                                        style={styles.input}
                                        value={reference.name}
                                        onChangeText={(text) => updateReference(index, { name: text })}
                                        placeholder="Full name"
                                    />
                                </View>

                                <View style={styles.inputGroup}>
                                    <Text style={styles.label}>Relationship</Text>
                                    <View style={styles.pickerContainer}>
                                        {['landlord', 'employer', 'personal', 'other'].map((rel) => (
                                            <TouchableOpacity
                                                key={rel}
                                                style={[
                                                    styles.pickerOption,
                                                    reference.relationship === rel && styles.pickerOptionSelected
                                                ]}
                                                onPress={() => updateReference(index, { relationship: rel as any })}
                                            >
                                                <Text style={[
                                                    styles.pickerOptionText,
                                                    reference.relationship === rel && styles.pickerOptionTextSelected
                                                ]}>
                                                    {rel.charAt(0).toUpperCase() + rel.slice(1)}
                                                </Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                </View>

                                <View style={styles.row}>
                                    <View style={[styles.inputGroup, styles.halfWidth]}>
                                        <Text style={styles.label}>Phone</Text>
                                        <TextInput
                                            style={styles.input}
                                            value={reference.phone}
                                            onChangeText={(text) => updateReference(index, { phone: text })}
                                            placeholder="Phone number"
                                            keyboardType="phone-pad"
                                        />
                                    </View>
                                    <View style={[styles.inputGroup, styles.halfWidth]}>
                                        <Text style={styles.label}>Email</Text>
                                        <TextInput
                                            style={styles.input}
                                            value={reference.email}
                                            onChangeText={(text) => updateReference(index, { email: text })}
                                            placeholder="Email address"
                                            keyboardType="email-address"
                                        />
                                    </View>
                                </View>
                            </View>
                        ))}
                    </View>
                );

            case 'rental-history':
                return (
                    <View style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <Text style={styles.sectionTitle}>Rental History</Text>
                            <TouchableOpacity style={styles.addButton} onPress={addRentalHistory}>
                                <Text style={styles.addButtonText}>+ Add History</Text>
                            </TouchableOpacity>
                        </View>

                        {rentalHistory.map((history, index) => (
                            <View key={index} style={styles.referenceCard}>
                                <View style={styles.cardHeader}>
                                    <Text style={styles.cardTitle}>Rental {index + 1}</Text>
                                    <TouchableOpacity onPress={() => removeRentalHistory(index)}>
                                        <Text style={styles.removeButton}>Remove</Text>
                                    </TouchableOpacity>
                                </View>

                                <View style={styles.inputGroup}>
                                    <Text style={styles.label}>Address</Text>
                                    <TextInput
                                        style={styles.input}
                                        value={history.address}
                                        onChangeText={(text) => updateRentalHistory(index, { address: text })}
                                        placeholder="Full address"
                                    />
                                </View>

                                <View style={styles.row}>
                                    <View style={[styles.inputGroup, styles.halfWidth]}>
                                        <Text style={styles.label}>Start Date</Text>
                                        <TextInput
                                            style={styles.input}
                                            value={history.startDate}
                                            onChangeText={(text) => updateRentalHistory(index, { startDate: text })}
                                            placeholder="YYYY-MM-DD"
                                        />
                                    </View>
                                    <View style={[styles.inputGroup, styles.halfWidth]}>
                                        <Text style={styles.label}>End Date</Text>
                                        <TextInput
                                            style={styles.input}
                                            value={history.endDate}
                                            onChangeText={(text) => updateRentalHistory(index, { endDate: text })}
                                            placeholder="YYYY-MM-DD (optional)"
                                        />
                                    </View>
                                </View>

                                <View style={styles.row}>
                                    <View style={[styles.inputGroup, styles.halfWidth]}>
                                        <Text style={styles.label}>Monthly Rent ($)</Text>
                                        <TextInput
                                            style={styles.input}
                                            value={history.monthlyRent}
                                            onChangeText={(text) => updateRentalHistory(index, { monthlyRent: text })}
                                            placeholder="e.g., 1500"
                                            keyboardType="numeric"
                                        />
                                    </View>
                                    <View style={[styles.inputGroup, styles.halfWidth]}>
                                        <Text style={styles.label}>Reason for Leaving</Text>
                                        <View style={styles.pickerContainer}>
                                            {['lease_ended', 'bought_home', 'job_relocation', 'family_reasons', 'upgrade', 'other'].map((reason) => (
                                                <TouchableOpacity
                                                    key={reason}
                                                    style={[
                                                        styles.pickerOption,
                                                        history.reasonForLeaving === reason && styles.pickerOptionSelected
                                                    ]}
                                                    onPress={() => updateRentalHistory(index, { reasonForLeaving: reason as any })}
                                                >
                                                    <Text style={[
                                                        styles.pickerOptionText,
                                                        history.reasonForLeaving === reason && styles.pickerOptionTextSelected
                                                    ]}>
                                                        {reason.replace('_', ' ').toUpperCase()}
                                                    </Text>
                                                </TouchableOpacity>
                                            ))}
                                        </View>
                                    </View>
                                </View>

                                <View style={styles.inputGroup}>
                                    <Text style={styles.label}>Landlord Contact</Text>
                                    <View style={styles.row}>
                                        <View style={[styles.inputGroup, styles.halfWidth]}>
                                            <TextInput
                                                style={styles.input}
                                                value={history.landlordContact.name}
                                                onChangeText={(text) => updateRentalHistory(index, {
                                                    landlordContact: { ...history.landlordContact, name: text }
                                                })}
                                                placeholder="Landlord name"
                                            />
                                        </View>
                                        <View style={[styles.inputGroup, styles.halfWidth]}>
                                            <TextInput
                                                style={styles.input}
                                                value={history.landlordContact.phone}
                                                onChangeText={(text) => updateRentalHistory(index, {
                                                    landlordContact: { ...history.landlordContact, phone: text }
                                                })}
                                                placeholder="Phone"
                                                keyboardType="phone-pad"
                                            />
                                        </View>
                                    </View>
                                    <TextInput
                                        style={styles.input}
                                        value={history.landlordContact.email}
                                        onChangeText={(text) => updateRentalHistory(index, {
                                            landlordContact: { ...history.landlordContact, email: text }
                                        })}
                                        placeholder="Email"
                                        keyboardType="email-address"
                                    />
                                </View>
                            </View>
                        ))}
                    </View>
                );

            case 'trust-score':
                return (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Trust Score</Text>
                        <TrustScore
                            score={trustScoreData.score}
                            size="large"
                            showDetails={true}
                            factors={trustScoreData.factors}
                        />
                    </View>
                );

            case 'settings':
                return (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Settings</Text>

                        <View style={styles.subsection}>
                            <Text style={styles.subsectionTitle}>Notifications</Text>
                            <View style={styles.switchGroup}>
                                <TouchableOpacity
                                    style={[
                                        styles.switch,
                                        settings.notifications.email && styles.switchActive
                                    ]}
                                    onPress={() => updateSettings({
                                        notifications: { ...settings.notifications, email: !settings.notifications.email }
                                    })}
                                >
                                    <Text style={[
                                        styles.switchText,
                                        settings.notifications.email && styles.switchTextActive
                                    ]}>
                                        Email Notifications
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[
                                        styles.switch,
                                        settings.notifications.push && styles.switchActive
                                    ]}
                                    onPress={() => updateSettings({
                                        notifications: { ...settings.notifications, push: !settings.notifications.push }
                                    })}
                                >
                                    <Text style={[
                                        styles.switchText,
                                        settings.notifications.push && styles.switchTextActive
                                    ]}>
                                        Push Notifications
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[
                                        styles.switch,
                                        settings.notifications.sms && styles.switchActive
                                    ]}
                                    onPress={() => updateSettings({
                                        notifications: { ...settings.notifications, sms: !settings.notifications.sms }
                                    })}
                                >
                                    <Text style={[
                                        styles.switchText,
                                        settings.notifications.sms && styles.switchTextActive
                                    ]}>
                                        SMS Notifications
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[
                                        styles.switch,
                                        settings.notifications.propertyAlerts && styles.switchActive
                                    ]}
                                    onPress={() => updateSettings({
                                        notifications: { ...settings.notifications, propertyAlerts: !settings.notifications.propertyAlerts }
                                    })}
                                >
                                    <Text style={[
                                        styles.switchText,
                                        settings.notifications.propertyAlerts && styles.switchTextActive
                                    ]}>
                                        Property Alerts
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[
                                        styles.switch,
                                        settings.notifications.viewingReminders && styles.switchActive
                                    ]}
                                    onPress={() => updateSettings({
                                        notifications: { ...settings.notifications, viewingReminders: !settings.notifications.viewingReminders }
                                    })}
                                >
                                    <Text style={[
                                        styles.switchText,
                                        settings.notifications.viewingReminders && styles.switchTextActive
                                    ]}>
                                        Viewing Reminders
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[
                                        styles.switch,
                                        settings.notifications.leaseUpdates && styles.switchActive
                                    ]}
                                    onPress={() => updateSettings({
                                        notifications: { ...settings.notifications, leaseUpdates: !settings.notifications.leaseUpdates }
                                    })}
                                >
                                    <Text style={[
                                        styles.switchText,
                                        settings.notifications.leaseUpdates && styles.switchTextActive
                                    ]}>
                                        Lease Updates
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </View>

                        <View style={styles.subsection}>
                            <Text style={styles.subsectionTitle}>Privacy</Text>
                            <View style={styles.switchGroup}>
                                <TouchableOpacity
                                    style={[
                                        styles.switch,
                                        settings.privacy.showContactInfo && styles.switchActive
                                    ]}
                                    onPress={() => updateSettings({
                                        privacy: { ...settings.privacy, showContactInfo: !settings.privacy.showContactInfo }
                                    })}
                                >
                                    <Text style={[
                                        styles.switchText,
                                        settings.privacy.showContactInfo && styles.switchTextActive
                                    ]}>
                                        Show Contact Info
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[
                                        styles.switch,
                                        settings.privacy.showIncome && styles.switchActive
                                    ]}
                                    onPress={() => updateSettings({
                                        privacy: { ...settings.privacy, showIncome: !settings.privacy.showIncome }
                                    })}
                                >
                                    <Text style={[
                                        styles.switchText,
                                        settings.privacy.showIncome && styles.switchTextActive
                                    ]}>
                                        Show Income
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[
                                        styles.switch,
                                        settings.privacy.showRentalHistory && styles.switchActive
                                    ]}
                                    onPress={() => updateSettings({
                                        privacy: { ...settings.privacy, showRentalHistory: !settings.privacy.showRentalHistory }
                                    })}
                                >
                                    <Text style={[
                                        styles.switchText,
                                        settings.privacy.showRentalHistory && styles.switchTextActive
                                    ]}>
                                        Show Rental History
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[
                                        styles.switch,
                                        settings.privacy.showReferences && styles.switchActive
                                    ]}
                                    onPress={() => updateSettings({
                                        privacy: { ...settings.privacy, showReferences: !settings.privacy.showReferences }
                                    })}
                                >
                                    <Text style={[
                                        styles.switchText,
                                        settings.privacy.showReferences && styles.switchTextActive
                                    ]}>
                                        Show References
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                );

            default:
                return null;
        }
    };

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
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <IconButton name="arrow-back" size={24} color={colors.primaryDark} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>
                    Edit Profile
                    {hasUnsavedChanges && <Text style={styles.unsavedIndicator}> *</Text>}
                </Text>
                <View style={styles.headerActions}>
                    <TouchableOpacity
                        onPress={() => {
                            console.log('=== DEBUG INFO ===');
                            console.log('primaryProfile:', primaryProfile);
                            console.log('personalInfo state:', personalInfo);
                            console.log('profileLoading:', profileLoading);
                            console.log('==================');
                        }}
                        style={[styles.headerButton, styles.debugButton]}
                    >
                        <IconButton
                            name="bug-report"
                            size={20}
                            color={colors.primaryDark}
                        />
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={async () => {
                            try {
                                console.log('Creating test profile data...');
                                const testData = {
                                    personalProfile: {
                                        personalInfo: {
                                            bio: "Test bio - I am a software developer",
                                            occupation: "Software Engineer",
                                            employer: "Tech Company",
                                            annualIncome: 75000,
                                            employmentStatus: "employed" as const,
                                            moveInDate: "2024-06-01",
                                            leaseDuration: "yearly" as const,
                                        },
                                        preferences: {
                                            propertyTypes: ["apartment", "house"],
                                            maxRent: 2000,
                                            minBedrooms: 2,
                                            minBathrooms: 1,
                                            preferredAmenities: ["parking", "gym"],
                                            petFriendly: true,
                                            smokingAllowed: false,
                                            furnished: false,
                                            parkingRequired: true,
                                            accessibility: false,
                                        },
                                        references: [
                                            {
                                                name: "John Smith",
                                                relationship: "landlord" as const,
                                                phone: "555-123-4567",
                                                email: "john.smith@email.com",
                                            },
                                            {
                                                name: "Jane Doe",
                                                relationship: "employer" as const,
                                                phone: "555-987-6543",
                                                email: "jane.doe@company.com",
                                            }
                                        ],
                                        rentalHistory: [
                                            {
                                                address: "123 Main St, City, State 12345",
                                                startDate: "2022-01-01",
                                                endDate: "2023-12-31",
                                                monthlyRent: 1500,
                                                reasonForLeaving: "lease_ended" as const,
                                                landlordContact: {
                                                    name: "John Smith",
                                                    phone: "555-123-4567",
                                                    email: "john.smith@email.com",
                                                },
                                            },
                                            {
                                                address: "456 Oak Ave, City, State 12345",
                                                startDate: "2020-06-01",
                                                endDate: "2021-12-31",
                                                monthlyRent: 1200,
                                                reasonForLeaving: "job_relocation" as const,
                                                landlordContact: {
                                                    name: "Mary Johnson",
                                                    phone: "555-456-7890",
                                                    email: "mary.johnson@email.com",
                                                },
                                            }
                                        ],
                                        settings: {
                                            notifications: {
                                                email: true,
                                                push: true,
                                                sms: false,
                                                propertyAlerts: true,
                                                viewingReminders: true,
                                                leaseUpdates: true,
                                            },
                                            privacy: {
                                                profileVisibility: "public" as const,
                                                showContactInfo: true,
                                                showIncome: false,
                                                showRentalHistory: false,
                                                showReferences: false,
                                            },
                                            language: "en",
                                            timezone: "UTC",
                                            currency: "USD",
                                        },
                                    },
                                };

                                const result = await updateProfileMutation.mutateAsync(testData);
                                console.log('Test profile created:', result);
                                Alert.alert('Success', 'Test profile data created!');
                            } catch (error) {
                                console.error('Error creating test profile:', error);
                                Alert.alert('Error', 'Failed to create test profile');
                            }
                        }}
                        style={[styles.headerButton, styles.testButton]}
                    >
                        <IconButton
                            name="add"
                            size={20}
                            color={colors.primaryDark}
                        />
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={handleRefresh}
                        style={[styles.headerButton, styles.refreshButton]}
                        disabled={profileLoading}
                    >
                        <IconButton
                            name="refresh"
                            size={20}
                            color={colors.primaryDark}
                        />
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={handleSave}
                        style={[
                            styles.saveButton,
                            hasUnsavedChanges && styles.saveButtonActive
                        ]}
                        disabled={isSaving || !hasUnsavedChanges}
                    >
                        {isSaving ? (
                            <ActivityIndicator size="small" color={colors.primaryLight} />
                        ) : (
                            <Text style={styles.saveButtonText}>Save</Text>
                        )}
                    </TouchableOpacity>
                </View>
            </View>

            <View style={styles.tabContainer}>
                {[
                    { key: 'personal', label: 'Personal' },
                    { key: 'preferences', label: 'Preferences' },
                    { key: 'references', label: 'References' },
                    { key: 'rental-history', label: 'History' },
                    { key: 'trust-score', label: 'Trust Score' },
                    { key: 'settings', label: 'Settings' },
                ].map((tab) => (
                    <TouchableOpacity
                        key={tab.key}
                        style={[
                            styles.tab,
                            activeSection === tab.key && styles.tabActive
                        ]}
                        onPress={() => setActiveSection(tab.key)}
                    >
                        <Text style={[
                            styles.tabText,
                            activeSection === tab.key && styles.tabTextActive
                        ]}>
                            {tab.label}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            <ScrollView
                style={styles.container}
                key={primaryProfile?.personalProfile ? 'profile-loaded' : 'profile-loading'}
            >
                {renderSection()}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
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
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: colors.primaryLight,
        borderBottomWidth: 1,
        borderBottomColor: colors.primaryLight_1,
    },
    backButton: {
        padding: 8,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: colors.primaryDark,
    },
    unsavedIndicator: {
        color: colors.primaryColor,
        fontWeight: 'bold',
    },
    saveButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: colors.primaryLight_1,
        borderRadius: 20,
    },
    saveButtonActive: {
        backgroundColor: colors.primaryColor,
    },
    saveButtonText: {
        color: colors.primaryLight,
        fontSize: 16,
        fontWeight: '600',
    },
    tabContainer: {
        flexDirection: 'row',
        backgroundColor: colors.primaryLight,
        borderBottomWidth: 1,
        borderBottomColor: colors.primaryLight_1,
    },
    tab: {
        flex: 1,
        paddingVertical: 12,
        alignItems: 'center',
    },
    tabActive: {
        borderBottomWidth: 2,
        borderBottomColor: colors.primaryColor,
    },
    tabText: {
        fontSize: 14,
        color: colors.primaryDark,
        fontWeight: '500',
    },
    tabTextActive: {
        color: colors.primaryColor,
        fontWeight: '600',
    },
    container: {
        flex: 1,
        backgroundColor: colors.primaryLight,
    },
    section: {
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.primaryLight_1,
    },
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: colors.primaryDark,
        marginBottom: 16,
    },
    subsection: {
        marginBottom: 24,
    },
    subsectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryDark,
        marginBottom: 12,
    },
    inputGroup: {
        marginBottom: 16,
    },
    label: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryDark,
        marginBottom: 8,
    },
    input: {
        borderWidth: 1,
        borderColor: colors.primaryLight_1,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 12,
        fontSize: 16,
        backgroundColor: colors.primaryLight,
    },
    textArea: {
        height: 100,
        textAlignVertical: 'top',
    },
    row: {
        flexDirection: 'row',
        gap: 12,
    },
    halfWidth: {
        flex: 1,
    },
    checkboxGroup: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    checkbox: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: colors.primaryLight_1,
        backgroundColor: colors.primaryLight,
    },
    checkboxSelected: {
        backgroundColor: colors.primaryColor,
        borderColor: colors.primaryColor,
    },
    checkboxText: {
        fontSize: 14,
        color: colors.primaryDark,
    },
    checkboxTextSelected: {
        color: colors.primaryLight,
    },
    pickerContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    pickerOption: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: colors.primaryLight_1,
        backgroundColor: colors.primaryLight,
    },
    pickerOptionSelected: {
        backgroundColor: colors.primaryColor,
        borderColor: colors.primaryColor,
    },
    pickerOptionText: {
        fontSize: 12,
        color: colors.primaryDark,
    },
    pickerOptionTextSelected: {
        color: colors.primaryLight,
    },
    switchGroup: {
        gap: 12,
    },
    switch: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.primaryLight_1,
        backgroundColor: colors.primaryLight,
    },
    switchActive: {
        backgroundColor: colors.primaryColor,
        borderColor: colors.primaryColor,
    },
    switchText: {
        fontSize: 16,
        color: colors.primaryDark,
    },
    switchTextActive: {
        color: colors.primaryLight,
    },
    addButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: colors.primaryColor,
        borderRadius: 20,
    },
    addButtonText: {
        color: colors.primaryLight,
        fontSize: 14,
        fontWeight: '600',
    },
    referenceCard: {
        backgroundColor: colors.primaryLight,
        borderWidth: 1,
        borderColor: colors.primaryLight_1,
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    cardTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryDark,
    },
    removeButton: {
        color: colors.primaryColor,
        fontSize: 14,
        fontWeight: '600',
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    headerButton: {
        padding: 8,
    },
    refreshButton: {
        padding: 8,
    },
    debugButton: {
        padding: 8,
    },
    testButton: {
        padding: 8,
    },
}); 
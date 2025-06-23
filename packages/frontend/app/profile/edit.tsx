import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/styles/colors';
import { useRouter } from 'expo-router';
import { IconButton } from '@/components/IconButton';
import { TrustScore } from '@/components/TrustScore';
import { Header } from '@/components/Header';
import { useActiveProfile, useUpdateProfile } from '@/hooks/useProfileQueries';
import { UpdateProfileData } from '@/services/profileService';
import { storeData, getData } from '@/utils/storage';

export default function ProfileEditScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const { data: activeProfile, isLoading: profileLoading, refetch: refetchProfile } = useActiveProfile();
    const updateProfileMutation = useUpdateProfile();
    const [isSaving, setIsSaving] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [activeSection, setActiveSection] = useState('personal');
    const [isFormInitialized, setIsFormInitialized] = useState(false);

    // Track previous profile to detect changes
    const prevProfileIdRef = React.useRef<string | null>(null);

    // Reset initialization when a different profile loads
    useEffect(() => {
        if (activeProfile?.id && activeProfile.id !== prevProfileIdRef.current) {
            prevProfileIdRef.current = activeProfile.id;
            setIsFormInitialized(false);
        }
    }, [activeProfile?.id]);

    // Get profile type to determine which UI to show
    const profileType = activeProfile?.profileType || 'personal';
    console.log('ProfileEditScreen: Determined profileType:', profileType, 'from activeProfile.profileType:', activeProfile?.profileType);

    // Load saved tab state on mount
    useEffect(() => {
        const loadSavedTabState = async () => {
            try {
                const savedTab = await getData<string>('profile-edit-active-section');
                if (savedTab && ['personal', 'preferences', 'verification', 'business', 'settings'].includes(savedTab)) {
                    setActiveSection(savedTab);
                } else {
                    // Set default active section based on profile type
                    if (profileType === 'agency') {
                        setActiveSection('business');
                    } else {
                        setActiveSection('personal');
                    }
                }
            } catch (error) {
                console.error('Error loading saved tab state:', error);
                // Fallback to default behavior
                if (profileType === 'agency') {
                    setActiveSection('business');
                } else {
                    setActiveSection('personal');
                }
            }
        };

        loadSavedTabState();
    }, [profileType]);

    // Save tab state when it changes
    useEffect(() => {
        if (isFormInitialized) {
            storeData('profile-edit-active-section', activeSection);
        }
    }, [activeSection, isFormInitialized]);

    // Debug logging for component lifecycle
    useEffect(() => {
        console.log('ProfileEditScreen: Component mounted');
    }, []);

    useEffect(() => {
        console.log('ProfileEditScreen: profileLoading changed to:', profileLoading);
    }, [profileLoading]);

    // Form state for personal profile
    const [personalInfo, setPersonalInfo] = useState({
        bio: '',
        occupation: '',
        employer: '',
        annualIncome: '',
        employmentStatus: 'employed' as 'employed' | 'self_employed' | 'student' | 'retired' | 'unemployed' | 'other',
        moveInDate: '',
        leaseDuration: 'yearly' as 'monthly' | '3_months' | '6_months' | 'yearly' | 'flexible',
    });

    // Form state for agency profile
    const [agencyInfo, setAgencyInfo] = useState({
        businessType: 'real_estate_agency' as 'real_estate_agency' | 'property_management' | 'brokerage' | 'developer' | 'other',
        legalCompanyName: '',
        description: '',
        businessDetails: {
            licenseNumber: '',
            taxId: '',
            yearEstablished: '',
            employeeCount: '1-10' as '1-10' | '11-50' | '51-200' | '200+',
            specialties: [] as string[],
        },
        verification: {
            businessLicense: false,
            insurance: false,
            bonding: false,
            backgroundCheck: false,
        },
    });

    // Form state for business profile
    const [businessInfo, setBusinessInfo] = useState({
        businessType: 'startup' as 'small_business' | 'startup' | 'freelancer' | 'consultant' | 'other',
        legalCompanyName: '',
        description: '',
        businessDetails: {
            licenseNumber: '',
            taxId: '',
            yearEstablished: '',
            employeeCount: '1-5' as '1-5' | '6-10' | '11-25' | '26+',
            industry: '',
            specialties: [] as string[],
        },
        verification: {
            businessLicense: false,
            insurance: false,
            backgroundCheck: false,
        },
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
        // Skip if form is already initialized
        if (isFormInitialized) {
            return;
        }

        // If there's no active profile, initialize with defaults
        if (!activeProfile) {
            console.log('ProfileEditScreen: No active profile found, initializing with defaults');
            setIsFormInitialized(true);
            return;
        }

        console.log('ProfileEditScreen: Initializing form with profile data:', activeProfile);
        console.log('ProfileEditScreen: profileType:', profileType);
        console.log('ProfileEditScreen: activeProfile structure:');
        console.log('  - profileType:', activeProfile?.profileType);
        console.log('  - personalProfile exists:', !!activeProfile?.personalProfile);
        console.log('  - agencyProfile exists:', !!activeProfile?.agencyProfile);
        console.log('  - businessProfile exists:', !!activeProfile?.businessProfile);
        console.log('  - personalProfile data:', activeProfile?.personalProfile);

        // Log a few specific fields to see structure
        if (activeProfile?.personalProfile) {
            console.log('  - personalProfile.personalInfo:', activeProfile.personalProfile.personalInfo);
            console.log('  - personalProfile.preferences:', activeProfile.personalProfile.preferences);
        }

        if (profileType === 'personal') {
            // Initialize personal profile form whether or not personalProfile exists
            const profile = activeProfile?.personalProfile;
            console.log('ProfileEditScreen: Updating form state with profile data:', profile);
            console.log('ProfileEditScreen: personalInfo from profile:', profile?.personalInfo);

            // Update personal info
            const newPersonalInfo = {
                bio: profile?.personalInfo?.bio || '',
                occupation: profile?.personalInfo?.occupation || '',
                employer: profile?.personalInfo?.employer || '',
                annualIncome: profile?.personalInfo?.annualIncome?.toString() || '',
                employmentStatus: profile?.personalInfo?.employmentStatus || 'employed',
                moveInDate: profile?.personalInfo?.moveInDate ? new Date(profile.personalInfo.moveInDate).toISOString().split('T')[0] : '',
                leaseDuration: profile?.personalInfo?.leaseDuration || 'yearly',
            };

            console.log('ProfileEditScreen: Setting personalInfo to:', newPersonalInfo);
            setPersonalInfo(newPersonalInfo);

            // Update preferences
            setPreferences({
                propertyTypes: profile?.preferences?.propertyTypes || [],
                maxRent: profile?.preferences?.maxRent?.toString() || '',
                minBedrooms: profile?.preferences?.minBedrooms?.toString() || '',
                minBathrooms: profile?.preferences?.minBathrooms?.toString() || '',
                preferredAmenities: profile?.preferences?.preferredAmenities || [],
                petFriendly: profile?.preferences?.petFriendly || false,
                smokingAllowed: profile?.preferences?.smokingAllowed || false,
                furnished: profile?.preferences?.furnished || false,
                parkingRequired: profile?.preferences?.parkingRequired || false,
                accessibility: profile?.preferences?.accessibility || false,
            });

            // Update settings
            setSettings({
                notifications: {
                    email: profile?.settings?.notifications?.email ?? true,
                    push: profile?.settings?.notifications?.push ?? true,
                    sms: profile?.settings?.notifications?.sms ?? false,
                    propertyAlerts: profile?.settings?.notifications?.propertyAlerts ?? true,
                    viewingReminders: profile?.settings?.notifications?.viewingReminders ?? true,
                    leaseUpdates: profile?.settings?.notifications?.leaseUpdates ?? true,
                },
                privacy: {
                    profileVisibility: profile?.settings?.privacy?.profileVisibility || 'public',
                    showContactInfo: profile?.settings?.privacy?.showContactInfo ?? true,
                    showIncome: profile?.settings?.privacy?.showIncome ?? false,
                    showRentalHistory: profile?.settings?.privacy?.showRentalHistory ?? false,
                    showReferences: profile?.settings?.privacy?.showReferences ?? false,
                },
                language: profile?.settings?.language || 'en',
                timezone: profile?.settings?.timezone || 'UTC',
                currency: profile?.settings?.currency || 'USD',
            });

            // Update references
            const newReferences = profile?.references?.map(ref => ({
                name: ref.name,
                relationship: ref.relationship,
                phone: ref.phone || '',
                email: ref.email || '',
            })) || [];

            console.log('ProfileEditScreen: Setting references to:', newReferences);
            setReferences(newReferences);

            // Update rental history
            const newRentalHistory = profile?.rentalHistory?.map(history => ({
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
            setIsFormInitialized(true);
        } else if (profileType === 'agency') {
            // Initialize agency profile form whether or not agencyProfile exists
            const profile = activeProfile?.agencyProfile;
            console.log('ProfileEditScreen: Updating agency form state with profile data:', profile);
            // Defensive: ensure all fields and nested fields are set with defaults if missing
            setAgencyInfo({
                businessType: profile?.businessType || 'real_estate_agency',
                legalCompanyName: profile?.legalCompanyName || '',
                description: profile?.description || '',
                businessDetails: {
                    licenseNumber: profile?.businessDetails?.licenseNumber || '',
                    taxId: profile?.businessDetails?.taxId || '',
                    yearEstablished: profile?.businessDetails?.yearEstablished?.toString() || '',
                    employeeCount: profile?.businessDetails?.employeeCount || '1-10',
                    specialties: profile?.businessDetails?.specialties || [],
                },
                verification: {
                    businessLicense: profile?.verification?.businessLicense || false,
                    insurance: profile?.verification?.insurance || false,
                    bonding: profile?.verification?.bonding || false,
                    backgroundCheck: profile?.verification?.backgroundCheck || false,
                },
            });
            // Log all fields for debugging
            console.log('AgencyInfo set to:', {
                businessType: profile?.businessType || 'real_estate_agency',
                legalCompanyName: profile?.legalCompanyName || '',
                description: profile?.description || '',
                businessDetails: {
                    licenseNumber: profile?.businessDetails?.licenseNumber || '',
                    taxId: profile?.businessDetails?.taxId || '',
                    yearEstablished: profile?.businessDetails?.yearEstablished?.toString() || '',
                    employeeCount: profile?.businessDetails?.employeeCount || '1-10',
                    specialties: profile?.businessDetails?.specialties || [],
                },
                verification: {
                    businessLicense: profile?.verification?.businessLicense || false,
                    insurance: profile?.verification?.insurance || false,
                    bonding: profile?.verification?.bonding || false,
                    backgroundCheck: profile?.verification?.backgroundCheck || false,
                },
            });
            setHasUnsavedChanges(false);
            setIsFormInitialized(true);
        } else if (profileType === 'business') {
            // Initialize business profile form whether or not businessProfile exists
            const profile = activeProfile?.businessProfile;
            console.log('ProfileEditScreen: Updating business form state with profile data:', profile);
            // Defensive: ensure all fields and nested fields are set with defaults if missing
            setBusinessInfo({
                businessType: profile?.businessType || 'startup',
                legalCompanyName: profile?.legalCompanyName || '',
                description: profile?.description || '',
                businessDetails: {
                    licenseNumber: profile?.businessDetails?.licenseNumber || '',
                    taxId: profile?.businessDetails?.taxId || '',
                    yearEstablished: profile?.businessDetails?.yearEstablished?.toString() || '',
                    employeeCount: profile?.businessDetails?.employeeCount || '1-5',
                    industry: profile?.businessDetails?.industry || '',
                    specialties: profile?.businessDetails?.specialties || [],
                },
                verification: {
                    businessLicense: profile?.verification?.businessLicense || false,
                    insurance: profile?.verification?.insurance || false,
                    backgroundCheck: profile?.verification?.backgroundCheck || false,
                },
            });
            // Log all fields for debugging
            console.log('BusinessInfo set to:', {
                businessType: profile?.businessType || 'startup',
                legalCompanyName: profile?.legalCompanyName || '',
                description: profile?.description || '',
                businessDetails: {
                    licenseNumber: profile?.businessDetails?.licenseNumber || '',
                    taxId: profile?.businessDetails?.taxId || '',
                    yearEstablished: profile?.businessDetails?.yearEstablished?.toString() || '',
                    employeeCount: profile?.businessDetails?.employeeCount || '1-5',
                    industry: profile?.businessDetails?.industry || '',
                    specialties: profile?.businessDetails?.specialties || [],
                },
                verification: {
                    businessLicense: profile?.verification?.businessLicense || false,
                    insurance: profile?.verification?.insurance || false,
                    backgroundCheck: profile?.verification?.backgroundCheck || false,
                },
            });
            setHasUnsavedChanges(false);
            setIsFormInitialized(true);
        } else {
            // Unknown profile type or no profile - initialize with defaults
            console.log('ProfileEditScreen: Unknown profile type or no profile data, initializing with defaults');
            setIsFormInitialized(true);
        }
    }, [activeProfile, profileType, isFormInitialized]);

    // Memoize trust score data to prevent unnecessary re-renders
    const trustScoreData = useMemo(() => {
        if (!activeProfile?.personalProfile?.trustScore) {
            return { score: 0, factors: [] };
        }

        const trustScore = activeProfile.personalProfile.trustScore;
        return {
            score: trustScore.score || 0,
            factors: trustScore.factors?.map(factor => ({
                type: factor.type,
                value: factor.value,
                maxValue: 20, // Default max value, should come from backend
                label: factor.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            })) || []
        };
    }, [activeProfile?.personalProfile?.trustScore]);

    // Memoize the handleSave function to prevent unnecessary re-renders
    const handleSave = useCallback(async () => {
        if (!activeProfile) {
            Alert.alert('Error', 'No profile found to update.');
            return;
        }

        setIsSaving(true);

        try {
            const profileId = activeProfile.id || activeProfile._id;
            if (!profileId) {
                throw new Error('Profile ID not found');
            }

            let updateData: UpdateProfileData = {};

            if (profileType === 'personal') {
                updateData = {
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
            } else if (profileType === 'agency') {
                updateData = {
                    agencyProfile: {
                        businessType: agencyInfo.businessType,
                        description: agencyInfo.description,
                        businessDetails: {
                            ...agencyInfo.businessDetails,
                            yearEstablished: agencyInfo.businessDetails.yearEstablished ?
                                parseInt(agencyInfo.businessDetails.yearEstablished) : undefined,
                        },
                        verification: agencyInfo.verification,
                    },
                };
            } else if (profileType === 'business') {
                updateData = {
                    businessProfile: {
                        businessType: businessInfo.businessType,
                        description: businessInfo.description,
                        legalCompanyName: businessInfo.legalCompanyName,
                        businessDetails: {
                            licenseNumber: businessInfo.businessDetails.licenseNumber,
                            taxId: businessInfo.businessDetails.taxId,
                            yearEstablished: businessInfo.businessDetails.yearEstablished ?
                                parseInt(businessInfo.businessDetails.yearEstablished) : undefined,
                            employeeCount: businessInfo.businessDetails.employeeCount,
                            industry: businessInfo.businessDetails.industry,
                            specialties: businessInfo.businessDetails.specialties,
                            serviceAreas: [],
                        },
                        verification: businessInfo.verification,
                    },
                };
            }

            await updateProfileMutation.mutateAsync({
                profileId,
                updateData
            });

            setHasUnsavedChanges(false);
            Alert.alert('Success', 'Profile updated successfully!');
        } catch (error: any) {
            console.error('Error saving profile:', error);
            Alert.alert('Error', error.message || 'Failed to update profile.');
        } finally {
            setIsSaving(false);
        }
    }, [activeProfile, profileType, personalInfo, preferences, references, rentalHistory, settings, agencyInfo, businessInfo, updateProfileMutation]);

    // Memoized form update functions to prevent unnecessary re-renders
    const updatePersonalInfo = useCallback((updates: Partial<typeof personalInfo>) => {
        setPersonalInfo(prev => ({ ...prev, ...updates }));
        setHasUnsavedChanges(true);
    }, []);

    const updatePreferences = useCallback((updates: Partial<typeof preferences>) => {
        setPreferences(prev => ({ ...prev, ...updates }));
        setHasUnsavedChanges(true);
    }, []);

    const updateSettings = useCallback((updates: Partial<typeof settings>) => {
        setSettings(prev => ({ ...prev, ...updates }));
        setHasUnsavedChanges(true);
    }, []);

    const toggleAmenity = useCallback((amenity: string) => {
        setPreferences(prev => ({
            ...prev,
            preferredAmenities: prev.preferredAmenities.includes(amenity)
                ? prev.preferredAmenities.filter(a => a !== amenity)
                : [...prev.preferredAmenities, amenity]
        }));
        setHasUnsavedChanges(true);
    }, []);

    const togglePropertyType = useCallback((type: string) => {
        setPreferences(prev => ({
            ...prev,
            propertyTypes: prev.propertyTypes.includes(type)
                ? prev.propertyTypes.filter(t => t !== type)
                : [...prev.propertyTypes, type]
        }));
        setHasUnsavedChanges(true);
    }, []);

    const addReference = useCallback(() => {
        setReferences(prev => [...prev, {
            name: '',
            relationship: 'personal',
            phone: '',
            email: '',
        }]);
        setHasUnsavedChanges(true);
    }, []);

    const updateReference = useCallback((index: number, updates: Partial<typeof references[0]>) => {
        setReferences(prev => prev.map((ref, i) => i === index ? { ...ref, ...updates } : ref));
        setHasUnsavedChanges(true);
    }, []);

    const removeReference = useCallback((index: number) => {
        setReferences(prev => prev.filter((_, i) => i !== index));
        setHasUnsavedChanges(true);
    }, []);

    const addRentalHistory = useCallback(() => {
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
    }, []);

    const updateRentalHistory = useCallback((index: number, updates: Partial<typeof rentalHistory[0]>) => {
        setRentalHistory(prev => prev.map((history, i) => i === index ? { ...history, ...updates } : history));
        setHasUnsavedChanges(true);
    }, []);

    const removeRentalHistory = useCallback((index: number) => {
        setRentalHistory(prev => prev.filter((_, i) => i !== index));
        setHasUnsavedChanges(true);
    }, []);

    const updateAgencyInfo = useCallback((updates: Partial<typeof agencyInfo>) => {
        setAgencyInfo(prev => ({ ...prev, ...updates }));
        setHasUnsavedChanges(true);
    }, []);

    const updateBusinessInfo = useCallback((updates: Partial<typeof businessInfo>) => {
        setBusinessInfo(prev => ({ ...prev, ...updates }));
        setHasUnsavedChanges(true);
    }, []);

    const toggleSpecialty = useCallback((specialty: string) => {
        if (profileType === 'agency') {
            setAgencyInfo(prev => ({
                ...prev,
                businessDetails: {
                    ...prev.businessDetails,
                    specialties: prev.businessDetails.specialties.includes(specialty)
                        ? prev.businessDetails.specialties.filter(s => s !== specialty)
                        : [...prev.businessDetails.specialties, specialty]
                }
            }));
        } else if (profileType === 'business') {
            setBusinessInfo(prev => ({
                ...prev,
                businessDetails: {
                    ...prev.businessDetails,
                    specialties: prev.businessDetails.specialties.includes(specialty)
                        ? prev.businessDetails.specialties.filter(s => s !== specialty)
                        : [...prev.businessDetails.specialties, specialty]
                }
            }));
        }
        setHasUnsavedChanges(true);
    }, [profileType]);

    const toggleVerification = useCallback((field: keyof typeof agencyInfo.verification) => {
        if (profileType === 'agency') {
            setAgencyInfo(prev => ({
                ...prev,
                verification: {
                    ...prev.verification,
                    [field]: !prev.verification[field]
                }
            }));
        } else if (profileType === 'business') {
            // Business profiles don't have bonding, so we need to handle this differently
            if (field === 'bonding') return; // Skip bonding for business profiles

            setBusinessInfo(prev => ({
                ...prev,
                verification: {
                    ...prev.verification,
                    [field]: !prev.verification[field]
                }
            }));
        }
        setHasUnsavedChanges(true);
    }, [profileType]);

    // Manual refresh function
    const handleRefresh = useCallback(async () => {
        try {
            console.log('Manually refreshing profile data...');
            await refetchProfile();
            console.log('Profile data refreshed successfully');
        } catch (error) {
            console.error('Error refreshing profile data:', error);
        }
    }, [refetchProfile]);

    const renderSection = () => {
        if (profileType === 'agency') {
            return renderAgencySection();
        } else if (profileType === 'business') {
            return renderBusinessSection();
        } else {
            return renderPersonalSection();
        }
    };

    const renderAgencySection = () => {
        switch (activeSection) {
            case 'business':
                return (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Agency Information</Text>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Business Type *</Text>
                            <View style={styles.checkboxGroup}>
                                {['real_estate_agency', 'property_management', 'brokerage', 'developer', 'other'].map((type) => (
                                    <TouchableOpacity
                                        key={type}
                                        style={[
                                            styles.checkbox,
                                            agencyInfo.businessType === type && styles.checkboxSelected
                                        ]}
                                        onPress={() => updateAgencyInfo({ businessType: type as any })}
                                    >
                                        <Text style={[
                                            styles.checkboxText,
                                            agencyInfo.businessType === type && styles.checkboxTextSelected
                                        ]}>
                                            {type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Legal Company Name *</Text>
                            <TextInput
                                style={styles.input}
                                value={agencyInfo.legalCompanyName}
                                onChangeText={(text) => updateAgencyInfo({ legalCompanyName: text })}
                                placeholder="Enter your legal company name"
                            />
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Description</Text>
                            <TextInput
                                style={[styles.input, styles.textArea]}
                                value={agencyInfo.description}
                                onChangeText={(text) => updateAgencyInfo({ description: text })}
                                placeholder="Describe your business..."
                                multiline
                                numberOfLines={4}
                            />
                        </View>

                        <View style={styles.row}>
                            <View style={[styles.inputGroup, styles.halfWidth]}>
                                <Text style={styles.label}>License Number</Text>
                                <TextInput
                                    style={styles.input}
                                    value={agencyInfo.businessDetails.licenseNumber}
                                    onChangeText={(text) => updateAgencyInfo({
                                        businessDetails: { ...agencyInfo.businessDetails, licenseNumber: text }
                                    })}
                                    placeholder="Enter license number"
                                />
                            </View>
                            <View style={[styles.inputGroup, styles.halfWidth]}>
                                <Text style={styles.label}>Tax ID</Text>
                                <TextInput
                                    style={styles.input}
                                    value={agencyInfo.businessDetails.taxId}
                                    onChangeText={(text) => updateAgencyInfo({
                                        businessDetails: { ...agencyInfo.businessDetails, taxId: text }
                                    })}
                                    placeholder="Enter tax ID"
                                />
                            </View>
                        </View>

                        <View style={styles.row}>
                            <View style={[styles.inputGroup, styles.halfWidth]}>
                                <Text style={styles.label}>Year Established</Text>
                                <TextInput
                                    style={styles.input}
                                    value={agencyInfo.businessDetails.yearEstablished}
                                    onChangeText={(text) => updateAgencyInfo({
                                        businessDetails: { ...agencyInfo.businessDetails, yearEstablished: text }
                                    })}
                                    placeholder="e.g., 2020"
                                    keyboardType="numeric"
                                />
                            </View>
                            <View style={[styles.inputGroup, styles.halfWidth]}>
                                <Text style={styles.label}>Number of Employees</Text>
                                <View style={styles.pickerContainer}>
                                    {['1-10', '11-50', '51-200', '200+'].map((count) => (
                                        <TouchableOpacity
                                            key={count}
                                            style={[
                                                styles.pickerOption,
                                                agencyInfo.businessDetails.employeeCount === count && styles.pickerOptionSelected
                                            ]}
                                            onPress={() => updateAgencyInfo({
                                                businessDetails: { ...agencyInfo.businessDetails, employeeCount: count as any }
                                            })}
                                        >
                                            <Text style={[
                                                styles.pickerOptionText,
                                                agencyInfo.businessDetails.employeeCount === count && styles.pickerOptionTextSelected
                                            ]}>
                                                {count}
                                            </Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            </View>
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Specialties</Text>
                            <View style={styles.checkboxGroup}>
                                {['residential', 'commercial', 'luxury', 'student_housing', 'senior_housing', 'vacation_rentals'].map((specialty) => (
                                    <TouchableOpacity
                                        key={specialty}
                                        style={[
                                            styles.checkbox,
                                            agencyInfo.businessDetails.specialties.includes(specialty) && styles.checkboxSelected
                                        ]}
                                        onPress={() => toggleSpecialty(specialty)}
                                    >
                                        <Text style={[
                                            styles.checkboxText,
                                            agencyInfo.businessDetails.specialties.includes(specialty) && styles.checkboxTextSelected
                                        ]}>
                                            {specialty.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>
                    </View>
                );

            case 'verification':
                return (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Agency Verification</Text>
                        <Text style={styles.sectionSubtitle}>
                            Complete these verifications to build trust with clients
                        </Text>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Verification Status</Text>

                            <TouchableOpacity
                                style={[
                                    styles.verificationItem,
                                    agencyInfo.verification.businessLicense && styles.verificationItemCompleted
                                ]}
                                onPress={() => toggleVerification('businessLicense')}
                            >
                                <View style={styles.verificationItemContent}>
                                    <Text style={styles.verificationItemTitle}>Business License</Text>
                                    <Text style={styles.verificationItemDescription}>
                                        Upload your business license for verification
                                    </Text>
                                </View>
                                <View style={[
                                    styles.verificationStatus,
                                    agencyInfo.verification.businessLicense && styles.verificationStatusCompleted
                                ]}>
                                    <Text style={styles.verificationStatusText}>
                                        {agencyInfo.verification.businessLicense ? '✓' : '○'}
                                    </Text>
                                </View>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[
                                    styles.verificationItem,
                                    agencyInfo.verification.insurance && styles.verificationItemCompleted
                                ]}
                                onPress={() => toggleVerification('insurance')}
                            >
                                <View style={styles.verificationItemContent}>
                                    <Text style={styles.verificationItemTitle}>Insurance</Text>
                                    <Text style={styles.verificationItemDescription}>
                                        Provide proof of business insurance
                                    </Text>
                                </View>
                                <View style={[
                                    styles.verificationStatus,
                                    agencyInfo.verification.insurance && styles.verificationStatusCompleted
                                ]}>
                                    <Text style={styles.verificationStatusText}>
                                        {agencyInfo.verification.insurance ? '✓' : '○'}
                                    </Text>
                                </View>
                            </TouchableOpacity>

                            {profileType === 'agency' && (
                                <TouchableOpacity
                                    style={[
                                        styles.verificationItem,
                                        agencyInfo.verification.bonding && styles.verificationItemCompleted
                                    ]}
                                    onPress={() => toggleVerification('bonding')}
                                >
                                    <View style={styles.verificationItemContent}>
                                        <Text style={styles.verificationItemTitle}>Bonding</Text>
                                        <Text style={styles.verificationItemDescription}>
                                            Provide surety bond information
                                        </Text>
                                    </View>
                                    <View style={[
                                        styles.verificationStatus,
                                        agencyInfo.verification.bonding && styles.verificationStatusCompleted
                                    ]}>
                                        <Text style={styles.verificationStatusText}>
                                            {agencyInfo.verification.bonding ? '✓' : '○'}
                                        </Text>
                                    </View>
                                </TouchableOpacity>
                            )}

                            <TouchableOpacity
                                style={[
                                    styles.verificationItem,
                                    agencyInfo.verification.backgroundCheck && styles.verificationItemCompleted
                                ]}
                                onPress={() => toggleVerification('backgroundCheck')}
                            >
                                <View style={styles.verificationItemContent}>
                                    <Text style={styles.verificationItemTitle}>Background Check</Text>
                                    <Text style={styles.verificationItemDescription}>
                                        Complete background check for all team members
                                    </Text>
                                </View>
                                <View style={[
                                    styles.verificationStatus,
                                    agencyInfo.verification.backgroundCheck && styles.verificationStatusCompleted
                                ]}>
                                    <Text style={styles.verificationStatusText}>
                                        {agencyInfo.verification.backgroundCheck ? '✓' : '○'}
                                    </Text>
                                </View>
                            </TouchableOpacity>
                        </View>
                    </View>
                );

            case 'team':
                // Only show team section for agency profiles
                if (profileType !== 'agency') {
                    return null;
                }

                return (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Team Management</Text>
                        <Text style={styles.sectionSubtitle}>
                            Manage your team members and their roles
                        </Text>

                        {activeProfile?.agencyProfile?.members && activeProfile.agencyProfile.members.length > 0 ? (
                            activeProfile.agencyProfile.members.map((member, index) => (
                                <View key={index} style={styles.teamMemberItem}>
                                    <View style={styles.teamMemberInfo}>
                                        <Text style={styles.teamMemberName}>Member {index + 1}</Text>
                                        <Text style={styles.teamMemberRole}>{member.role}</Text>
                                        <Text style={styles.teamMemberDate}>
                                            Added: {new Date(member.addedAt).toLocaleDateString()}
                                        </Text>
                                    </View>
                                </View>
                            ))
                        ) : (
                            <Text style={styles.emptyStateText}>No team members added yet.</Text>
                        )}

                        <TouchableOpacity style={styles.addButton}>
                            <Text style={styles.addButtonText}>+ Add Team Member</Text>
                        </TouchableOpacity>
                    </View>
                );

            case 'settings':
                return (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Business Settings</Text>
                        <Text style={styles.sectionSubtitle}>
                            Configure your business profile settings
                        </Text>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Profile Visibility</Text>
                            <View style={styles.pickerContainer}>
                                {['public', 'private', 'contacts_only'].map((visibility) => (
                                    <TouchableOpacity
                                        key={visibility}
                                        style={[
                                            styles.pickerOption,
                                            settings.privacy.profileVisibility === visibility && styles.pickerOptionSelected
                                        ]}
                                        onPress={() => updateSettings({
                                            privacy: { ...settings.privacy, profileVisibility: visibility as any }
                                        })}
                                    >
                                        <Text style={[
                                            styles.pickerOptionText,
                                            settings.privacy.profileVisibility === visibility && styles.pickerOptionTextSelected
                                        ]}>
                                            {visibility.replace('_', ' ').toUpperCase()}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Notifications</Text>
                            <View style={styles.checkboxGroup}>
                                <TouchableOpacity
                                    style={[
                                        styles.checkbox,
                                        settings.notifications.email && styles.checkboxSelected
                                    ]}
                                    onPress={() => updateSettings({
                                        notifications: { ...settings.notifications, email: !settings.notifications.email }
                                    })}
                                >
                                    <Text style={[
                                        styles.checkboxText,
                                        settings.notifications.email && styles.checkboxTextSelected
                                    ]}>
                                        Email Notifications
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[
                                        styles.checkbox,
                                        settings.notifications.push && styles.checkboxSelected
                                    ]}
                                    onPress={() => updateSettings({
                                        notifications: { ...settings.notifications, push: !settings.notifications.push }
                                    })}
                                >
                                    <Text style={[
                                        styles.checkboxText,
                                        settings.notifications.push && styles.checkboxTextSelected
                                    ]}>
                                        Push Notifications
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

    const renderBusinessSection = () => {
        switch (activeSection) {
            case 'business':
                return (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Business Information</Text>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Business Type *</Text>
                            <View style={styles.checkboxGroup}>
                                {['small_business', 'startup', 'freelancer', 'consultant', 'other'].map((type) => (
                                    <TouchableOpacity
                                        key={type}
                                        style={[
                                            styles.checkbox,
                                            businessInfo.businessType === type && styles.checkboxSelected
                                        ]}
                                        onPress={() => updateBusinessInfo({ businessType: type as any })}
                                    >
                                        <Text style={[
                                            styles.checkboxText,
                                            businessInfo.businessType === type && styles.checkboxTextSelected
                                        ]}>
                                            {type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Legal Company Name *</Text>
                            <TextInput
                                style={styles.input}
                                value={businessInfo.legalCompanyName}
                                onChangeText={(text) => updateBusinessInfo({ legalCompanyName: text })}
                                placeholder="Enter your legal company name"
                            />
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Description</Text>
                            <TextInput
                                style={[styles.input, styles.textArea]}
                                value={businessInfo.description}
                                onChangeText={(text) => updateBusinessInfo({ description: text })}
                                placeholder="Describe your business..."
                                multiline
                                numberOfLines={4}
                            />
                        </View>

                        <View style={styles.row}>
                            <View style={[styles.inputGroup, styles.halfWidth]}>
                                <Text style={styles.label}>License Number</Text>
                                <TextInput
                                    style={styles.input}
                                    value={businessInfo.businessDetails.licenseNumber}
                                    onChangeText={(text) => updateBusinessInfo({
                                        businessDetails: { ...businessInfo.businessDetails, licenseNumber: text }
                                    })}
                                    placeholder="Enter license number"
                                />
                            </View>
                            <View style={[styles.inputGroup, styles.halfWidth]}>
                                <Text style={styles.label}>Tax ID</Text>
                                <TextInput
                                    style={styles.input}
                                    value={businessInfo.businessDetails.taxId}
                                    onChangeText={(text) => updateBusinessInfo({
                                        businessDetails: { ...businessInfo.businessDetails, taxId: text }
                                    })}
                                    placeholder="Enter tax ID"
                                />
                            </View>
                        </View>

                        <View style={styles.row}>
                            <View style={[styles.inputGroup, styles.halfWidth]}>
                                <Text style={styles.label}>Year Established</Text>
                                <TextInput
                                    style={styles.input}
                                    value={businessInfo.businessDetails.yearEstablished}
                                    onChangeText={(text) => updateBusinessInfo({
                                        businessDetails: { ...businessInfo.businessDetails, yearEstablished: text }
                                    })}
                                    placeholder="e.g., 2020"
                                    keyboardType="numeric"
                                />
                            </View>
                            <View style={[styles.inputGroup, styles.halfWidth]}>
                                <Text style={styles.label}>Number of Employees</Text>
                                <View style={styles.pickerContainer}>
                                    {['1-5', '6-10', '11-25', '26+'].map((count) => (
                                        <TouchableOpacity
                                            key={count}
                                            style={[
                                                styles.pickerOption,
                                                businessInfo.businessDetails.employeeCount === count && styles.pickerOptionSelected
                                            ]}
                                            onPress={() => updateBusinessInfo({
                                                businessDetails: { ...businessInfo.businessDetails, employeeCount: count as any }
                                            })}
                                        >
                                            <Text style={[
                                                styles.pickerOptionText,
                                                businessInfo.businessDetails.employeeCount === count && styles.pickerOptionTextSelected
                                            ]}>
                                                {count}
                                            </Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            </View>
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Industry</Text>
                            <TextInput
                                style={styles.input}
                                value={businessInfo.businessDetails.industry}
                                onChangeText={(text) => updateBusinessInfo({
                                    businessDetails: { ...businessInfo.businessDetails, industry: text }
                                })}
                                placeholder="Enter industry"
                            />
                        </View>
                    </View>
                );

            case 'verification':
                return (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Business Verification</Text>
                        <Text style={styles.sectionSubtitle}>
                            Complete these verifications to build trust with clients
                        </Text>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Verification Status</Text>

                            <TouchableOpacity
                                style={[
                                    styles.verificationItem,
                                    businessInfo.verification.businessLicense && styles.verificationItemCompleted
                                ]}
                                onPress={() => updateBusinessInfo({ verification: { ...businessInfo.verification, businessLicense: !businessInfo.verification.businessLicense } })}
                            >
                                <View style={styles.verificationItemContent}>
                                    <Text style={styles.verificationItemTitle}>Business License</Text>
                                    <Text style={styles.verificationItemDescription}>
                                        Upload your business license for verification
                                    </Text>
                                </View>
                                <View style={[
                                    styles.verificationStatus,
                                    businessInfo.verification.businessLicense && styles.verificationStatusCompleted
                                ]}>
                                    <Text style={styles.verificationStatusText}>
                                        {businessInfo.verification.businessLicense ? '✓' : '○'}
                                    </Text>
                                </View>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[
                                    styles.verificationItem,
                                    businessInfo.verification.insurance && styles.verificationItemCompleted
                                ]}
                                onPress={() => updateBusinessInfo({ verification: { ...businessInfo.verification, insurance: !businessInfo.verification.insurance } })}
                            >
                                <View style={styles.verificationItemContent}>
                                    <Text style={styles.verificationItemTitle}>Insurance</Text>
                                    <Text style={styles.verificationItemDescription}>
                                        Provide proof of business insurance
                                    </Text>
                                </View>
                                <View style={[
                                    styles.verificationStatus,
                                    businessInfo.verification.insurance && styles.verificationStatusCompleted
                                ]}>
                                    <Text style={styles.verificationStatusText}>
                                        {businessInfo.verification.insurance ? '✓' : '○'}
                                    </Text>
                                </View>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[
                                    styles.verificationItem,
                                    businessInfo.verification.backgroundCheck && styles.verificationItemCompleted
                                ]}
                                onPress={() => updateBusinessInfo({ verification: { ...businessInfo.verification, backgroundCheck: !businessInfo.verification.backgroundCheck } })}
                            >
                                <View style={styles.verificationItemContent}>
                                    <Text style={styles.verificationItemTitle}>Background Check</Text>
                                    <Text style={styles.verificationItemDescription}>
                                        Complete background check for all team members
                                    </Text>
                                </View>
                                <View style={[
                                    styles.verificationStatus,
                                    businessInfo.verification.backgroundCheck && styles.verificationStatusCompleted
                                ]}>
                                    <Text style={styles.verificationStatusText}>
                                        {businessInfo.verification.backgroundCheck ? '✓' : '○'}
                                    </Text>
                                </View>
                            </TouchableOpacity>
                        </View>
                    </View>
                );

            case 'settings':
                return (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Business Settings</Text>
                        <Text style={styles.sectionSubtitle}>
                            Configure your business profile settings
                        </Text>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Profile Visibility</Text>
                            <View style={styles.pickerContainer}>
                                {['public', 'private', 'contacts_only'].map((visibility) => (
                                    <TouchableOpacity
                                        key={visibility}
                                        style={[
                                            styles.pickerOption,
                                            settings.privacy.profileVisibility === visibility && styles.pickerOptionSelected
                                        ]}
                                        onPress={() => updateSettings({
                                            privacy: { ...settings.privacy, profileVisibility: visibility as any }
                                        })}
                                    >
                                        <Text style={[
                                            styles.pickerOptionText,
                                            settings.privacy.profileVisibility === visibility && styles.pickerOptionTextSelected
                                        ]}>
                                            {visibility.replace('_', ' ').toUpperCase()}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Notifications</Text>
                            <View style={styles.checkboxGroup}>
                                <TouchableOpacity
                                    style={[
                                        styles.checkbox,
                                        settings.notifications.email && styles.checkboxSelected
                                    ]}
                                    onPress={() => updateSettings({
                                        notifications: { ...settings.notifications, email: !settings.notifications.email }
                                    })}
                                >
                                    <Text style={[
                                        styles.checkboxText,
                                        settings.notifications.email && styles.checkboxTextSelected
                                    ]}>
                                        Email Notifications
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[
                                        styles.checkbox,
                                        settings.notifications.push && styles.checkboxSelected
                                    ]}
                                    onPress={() => updateSettings({
                                        notifications: { ...settings.notifications, push: !settings.notifications.push }
                                    })}
                                >
                                    <Text style={[
                                        styles.checkboxText,
                                        settings.notifications.push && styles.checkboxTextSelected
                                    ]}>
                                        Push Notifications
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

    const renderPersonalSection = () => {
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

    // Show loading while profile is loading or form is not yet initialized
    const shouldShowLoading = profileLoading || (!isFormInitialized && activeProfile);

    // Debug logging
    console.log('ProfileEditScreen render state:', {
        profileLoading,
        isFormInitialized,
        hasActiveProfile: !!activeProfile,
        profileType,
        shouldShowLoading
    });

    if (shouldShowLoading) {
        return (
            <SafeAreaView style={{ flex: 1 }} edges={['top']}>
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.primaryColor} />
                    <Text style={styles.loadingText}>
                        {profileLoading ? 'Loading profile...' : !isFormInitialized ? 'Preparing form...' : 'Loading...'}
                    </Text>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
            <Header
                options={{
                    title: `Edit ${profileType === 'agency' ? 'Agency' : profileType === 'business' ? 'Business' : 'Personal'} Profile${hasUnsavedChanges ? ' *' : ''}`,
                    showBackButton: true,
                    rightComponents: [
                        <TouchableOpacity
                            key="save"
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
                    ]
                }}
            />

            <View style={styles.tabContainer}>
                {profileType === 'agency' ? (
                    // Agency profile tabs
                    [
                        { key: 'business', label: 'Agency' },
                        { key: 'verification', label: 'Verification' },
                        { key: 'team', label: 'Team' },
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
                    ))
                ) : profileType === 'business' ? (
                    // Business profile tabs
                    [
                        { key: 'business', label: 'Business' },
                        { key: 'verification', label: 'Verification' },
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
                    ))
                ) : (
                    // Personal profile tabs
                    [
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
                    ))
                )}
            </View>

            <ScrollView
                style={styles.container}
                key={activeProfile ? 'profile-loaded' : 'profile-loading'}
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
    sectionSubtitle: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_5,
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
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 8,
        backgroundColor: colors.primaryColor,
        alignItems: 'center',
        marginTop: 16,
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
    verificationItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderWidth: 1,
        borderColor: colors.primaryLight_1,
        borderRadius: 8,
        marginBottom: 8,
    },
    verificationItemCompleted: {
        borderColor: colors.online,
        backgroundColor: colors.primaryLight_1,
    },
    verificationItemContent: {
        flex: 1,
    },
    verificationItemTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryDark,
    },
    verificationItemDescription: {
        fontSize: 14,
        color: colors.primaryDark,
    },
    verificationStatus: {
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.primaryLight_1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    verificationStatusCompleted: {
        backgroundColor: colors.primaryColor,
        borderColor: colors.primaryColor,
    },
    verificationStatusText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryLight,
    },
    teamMemberItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.primaryLight_1,
    },
    teamMemberInfo: {
        flex: 1,
    },
    teamMemberName: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryDark,
    },
    teamMemberRole: {
        fontSize: 14,
        color: colors.primaryDark,
    },
    teamMemberDate: {
        fontSize: 14,
        color: colors.primaryDark,
    },
    emptyStateText: {
        fontSize: 16,
        color: colors.primaryDark,
        textAlign: 'center',
        marginVertical: 20,
    },
}); 
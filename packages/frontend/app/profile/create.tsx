import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/styles/colors';
import { useRouter } from 'expo-router';
import { IconButton } from '@/components/IconButton';
import { useCreateProfile } from '@/hooks/useProfileQueries';

type ProfileType = 'personal' | 'roommate' | 'agency';

export default function ProfileCreateScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const createProfile = useCreateProfile();
    const [isCreating, setIsCreating] = useState(false);
    const [selectedType, setSelectedType] = useState<ProfileType | null>(null);
    const [formData, setFormData] = useState({
        businessType: '',
        description: '',
        businessDetails: {
            licenseNumber: '',
            taxId: '',
            yearEstablished: '',
            employeeCount: '',
            specialties: [] as string[],
        },
        legalCompanyName: '',
    });

    const profileTypes = [
        {
            type: 'personal' as ProfileType,
            title: 'Personal Profile',
            description: 'For individual property searches and preferences',
            icon: 'person-outline',
            color: colors.primaryColor,
        },
        {
            type: 'roommate' as ProfileType,
            title: 'Roommate Profile',
            description: 'For finding roommates and shared housing',
            icon: 'people-outline',
            color: colors.success,
        },
        {
            type: 'agency' as ProfileType,
            title: 'Agency Profile',
            description: 'For real estate agencies and property management',
            icon: 'business-outline',
            color: colors.warning,
        },
    ];

    const handleCreateProfile = async () => {
        if (!selectedType) {
            Alert.alert('Error', 'Please select a profile type.');
            return;
        }

        setIsCreating(true);
        try {
            const profileData = {
                profileType: selectedType,
                data: {},
            };

            // Add type-specific data
            if (selectedType === 'agency') {
                profileData.data = {
                    businessType: formData.businessType,
                    description: formData.description,
                    businessDetails: {
                        ...formData.businessDetails,
                        yearEstablished: formData.businessDetails.yearEstablished ?
                            parseInt(formData.businessDetails.yearEstablished) : undefined,
                    },
                    legalCompanyName: formData.legalCompanyName,
                };
            }

            await createProfile.mutateAsync(profileData);
            Alert.alert('Success', `${profileTypes.find(p => p.type === selectedType)?.title} created successfully!`);
            router.back();
        } catch (error) {
            Alert.alert('Error', 'Failed to create profile. Please try again.');
        } finally {
            setIsCreating(false);
        }
    };

    const toggleSpecialty = (specialty: string) => {
        setFormData(prev => ({
            ...prev,
            businessDetails: {
                ...prev.businessDetails,
                specialties: prev.businessDetails.specialties.includes(specialty)
                    ? prev.businessDetails.specialties.filter(s => s !== specialty)
                    : [...prev.businessDetails.specialties, specialty]
            }
        }));
    };

    const employeeCountOptions = ['1-10', '11-50', '51-200', '200+'];

    return (
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <IconButton name="arrow-back" size={24} color={colors.primaryDark} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Create Profile</Text>
                <TouchableOpacity
                    onPress={handleCreateProfile}
                    style={[styles.createButton, !selectedType && styles.createButtonDisabled]}
                    disabled={!selectedType || isCreating}
                >
                    {isCreating ? (
                        <ActivityIndicator size="small" color={colors.primaryLight} />
                    ) : (
                        <Text style={styles.createButtonText}>Create</Text>
                    )}
                </TouchableOpacity>
            </View>

            <ScrollView style={styles.container}>
                {/* Profile Type Selection */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Choose Profile Type</Text>
                    <Text style={styles.sectionSubtitle}>
                        Select the type of profile you want to create
                    </Text>

                    {profileTypes.map((profileType) => (
                        <TouchableOpacity
                            key={profileType.type}
                            style={[
                                styles.profileTypeCard,
                                selectedType === profileType.type && styles.profileTypeCardSelected
                            ]}
                            onPress={() => setSelectedType(profileType.type)}
                        >
                            <View style={styles.profileTypeHeader}>
                                <IconButton
                                    name={profileType.icon as any}
                                    size={32}
                                    color={selectedType === profileType.type ? colors.primaryLight : profileType.color}
                                    backgroundColor={selectedType === profileType.type ? profileType.color : 'transparent'}
                                    style={styles.profileTypeIcon}
                                />
                                <View style={styles.profileTypeInfo}>
                                    <Text style={[
                                        styles.profileTypeTitle,
                                        selectedType === profileType.type && styles.profileTypeTitleSelected
                                    ]}>
                                        {profileType.title}
                                    </Text>
                                    <Text style={[
                                        styles.profileTypeDescription,
                                        selectedType === profileType.type && styles.profileTypeDescriptionSelected
                                    ]}>
                                        {profileType.description}
                                    </Text>
                                </View>
                            </View>
                        </TouchableOpacity>
                    ))}
                </View>

                {/* Agency-specific form */}
                {selectedType === 'agency' && (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Agency Information</Text>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Business Type *</Text>
                            <View style={styles.radioGroup}>
                                {['real_estate_agency', 'property_management', 'brokerage', 'developer', 'other'].map((type) => (
                                    <TouchableOpacity
                                        key={type}
                                        style={[
                                            styles.radioButton,
                                            formData.businessType === type && styles.radioButtonSelected
                                        ]}
                                        onPress={() => setFormData(prev => ({ ...prev, businessType: type }))}
                                    >
                                        <Text style={[
                                            styles.radioButtonText,
                                            formData.businessType === type && styles.radioButtonTextSelected
                                        ]}>
                                            {type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Description</Text>
                            <TextInput
                                style={[styles.input, styles.textArea]}
                                value={formData.description}
                                onChangeText={(text) => setFormData(prev => ({ ...prev, description: text }))}
                                placeholder="Describe your agency..."
                                multiline
                                numberOfLines={4}
                            />
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>License Number</Text>
                            <TextInput
                                style={styles.input}
                                value={formData.businessDetails.licenseNumber}
                                onChangeText={(text) => setFormData(prev => ({
                                    ...prev,
                                    businessDetails: { ...prev.businessDetails, licenseNumber: text }
                                }))}
                                placeholder="Enter license number"
                            />
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Tax ID</Text>
                            <TextInput
                                style={styles.input}
                                value={formData.businessDetails.taxId}
                                onChangeText={(text) => setFormData(prev => ({
                                    ...prev,
                                    businessDetails: { ...prev.businessDetails, taxId: text }
                                }))}
                                placeholder="Enter tax ID"
                            />
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Year Established</Text>
                            <TextInput
                                style={styles.input}
                                value={formData.businessDetails.yearEstablished}
                                onChangeText={(text) => setFormData(prev => ({
                                    ...prev,
                                    businessDetails: { ...prev.businessDetails, yearEstablished: text }
                                }))}
                                placeholder="e.g., 2020"
                                keyboardType="numeric"
                            />
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Number of Employees</Text>
                            <View style={styles.radioGroup}>
                                {employeeCountOptions.map((count) => (
                                    <TouchableOpacity
                                        key={count}
                                        style={[
                                            styles.radioButton,
                                            formData.businessDetails.employeeCount === count && styles.radioButtonSelected
                                        ]}
                                        onPress={() => setFormData(prev => ({
                                            ...prev,
                                            businessDetails: { ...prev.businessDetails, employeeCount: count }
                                        }))}
                                    >
                                        <Text style={[
                                            styles.radioButtonText,
                                            formData.businessDetails.employeeCount === count && styles.radioButtonTextSelected
                                        ]}>
                                            {count}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Specialties</Text>
                            <View style={styles.checkboxGroup}>
                                {['residential', 'commercial', 'luxury', 'investment', 'rental', 'new_construction'].map((specialty) => (
                                    <TouchableOpacity
                                        key={specialty}
                                        style={[
                                            styles.checkbox,
                                            formData.businessDetails.specialties.includes(specialty) && styles.checkboxSelected
                                        ]}
                                        onPress={() => toggleSpecialty(specialty)}
                                    >
                                        <Text style={[
                                            styles.checkboxText,
                                            formData.businessDetails.specialties.includes(specialty) && styles.checkboxTextSelected
                                        ]}>
                                            {specialty.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Legal Company Name *</Text>
                            <TextInput
                                style={styles.input}
                                value={formData.legalCompanyName}
                                onChangeText={(text) => setFormData(prev => ({ ...prev, legalCompanyName: text }))}
                                placeholder="Enter your legal company name"
                            />
                        </View>
                    </View>
                )}

                {/* Profile Type Info */}
                {selectedType && (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>What's Next?</Text>
                        <Text style={styles.infoText}>
                            After creating your {selectedType} profile, you can:
                        </Text>
                        <View style={styles.infoList}>
                            <Text style={styles.infoItem}>• Customize your preferences and settings</Text>
                            <Text style={styles.infoItem}>• Add verification documents</Text>
                            <Text style={styles.infoItem}>• Build your trust score</Text>
                            {selectedType === 'agency' && (
                                <Text style={styles.infoItem}>• Add team members to your agency</Text>
                            )}
                        </View>
                    </View>
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
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
    createButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: colors.primaryColor,
        borderRadius: 20,
    },
    createButtonDisabled: {
        backgroundColor: colors.primaryLight_1,
    },
    createButtonText: {
        color: colors.primaryLight,
        fontSize: 16,
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
    profileTypeCard: {
        padding: 16,
        borderRadius: 12,
        borderWidth: 2,
        borderColor: colors.primaryLight_1,
        backgroundColor: colors.primaryLight,
        marginBottom: 12,
    },
    profileTypeCardSelected: {
        borderColor: colors.primaryColor,
        backgroundColor: colors.primaryLight_1,
    },
    profileTypeHeader: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    profileTypeIcon: {
        marginRight: 16,
    },
    profileTypeInfo: {
        flex: 1,
    },
    profileTypeTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: colors.primaryDark,
        marginBottom: 4,
    },
    profileTypeTitleSelected: {
        color: colors.primaryColor,
    },
    profileTypeDescription: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_5,
    },
    profileTypeDescriptionSelected: {
        color: colors.primaryDark,
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
    radioGroup: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    radioButton: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: colors.primaryLight_1,
        backgroundColor: colors.primaryLight,
    },
    radioButtonSelected: {
        backgroundColor: colors.primaryColor,
        borderColor: colors.primaryColor,
    },
    radioButtonText: {
        fontSize: 14,
        color: colors.primaryDark,
    },
    radioButtonTextSelected: {
        color: colors.primaryLight,
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
    infoText: {
        fontSize: 16,
        color: colors.primaryDark,
        marginBottom: 12,
    },
    infoList: {
        marginLeft: 8,
    },
    infoItem: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_5,
        marginBottom: 4,
    },
}); 
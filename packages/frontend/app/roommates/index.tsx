import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, TextInput } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Header } from '@/components/Header';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useRoommateRedux } from '@/hooks/useRoommateRedux';
import { roommateService } from '@/services/roommateService';
import { useOxy } from '@oxyhq/services';
import { toast } from 'sonner';

type RoommateDisplay = {
    id: string;
    oxyUserId?: string;
    name: string;
    age: number;
    bio: string;
    budget: { min: number; max: number; currency: string };
    location: string;
    matchPercentage: number;
    lifestylePreferences: string[];
    interests: string[];
    occupation: string;
    imageUrl: string;
};

export default function RoommatesScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const { oxyServices, activeSessionId } = useOxy();
    const {
        profiles,
        hasRoommateMatching,
        isLoading,
        error,
        filters,
        fetchProfiles,
        fetchPreferences,
        checkStatus,
        toggleMatching,
        sendRequest,
        setFilters,
        clearFilters,
        clearError,
    } = useRoommateRedux();

    const [searchQuery, setSearchQuery] = useState('');
    const [showFilters, setShowFilters] = useState(false);
    const [isToggling, setIsToggling] = useState(false);

    // All possible interests for filtering
    const allInterests = [
        'Art', 'Music', 'Sports', 'Gaming', 'Reading', 'Cooking',
        'Travel', 'Photography', 'Hiking', 'Yoga', 'Design', 'Technology'
    ];

    // Load data on mount
    useEffect(() => {
        console.log('RoommatesScreen: Loading data on mount');
        console.log('Current filters:', filters);
        console.log('OxyServices available:', !!oxyServices);
        console.log('ActiveSessionId available:', !!activeSessionId);
        console.log('Current hasRoommateMatching state:', hasRoommateMatching);

        // Only make API calls if authentication is ready
        if (oxyServices && activeSessionId) {
            console.log('Authentication ready, making API calls...');
            checkStatus(); // Check current roommate matching status
            fetchProfiles(filters);
            fetchPreferences();
        } else {
            console.log('Waiting for authentication to be ready...');
        }
    }, [oxyServices, activeSessionId]); // Add dependencies

    // Show error toast if there's an error
    useEffect(() => {
        if (error) {
            console.error('RoommatesScreen: Error occurred:', error);
            toast.error(error);
            clearError();
        }
    }, [error]);

    // Debug profiles data
    useEffect(() => {
        console.log('RoommatesScreen: Profiles updated:', profiles);
        console.log('RoommatesScreen: Profiles count:', profiles.length);
    }, [profiles]);

    // Debug effect to track hasRoommateMatching changes
    useEffect(() => {
        console.log('hasRoommateMatching state changed:', hasRoommateMatching);
    }, [hasRoommateMatching]);

    // Convert profiles to roommate display format
    const roommatesDisplay: RoommateDisplay[] = profiles.map((profile: any) => {
        console.log('Processing profile:', profile);
        const displayInfo = roommateService.getProfileDisplayInfo(profile);
        console.log('Display info:', displayInfo);
        const preferences = roommateService.getRoommatePreferencesFromProfile(profile);
        console.log('Preferences:', preferences);

        // Extract lifestyle preferences
        const lifestylePreferences: string[] = [];
        if (preferences?.lifestyle) {
            if (preferences.lifestyle.pets === 'yes') lifestylePreferences.push('Pet-friendly');
            if (preferences.lifestyle.smoking === 'no') lifestylePreferences.push('Non-smoking');
            if (preferences.lifestyle.cleanliness === 'very_clean') lifestylePreferences.push('Very clean');
            if (preferences.lifestyle.schedule === 'early_bird') lifestylePreferences.push('Early bird');
        }

        const roommateDisplay = {
            id: profile._id || profile.id || '',
            oxyUserId: profile.oxyUserId || '',
            name: profile.userData?.fullName || displayInfo.name,
            age: displayInfo.age,
            bio: profile.userData?.bio || displayInfo.bio,
            budget: displayInfo.budget,
            location: profile.userData?.location || displayInfo.location,
            matchPercentage: (profile as any).matchPercentage || 75,
            lifestylePreferences,
            interests: preferences?.interests || [],
            occupation: displayInfo.occupation,
            imageUrl: profile.userData?.avatar || 'https://randomuser.me/api/portraits/lego/1.jpg',
        };

        console.log('Created roommate display:', roommateDisplay);
        return roommateDisplay;
    });

    console.log('All roommates display:', roommatesDisplay);

    // Apply filters to roommate list
    const filteredRoommates = roommatesDisplay.filter(roommate => {
        // Match percentage filter
        if (roommate.matchPercentage < filters.minMatchPercentage) {
            return false;
        }

        // Budget filter
        if (roommate.budget.max > filters.maxBudget) {
            return false;
        }

        // Pets preference filter
        if (filters.withPets && !roommate.lifestylePreferences.includes('Pet-friendly')) {
            return false;
        }

        // Smoking preference filter
        if (filters.nonSmoking && !roommate.lifestylePreferences.includes('Non-smoking')) {
            return false;
        }

        // Interests filter
        if (filters.interests.length > 0 && !roommate.interests.some(interest =>
            filters.interests.includes(interest)
        )) {
            return false;
        }

        // Search query filter
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            return (
                roommate.name.toLowerCase().includes(query) ||
                roommate.occupation.toLowerCase().includes(query) ||
                roommate.bio.toLowerCase().includes(query) ||
                roommate.location.toLowerCase().includes(query) ||
                roommate.interests.some(interest => interest.toLowerCase().includes(query))
            );
        }

        return true;
    });

    const sortedRoommates = [...filteredRoommates].sort((a, b) =>
        b.matchPercentage - a.matchPercentage
    );

    const handleRoommateDetails = (roommateId: string) => {
        router.push(`/roommates/${roommateId}`);
    };

    const handleMessage = (roommateId: string) => {
        router.push(`/messages/new?recipientId=${roommateId}`);
    };

    const handleCreateProfile = () => {
        router.push('/profile/edit');
    };

    const handlePreferences = () => {
        router.push('/roommates/preferences');
    };

    const handleToggleRoommateMatching = async () => {
        setIsToggling(true);
        try {
            await toggleMatching(!hasRoommateMatching);
            toast.success(`Roommate matching ${!hasRoommateMatching ? 'enabled' : 'disabled'}`);
            // Refetch profiles after toggling
            fetchProfiles(filters);
        } catch (error) {
            console.error('Error toggling roommate matching:', error);
        } finally {
            setIsToggling(false);
        }
    };

    const handleSendRequest = async (roommateId: string) => {
        try {
            await sendRequest(roommateId);
            toast.success('Roommate request sent successfully');
        } catch (error) {
            console.error('Error sending roommate request:', error);
        }
    };

    const toggleInterestFilter = (interest: string) => {
        const updatedInterests = [...filters.interests];
        const index = updatedInterests.indexOf(interest);

        if (index > -1) {
            updatedInterests.splice(index, 1);
        } else {
            updatedInterests.push(interest);
        }

        setFilters({ ...filters, interests: updatedInterests });
    };

    const resetFilters = () => {
        clearFilters();
    };

    const applyFilters = () => {
        fetchProfiles(filters);
    };

    if (isLoading) {
        return (
            <SafeAreaView style={styles.container} edges={['top']}>
                <Header
                    options={{
                        title: t("Roommate Matching"),
                        titlePosition: 'center',
                    }}
                />
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.primaryColor} />
                    <Text style={styles.loadingText}>{t("Finding your perfect roommates...")}</Text>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <Header
                options={{
                    title: t("Roommate Matching"),
                    titlePosition: 'center',
                    rightComponents: [
                        <TouchableOpacity key="preferences" style={styles.headerButton} onPress={handlePreferences}>
                            <Ionicons name="settings-outline" size={24} color={colors.COLOR_BLACK} />
                        </TouchableOpacity>,
                    ],
                }}
            />

            {!hasRoommateMatching && (
                <View style={styles.profileBanner}>
                    <View style={styles.profileIconContainer}>
                        <Ionicons name="people" size={24} color="white" />
                    </View>
                    <View style={styles.profileContent}>
                        <Text style={styles.profileTitle}>{t("Enable Roommate Matching")}</Text>
                        <Text style={styles.profileDescription}>
                            {t("Turn on roommate matching to find compatible roommates and let others find you.")}
                        </Text>
                    </View>
                    <TouchableOpacity
                        style={styles.profileButton}
                        onPress={handleToggleRoommateMatching}
                        disabled={isToggling}
                    >
                        <Text style={styles.profileButtonText}>
                            {isToggling ? t("Enabling...") : t("Enable")}
                        </Text>
                    </TouchableOpacity>
                </View>
            )}

            {hasRoommateMatching && (
                <View style={styles.profileBanner}>
                    <View style={styles.profileIconContainer}>
                        <Ionicons name="checkmark-circle" size={24} color="white" />
                    </View>
                    <View style={styles.profileContent}>
                        <Text style={styles.profileTitle}>{t("Roommate Matching Active")}</Text>
                        <Text style={styles.profileDescription}>
                            {t("You're visible to other roommates. Update your preferences to improve matches.")}
                        </Text>
                    </View>
                    <TouchableOpacity
                        style={styles.profileButton}
                        onPress={handleCreateProfile}
                    >
                        <Text style={styles.profileButtonText}>{t("Update")}</Text>
                    </TouchableOpacity>
                </View>
            )}

            <View style={styles.searchContainer}>
                <View style={styles.searchInputContainer}>
                    <Ionicons name="search" size={20} color={colors.primaryDark_1} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder={t("Search roommates...")}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => setSearchQuery('')}>
                            <Ionicons name="close-circle" size={20} color={colors.primaryDark_1} />
                        </TouchableOpacity>
                    )}
                </View>

                <TouchableOpacity
                    style={styles.filterButton}
                    onPress={() => setShowFilters(!showFilters)}
                >
                    <Ionicons
                        name={showFilters ? "options" : "options-outline"}
                        size={20}
                        color={colors.primaryDark_1}
                    />
                </TouchableOpacity>
            </View>

            {showFilters && (
                <View style={styles.filtersContainer}>
                    <View style={styles.filterHeader}>
                        <Text style={styles.filterTitle}>{t("Filters")}</Text>
                        <TouchableOpacity onPress={resetFilters}>
                            <Text style={styles.resetText}>{t("Reset")}</Text>
                        </TouchableOpacity>
                    </View>

                    <View style={styles.filterSection}>
                        <Text style={styles.filterLabel}>
                            {t("Minimum Match")} ({filters.minMatchPercentage}%)
                        </Text>
                        <Slider
                            style={styles.slider}
                            value={filters.minMatchPercentage}
                            onValueChange={(value) => setFilters({ ...filters, minMatchPercentage: value })}
                            minimumValue={50}
                            maximumValue={100}
                            step={1}
                            minimumTrackTintColor={colors.primaryColor}
                            maximumTrackTintColor="#D0D0D0"
                            thumbTintColor={colors.primaryColor}
                        />
                    </View>

                    <View style={styles.filterSection}>
                        <Text style={styles.filterLabel}>
                            {t("Maximum Budget")} ({filters.maxBudget}⊜)
                        </Text>
                        <Slider
                            style={styles.slider}
                            value={filters.maxBudget}
                            onValueChange={(value) => setFilters({ ...filters, maxBudget: value })}
                            minimumValue={300}
                            maximumValue={1500}
                            step={50}
                            minimumTrackTintColor={colors.primaryColor}
                            maximumTrackTintColor="#D0D0D0"
                            thumbTintColor={colors.primaryColor}
                        />
                    </View>

                    <View style={styles.checkboxSection}>
                        <TouchableOpacity
                            style={styles.checkboxRow}
                            onPress={() => setFilters({ ...filters, withPets: !filters.withPets })}
                        >
                            <View style={[
                                styles.checkbox,
                                filters.withPets && styles.checkboxChecked
                            ]}>
                                {filters.withPets && <Ionicons name="checkmark" size={16} color="white" />}
                            </View>
                            <Text style={styles.checkboxLabel}>{t("Pet-friendly")}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.checkboxRow}
                            onPress={() => setFilters({ ...filters, nonSmoking: !filters.nonSmoking })}
                        >
                            <View style={[
                                styles.checkbox,
                                filters.nonSmoking && styles.checkboxChecked
                            ]}>
                                {filters.nonSmoking && <Ionicons name="checkmark" size={16} color="white" />}
                            </View>
                            <Text style={styles.checkboxLabel}>{t("Non-smoking")}</Text>
                        </TouchableOpacity>
                    </View>

                    <View style={styles.interestsSection}>
                        <Text style={styles.interestsTitle}>{t("Interests")}</Text>
                        <View style={styles.interestsGrid}>
                            {allInterests.map(interest => (
                                <TouchableOpacity
                                    key={interest}
                                    style={[
                                        styles.interestChip,
                                        filters.interests.includes(interest) && styles.interestChipSelected
                                    ]}
                                    onPress={() => toggleInterestFilter(interest)}
                                >
                                    <Text style={[
                                        styles.interestChipText,
                                        filters.interests.includes(interest) && styles.interestChipTextSelected
                                    ]}>
                                        {interest}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>

                    <TouchableOpacity style={styles.applyFiltersButton} onPress={applyFilters}>
                        <Text style={styles.applyFiltersButtonText}>{t("Apply Filters")}</Text>
                    </TouchableOpacity>
                </View>
            )}

            <ScrollView style={styles.roommatesList} showsVerticalScrollIndicator={false}>
                {sortedRoommates.length === 0 ? (
                    <View style={styles.emptyState}>
                        <Ionicons name="people-outline" size={64} color={colors.primaryDark_1} />
                        <Text style={styles.emptyStateTitle}>{t("No Roommates Found")}</Text>
                        <Text style={styles.emptyStateText}>
                            {t("Try adjusting your filters or search criteria to find more roommates.")}
                        </Text>
                    </View>
                ) : (
                    sortedRoommates.map((roommate, idx) => (
                        <View key={roommate.id || roommate.oxyUserId || (roommate.name + idx)} style={styles.roommateCard}>
                            <View style={styles.roommateHeader}>
                                <View style={styles.roommateInfo}>
                                    <Text style={styles.roommateName}>{roommate.name}</Text>
                                    <Text style={styles.roommateAge}>{roommate.age} years old</Text>
                                    <Text style={styles.roommateOccupation}>{roommate.occupation}</Text>
                                </View>
                                <View style={styles.matchBadge}>
                                    <Text style={styles.matchPercentage}>{roommate.matchPercentage}%</Text>
                                    <Text style={styles.matchLabel}>{t("Match")}</Text>
                                </View>
                            </View>

                            <Text style={styles.roommateBio}>{roommate.bio}</Text>

                            <View style={styles.roommateDetails}>
                                <View style={styles.detailItem}>
                                    <Ionicons name="location" size={16} color={colors.primaryDark_1} />
                                    <Text style={styles.detailText}>{roommate.location}</Text>
                                </View>
                                <View style={styles.detailItem}>
                                    <Ionicons name="cash" size={16} color={colors.primaryDark_1} />
                                    <Text style={styles.detailText}>
                                        {roommate.budget.min}-{roommate.budget.max} {roommate.budget.currency}/month
                                    </Text>
                                </View>
                            </View>

                            {roommate.lifestylePreferences.length > 0 && (
                                <View style={styles.preferencesContainer}>
                                    {roommate.lifestylePreferences.map((pref, index) => (
                                        <View key={index} style={styles.preferenceChip}>
                                            <Text style={styles.preferenceText}>{pref}</Text>
                                        </View>
                                    ))}
                                </View>
                            )}

                            {roommate.interests.length > 0 && (
                                <View style={styles.interestsContainer}>
                                    {roommate.interests.slice(0, 3).map((interest, index) => (
                                        <View key={index} style={styles.interestChip}>
                                            <Text style={styles.interestText}>{interest}</Text>
                                        </View>
                                    ))}
                                    {roommate.interests.length > 3 && (
                                        <Text style={styles.moreInterests}>+{roommate.interests.length - 3} more</Text>
                                    )}
                                </View>
                            )}

                            <View style={styles.roommateActions}>
                                <TouchableOpacity
                                    style={styles.actionButton}
                                    onPress={() => handleRoommateDetails(roommate.id)}
                                >
                                    <Text style={styles.actionButtonText}>{t("View Profile")}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.actionButton, styles.primaryButton]}
                                    onPress={() => handleSendRequest(roommate.id)}
                                >
                                    <Text style={[styles.actionButtonText, styles.primaryButtonText]}>
                                        {t("Send Request")}
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    ))
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.primaryLight,
    },
    headerButton: {
        padding: 8,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        marginTop: 12,
        fontSize: 16,
        color: colors.primaryDark_1,
    },
    profileBanner: {
        flexDirection: 'row',
        backgroundColor: colors.primaryColor,
        padding: 16,
        alignItems: 'center',
    },
    profileIconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    profileContent: {
        flex: 1,
    },
    profileTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: 'white',
        marginBottom: 4,
    },
    profileDescription: {
        fontSize: 12,
        color: 'rgba(255, 255, 255, 0.8)',
    },
    profileButton: {
        backgroundColor: 'white',
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 16,
    },
    profileButtonText: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.primaryColor,
    },
    searchContainer: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        paddingVertical: 12,
        alignItems: 'center',
    },
    searchInputContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'white',
        paddingHorizontal: 12,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_5,
        marginRight: 8,
    },
    searchInput: {
        flex: 1,
        paddingVertical: 10,
        marginLeft: 8,
        fontSize: 14,
    },
    filterButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'white',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_5,
    },
    filtersContainer: {
        backgroundColor: 'white',
        borderRadius: 8,
        margin: 16,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    filterHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    filterTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryDark,
    },
    resetText: {
        fontSize: 14,
        color: colors.primaryColor,
    },
    filterSection: {
        marginBottom: 16,
    },
    filterLabel: {
        fontSize: 14,
        color: colors.primaryDark_1,
        marginBottom: 8,
    },
    slider: {
        width: '100%',
        height: 40,
    },
    checkboxSection: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 16,
    },
    checkboxRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    checkbox: {
        width: 20,
        height: 20,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_4,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 8,
    },
    checkboxChecked: {
        backgroundColor: colors.primaryColor,
        borderColor: colors.primaryColor,
    },
    checkboxLabel: {
        fontSize: 14,
        color: colors.primaryDark,
    },
    interestsSection: {
        marginBottom: 16,
    },
    interestsTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryDark_1,
        marginBottom: 8,
    },
    interestsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    interestChip: {
        backgroundColor: 'rgba(0, 0, 0, 0.05)',
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 16,
        marginRight: 8,
        marginBottom: 8,
    },
    interestChipSelected: {
        backgroundColor: colors.primaryColor,
    },
    interestChipText: {
        fontSize: 12,
        color: colors.primaryDark_1,
    },
    interestChipTextSelected: {
        color: 'white',
    },
    roommatesList: {
        flex: 1,
    },
    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 40,
        marginTop: 80,
    },
    emptyStateTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
        marginTop: 16,
        marginBottom: 8,
    },
    emptyStateText: {
        fontSize: 14,
        color: colors.primaryDark_1,
        textAlign: 'center',
        marginBottom: 24,
    },
    roommateCard: {
        backgroundColor: 'white',
        borderRadius: 8,
        margin: 16,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    roommateHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    roommateInfo: {
        flex: 1,
    },
    roommateName: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryDark,
    },
    roommateAge: {
        fontSize: 14,
        color: colors.primaryDark_1,
    },
    roommateOccupation: {
        fontSize: 14,
        color: colors.primaryDark_1,
    },
    matchBadge: {
        backgroundColor: colors.primaryColor,
        paddingVertical: 4,
        paddingHorizontal: 8,
        borderRadius: 16,
        marginLeft: 16,
    },
    matchPercentage: {
        fontSize: 12,
        fontWeight: '600',
        color: 'white',
    },
    matchLabel: {
        fontSize: 12,
        color: 'rgba(255, 255, 255, 0.8)',
    },
    roommateBio: {
        fontSize: 14,
        color: colors.primaryDark_1,
    },
    roommateDetails: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    detailItem: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    detailText: {
        fontSize: 14,
        color: colors.primaryDark_1,
    },
    preferencesContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: 16,
    },
    preferenceChip: {
        backgroundColor: 'rgba(0, 0, 0, 0.05)',
        paddingVertical: 4,
        paddingHorizontal: 8,
        borderRadius: 16,
        marginRight: 8,
        marginBottom: 8,
    },
    preferenceText: {
        fontSize: 12,
    },
    applyFiltersButton: {
        backgroundColor: colors.primaryColor,
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 16,
        alignItems: 'center',
        marginTop: 16,
    },
    applyFiltersButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: 'white',
    },
}); 
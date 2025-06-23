import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, TextInput, Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '@/components/Header';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/styles/colors';
import { RoommateMatch, LifestylePreference } from '@/components/RoommateMatch';
import Slider from '@react-native-community/slider';
import { useRoommateProfiles, useHasRoommateMatching, useToggleRoommateMatching, useSendRoommateRequest } from '@/hooks/useRoommateQueries';
import { roommateService } from '@/services/roommateService';
import type { Profile } from '@/services/profileService';

type FilterOptions = {
    minMatchPercentage: number;
    maxBudget: number;
    withPets: boolean;
    nonSmoking: boolean;
    interests: string[];
};

export default function RoommatesScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const [searchQuery, setSearchQuery] = useState('');
    const [showFilters, setShowFilters] = useState(false);

    // Get roommate data
    const { data: roommateData, isLoading: roommatesLoading } = useRoommateProfiles();
    const { hasRoommateMatching, activeProfile } = useHasRoommateMatching();
    const toggleRoommateMatching = useToggleRoommateMatching();
    const sendRoommateRequest = useSendRoommateRequest();

    // Filtering options
    const [filters, setFilters] = useState<FilterOptions>({
        minMatchPercentage: 70,
        maxBudget: 1000,
        withPets: false,
        nonSmoking: false,
        interests: [],
    });

    // All possible interests for filtering
    const allInterests = [
        'Art', 'Music', 'Sports', 'Gaming', 'Reading', 'Cooking',
        'Travel', 'Photography', 'Hiking', 'Yoga', 'Design', 'Technology'
    ];

    // Convert profiles to roommate display format
    const roommates = roommateData?.profiles.map(profile => {
        const displayInfo = roommateService.getProfileDisplayInfo(profile);
        const matchPercentage = activeProfile ? roommateService.calculateMatchPercentage(activeProfile, profile) : 0;

        return {
            id: profile.id,
            profileId: profile.id,
            name: displayInfo.name,
            age: displayInfo.age,
            occupation: displayInfo.occupation,
            bio: displayInfo.bio,
            imageUrl: 'https://randomuser.me/api/portraits/lego/1.jpg', // Default avatar
            matchPercentage,
            trustScore: displayInfo.trustScore,
            lifestylePreferences: roommateService.getRoommatePreferencesFromProfile(profile)?.lifestyle ?
                Object.entries(roommateService.getRoommatePreferencesFromProfile(profile)!.lifestyle!).map(([key, value]) => value) : [],
            interests: [], // Would need to be added to profile
            location: displayInfo.location,
            budget: displayInfo.budget,
            moveInDate: displayInfo.moveInDate,
            duration: displayInfo.duration,
            lastActive: profile.updatedAt,
            isVerified: displayInfo.isVerified,
            hasReferences: displayInfo.hasReferences,
            rentalHistory: displayInfo.rentalHistory,
        };
    }) || [];

    // Apply filters to roommate list
    const filteredRoommates = roommates.filter(roommate => {
        // Match percentage filter
        if (roommate.matchPercentage < filters.minMatchPercentage) {
            return false;
        }

        // Budget filter
        if (roommate.budget.max > filters.maxBudget) {
            return false;
        }

        // Pets preference filter
        if (filters.withPets && !roommate.lifestylePreferences.includes('yes')) {
            return false;
        }

        // Smoking preference filter
        if (filters.nonSmoking && !roommate.lifestylePreferences.includes('no')) {
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

    const handleToggleRoommateMatching = () => {
        toggleRoommateMatching.mutate(!hasRoommateMatching);
    };

    const handleSendRequest = (roommateId: string) => {
        sendRoommateRequest.mutate({ profileId: roommateId });
    };

    const toggleInterestFilter = (interest: string) => {
        setFilters(prevFilters => {
            const updatedInterests = [...prevFilters.interests];
            const index = updatedInterests.indexOf(interest);

            if (index > -1) {
                updatedInterests.splice(index, 1);
            } else {
                updatedInterests.push(interest);
            }

            return {
                ...prevFilters,
                interests: updatedInterests
            };
        });
    };

    const resetFilters = () => {
        setFilters({
            minMatchPercentage: 70,
            maxBudget: 1000,
            withPets: false,
            nonSmoking: false,
            interests: [],
        });
    };

    if (roommatesLoading) {
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
                        disabled={toggleRoommateMatching.isPending}
                    >
                        <Text style={styles.profileButtonText}>
                            {toggleRoommateMatching.isPending ? t("Enabling...") : t("Enable")}
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
                            onValueChange={(value) => setFilters(prev => ({ ...prev, minMatchPercentage: value }))}
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
                            onValueChange={(value) => setFilters(prev => ({ ...prev, maxBudget: value }))}
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
                            onPress={() => setFilters(prev => ({ ...prev, withPets: !prev.withPets }))}
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
                            onPress={() => setFilters(prev => ({ ...prev, nonSmoking: !prev.nonSmoking }))}
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
                </View>
            )}

            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContent}
            >
                {sortedRoommates.length === 0 ? (
                    <View style={styles.emptyContainer}>
                        <Ionicons name="people-outline" size={60} color={colors.COLOR_BLACK_LIGHT_3} />
                        <Text style={styles.emptyText}>{t("No roommates found")}</Text>
                        <Text style={styles.emptySubtext}>
                            {searchQuery || filters.interests.length > 0 ?
                                t("Try adjusting your search or filters") :
                                t("No roommates available in your area yet")}
                        </Text>
                    </View>
                ) : (
                    sortedRoommates.map((roommate) => (
                        <RoommateMatch
                            key={roommate.id}
                            {...roommate}
                            onPress={() => handleRoommateDetails(roommate.id)}
                            onMessage={() => handleMessage(roommate.id)}
                            onSendRequest={() => handleSendRequest(roommate.id)}
                        />
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
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: 16,
        paddingBottom: 100,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 40,
        marginTop: 80,
    },
    emptyText: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
        marginTop: 16,
        marginBottom: 8,
    },
    emptySubtext: {
        fontSize: 14,
        color: colors.primaryDark_1,
        textAlign: 'center',
        marginBottom: 24,
    },
}); 
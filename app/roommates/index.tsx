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

type RoommateProfile = {
    id: string;
    name: string;
    age: number;
    occupation: string;
    bio: string;
    imageUrl: string;
    matchPercentage: number;
    trustScore: number;
    lifestylePreferences: LifestylePreference[];
    interests: string[];
    location: string;
    budget: {
        min: number;
        max: number;
        currency: string;
    };
    moveInDate: string;
    duration: string;
    lastActive: string;
};

// Sample roommate profiles for demonstration
const sampleRoommates: RoommateProfile[] = [
    {
        id: '1',
        name: 'Sofia Martinez',
        age: 27,
        occupation: 'UX Designer',
        bio: 'Creative professional looking for a peaceful home where I can work remotely part of the week. Love cooking and hiking on weekends.',
        imageUrl: 'https://randomuser.me/api/portraits/women/33.jpg',
        matchPercentage: 92,
        trustScore: 4.8,
        lifestylePreferences: [
            'non_smoker', 'pets', 'quiet', 'social'
        ],
        interests: ['Design', 'Cooking', 'Hiking', 'Photography'],
        location: 'Gracia, Barcelona',
        budget: { min: 600, max: 800, currency: '€' },
        moveInDate: '2023-07-01',
        duration: '12+ months',
        lastActive: '2 hours ago',
    },
    {
        id: '2',
        name: 'Lucas Dubois',
        age: 31,
        occupation: 'Software Engineer',
        bio: 'Tech enthusiast working for a global company. Looking for a well-located apartment with good internet connection. Clean and organized.',
        imageUrl: 'https://randomuser.me/api/portraits/men/44.jpg',
        matchPercentage: 87,
        trustScore: 4.9,
        lifestylePreferences: [
            'non_smoker', 'clean', 'quiet'
        ],
        interests: ['Programming', 'Gaming', 'Cycling', 'Science'],
        location: 'Poblenou, Barcelona',
        budget: { min: 700, max: 900, currency: '€' },
        moveInDate: '2023-06-15',
        duration: '12+ months',
        lastActive: '1 day ago',
    },
    {
        id: '3',
        name: 'Mia Johnson',
        age: 24,
        occupation: 'Postgraduate Student',
        bio: 'Environmental science student looking for eco-conscious roommates. Vegan, love to garden and participate in community projects.',
        imageUrl: 'https://randomuser.me/api/portraits/women/66.jpg',
        matchPercentage: 82,
        trustScore: 4.5,
        lifestylePreferences: [
            'non_smoker', 'pets', 'social', 'vegan'
        ],
        interests: ['Environment', 'Gardening', 'Yoga', 'Reading'],
        location: 'Eixample, Barcelona',
        budget: { min: 500, max: 650, currency: '€' },
        moveInDate: '2023-08-01',
        duration: '6+ months',
        lastActive: '3 hours ago',
    },
    {
        id: '4',
        name: 'Javier Torres',
        age: 29,
        occupation: 'Marketing Specialist',
        bio: 'Local Barcelonian who can show you the best spots in the city. Work in digital marketing and enjoy a good balance of social life and quiet time.',
        imageUrl: 'https://randomuser.me/api/portraits/men/11.jpg',
        matchPercentage: 79,
        trustScore: 4.7,
        lifestylePreferences: [
            'smoker', 'pets', 'social', 'night_owl'
        ],
        interests: ['Music', 'Travel', 'Cooking', 'Nightlife'],
        location: 'El Born, Barcelona',
        budget: { min: 650, max: 850, currency: '€' },
        moveInDate: '2023-06-01',
        duration: '12+ months',
        lastActive: '5 hours ago',
    },
    {
        id: '5',
        name: 'Emma Rossi',
        age: 26,
        occupation: 'Language Teacher',
        bio: 'Italian teacher who recently moved to Barcelona. Love languages, cooking Italian food, and exploring new cultures. Looking for a friendly home environment.',
        imageUrl: 'https://randomuser.me/api/portraits/women/19.jpg',
        matchPercentage: 85,
        trustScore: 4.6,
        lifestylePreferences: [
            'non_smoker', 'pets', 'quiet', 'creative'
        ],
        interests: ['Languages', 'Cooking', 'Travel', 'Art'],
        location: 'Sant Antoni, Barcelona',
        budget: { min: 600, max: 750, currency: '€' },
        moveInDate: '2023-07-15',
        duration: '12+ months',
        lastActive: '1 day ago',
    },
];

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
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [showFilters, setShowFilters] = useState(false);
    const [roommates, setRoommates] = useState<RoommateProfile[]>([]);

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

    useEffect(() => {
        // Simulate loading data
        const timer = setTimeout(() => {
            setRoommates(sampleRoommates);
            setLoading(false);
        }, 1500);

        return () => clearTimeout(timer);
    }, []);

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
        if (filters.withPets && !roommate.lifestylePreferences.includes('pets')) {
            return false;
        }

        // Smoking preference filter
        if (filters.nonSmoking && !roommate.lifestylePreferences.includes('non_smoker')) {
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
        router.push('/roommates/create-profile');
    };

    const handlePreferences = () => {
        router.push('/roommates/preferences');
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

    if (loading) {
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

            <View style={styles.profileBanner}>
                <View style={styles.profileIconContainer}>
                    <Ionicons name="people" size={24} color="white" />
                </View>
                <View style={styles.profileContent}>
                    <Text style={styles.profileTitle}>{t("Complete Your Profile")}</Text>
                    <Text style={styles.profileDescription}>
                        {t("Add more details to improve your matches and help others find you.")}
                    </Text>
                </View>
                <TouchableOpacity
                    style={styles.profileButton}
                    onPress={handleCreateProfile}
                >
                    <Text style={styles.profileButtonText}>{t("Update")}</Text>
                </TouchableOpacity>
            </View>

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
                            {t("Maximum Budget")} ({filters.maxBudget}€)
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
                            <Text style={styles.checkboxLabel}>{t("Non-smoker")}</Text>
                        </TouchableOpacity>
                    </View>

                    <Text style={styles.interestsLabel}>{t("Interests")}</Text>
                    <View style={styles.interestTagsContainer}>
                        {allInterests.map(interest => (
                            <TouchableOpacity
                                key={interest}
                                style={[
                                    styles.interestTag,
                                    filters.interests.includes(interest) && styles.interestTagSelected
                                ]}
                                onPress={() => toggleInterestFilter(interest)}
                            >
                                <Text style={[
                                    styles.interestTagText,
                                    filters.interests.includes(interest) && styles.interestTagTextSelected
                                ]}>
                                    {interest}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>
            )}

            <ScrollView style={styles.scrollView}>
                {sortedRoommates.length === 0 ? (
                    <View style={styles.emptyContainer}>
                        <Ionicons name="people-outline" size={60} color={colors.COLOR_BLACK_LIGHT_3} />
                        <Text style={styles.emptyText}>{t("No roommates found")}</Text>
                        <Text style={styles.emptySubtext}>
                            {t("Try adjusting your filters or search criteria to find more potential roommates.")}
                        </Text>
                        <TouchableOpacity
                            style={styles.emptyButton}
                            onPress={resetFilters}
                        >
                            <Text style={styles.emptyButtonText}>{t("Reset Filters")}</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <View style={styles.roommatesContainer}>
                        <Text style={styles.resultCount}>
                            {sortedRoommates.length} {sortedRoommates.length === 1 ? t("roommate") : t("roommates")} {t("found")}
                        </Text>

                        {sortedRoommates.map((roommate) => (
                            <RoommateMatch
                                key={roommate.id}
                                id={roommate.id}
                                name={roommate.name}
                                age={roommate.age}
                                occupation={roommate.occupation}
                                bio={roommate.bio}
                                imageUrl={roommate.imageUrl}
                                matchPercentage={roommate.matchPercentage}
                                trustScore={roommate.trustScore}
                                lifestylePreferences={roommate.lifestylePreferences}
                                interests={roommate.interests}
                                onViewProfilePress={() => handleRoommateDetails(roommate.id)}
                                onMessagePress={() => handleMessage(roommate.id)}
                            />
                        ))}
                    </View>
                )}
            </ScrollView>

            <View style={styles.createProfileButton}>
                <TouchableOpacity
                    style={styles.actionButton}
                    onPress={handleCreateProfile}
                >
                    <Ionicons name="person-add" size={20} color="white" />
                    <Text style={styles.actionButtonText}>{t("Create/Edit Your Profile")}</Text>
                </TouchableOpacity>
            </View>
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
    interestsLabel: {
        fontSize: 14,
        color: colors.primaryDark_1,
        marginBottom: 8,
    },
    interestTagsContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    interestTag: {
        backgroundColor: 'rgba(0, 0, 0, 0.05)',
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 16,
        marginRight: 8,
        marginBottom: 8,
    },
    interestTagSelected: {
        backgroundColor: colors.primaryColor,
    },
    interestTagText: {
        fontSize: 12,
        color: colors.primaryDark_1,
    },
    interestTagTextSelected: {
        color: 'white',
    },
    scrollView: {
        flex: 1,
    },
    roommatesContainer: {
        paddingHorizontal: 16,
        paddingBottom: 100,
    },
    resultCount: {
        fontSize: 14,
        color: colors.primaryDark_1,
        marginBottom: 16,
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
    emptyButton: {
        backgroundColor: colors.primaryColor,
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 24,
    },
    emptyButtonText: {
        color: 'white',
        fontWeight: '600',
    },
    createProfileButton: {
        position: 'absolute',
        bottom: 16,
        left: 16,
        right: 16,
    },
    actionButton: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.primaryColor,
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 4,
    },
    actionButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '600',
        marginLeft: 8,
    },
}); 
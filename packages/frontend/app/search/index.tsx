import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TextInput,
    TouchableOpacity,
    FlatList,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/styles/colors';
import { Header } from '@/components/Header';
import LoadingSpinner from '@/components/LoadingSpinner';

// Type assertion for Ionicons compatibility with React 19
const IconComponent = Ionicons as any;

export default function SearchScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearching, setIsSearching] = useState(false);

    // Popular searches
    const popularSearches = [
        'Barcelona apartments',
        'Berlin co-living',
        'Amsterdam studios',
        'Stockholm eco-friendly',
        'London furnished',
        'Paris city center',
    ];

    // Recent searches (mock data)
    const recentSearches = [
        'Downtown apartments',
        'Student housing',
        'Pet-friendly rentals',
    ];

    // Property types with updated styling
    const propertyTypes = [
        { id: 'apartment', label: t('search.types.apartments'), icon: 'business-outline', count: 128, color: '#3B82F6' },
        { id: 'house', label: t('search.types.houses'), icon: 'home-outline', count: 94, color: '#10B981' },
        { id: 'room', label: t('search.types.rooms'), icon: 'bed-outline', count: 75, color: '#F59E0B' },
        { id: 'studio', label: t('search.types.studios'), icon: 'square-outline', count: 103, color: '#8B5CF6' },
    ];

    // Cities with enhanced data
    const popularCities = [
        { id: 'barcelona', name: 'Barcelona', count: 128, country: 'Spain' },
        { id: 'berlin', name: 'Berlin', count: 94, country: 'Germany' },
        { id: 'amsterdam', name: 'Amsterdam', count: 103, country: 'Netherlands' },
        { id: 'stockholm', name: 'Stockholm', count: 75, country: 'Sweden' },
        { id: 'london', name: 'London', count: 156, country: 'UK' },
        { id: 'paris', name: 'Paris', count: 89, country: 'France' },
    ];

    const handleSearch = async () => {
        if (searchQuery.trim()) {
            setIsSearching(true);
            // Add a small delay to show loading state
            setTimeout(() => {
                setIsSearching(false);
                router.push(`/search/${encodeURIComponent(searchQuery.trim())}`);
            }, 500);
        }
    };

    const handleSearchPress = (query: string) => {
        router.push(`/search/${encodeURIComponent(query)}`);
    };

    const handlePropertyTypePress = (type: string) => {
        router.push(`/search/${encodeURIComponent(type)}`);
    };

    const handleCityPress = (city: string) => {
        router.push(`/search/${encodeURIComponent(city)}`);
    };

    const clearSearch = () => {
        setSearchQuery('');
    };

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            {/* Updated Header */}
            <Header
                options={{
                    title: t('search.title'),
                    titlePosition: 'left',
                    showBackButton: false
                }}
            />

            {/* Enhanced Search Section */}
            <View style={styles.searchSection}>
                <View style={styles.searchContainer}>
                    <View style={styles.searchBar}>
                        <IconComponent name="search" size={20} color={colors.COLOR_BLACK_LIGHT_4} />
                        <TextInput
                            style={styles.searchInput}
                            placeholder={t("search.searchPlaceholder")}
                            placeholderTextColor={colors.COLOR_BLACK_LIGHT_4}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            onSubmitEditing={handleSearch}
                            returnKeyType="search"
                            autoFocus
                            editable={!isSearching}
                        />
                        {searchQuery.length > 0 && !isSearching && (
                            <TouchableOpacity onPress={clearSearch} style={styles.clearButton}>
                                <IconComponent name="close-circle" size={20} color={colors.COLOR_BLACK_LIGHT_4} />
                            </TouchableOpacity>
                        )}
                        {isSearching && (
                            <LoadingSpinner size={16} showText={false} />
                        )}
                    </View>
                </View>
                <TouchableOpacity
                    style={[styles.searchButton, !searchQuery.trim() && styles.searchButtonDisabled]}
                    onPress={handleSearch}
                    disabled={!searchQuery.trim() || isSearching}
                >
                    <Text style={styles.searchButtonText}>
                        {isSearching ? t('search.searching') : t('search.searchButton')}
                    </Text>
                </TouchableOpacity>
            </View>

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                {/* Recent Searches with improved styling */}
                {recentSearches.length > 0 && (
                    <View style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <IconComponent name="time-outline" size={20} color={colors.primaryColor} />
                            <Text style={styles.sectionTitle}>{t('search.recentSearches')}</Text>
                        </View>
                        <View style={styles.searchTags}>
                            {recentSearches.map((search, index) => (
                                <TouchableOpacity
                                    key={index}
                                    style={styles.searchTag}
                                    onPress={() => handleSearchPress(search)}
                                >
                                    <Text style={styles.searchTagText}>{search}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>
                )}

                {/* Popular Searches with enhanced design */}
                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <IconComponent name="trending-up" size={20} color={colors.primaryColor} />
                        <Text style={styles.sectionTitle}>{t('search.popularSearches')}</Text>
                    </View>
                    <View style={styles.searchTags}>
                        {popularSearches.map((search, index) => (
                            <TouchableOpacity
                                key={index}
                                style={styles.popularSearchTag}
                                onPress={() => handleSearchPress(search)}
                            >
                                <Text style={styles.popularSearchTagText}>{search}</Text>
                                <IconComponent name="arrow-up-right" size={14} color={colors.primaryColor} />
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                {/* Enhanced Property Types */}
                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <IconComponent name="apps" size={20} color={colors.primaryColor} />
                        <Text style={styles.sectionTitle}>{t('search.propertyTypes')}</Text>
                    </View>
                    <View style={styles.propertyTypesGrid}>
                        {propertyTypes.map((type) => (
                            <TouchableOpacity
                                key={type.id}
                                style={styles.propertyTypeCard}
                                onPress={() => handlePropertyTypePress(type.label.toLowerCase())}
                                activeOpacity={0.7}
                            >
                                <View style={[styles.propertyTypeIcon, { backgroundColor: type.color + '15' }]}>
                                    <IconComponent name={type.icon as any} size={28} color={type.color} />
                                </View>
                                <Text style={styles.propertyTypeLabel}>{type.label}</Text>
                                <Text style={styles.propertyTypeCount}>
                                    {type.count} {t('search.properties')}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                {/* Enhanced Popular Cities */}
                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <IconComponent name="location" size={20} color={colors.primaryColor} />
                        <Text style={styles.sectionTitle}>{t('search.popularCities')}</Text>
                    </View>
                    <View style={styles.citiesList}>
                        {popularCities.map((city) => (
                            <TouchableOpacity
                                key={city.id}
                                style={styles.cityItem}
                                onPress={() => handleCityPress(city.name)}
                                activeOpacity={0.7}
                            >
                                <View style={styles.cityIconContainer}>
                                    <IconComponent name="location-outline" size={24} color={colors.primaryColor} />
                                </View>
                                <View style={styles.cityInfo}>
                                    <Text style={styles.cityName}>{city.name}</Text>
                                    <Text style={styles.cityDetails}>
                                        {city.country} • {city.count} {t('search.properties')}
                                    </Text>
                                </View>
                                <IconComponent name="chevron-forward" size={20} color={colors.COLOR_BLACK_LIGHT_4} />
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                {/* Additional padding for bottom navigation */}
                <View style={styles.bottomSpacing} />
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.primaryLight,
    },
    searchSection: {
        backgroundColor: 'white',
        paddingHorizontal: 16,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 3,
    },
    searchContainer: {
        marginBottom: 12,
    },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.primaryLight,
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 4,
        borderWidth: 2,
        borderColor: 'transparent',
        minHeight: 52,
    },
    searchInput: {
        flex: 1,
        paddingVertical: 12,
        marginLeft: 12,
        fontSize: 16,
        color: colors.primaryDark,
        fontFamily: 'Inter-Regular',
    },
    clearButton: {
        padding: 4,
    },
    searchButton: {
        backgroundColor: colors.primaryColor,
        paddingVertical: 14,
        paddingHorizontal: 24,
        borderRadius: 12,
        alignItems: 'center',
        shadowColor: colors.primaryColor,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    searchButtonDisabled: {
        backgroundColor: colors.COLOR_BLACK_LIGHT_5,
        shadowOpacity: 0,
        elevation: 0,
    },
    searchButtonText: {
        color: 'white',
        fontWeight: '600',
        fontSize: 16,
        fontFamily: 'Inter-SemiBold',
    },
    content: {
        flex: 1,
    },
    section: {
        backgroundColor: 'white',
        paddingHorizontal: 20,
        paddingVertical: 24,
        marginBottom: 12,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: colors.primaryDark,
        marginLeft: 8,
        fontFamily: 'Inter-Bold',
    },
    searchTags: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    searchTag: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 24,
        backgroundColor: colors.primaryLight,
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_5,
    },
    searchTagText: {
        fontSize: 14,
        color: colors.primaryDark,
        fontFamily: 'Inter-Medium',
    },
    popularSearchTag: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 24,
        backgroundColor: colors.primaryColor + '10',
        borderWidth: 1,
        borderColor: colors.primaryColor + '30',
        gap: 6,
    },
    popularSearchTagText: {
        fontSize: 14,
        color: colors.primaryColor,
        fontFamily: 'Inter-Medium',
        fontWeight: '600',
    },
    propertyTypesGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 16,
    },
    propertyTypeCard: {
        width: '47%',
        backgroundColor: 'white',
        borderRadius: 20,
        padding: 20,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
        elevation: 3,
    },
    propertyTypeIcon: {
        width: 64,
        height: 64,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 12,
    },
    propertyTypeLabel: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryDark,
        marginBottom: 4,
        textAlign: 'center',
        fontFamily: 'Inter-SemiBold',
    },
    propertyTypeCount: {
        fontSize: 14,
        color: colors.primaryDark_1,
        fontFamily: 'Inter-Regular',
    },
    citiesList: {
        gap: 12,
    },
    cityItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 16,
        paddingHorizontal: 20,
        backgroundColor: colors.primaryLight,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_6,
    },
    cityIconContainer: {
        width: 48,
        height: 48,
        borderRadius: 12,
        backgroundColor: colors.primaryColor + '15',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
    },
    cityInfo: {
        flex: 1,
    },
    cityName: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
        marginBottom: 4,
        fontFamily: 'Inter-SemiBold',
    },
    cityDetails: {
        fontSize: 14,
        color: colors.primaryDark_1,
        fontFamily: 'Inter-Regular',
    },
    bottomSpacing: {
        height: 100,
    },
}); 
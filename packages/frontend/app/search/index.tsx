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

export default function SearchScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const [searchQuery, setSearchQuery] = useState('');

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

    // Property types
    const propertyTypes = [
        { id: 'apartment', label: t('Apartments'), icon: 'business-outline', count: 128 },
        { id: 'house', label: t('Houses'), icon: 'home-outline', count: 94 },
        { id: 'room', label: t('Rooms'), icon: 'bed-outline', count: 75 },
        { id: 'studio', label: t('Studios'), icon: 'square-outline', count: 103 },
    ];

    // Cities
    const popularCities = [
        { id: 'barcelona', name: 'Barcelona', count: 128 },
        { id: 'berlin', name: 'Berlin', count: 94 },
        { id: 'amsterdam', name: 'Amsterdam', count: 103 },
        { id: 'stockholm', name: 'Stockholm', count: 75 },
        { id: 'london', name: 'London', count: 156 },
        { id: 'paris', name: 'Paris', count: 89 },
    ];

    const handleSearch = () => {
        if (searchQuery.trim()) {
            router.push(`/search/${encodeURIComponent(searchQuery.trim())}`);
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
            {/* Header */}
            <View style={styles.header}>
                <Text style={styles.headerTitle}>{t('Search')}</Text>
            </View>

            {/* Search Bar */}
            <View style={styles.searchContainer}>
                <View style={styles.searchBar}>
                    <Ionicons name="search" size={20} color={colors.COLOR_BLACK_LIGHT_4} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder={t("Search by location, property type...")}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        onSubmitEditing={handleSearch}
                        returnKeyType="search"
                        autoFocus
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity onPress={clearSearch}>
                            <Ionicons name="close-circle" size={20} color={colors.COLOR_BLACK_LIGHT_4} />
                        </TouchableOpacity>
                    )}
                </View>
                <TouchableOpacity
                    style={[styles.searchButton, !searchQuery.trim() && styles.searchButtonDisabled]}
                    onPress={handleSearch}
                    disabled={!searchQuery.trim()}
                >
                    <Text style={styles.searchButtonText}>{t('Search')}</Text>
                </TouchableOpacity>
            </View>

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                {/* Recent Searches */}
                {recentSearches.length > 0 && (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>{t('Recent Searches')}</Text>
                        <View style={styles.searchTags}>
                            {recentSearches.map((search, index) => (
                                <TouchableOpacity
                                    key={index}
                                    style={styles.searchTag}
                                    onPress={() => handleSearchPress(search)}
                                >
                                    <Ionicons name="time-outline" size={16} color={colors.primaryColor} />
                                    <Text style={styles.searchTagText}>{search}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>
                )}

                {/* Popular Searches */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('Popular Searches')}</Text>
                    <View style={styles.searchTags}>
                        {popularSearches.map((search, index) => (
                            <TouchableOpacity
                                key={index}
                                style={styles.searchTag}
                                onPress={() => handleSearchPress(search)}
                            >
                                <Ionicons name="trending-up-outline" size={16} color={colors.primaryColor} />
                                <Text style={styles.searchTagText}>{search}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                {/* Property Types */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('Property Types')}</Text>
                    <View style={styles.propertyTypesGrid}>
                        {propertyTypes.map((type) => (
                            <TouchableOpacity
                                key={type.id}
                                style={styles.propertyTypeCard}
                                onPress={() => handlePropertyTypePress(type.label.toLowerCase())}
                            >
                                <View style={styles.propertyTypeIcon}>
                                    <Ionicons name={type.icon as any} size={24} color={colors.primaryColor} />
                                </View>
                                <Text style={styles.propertyTypeLabel}>{type.label}</Text>
                                <Text style={styles.propertyTypeCount}>{type.count} {t('properties')}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                {/* Popular Cities */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('Popular Cities')}</Text>
                    <View style={styles.citiesList}>
                        {popularCities.map((city) => (
                            <TouchableOpacity
                                key={city.id}
                                style={styles.cityItem}
                                onPress={() => handleCityPress(city.name)}
                            >
                                <View style={styles.cityInfo}>
                                    <Text style={styles.cityName}>{city.name}</Text>
                                    <Text style={styles.cityCount}>{city.count} {t('properties')}</Text>
                                </View>
                                <Ionicons name="chevron-forward" size={20} color={colors.COLOR_BLACK_LIGHT_4} />
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.primaryLight,
    },
    header: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: 'white',
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: colors.primaryDark,
    },
    searchContainer: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: 'white',
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
    },
    searchBar: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.primaryLight,
        borderRadius: 24,
        paddingHorizontal: 12,
        marginRight: 8,
    },
    searchInput: {
        flex: 1,
        paddingVertical: 10,
        marginLeft: 8,
        fontSize: 16,
        color: colors.primaryDark,
    },
    searchButton: {
        backgroundColor: colors.primaryColor,
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 20,
        justifyContent: 'center',
    },
    searchButtonDisabled: {
        backgroundColor: colors.COLOR_BLACK_LIGHT_5,
    },
    searchButtonText: {
        color: 'white',
        fontWeight: '600',
        fontSize: 14,
    },
    content: {
        flex: 1,
    },
    section: {
        paddingHorizontal: 16,
        paddingVertical: 20,
        backgroundColor: 'white',
        marginBottom: 8,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
        marginBottom: 16,
    },
    searchTags: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    searchTag: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: colors.primaryLight,
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_5,
        gap: 6,
    },
    searchTagText: {
        fontSize: 14,
        color: colors.primaryDark,
    },
    propertyTypesGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    propertyTypeCard: {
        width: '48%',
        backgroundColor: colors.primaryLight,
        borderRadius: 12,
        padding: 16,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_5,
    },
    propertyTypeIcon: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: 'white',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 8,
    },
    propertyTypeLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.primaryDark,
        marginBottom: 4,
    },
    propertyTypeCount: {
        fontSize: 12,
        color: colors.primaryDark_1,
    },
    citiesList: {
        gap: 8,
    },
    cityItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        paddingHorizontal: 16,
        backgroundColor: colors.primaryLight,
        borderRadius: 8,
    },
    cityInfo: {
        flex: 1,
    },
    cityName: {
        fontSize: 16,
        fontWeight: '500',
        color: colors.primaryDark,
        marginBottom: 2,
    },
    cityCount: {
        fontSize: 14,
        color: colors.primaryDark_1,
    },
}); 
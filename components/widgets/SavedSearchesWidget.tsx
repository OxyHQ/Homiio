import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { BaseWidget } from './BaseWidget';

interface SavedSearch {
    id: string;
    name: string;
    criteria: string;
    newResults?: number;
}

export function SavedSearchesWidget() {
    const { t } = useTranslation();
    const router = useRouter();

    // Mock data for saved searches
    const savedSearches: SavedSearch[] = [
        {
            id: '1',
            name: 'Barcelona Studios',
            criteria: '1BR, Max €900/month',
            newResults: 3
        },
        {
            id: '2',
            name: 'Berlin Family Homes',
            criteria: '3BR+, Garden',
            newResults: 1
        },
        {
            id: '3',
            name: 'London Co-living',
            criteria: 'Co-living, Central',
        }
    ];

    const navigateToSearch = (searchId: string) => {
        router.push(`/properties/search/${searchId}`);
    };

    const renderSearchItem = ({ item }: { item: SavedSearch }) => (
        <TouchableOpacity
            style={styles.searchItem}
            onPress={() => navigateToSearch(item.id)}
        >
            <View style={styles.searchInfo}>
                <Text style={styles.searchName}>{item.name}</Text>
                <Text style={styles.searchCriteria}>{item.criteria}</Text>
            </View>
            <View style={styles.searchActions}>
                {item.newResults && (
                    <View style={styles.newResultsBadge}>
                        <Text style={styles.newResultsText}>{item.newResults}</Text>
                    </View>
                )}
                <Ionicons name="chevron-forward" size={16} color={colors.COLOR_BLACK_LIGHT_4} />
            </View>
        </TouchableOpacity>
    );

    return (
        <BaseWidget
            title={t("Saved Searches")}
            icon={<Ionicons name="bookmark" size={22} color={colors.primaryColor} />}
        >
            <View style={styles.container}>
                <FlatList
                    data={savedSearches}
                    renderItem={renderSearchItem}
                    keyExtractor={item => item.id}
                    scrollEnabled={false}
                />

                <TouchableOpacity
                    style={styles.createButton}
                    onPress={() => router.push('/properties/search/create')}
                >
                    <Text style={styles.createButtonText}>Create New Search</Text>
                </TouchableOpacity>
            </View>
        </BaseWidget>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingVertical: 5,
    },
    searchItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
    },
    searchInfo: {
        flex: 1,
    },
    searchName: {
        fontSize: 15,
        fontWeight: '600',
        marginBottom: 2,
    },
    searchCriteria: {
        fontSize: 13,
        color: colors.COLOR_BLACK_LIGHT_4,
    },
    searchActions: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    newResultsBadge: {
        backgroundColor: colors.primaryColor,
        borderRadius: 12,
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 8,
    },
    newResultsText: {
        color: 'white',
        fontSize: 12,
        fontWeight: 'bold',
    },
    createButton: {
        backgroundColor: colors.primaryLight,
        borderWidth: 1,
        borderColor: colors.primaryColor,
        borderRadius: 20,
        paddingVertical: 8,
        paddingHorizontal: 15,
        alignItems: 'center',
        marginTop: 15,
    },
    createButtonText: {
        color: colors.primaryColor,
        fontWeight: '600',
        fontSize: 14,
    },
}); 
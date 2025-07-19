import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { BaseWidget } from './BaseWidget';

// Type assertion for Ionicons compatibility
const IconComponent = Ionicons as any;

interface QuickFilter {
    id: string;
    label: string;
    query: string;
    color?: string;
}

interface FilterPillProps {
    filter: QuickFilter;
    isSelected: boolean;
    onToggle: () => void;
}

const FilterPill = ({ filter, isSelected, onToggle }: FilterPillProps) => {
    return (
        <TouchableOpacity
            style={[
                styles.filterPill,
                isSelected && styles.filterPillSelected,
                isSelected && filter.color && { backgroundColor: filter.color }
            ]}
            onPress={onToggle}
        >
            <Text style={[
                styles.filterPillText,
                isSelected && styles.filterPillTextSelected
            ]}>
                {filter.label}
            </Text>
        </TouchableOpacity>
    );
};

export function QuickFiltersWidget() {
    const { t } = useTranslation();
    const router = useRouter();

    const [selectedFilters, setSelectedFilters] = useState<string[]>([]);

    const quickFilters: QuickFilter[] = [
        { id: 'eco', label: t('Eco-friendly'), query: 'eco-friendly sustainable green', color: '#16a34a' },
        { id: 'coliving', label: t('Co-living'), query: 'co-living shared coliving', color: '#8b5cf6' },
        { id: 'furnished', label: t('Furnished'), query: 'furnished', color: '#f59e0b' },
        { id: 'pets', label: t('Pets Allowed'), query: 'pets allowed pet-friendly', color: '#10b981' },
        { id: 'budget', label: '< ⊜1000', query: 'cheap budget under 1000', color: '#3b82f6' },
        { id: 'verified', label: t('Verified'), query: 'verified trusted', color: '#059669' },
    ];

    const handleFilterToggle = (filterId: string) => {
        setSelectedFilters(prev =>
            prev.includes(filterId)
                ? prev.filter(f => f !== filterId)
                : [...prev, filterId]
        );
    };

    const handleApplyFilters = () => {
        if (selectedFilters.length === 0) {
            router.push('/search');
            return;
        }

        // Build search query from selected filters
        const selectedFilterObjects = quickFilters.filter(f => selectedFilters.includes(f.id));
        const searchQuery = selectedFilterObjects.map(f => f.query).join(' ');

        router.push(`/search/${encodeURIComponent(searchQuery)}`);
    };

    const handleAdvancedFilters = () => {
        router.push('/search');
    };

    return (
        <BaseWidget
            title={t("Quick Filters")}
        >
            <View style={styles.container}>
                <View style={styles.filtersGrid}>
                    {quickFilters.map((filter) => (
                        <FilterPill
                            key={filter.id}
                            filter={filter}
                            isSelected={selectedFilters.includes(filter.id)}
                            onToggle={() => handleFilterToggle(filter.id)}
                        />
                    ))}
                </View>

                {selectedFilters.length > 0 && (
                    <TouchableOpacity
                        style={styles.applyButton}
                        onPress={handleApplyFilters}
                    >
                        <IconComponent name="search" size={16} color="white" />
                        <Text style={styles.applyButtonText}>
                            {`${t("Search with")} ${selectedFilters.length} ${t("filters")}`}
                        </Text>
                    </TouchableOpacity>
                )}

                <TouchableOpacity
                    style={styles.advancedButton}
                    onPress={handleAdvancedFilters}
                >
                    <Text style={styles.advancedButtonText}>
                        {t("Advanced Filters")}
                    </Text>
                </TouchableOpacity>
            </View>
        </BaseWidget>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingVertical: 5,
    },
    filtersGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 15,
    },
    filterPill: {
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 20,
        backgroundColor: '#f0f0f0',
        borderWidth: 1,
        borderColor: '#e0e0e0',
    },
    filterPillSelected: {
        backgroundColor: colors.primaryColor,
        borderWidth: 0,
    },
    filterPillText: {
        color: colors.COLOR_BLACK_LIGHT_4,
        fontSize: 14,
        fontWeight: 'normal',
    },
    filterPillTextSelected: {
        color: 'white',
        fontWeight: '600',
    },
    applyButton: {
        backgroundColor: colors.primaryColor,
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 25,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 8,
        marginBottom: 10,
        shadowColor: colors.primaryColor,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 3,
    },
    applyButtonText: {
        color: 'white',
        fontWeight: '600',
        fontSize: 14,
        fontFamily: 'Phudu',
    },
    advancedButton: {
        backgroundColor: colors.primaryColor + '10',
        borderWidth: 1,
        borderColor: colors.primaryColor + '30',
        paddingVertical: 10,
        borderRadius: 25,
        alignItems: 'center',
    },
    advancedButtonText: {
        color: colors.primaryColor,
        fontWeight: '600',
        fontSize: 14,
        fontFamily: 'Phudu',
    },
}); 
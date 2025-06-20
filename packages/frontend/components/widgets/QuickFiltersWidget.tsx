import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { BaseWidget } from './BaseWidget';

interface FilterPillProps {
    label: string;
    isSelected: boolean;
    onToggle: () => void;
}

const FilterPill = ({ label, isSelected, onToggle }: FilterPillProps) => {
    return (
        <TouchableOpacity
            style={[
                styles.filterPill,
                isSelected && styles.filterPillSelected
            ]}
            onPress={onToggle}
        >
            <Text style={[
                styles.filterPillText,
                isSelected && styles.filterPillTextSelected
            ]}>
                {label}
            </Text>
        </TouchableOpacity>
    );
};

export function QuickFiltersWidget() {
    const { t } = useTranslation();
    const router = useRouter();

    const [selectedFilters, setSelectedFilters] = useState<string[]>([]);

    const quickFilters = [
        'Eco-friendly',
        'Co-living',
        'Furnished',
        'Pets Allowed',
        '< ⊜1000',
        'Verified'
    ];

    const handleFilterToggle = (filter: string) => {
        setSelectedFilters(prev =>
            prev.includes(filter)
                ? prev.filter(f => f !== filter)
                : [...prev, filter]
        );
    };

    const handleAdvancedFilters = () => {
        router.push('/properties/filter');
    };

    return (
        <BaseWidget
            title={t("Quick Filters")}
        >
            <View style={styles.container}>
                <View style={styles.filtersGrid}>
                    {quickFilters.map((filter) => (
                        <FilterPill
                            key={filter}
                            label={filter}
                            isSelected={selectedFilters.includes(filter)}
                            onToggle={() => handleFilterToggle(filter)}
                        />
                    ))}
                </View>

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
    advancedButton: {
        backgroundColor: colors.primaryColor,
        paddingVertical: 10,
        borderRadius: 20,
        alignItems: 'center',
    },
    advancedButtonText: {
        color: 'white',
        fontWeight: '600',
        fontSize: 14,
    },
}); 
import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';

interface FiltersBarProps {
    activeFiltersCount: number;
    onFilterPress: () => void;
    sortBy: string;
    onSortPress: () => void;
}

export function FiltersBar({ activeFiltersCount, onFilterPress, sortBy, onSortPress }: FiltersBarProps) {
    return (
        <View style={styles.container}>
            <TouchableOpacity
                style={[styles.button, activeFiltersCount > 0 && styles.buttonActive]}
                onPress={onFilterPress}
            >
                <Ionicons
                    name="filter"
                    size={20}
                    color={activeFiltersCount > 0 ? '#fff' : colors.COLOR_BLACK}
                />
                <ThemedText style={[
                    styles.buttonText,
                    activeFiltersCount > 0 && styles.buttonTextActive
                ]}>
                    {activeFiltersCount > 0 ? `${activeFiltersCount} Filters` : 'Filter'}
                </ThemedText>
            </TouchableOpacity>

            <TouchableOpacity
                style={[styles.button, styles.sortButton]}
                onPress={onSortPress}
            >
                <Ionicons name="swap-vertical" size={20} color={colors.COLOR_BLACK} />
                <ThemedText style={styles.buttonText}>
                    {sortBy === 'newest'
                        ? 'Newest'
                        : sortBy === 'priceAsc'
                            ? 'Price: Low to High'
                            : 'Price: High to Low'}
                </ThemedText>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        paddingVertical: 8,
        gap: 8,
    },
    button: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: colors.COLOR_BLACK_LIGHT_7,
        gap: 6,
    },
    buttonActive: {
        backgroundColor: colors.primaryColor,
    },
    buttonText: {
        fontSize: 14,
        color: colors.COLOR_BLACK,
    },
    buttonTextActive: {
        color: '#fff',
    },
    sortButton: {
        flex: 1,
    },
});

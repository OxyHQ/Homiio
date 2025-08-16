import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { colors } from '@/styles/colors';
import { LinearGradient } from 'expo-linear-gradient';

export type FilterValue = string | number | boolean | (string | number)[];

export interface FilterOption {
    id: string;
    label: string;
    value: string | number;
}

export interface FilterSection {
    id: string;
    title: string;
    type: 'range' | 'chips' | 'toggle';
    options?: FilterOption[];
    min?: number;
    max?: number;
    value?: FilterValue;
}

interface FiltersBottomSheetProps {
    sections: FilterSection[];
    onFilterChange: (sectionId: string, value: FilterValue) => void;
    onApply: () => void;
    onClear: () => void;
}

export function FiltersBottomSheet({
    sections,
    onFilterChange,
    onApply,
    onClear,
}: FiltersBottomSheetProps) {
    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <ThemedText style={styles.title}>Filters</ThemedText>
            </View>

            {sections.map((section) => (
                <View key={section.id} style={styles.section}>
                    <ThemedText style={styles.sectionTitle}>{section.title}</ThemedText>

                    {section.type === 'chips' && section.options && (
                        <View style={styles.chipContainer}>
                            {section.options.map((option) => (
                                <TouchableOpacity
                                    key={option.id}
                                    style={[
                                        styles.chip,
                                        section.value === option.value && styles.chipSelected,
                                    ]}
                                    onPress={() => onFilterChange(section.id, option.value)}
                                >
                                    <ThemedText
                                        style={[
                                            styles.chipText,
                                            section.value === option.value && styles.chipTextSelected,
                                        ]}
                                    >
                                        {option.label}
                                    </ThemedText>
                                </TouchableOpacity>
                            ))}
                        </View>
                    )}

                    {section.type === 'range' && section.min !== undefined && section.max !== undefined && (
                        <View style={styles.rangeContainer}>
                            <TouchableOpacity
                                style={styles.rangeInput}
                                onPress={() => {/* TODO: Show number picker */ }}
                            >
                                <ThemedText>
                                    {Array.isArray(section.value) && section.value[0] !== undefined
                                        ? section.value[0]
                                        : 'Min'}
                                </ThemedText>
                            </TouchableOpacity>
                            <ThemedText style={styles.rangeSeparator}>-</ThemedText>
                            <TouchableOpacity
                                style={styles.rangeInput}
                                onPress={() => {/* TODO: Show number picker */ }}
                            >
                                <ThemedText>
                                    {Array.isArray(section.value) && section.value[1] !== undefined
                                        ? section.value[1]
                                        : 'Max'}
                                </ThemedText>
                            </TouchableOpacity>
                        </View>
                    )}
                </View>
            ))}

            <View style={styles.footer}>
                <TouchableOpacity style={styles.clearButton} onPress={onClear}>
                    <ThemedText style={styles.clearButtonText}>Clear All</ThemedText>
                </TouchableOpacity>

                <TouchableOpacity style={styles.applyButton} onPress={onApply}>
                    <LinearGradient
                        colors={[colors.primaryColor, colors.secondaryColor]}
                        style={styles.applyButtonGradient}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                    >
                        <ThemedText style={styles.applyButtonText}>Apply</ThemedText>
                    </LinearGradient>
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
        padding: 16,
    },
    header: {
        marginBottom: 24,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: colors.COLOR_BLACK,
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.COLOR_BLACK,
        marginBottom: 12,
    },
    chipContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    chip: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: colors.COLOR_BLACK_LIGHT_7,
    },
    chipSelected: {
        backgroundColor: colors.primaryColor,
    },
    chipText: {
        fontSize: 14,
        color: colors.COLOR_BLACK,
    },
    chipTextSelected: {
        color: '#fff',
    },
    rangeContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    rangeInput: {
        flex: 1,
        height: 40,
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_6,
        borderRadius: 8,
        paddingHorizontal: 12,
        justifyContent: 'center',
    },
    rangeSeparator: {
        marginHorizontal: 12,
        color: colors.COLOR_BLACK_LIGHT_4,
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 'auto',
        gap: 12,
    },
    clearButton: {
        flex: 1,
        height: 44,
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_6,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
    },
    clearButtonText: {
        color: colors.COLOR_BLACK,
        fontSize: 14,
        fontWeight: '600',
    },
    applyButton: {
        flex: 1,
        height: 44,
        borderRadius: 22,
        overflow: 'hidden',
    },
    applyButtonGradient: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    applyButtonText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
    },
});

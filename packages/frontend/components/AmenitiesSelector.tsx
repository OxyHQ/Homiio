import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/components/ThemedText';
import { colors } from '@/styles/colors';
import { POPULAR_AMENITIES, getAmenityById, Amenity } from '@/constants/amenities';

// Type assertion for Ionicons compatibility with React 19
const IconComponent = Ionicons as any;

type AmenitiesSelectorProps = {
    selectedAmenities: string[];
    onAmenityToggle: (amenityId: string) => void;
    title?: string;
    showPremiumBadge?: boolean;
    style?: any;
};

export function AmenitiesSelector({
    selectedAmenities,
    onAmenityToggle,
    title = 'Amenities',
    showPremiumBadge = true,
    style,
}: AmenitiesSelectorProps) {
    return (
        <View style={[styles.container, style]}>
            <ThemedText style={styles.label}>{title}</ThemedText>
            <View style={styles.pickerContainer}>
                {POPULAR_AMENITIES.map((amenityId) => {
                    const amenity = getAmenityById(amenityId);
                    if (!amenity) return null;

                    const isSelected = selectedAmenities?.includes(amenity.id);

                    return (
                        <TouchableOpacity
                            key={amenity.id}
                            style={[
                                styles.pickerOption,
                                isSelected && styles.pickerOptionSelected,
                                amenity.premium && styles.premiumAmenityOption
                            ]}
                            onPress={() => onAmenityToggle(amenity.id)}
                        >
                            <View style={styles.amenityOptionContent}>
                                <IconComponent
                                    name={amenity.icon as any}
                                    size={16}
                                    color={isSelected ? 'white' : colors.primaryColor}
                                />
                                <ThemedText
                                    style={[
                                        styles.pickerOptionText,
                                        isSelected && styles.pickerOptionTextSelected
                                    ]}
                                >
                                    {amenity.name}
                                </ThemedText>
                                {showPremiumBadge && amenity.premium && (
                                    <View style={styles.premiumBadge}>
                                        <ThemedText style={styles.premiumBadgeText}>P</ThemedText>
                                    </View>
                                )}
                            </View>
                        </TouchableOpacity>
                    );
                })}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginBottom: 16,
    },
    label: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryDark,
        marginBottom: 8,
    },
    pickerContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    pickerOption: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: colors.primaryLight_1,
        backgroundColor: colors.primaryLight,
    },
    pickerOptionSelected: {
        backgroundColor: colors.primaryColor,
        borderColor: colors.primaryColor,
    },
    pickerOptionText: {
        fontSize: 14,
        color: colors.primaryDark,
    },
    pickerOptionTextSelected: {
        color: 'white',
        fontWeight: '600',
    },
    amenityOptionContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    premiumAmenityOption: {
        borderColor: colors.primaryColor,
        borderWidth: 2,
    },
    premiumBadge: {
        backgroundColor: colors.primaryColor,
        borderRadius: 10,
        width: 16,
        height: 16,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 4,
    },
    premiumBadgeText: {
        fontSize: 10,
        color: 'white',
        fontWeight: 'bold',
    },
}); 
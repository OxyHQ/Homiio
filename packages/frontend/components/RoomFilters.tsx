import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    TextInput,
    ScrollView,
    Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { PropertyFilters } from '@/services/propertyService';
import { PropertyType } from '@homiio/shared-types';

interface RoomFiltersProps {
    filters: PropertyFilters;
    onApplyFilters: (filters: PropertyFilters) => void;
    onClose: () => void;
}

const IconComponent = Ionicons as any;

export function RoomFilters({ filters, onApplyFilters, onClose }: RoomFiltersProps) {
    const [localFilters, setLocalFilters] = useState<PropertyFilters>(filters);

    const handleInputChange = (key: keyof PropertyFilters, value: any) => {
        setLocalFilters(prev => ({
            ...prev,
            [key]: value
        }));
    };

    const handleApply = () => {
        onApplyFilters(localFilters);
        onClose();
    };

    const handleReset = () => {
        const resetFilters: PropertyFilters = {
            type: PropertyType.ROOM,
            sortBy: 'createdAt',
            sortOrder: 'desc'
        };
        setLocalFilters(resetFilters);
        onApplyFilters(resetFilters);
        onClose();
    };

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                    <IconComponent name="close" size={24} color={colors.primaryDark} />
                </TouchableOpacity>
                <Text style={styles.title}>Filter Rooms</Text>
                <TouchableOpacity onPress={handleReset} style={styles.resetButton}>
                    <Text style={styles.resetText}>Reset</Text>
                </TouchableOpacity>
            </View>

            <ScrollView style={styles.content}>
                {/* Price Range */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Price Range</Text>
                    <View style={styles.row}>
                        <View style={styles.halfInput}>
                            <Text style={styles.label}>Min ($)</Text>
                            <TextInput
                                style={styles.input}
                                value={localFilters.minPrice?.toString()}
                                onChangeText={value => handleInputChange('minPrice', value ? parseInt(value) : undefined)}
                                keyboardType="numeric"
                                placeholder="Min"
                            />
                        </View>
                        <View style={styles.halfInput}>
                            <Text style={styles.label}>Max ($)</Text>
                            <TextInput
                                style={styles.input}
                                value={localFilters.maxPrice?.toString()}
                                onChangeText={value => handleInputChange('maxPrice', value ? parseInt(value) : undefined)}
                                keyboardType="numeric"
                                placeholder="Max"
                            />
                        </View>
                    </View>
                </View>

                {/* Room Type is fixed to PropertyType.ROOM */}

                {/* Amenities */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Amenities</Text>
                    <View style={styles.optionsGrid}>
                        {[
                            'private_bathroom',
                            'balcony',
                            'walk_in_closet',
                            'air_conditioning',
                            'heating',
                            'furnished',
                            'pet_friendly',
                            'smoking_allowed'
                        ].map(amenity => (
                            <TouchableOpacity
                                key={amenity}
                                style={[
                                    styles.optionButton,
                                    localFilters.amenities?.includes(amenity) && styles.optionButtonSelected
                                ]}
                                onPress={() => {
                                    const currentAmenities = localFilters.amenities || [];
                                    const newAmenities = currentAmenities.includes(amenity)
                                        ? currentAmenities.filter(a => a !== amenity)
                                        : [...currentAmenities, amenity];
                                    handleInputChange('amenities', newAmenities.length > 0 ? newAmenities : undefined);
                                }}
                            >
                                <Text style={[
                                    styles.optionText,
                                    localFilters.amenities?.includes(amenity) && styles.optionTextSelected
                                ]}>
                                    {amenity.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                {/* Preferences */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Preferences</Text>
                    <View style={styles.switchRow}>
                        <Text style={styles.switchLabel}>Pet Friendly</Text>
                        <Switch
                            value={localFilters.pets}
                            onValueChange={value => handleInputChange('pets', value)}
                            trackColor={{ false: colors.COLOR_BLACK_LIGHT_6, true: colors.primaryColor }}
                        />
                    </View>
                    <View style={styles.switchRow}>
                        <Text style={styles.switchLabel}>Smoking Allowed</Text>
                        <Switch
                            value={localFilters.smoking}
                            onValueChange={value => handleInputChange('smoking', value)}
                            trackColor={{ false: colors.COLOR_BLACK_LIGHT_6, true: colors.primaryColor }}
                        />
                    </View>
                </View>

                {/* Location */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Location</Text>
                    <View style={styles.row}>
                        <View style={styles.halfInput}>
                            <Text style={styles.label}>City</Text>
                            <TextInput
                                style={styles.input}
                                value={localFilters.city}
                                onChangeText={value => handleInputChange('city', value)}
                                placeholder="Enter city"
                            />
                        </View>
                        <View style={styles.halfInput}>
                            <Text style={styles.label}>State</Text>
                            <TextInput
                                style={styles.input}
                                value={localFilters.state}
                                onChangeText={value => handleInputChange('state', value)}
                                placeholder="Enter state"
                            />
                        </View>
                    </View>
                </View>

                {/* Sort By */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Sort By</Text>
                    <View style={styles.optionsGrid}>
                        {[
                            { value: 'matchScore', label: 'Best Match' },
                            { value: 'rent.amount', label: 'Price' },
                            { value: 'createdAt', label: 'Newest' },
                            { value: 'title', label: 'Name' }
                        ].map(({ value, label }) => (
                            <TouchableOpacity
                                key={value}
                                style={[
                                    styles.optionButton,
                                    localFilters.sortBy === value && styles.optionButtonSelected
                                ]}
                                onPress={() => {
                                    handleInputChange('sortBy', value);
                                    handleInputChange('sortOrder', value === 'rent.amount' ? 'asc' : 'desc');
                                }}
                            >
                                <Text style={[
                                    styles.optionText,
                                    localFilters.sortBy === value && styles.optionTextSelected
                                ]}>
                                    {label}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>
            </ScrollView>

            <View style={styles.footer}>
                <TouchableOpacity style={styles.applyButton} onPress={handleApply}>
                    <Text style={styles.applyButtonText}>Apply Filters</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.primaryLight,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
    },
    closeButton: {
        padding: 8,
    },
    title: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
    },
    resetButton: {
        padding: 8,
    },
    resetText: {
        color: colors.primaryColor,
        fontSize: 14,
        fontWeight: '500',
    },
    content: {
        flex: 1,
    },
    section: {
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryDark,
        marginBottom: 12,
    },
    row: {
        flexDirection: 'row',
        gap: 16,
    },
    halfInput: {
        flex: 1,
    },
    label: {
        fontSize: 14,
        color: colors.primaryDark_1,
        marginBottom: 4,
    },
    input: {
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_6,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        fontSize: 14,
        color: colors.primaryDark,
    },
    optionsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    optionButton: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_6,
        backgroundColor: colors.primaryLight,
    },
    optionButtonSelected: {
        backgroundColor: colors.primaryColor,
        borderColor: colors.primaryColor,
    },
    optionText: {
        fontSize: 14,
        color: colors.primaryDark_1,
    },
    optionTextSelected: {
        color: colors.primaryLight,
    },
    switchRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    switchLabel: {
        fontSize: 14,
        color: colors.primaryDark_1,
    },
    footer: {
        padding: 16,
        borderTopWidth: 1,
        borderTopColor: colors.COLOR_BLACK_LIGHT_6,
    },
    applyButton: {
        backgroundColor: colors.primaryColor,
        paddingVertical: 12,
        borderRadius: 8,
        alignItems: 'center',
    },
    applyButtonText: {
        color: colors.primaryLight,
        fontSize: 16,
        fontWeight: '600',
    },
});

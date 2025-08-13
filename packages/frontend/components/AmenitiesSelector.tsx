import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/components/ThemedText';
import { colors } from '@/styles/colors';
import {
  POPULAR_AMENITIES,
  getAmenityById,
  getAmenitiesByPropertyType,
} from '@/constants/amenities';

// Type assertion for Ionicons compatibility with React 19
const IconComponent = Ionicons as any;

type AmenitiesSelectorProps = {
  selectedAmenities: string[];
  onAmenityToggle: (amenityId: string) => void;
  showPremiumBadge?: boolean;
  style?: any;
  propertyType?: string;
};

export function AmenitiesSelector({
  selectedAmenities,
  onAmenityToggle,
  showPremiumBadge = true,
  style,
  propertyType,
}: AmenitiesSelectorProps) {
  // Get amenities based on property type, fallback to all amenities if no type specified
  const availableAmenities = propertyType
    ? getAmenitiesByPropertyType(propertyType)
    : POPULAR_AMENITIES;

  return (
    <View style={[styles.container, style]}>
      <View style={styles.pickerContainer}>
        {availableAmenities.map((amenityId) => {
          const amenity = getAmenityById(amenityId);
          if (!amenity) return null;

          const isSelected = selectedAmenities?.includes(amenity.id);

          return (
            <TouchableOpacity
              key={amenity.id}
              style={[styles.pickerOption, isSelected && styles.pickerOptionSelected]}
              onPress={() => onAmenityToggle(amenity.id)}
            >
              <View style={styles.amenityOptionContent}>
                <IconComponent
                  name={amenity.icon as any}
                  size={16}
                  color={isSelected ? 'white' : colors.primaryColor}
                />
                <ThemedText
                  style={[styles.pickerOptionText, isSelected && styles.pickerOptionTextSelected]}
                >
                  {amenity.name}
                </ThemedText>
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
});

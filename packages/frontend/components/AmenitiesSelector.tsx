import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
// Amenity glyphs are data-driven Ionicons names from `constants/amenities`
// (wifi, pool, paw…); Bloom's Remix set has no equivalents for most of them.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Chip } from '@oxy.so/bloom/chip';
import { useTheme } from '@oxy.so/bloom/theme';
import {
  POPULAR_AMENITIES,
  getAmenityById,
  getAmenitiesByPropertyType,
} from '@/constants/amenities';

type AmenitiesSelectorProps = {
  selectedAmenities: string[];
  onAmenityToggle: (amenityId: string) => void;
  showPremiumBadge?: boolean;
  style?: StyleProp<ViewStyle>;
  propertyType?: string;
};

/** Toggleable Bloom `Chip`s, one per amenity available for the property type. */
export function AmenitiesSelector({
  selectedAmenities,
  onAmenityToggle,
  style,
  propertyType,
}: AmenitiesSelectorProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  // Get amenities based on property type, fallback to all amenities if no type specified
  const availableAmenities = propertyType
    ? getAmenitiesByPropertyType(propertyType)
    : POPULAR_AMENITIES;

  return (
    <View style={[styles.container, style]}>
      {availableAmenities.map((amenityId) => {
        const amenity = getAmenityById(amenityId);
        if (!amenity) return null;

        const isSelected = Boolean(selectedAmenities?.includes(amenity.id));

        return (
          <Chip
            key={amenity.id}
            size="large"
            selected={isSelected}
            onPress={() => onAmenityToggle(amenity.id)}
            startIcon={
              <Ionicons
                name={amenity.icon}
                size={16}
                color={isSelected ? theme.colors.primary : theme.colors.textSecondary}
              />
            }
          >
            {amenity.nameKey ? t(amenity.nameKey) : amenity.name}
          </Chip>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
});

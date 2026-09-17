import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
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
        const AmenityIcon = amenity.icon;

        return (
          <Chip
            key={amenity.id}
            size="large"
            selected={isSelected}
            onPress={() => onAmenityToggle(amenity.id)}
            startIcon={
              <AmenityIcon
                width={16}
                height={16}
                fill={isSelected ? theme.colors.primary : theme.colors.textSecondary}
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

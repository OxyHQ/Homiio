import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/components/ThemedText';
import { colors } from '@/styles/colors';
import { getAmenityById } from '@/constants/amenities';

// Type assertion for Ionicons compatibility with React 19
const IconComponent = Ionicons as any;

type AmenitiesDisplayProps = {
  amenities: string[];
  title?: string;
  showEmptyState?: boolean;
  emptyStateText?: string;
  style?: any;
};

export function AmenitiesDisplay({
  amenities,
  title = "What's Included",
  showEmptyState = true,
  emptyStateText = 'No amenities listed',
  style,
}: AmenitiesDisplayProps) {
  if (amenities.length === 0) {
    if (!showEmptyState) return null;

    return (
      <View style={[styles.container, style]}>
        <ThemedText style={styles.title}>{title}</ThemedText>
        <View style={styles.emptyContainer}>
          <IconComponent name="home-outline" size={48} color={colors.COLOR_BLACK_LIGHT_4} />
          <ThemedText style={styles.emptyText}>{emptyStateText}</ThemedText>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      <ThemedText style={styles.title}>{title}</ThemedText>
      <View style={styles.amenitiesContainer}>
        {amenities.map((amenity, index) => {
          const amenityConfig = getAmenityById(amenity);
          return (
            <View
              key={index}
              style={[
                styles.amenityChip,
                amenityConfig?.essential && styles.essentialChip,
                amenityConfig?.accessibility && styles.accessibilityChip,
                amenityConfig?.environmental === 'positive' && styles.ecoChip,
              ]}
            >
              {amenityConfig && (
                <IconComponent
                  name={amenityConfig.icon as any}
                  size={16}
                  color={
                    amenityConfig.accessibility
                      ? '#6366f1'
                      : amenityConfig.essential
                        ? '#059669'
                        : amenityConfig.environmental === 'positive'
                          ? '#16a34a'
                          : colors.primaryColor
                  }
                  style={styles.amenityChipIcon}
                />
              )}
              <ThemedText
                style={[
                  styles.amenityChipText,
                  amenityConfig?.essential && styles.essentialChipText,
                  amenityConfig?.accessibility && styles.accessibilityChipText,
                  amenityConfig?.environmental === 'positive' && styles.ecoChipText,
                ]}
              >
                {amenityConfig?.nameKey ? amenityConfig.nameKey : amenityConfig?.name || amenity}
              </ThemedText>
              {amenityConfig?.maxFairValue === 0 && <View style={styles.includedDot} />}
            </View>
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
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primaryDark,
    marginBottom: 12,
  },
  amenitiesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  amenityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primaryLight_1,
    gap: 6,
  },
  essentialChip: {
    backgroundColor: '#f0f9ff',
    borderColor: '#059669',
  },
  accessibilityChip: {
    backgroundColor: '#f5f3ff',
    borderColor: '#6366f1',
  },
  ecoChip: {
    backgroundColor: '#f0fdf4',
    borderColor: '#16a34a',
  },
  amenityChipIcon: {
    marginRight: 4,
  },
  amenityChipText: {
    fontSize: 14,
    color: colors.primaryDark,
  },
  essentialChipText: {
    color: '#059669',
    fontWeight: '600',
  },
  accessibilityChipText: {
    color: '#6366f1',
    fontWeight: '600',
  },
  ecoChipText: {
    color: '#16a34a',
    fontWeight: '600',
  },
  includedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#059669',
    marginLeft: 4,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyText: {
    marginTop: 8,
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
});

import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/components/ThemedText';
import { colors } from '@/styles/colors';
import { getAmenityById } from '@/constants/amenities';

// Distinct indigo accent for the "accessibility" amenity category so it reads
// apart from the green essential/eco chips. Category accent, not a Bloom token.
const ACCESSIBILITY_ACCENT = '#6366f1';

type AmenitiesDisplayProps = {
  amenities: string[];
  title?: string;
  showEmptyState?: boolean;
  emptyStateText?: string;
  style?: StyleProp<ViewStyle>;
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
          <Ionicons name="home-outline" size={48} color={colors.COLOR_BLACK_LIGHT_4} />
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
                <Ionicons
                  name={amenityConfig.icon}
                  size={16}
                  color={
                    amenityConfig.accessibility
                      ? ACCESSIBILITY_ACCENT
                      : amenityConfig.essential
                        ? colors.success
                        : amenityConfig.environmental === 'positive'
                          ? colors.success
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
    backgroundColor: colors.successSubtle,
    borderColor: colors.success,
  },
  // Accessibility amenities use a distinct indigo category accent (not a Bloom
  // status token) so they read apart from the green essential/eco chips.
  accessibilityChip: {
    backgroundColor: '#f5f3ff',
    borderColor: ACCESSIBILITY_ACCENT,
  },
  ecoChip: {
    backgroundColor: colors.successSubtle,
    borderColor: colors.success,
  },
  amenityChipIcon: {
    marginRight: 4,
  },
  amenityChipText: {
    fontSize: 14,
    color: colors.primaryDark,
  },
  essentialChipText: {
    color: colors.success,
    fontWeight: '600',
  },
  accessibilityChipText: {
    color: ACCESSIBILITY_ACCENT,
    fontWeight: '600',
  },
  ecoChipText: {
    color: colors.success,
    fontWeight: '600',
  },
  includedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
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

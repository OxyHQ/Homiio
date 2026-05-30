/**
 * MapMarkerPopover — small floating card that appears above the bottom
 * panel on the search screen when a marker is selected. Web behaviour
 * mirrors Airbnb's map popover; on native we anchor it just above the
 * panel header so the marker stays tappable.
 *
 * The popover wraps an existing PropertyCard rendered in `compact`
 * orientation so we don't duplicate the styling. A Bloom Button (ghost,
 * small) provides the dismiss affordance.
 */
import React, { useCallback } from 'react';
import {
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@oxyhq/bloom/button';

import { PropertyCard } from '@/components/PropertyCard';
import { colors } from '@/styles/colors';
import { cardShadow, radius, spacing } from '@/constants/styles';
import type { Property } from '@homiio/shared-types';

interface MapMarkerPopoverProps {
  property: Property;
  onPress: () => void;
  onDismiss: () => void;
  /**
   * Position relative to the screen. The parent decides whether to
   * anchor above the panel (mobile) or above the marker (web).
   */
  style?: StyleProp<ViewStyle>;
}

export const MapMarkerPopover: React.FC<MapMarkerPopoverProps> = ({
  property,
  onPress,
  onDismiss,
  style,
}) => {
  const handlePress = useCallback(() => {
    onPress();
  }, [onPress]);

  return (
    <View style={[styles.container, style]} pointerEvents="box-none">
      <View style={[styles.card, cardShadow.lg]}>
        <View style={styles.dismissAnchor}>
          <Button
            onPress={onDismiss}
            variant="ghost"
            size="small"
            icon={<Ionicons name="close" size={16} color={colors.COLOR_BLACK} />}
            accessibilityLabel="Close preview"
          />
        </View>
        <PropertyCard
          property={property}
          variant="compact"
          orientation={Platform.OS === 'web' ? 'horizontal' : 'vertical'}
          onPress={handlePress}
          showSaveButton
          showVerifiedBadge
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
  },
  card: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    overflow: 'hidden',
    position: 'relative',
  },
  dismissAnchor: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    zIndex: 5,
  },
});

export default MapMarkerPopover;

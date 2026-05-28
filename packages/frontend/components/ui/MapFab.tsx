/**
 * MapFab — floating action button used on the mobile search screen to
 * open the full-screen map sheet. Pure Bloom Button with an icon.
 *
 * Position is left to the caller so we can adjust for tab bar / action
 * bar overlap per screen.
 */
import React from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@oxyhq/bloom/button';

import { cardShadow } from '@/constants/styles';

interface MapFabProps {
  onPress: () => void;
  label: string;
  /** Override the default `map` icon. */
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  style?: StyleProp<ViewStyle>;
}

export const MapFab: React.FC<MapFabProps> = ({
  onPress,
  label,
  icon = 'map',
  style,
}) => {
  return (
    <View style={[styles.fab, cardShadow.lg, style]}>
      <Button
        onPress={onPress}
        variant="primary"
        size="medium"
        icon={<Ionicons name={icon} size={18} color="#ffffff" />}
        iconPosition="left"
        accessibilityLabel={label}
      >
        {label}
      </Button>
    </View>
  );
};

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    borderRadius: 9999,
    overflow: 'hidden',
  },
});

export default MapFab;

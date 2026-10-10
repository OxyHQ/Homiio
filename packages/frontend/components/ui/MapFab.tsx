/**
 * MapFab — the centred "Map / List" toggle floating over a results list.
 *
 * The button is Bloom's extended `Fab`. Bloom 6 leaves a FAB's position to its
 * parent, and this toggle sits bottom-CENTRE (the list-over-map pattern), so
 * this wrapper owns the position. The caller may still lift it (`style.bottom`)
 * to clear a home indicator or an action bar.
 */
import type React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Fab } from '@oxy.so/bloom/fab';
import { RiListUnordered, RiMapPinLine } from '@oxy.so/bloom/icons';

interface MapFabProps {
  onPress: () => void;
  label: string;
  /** Which view the toggle switches TO. Defaults to `map`. */
  icon?: 'map' | 'list';
  style?: StyleProp<ViewStyle>;
}

export const MapFab: React.FC<MapFabProps> = ({ onPress, label, icon = 'map', style }) => {
  const Icon = icon === 'list' ? RiListUnordered : RiMapPinLine;
  return (
    // Pass-through row (valid CSS `none`) so only the button itself takes taps.
    <View style={[styles.anchor, style]}>
      <Fab
        label={label}
        accessibilityLabel={label}
        icon={Icon}
        onPress={onPress}
        size="md"
        style={styles.fab}
        appearance="solid"
        tone="accent"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    bottom: 24,
    left: 0,
    right: 0,
    alignItems: 'center',
    pointerEvents: 'none',
  },
  fab: {
    pointerEvents: 'auto',
  },
});

export default MapFab;

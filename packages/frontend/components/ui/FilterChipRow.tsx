/**
 * FilterChipRow — horizontally-scrolling row of Bloom Chips used to launch
 * the filter sheet pre-targeted at a section.
 *
 * Sits below the SearchBar pill on `/search` and on top of any future
 * map/list result surface. On web the row is sticky so the chips stay
 * visible while the underlying panel scrolls. On native it scrolls with
 * the page.
 *
 * The chip values are intentionally a closed enum (`FilterChipKey`) so
 * the underlying filter sheet can switch on the value without reaching
 * for string magic.
 */
import React, { useCallback } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Chip } from '@oxyhq/bloom/chip';

import { colors } from '@/styles/colors';
import { spacing, withShadow } from '@/constants/styles';

export type FilterChipKey =
  | 'price'
  | 'bedrooms'
  | 'bathrooms'
  | 'type'
  | 'amenities'
  | 'more';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export interface FilterChipDef {
  /** Stable id used by the parent to route into the filter sheet. */
  key: FilterChipKey;
  /** Visible chip label. */
  label: string;
  /** Optional leading icon name. */
  icon?: IoniconName;
  /** Marks the chip as actively constrained (price set, beds set, ...). */
  active?: boolean;
}

interface FilterChipRowProps {
  chips: readonly FilterChipDef[];
  onChipPress: (key: FilterChipKey) => void;
  /**
   * Extra padding applied around the row. Defaults to 16/12 (px h/v).
   */
  style?: StyleProp<ViewStyle>;
  /**
   * When true and Platform is web, the row sticks to the top of its
   * scroll parent. Useful for the search panel.
   */
  sticky?: boolean;
}

export const FilterChipRow: React.FC<FilterChipRowProps> = ({
  chips,
  onChipPress,
  style,
  sticky = false,
}) => {
  const renderIcon = useCallback(
    (icon: IoniconName | undefined, active: boolean) => {
      if (!icon) return undefined;
      return (
        <Ionicons
          name={icon}
          size={14}
          color={active ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_3}
        />
      );
    },
    [],
  );

  const containerStyle: StyleProp<ViewStyle> = [
    styles.container,
    sticky && Platform.OS === 'web' ? (styles.sticky as ViewStyle) : null,
    style,
  ];

  return (
    <View style={containerStyle}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {chips.map((chip) => (
          <Chip
            key={chip.key}
            onPress={() => onChipPress(chip.key)}
            variant={chip.active ? 'soft' : 'outlined'}
            color={chip.active ? 'primary' : 'default'}
            size="medium"
            startIcon={renderIcon(chip.icon, Boolean(chip.active))}
            accessibilityLabel={chip.label}
          >
            {chip.label}
          </Chip>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surfaceElevated,
    paddingVertical: spacing.sm,
    ...withShadow('sm'),
  },
  // RN-Web only — falls back to a normal block on native.
  sticky: {
    position: 'sticky',
    top: 0,
    zIndex: 50,
  } as unknown as ViewStyle,
  scrollContent: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
});

export default FilterChipRow;

/**
 * Home category strip — Airbnb-2026 inspired horizontal scroller that
 * switches the home feed's lens (Studios / Apartments / Houses for
 * long-term; Beachfront / Cabins / Pools for vacation).
 *
 * Visual language:
 *   - 28px outline-style Ionicons (not filled blobs).
 *   - 12px label sitting 8px under the icon.
 *   - Active state = primary color icon + label, 2px underline bar.
 *   - On web: 32px gap between items, subtle scale-1.04 on hover.
 *   - On mobile: 22px gap, snap-to-item via scroll inertia.
 *
 * Spacing is anchored on the design-token `spacing` scale.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@oxyhq/bloom/typography';

import { useRentalMode } from '@/context/RentalModeContext';
import { useHomeCategoryStore, type HomeCategory } from '@/store/homeCategoryStore';
import { colors } from '@/styles/colors';
import { spacing, tracker } from '@/constants/styles';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface CategoryDef {
  id: HomeCategory;
  labelKey: string;
  fallback: string;
  icon: IoniconName;
}

const LONG_TERM_CATEGORIES: CategoryDef[] = [
  { id: 'studios', labelKey: 'home.category.studios', fallback: 'Studios', icon: 'square-outline' },
  { id: 'apartments', labelKey: 'home.category.apartments', fallback: 'Apartments', icon: 'business-outline' },
  { id: 'houses', labelKey: 'home.category.houses', fallback: 'Houses', icon: 'home-outline' },
  { id: 'rooms', labelKey: 'home.category.rooms', fallback: 'Rooms', icon: 'bed-outline' },
  { id: 'coliving', labelKey: 'home.category.coliving', fallback: 'Co-living', icon: 'people-outline' },
  { id: 'luxury', labelKey: 'home.category.luxury', fallback: 'Luxury', icon: 'diamond-outline' },
  { id: 'new_listings', labelKey: 'home.category.newListings', fallback: 'New listings', icon: 'sparkles-outline' },
  { id: 'near_you', labelKey: 'home.category.nearYou', fallback: 'Near you', icon: 'navigate-outline' },
];

const VACATION_CATEGORIES: CategoryDef[] = [
  { id: 'beachfront', labelKey: 'home.category.beachfront', fallback: 'Beachfront', icon: 'sunny-outline' },
  { id: 'cabins', labelKey: 'home.category.cabins', fallback: 'Cabins', icon: 'leaf-outline' },
  { id: 'pools', labelKey: 'home.category.pools', fallback: 'Pools', icon: 'water-outline' },
  { id: 'mountain', labelKey: 'home.category.mountain', fallback: 'Mountain', icon: 'triangle-outline' },
  { id: 'city_breaks', labelKey: 'home.category.cityBreaks', fallback: 'City breaks', icon: 'business-outline' },
  { id: 'countryside', labelKey: 'home.category.countryside', fallback: 'Countryside', icon: 'flower-outline' },
  { id: 'instant_book', labelKey: 'home.category.instantBook', fallback: 'Instant book', icon: 'flash-outline' },
  { id: 'pet_friendly', labelKey: 'home.category.petFriendly', fallback: 'Pet friendly', icon: 'paw-outline' },
];

interface HomeCategoryStripProps {
  /** Optional class applied to the outer wrapper for custom spacing/background. */
  className?: string;
  /**
   * When true, on web breakpoints the strip becomes a sticky sub-header
   * pinned just below the layout top bar (top: 0). Mobile keeps native
   * scroll behavior — sticky reads as broken on touch.
   */
  sticky?: boolean;
}

interface CategoryItemProps {
  item: CategoryDef;
  active: boolean;
  label: string;
  onPress: () => void;
}

const CategoryItem: React.FC<CategoryItemProps> = ({ item, active, label, onPress }) => {
  const [hovered, setHovered] = useState(false);

  /**
   * Active items pop in the primary color (icon + label + 2px bar);
   * inactive items mute to neutral gray at 70% opacity. Hover on web
   * nudges scale slightly but never re-tints — that keeps the active
   * state unambiguous.
   */
  const tint = active ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_3;
  const scale = hovered && Platform.OS === 'web' ? 1.04 : 1;

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      className="items-center justify-start"
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={{
        opacity: active ? 1 : 0.7,
        transform: [{ scale }],
      }}
    >
      <View className="items-center justify-center" style={{ paddingBottom: spacing.sm }}>
        <Ionicons name={item.icon} size={28} color={tint} />
      </View>
      <Text
        style={{
          fontSize: 12,
          fontWeight: active ? '700' : '500',
          color: tint,
          letterSpacing: tracker.wide,
          textAlign: 'center',
        }}
      >
        {label}
      </Text>
      <View
        className="rounded-full"
        style={{
          marginTop: spacing.sm,
          height: 2,
          alignSelf: 'stretch',
          backgroundColor: active ? colors.primaryColor : 'transparent',
        }}
      />
    </Pressable>
  );
};

export const HomeCategoryStrip: React.FC<HomeCategoryStripProps> = ({
  className,
  sticky = false,
}) => {
  const { t } = useTranslation();
  const { mode } = useRentalMode();
  const category = useHomeCategoryStore((s) => s.category);
  const setCategory = useHomeCategoryStore((s) => s.setCategory);

  const items = useMemo(
    () => (mode === 'vacation' ? VACATION_CATEGORIES : LONG_TERM_CATEGORIES),
    [mode],
  );

  const handlePress = useCallback(
    (next: HomeCategory) => {
      setCategory(category === next ? null : next);
    },
    [category, setCategory],
  );

  const isWeb = Platform.OS === 'web';

  /**
   * Web-only `position: sticky` lives outside the RN style system. We
   * inject it via the style object and rely on react-native-web to
   * pass it through to the underlying div. On native, this is a no-op.
   */
  const stickyStyle =
    sticky && isWeb
      ? ({
          position: 'sticky',
          top: 0,
          zIndex: 30,
          backgroundColor: colors.white,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        } as unknown as object)
      : null;

  return (
    <View className={className ?? 'w-full py-4'} style={stickyStyle}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate={isWeb ? 'normal' : 'fast'}
        snapToAlignment="start"
        contentContainerStyle={
          isWeb
            ? { paddingHorizontal: spacing['2xl'], gap: spacing['3xl'] }
            : { paddingHorizontal: spacing.lg, gap: spacing['2xl'] }
        }
      >
        {items.map((item) => (
          <CategoryItem
            key={item.id}
            item={item}
            active={category === item.id}
            label={t(item.labelKey, item.fallback)}
            onPress={() => handlePress(item.id)}
          />
        ))}
      </ScrollView>
    </View>
  );
};

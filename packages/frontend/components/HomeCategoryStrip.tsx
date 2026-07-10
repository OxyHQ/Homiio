/**
 * Home category strip — Airbnb-2026 inspired horizontal scroller that
 * switches the home feed's lens (Studios / Apartments / Houses for
 * long-term; Beachfront / Cabins / Pools for vacation).
 *
 * Visual language:
 *   - Rich 54px isometric PNG render per category (full-color, never tinted)
 *     clipped to a `radius.lg` rounded square so it reads as a premium tile.
 *   - 13px label sitting just under the image, on a fixed-width item so
 *     labels line up across the row.
 *   - Active state = a soft rounded background highlight behind the whole
 *     item (icon + label) plus a dark + bold label and the image at full
 *     opacity; inactive = transparent background, muted label, image at
 *     0.85 opacity (dim the tile, don't recolor the render). The item keeps
 *     identical padding in both states so the layout never shifts.
 *   - On web: subtle scale-1.04 on hover (never re-tints).
 *
 * Spacing is anchored on the design-token `spacing`/`radius` scale.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text } from '@oxyhq/bloom/typography';
import { useTheme } from '@oxyhq/bloom/theme';

import { PANEL_TOP_INSET } from '@oxyhq/bloom/content-panel';

import { useRentalMode } from '@/context/RentalModeContext';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';
import { useHomeCategoryStore, type HomeCategory } from '@/store/homeCategoryStore';
import { colors } from '@/styles/colors';
import { tracker } from '@/constants/styles';

// Isometric 3D render shared by every category for now. Each category will
// get its own distinct PNG later — swap the per-entry `image` source below
// (the shape already supports a unique image per category). Loaded via
// `require` (typed) so it renders through RN's `Image` on web + native alike,
// matching the app's other local-asset images.
const isometricIcon: ImageSourcePropType = require('@/assets/categories/isometric-icon.png');

interface CategoryDef {
  id: HomeCategory;
  labelKey: string;
  fallback: string;
  image: ImageSourcePropType;
}

const LONG_TERM_CATEGORIES: CategoryDef[] = [
  { id: 'studios', labelKey: 'home.category.studios', fallback: 'Studios', image: isometricIcon },
  { id: 'apartments', labelKey: 'home.category.apartments', fallback: 'Apartments', image: isometricIcon },
  { id: 'houses', labelKey: 'home.category.houses', fallback: 'Houses', image: isometricIcon },
  { id: 'rooms', labelKey: 'home.category.rooms', fallback: 'Rooms', image: isometricIcon },
  { id: 'coliving', labelKey: 'home.category.coliving', fallback: 'Co-living', image: isometricIcon },
  { id: 'luxury', labelKey: 'home.category.luxury', fallback: 'Luxury', image: isometricIcon },
  { id: 'new_listings', labelKey: 'home.category.newListings', fallback: 'New listings', image: isometricIcon },
  { id: 'near_you', labelKey: 'home.category.nearYou', fallback: 'Near you', image: isometricIcon },
];

const VACATION_CATEGORIES: CategoryDef[] = [
  { id: 'beachfront', labelKey: 'home.category.beachfront', fallback: 'Beachfront', image: isometricIcon },
  { id: 'cabins', labelKey: 'home.category.cabins', fallback: 'Cabins', image: isometricIcon },
  { id: 'pools', labelKey: 'home.category.pools', fallback: 'Pools', image: isometricIcon },
  { id: 'mountain', labelKey: 'home.category.mountain', fallback: 'Mountain', image: isometricIcon },
  { id: 'city_breaks', labelKey: 'home.category.cityBreaks', fallback: 'City breaks', image: isometricIcon },
  { id: 'countryside', labelKey: 'home.category.countryside', fallback: 'Countryside', image: isometricIcon },
  { id: 'instant_book', labelKey: 'home.category.instantBook', fallback: 'Instant book', image: isometricIcon },
  { id: 'pet_friendly', labelKey: 'home.category.petFriendly', fallback: 'Pet friendly', image: isometricIcon },
];

/** Edge length of the isometric tile — larger than a line icon so the 3D render reads. */
const TILE_SIZE = 54;
/** Fixed item width keeps labels aligned across the row regardless of label length. */
const ITEM_WIDTH = 84;

interface HomeCategoryStripProps {
  /** Optional class applied to the outer wrapper for custom spacing/background. */
  className?: string;
  /**
   * When true, on web breakpoints the strip becomes a sticky sub-header
   * pinned at `PANEL_TOP_INSET` when the shell frames content (wide web),
   * or `top: 0` on full-bleed/narrow web. Mobile keeps native scroll
   * behavior — sticky reads as broken on touch.
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
   * The isometric render is full-color, so we never tint it — active vs
   * inactive is conveyed by image opacity (1 vs 0.85), the label color/weight,
   * and a soft rounded background highlight behind the whole item. The
   * highlight uses the lightest neutral fill (`COLOR_BLACK_LIGHT_8`, Bloom
   * `backgroundSecondary`) so the selected category reads as a subtle pill
   * without competing with the colorful tile. Padding is identical in both
   * states (so the row never reflows on selection); only the background
   * toggles. Hover on web nudges scale slightly only.
   */
  const scale = hovered && Platform.OS === 'web' ? 1.04 : 1;

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      className={
        active
          ? 'w-[84px] items-center justify-center rounded-2xl bg-secondary px-2 py-2'
          : 'w-[84px] items-center justify-center rounded-2xl bg-transparent px-2 py-2'
      }
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={{ width: ITEM_WIDTH, transform: [{ scale }] }}
    >
      <View className="mb-1 h-[54px] w-[54px] items-center justify-center overflow-hidden rounded-2xl">
        <Image
          source={item.image}
          className="h-[54px] w-[54px]"
          style={{ opacity: active ? 1 : 0.85, width: TILE_SIZE, height: TILE_SIZE }}
          resizeMode="contain"
          accessible={false}
        />
      </View>
      <Text
        numberOfLines={1}
        style={{
          fontSize: 13,
          fontWeight: active ? '700' : '500',
          color: active ? colors.COLOR_BLACK : colors.COLOR_BLACK_LIGHT_3,
          letterSpacing: tracker.wide,
          textAlign: 'center',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
};

export const HomeCategoryStrip: React.FC<HomeCategoryStripProps> = ({
  className,
  sticky = false,
}) => {
  const { t } = useTranslation();
  const { mode } = useRentalMode();
  const { colors: themeColors } = useTheme();
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
  const isScreenNotMobile = useIsScreenNotMobile();
  // Match Header: framed ContentPanel bleed-mask clips sticky at top:0.
  const framed = isWeb && isScreenNotMobile;

  /**
   * Web-only `position: sticky` lives outside the RN style system. We
   * inject it via the style object and rely on react-native-web to
   * pass it through to the underlying div. On native, this is a no-op.
   * Opaque fill must match ContentPanel's `bg-card` (not pure white) so
   * scrolled content doesn't flash a competing surface under the strip.
   * `top` stays numeric from PANEL_TOP_INSET when framed.
   */
  const stickyStyle =
    sticky && isWeb
      ? ({
          position: 'sticky',
          top: framed ? PANEL_TOP_INSET : 0,
          zIndex: 30,
          backgroundColor: themeColors.card,
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
        contentContainerClassName={isWeb ? 'gap-4 px-6' : 'gap-3 px-4'}
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

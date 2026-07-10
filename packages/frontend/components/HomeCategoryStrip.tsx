/**
 * Home category strip — Airbnb-2026 inspired horizontal scroller that
 * switches the home feed's lens (Studios / Apartments / Houses for
 * long-term; Beachfront / Cabins / Pools for vacation).
 *
 * Visual language:
 *   - Compact 40px isometric PNG render per category (full-color, never tinted)
 *     clipped to a `radius.lg` rounded square so it reads as a premium tile.
 *   - 12px label flush under the image (no tile/label gap), on a fixed-width
 *     item so labels line up across the row.
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

import { getIconArt, ICON_ART_PLACEHOLDER } from '@/constants/iconArt';
import { useRentalMode } from '@/context/RentalModeContext';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';
import { useHomeCategoryStore, type HomeCategory } from '@/store/homeCategoryStore';
import { colors } from '@/styles/colors';
import { tracker } from '@/constants/styles';

interface CategoryDef {
  id: HomeCategory;
  labelKey: string;
  fallback: string;
}

const LONG_TERM_CATEGORIES: CategoryDef[] = [
  { id: 'studios', labelKey: 'home.category.studios', fallback: 'Studios' },
  { id: 'apartments', labelKey: 'home.category.apartments', fallback: 'Apartments' },
  { id: 'houses', labelKey: 'home.category.houses', fallback: 'Houses' },
  { id: 'rooms', labelKey: 'home.category.rooms', fallback: 'Rooms' },
  { id: 'coliving', labelKey: 'home.category.coliving', fallback: 'Co-living' },
  { id: 'luxury', labelKey: 'home.category.luxury', fallback: 'Luxury' },
  { id: 'new_listings', labelKey: 'home.category.newListings', fallback: 'New listings' },
  { id: 'near_you', labelKey: 'home.category.nearYou', fallback: 'Near you' },
];

const VACATION_CATEGORIES: CategoryDef[] = [
  { id: 'beachfront', labelKey: 'home.category.beachfront', fallback: 'Beachfront' },
  { id: 'cabins', labelKey: 'home.category.cabins', fallback: 'Cabins' },
  { id: 'pools', labelKey: 'home.category.pools', fallback: 'Pools' },
  { id: 'mountain', labelKey: 'home.category.mountain', fallback: 'Mountain' },
  { id: 'city_breaks', labelKey: 'home.category.cityBreaks', fallback: 'City breaks' },
  { id: 'countryside', labelKey: 'home.category.countryside', fallback: 'Countryside' },
  { id: 'instant_book', labelKey: 'home.category.instantBook', fallback: 'Instant book' },
  { id: 'pet_friendly', labelKey: 'home.category.petFriendly', fallback: 'Pet friendly' },
];

/** Edge length of the isometric tile — compact so more categories fit on screen. */
const TILE_SIZE = 40;
/** Fixed item width keeps labels aligned across the row regardless of label length. */
const ITEM_WIDTH = 64;

const resolveCategoryImage = (id: HomeCategory): ImageSourcePropType =>
  getIconArt(id) ?? ICON_ART_PLACEHOLDER;

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
  active: boolean;
  label: string;
  image: ImageSourcePropType;
  onPress: () => void;
}

const CategoryItem: React.FC<CategoryItemProps> = ({ active, label, image, onPress }) => {
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
          ? 'items-center justify-center rounded-2xl bg-secondary px-1 py-1'
          : 'items-center justify-center rounded-2xl bg-transparent px-1 py-1'
      }
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={{ width: ITEM_WIDTH, transform: [{ scale }] }}
    >
      <View
        className="items-center justify-center overflow-hidden rounded-2xl"
        style={{ width: TILE_SIZE, height: TILE_SIZE }}
      >
        <Image
          source={image}
          style={{ opacity: active ? 1 : 0.85, width: TILE_SIZE, height: TILE_SIZE }}
          resizeMode="contain"
          accessible={false}
        />
      </View>
      <Text
        numberOfLines={1}
        className={
          active
            ? 'text-center text-[12px] font-bold text-foreground'
            : 'text-center text-[12px] font-medium text-muted-foreground'
        }
        style={{ letterSpacing: tracker.wide }}
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
   * Solid card surface on web + native so scrolled feed content never
   * shows through the strip. Web-only `position: sticky` lives outside
   * the RN style system — inject via style and rely on react-native-web
   * to pass it through. `top` stays numeric from PANEL_TOP_INSET when framed.
   */
  const stickyStyle =
    sticky && isWeb
      ? ({
          position: 'sticky',
          top: framed ? PANEL_TOP_INSET : 0,
          zIndex: 30,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        } as unknown as object)
      : null;

  return (
    <View
      className={className ?? 'w-full py-1'}
      style={[{ backgroundColor: themeColors.card }, stickyStyle]}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate={isWeb ? 'normal' : 'fast'}
        snapToAlignment="start"
        contentContainerClassName={isWeb ? 'gap-1 px-4' : 'gap-0.5 px-3'}
      >
        {items.map((item) => (
          <CategoryItem
            key={item.id}
            active={category === item.id}
            label={t(item.labelKey, item.fallback)}
            image={resolveCategoryImage(item.id)}
            onPress={() => handlePress(item.id)}
          />
        ))}
      </ScrollView>
    </View>
  );
};

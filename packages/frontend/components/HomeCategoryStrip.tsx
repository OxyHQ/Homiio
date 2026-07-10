/**
 * Home category strip — Airbnb-2026 inspired horizontal scroller that
 * switches the home feed's lens (Studios / Apartments / Houses for
 * long-term; Beachfront / Cabins / Pools for vacation; sale/exchange
 * buckets for buy and exchange browse modes).
 */
import React, { useState } from 'react';
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
import { homeCategoriesForMode, resolveHomeCategory } from '@/store/homeCategories';
import { useHomeCategoryStore, type HomeCategory } from '@/store/homeCategoryStore';
import { PAGE_GUTTER_CLASS, tracker } from '@/constants/styles';

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
  const { mode, browseMode } = useRentalMode();
  const { colors: themeColors } = useTheme();
  const category = useHomeCategoryStore((s) => s.category);
  const setCategory = useHomeCategoryStore((s) => s.setCategory);
  const items = homeCategoriesForMode(browseMode, mode);
  const activeCategory = resolveHomeCategory(category, browseMode, mode);

  const isWeb = Platform.OS === 'web';
  const isScreenNotMobile = useIsScreenNotMobile();
  const framed = isWeb && isScreenNotMobile;

  const stickyStyle =
    sticky && isWeb
      ? ({
          position: 'sticky',
          top: framed ? PANEL_TOP_INSET : 0,
          zIndex: 30,
          borderBottomWidth: 1,
          borderBottomColor: themeColors.border,
        } as unknown as object)
      : null;

  return (
    <View
      className={className ?? 'w-full py-1 bg-background'}
      style={stickyStyle}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate={isWeb ? 'normal' : 'fast'}
        snapToAlignment="start"
        contentContainerClassName={isWeb ? `gap-1 ${PAGE_GUTTER_CLASS}` : `gap-0.5 ${PAGE_GUTTER_CLASS}`}
      >
        {items.map((item) => (
          <CategoryItem
            key={item.id}
            active={activeCategory === item.id}
            label={t(item.labelKey)}
            image={resolveCategoryImage(item.id)}
            onPress={() => setCategory(activeCategory === item.id ? null : item.id)}
          />
        ))}
      </ScrollView>
    </View>
  );
};

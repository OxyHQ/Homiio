import React, { useCallback, useMemo } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@oxyhq/bloom/typography';

import { useRentalMode } from '@/context/RentalModeContext';
import { useHomeCategoryStore, type HomeCategory } from '@/store/homeCategoryStore';
import { colors } from '@/styles/colors';

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
}

export const HomeCategoryStrip: React.FC<HomeCategoryStripProps> = ({ className }) => {
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

  return (
    <View className={className ?? 'w-full py-3'}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={
          Platform.OS === 'web'
            ? { paddingHorizontal: 16, gap: 24 }
            : { paddingHorizontal: 16, gap: 18 }
        }
      >
        {items.map((item) => {
          const active = category === item.id;
          const tint = active ? colors.COLOR_BLACK : colors.COLOR_BLACK_LIGHT_3;
          return (
            <Pressable
              key={item.id}
              onPress={() => handlePress(item.id)}
              className="items-center justify-start"
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t(item.labelKey, item.fallback)}
            >
              <View className="items-center justify-center pb-1.5">
                <Ionicons name={item.icon} size={22} color={tint} />
              </View>
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: active ? '600' : '500',
                  color: tint,
                }}
              >
                {t(item.labelKey, item.fallback)}
              </Text>
              <View
                className="mt-1.5 h-0.5 w-8 rounded-full"
                style={{ backgroundColor: active ? colors.COLOR_BLACK : 'transparent' }}
              />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
};

/**
 * Right-rail "Recently viewed" strip.
 *
 * Scrolling, snapping and the prev/next arrows are Bloom's `Carousel`; this
 * widget only owns the card width and its states. The hand-rolled
 * `ScrollView.onScroll` offset math and the absolutely positioned arrow buttons
 * it used to carry are gone.
 *
 * Renders only when there are recently viewed homes to show: signed out,
 * loading, an error and an empty history all render nothing.
 */
import { Platform, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { useOxy } from '@oxy.so/services';

import { Button } from '@oxy.so/bloom/button';
import { Carousel, CarouselItem } from '@oxy.so/bloom/carousel';
import { RiArrowRightSLine, RiTimeLine } from '@oxy.so/bloom/icons';

import type { Property } from '@homiio/shared-types';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';
import { useColors } from '@/hooks/useThemeColor';
import { PropertyCard } from '@/components/PropertyCard';
import { BaseWidget } from './BaseWidget';

const HEADER_ICON_SIZE = 22;
/** Card width inside the 318px rail: two cards and a peek of the third. */
const CARD_WIDTH = 140;
const CARD_GAP = 12;

export function RecentlyViewedWidget() {
  const { t } = useTranslation();
  const colors = useColors();
  const { oxyServices, activeSessionId } = useOxy();
  const { properties: recentProperties, isLoading, error } = useRecentlyViewed();

  const isAuthenticated = !!(oxyServices && activeSessionId);
  // Arrows are a pointer affordance; touch swipes. Only when there is more
  // than fits.
  const showArrows = Platform.OS === 'web' && recentProperties.length > 2;

  const navigateToProperty = (property: Property) => {
    router.push(`/properties/${property.id}`);
  };

  if (!isAuthenticated || error || isLoading || recentProperties.length === 0) {
    return null;
  }

  return (
    <BaseWidget
      title={t('home.recentlyViewed.title')}
      icon={<RiTimeLine width={HEADER_ICON_SIZE} height={HEADER_ICON_SIZE} fill={colors.primary} />}
    >
      <Carousel
        accessibilityLabel={t('home.recentlyViewed.title')}
        showArrows={showArrows}
        showDots={false}
        gap={CARD_GAP}
      >
        {recentProperties.map((property) => (
          <CarouselItem key={property.id} width={CARD_WIDTH}>
            <PropertyCard
              property={property}
              // Horizontal scroller — an in-card photo pager would fight the
              // row swipe, so keep the single cover image here.
              enableImageCarousel={false}
              onPress={() => navigateToProperty(property)}
            />
          </CarouselItem>
        ))}
      </Carousel>
      <View className="flex-row">
        <Button
          size="sm"
          trailingIcon={RiArrowRightSLine}
          onPress={() => router.push('/properties/recently-viewed')}
          accessibilityLabel={t('home.viewAll')}
          tone="accent"
          appearance="plain"
        >
          {t('home.viewAll')}
        </Button>
      </View>
    </BaseWidget>
  );
}

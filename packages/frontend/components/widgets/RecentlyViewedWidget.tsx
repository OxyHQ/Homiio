/**
 * Right-rail "Recently viewed" strip.
 *
 * Scrolling, snapping and the prev/next arrows are Bloom's `Carousel`; this
 * widget only owns the card width and its states. The hand-rolled
 * `ScrollView.onScroll` offset math and the absolutely positioned arrow buttons
 * it used to carry are gone.
 */
import React from 'react';
import { Platform, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { useOxy } from '@oxy.so/services';

import { Button } from '@oxy.so/bloom/button';
import { Carousel, CarouselItem } from '@oxy.so/bloom/carousel';
import { RiArrowRightSLine, RiTimeLine } from '@oxy.so/bloom/icons';
import { Loading } from '@oxy.so/bloom/loading';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import type { Property } from '@homiio/shared-types';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';
import { useColors } from '@/hooks/useThemeColor';
import { PropertyCard } from '@/components/PropertyCard';
import { BaseWidget } from './BaseWidget';

const HEADER_ICON_SIZE = 22;
const EMPTY_ICON_SIZE = 32;
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

  // Hide widget completely if not authenticated
  if (!isAuthenticated) {
    return null;
  }

  const headerIcon = <RiTimeLine width={HEADER_ICON_SIZE} height={HEADER_ICON_SIZE} fill={colors.primary} />;

  if (error) {
    return (
      <BaseWidget title={t('home.recentlyViewed.title')} icon={headerIcon}>
        <View className="items-center p-4">
          <BloomText className="text-xs text-muted-foreground">{error}</BloomText>
        </View>
      </BaseWidget>
    );
  }

  const renderBody = () => {
    if (isLoading) {
      return (
        <View className="h-[140px] items-center justify-center">
          <Loading iconSize={16} showText={false} />
        </View>
      );
    }
    if (recentProperties.length === 0) {
      return (
        <View className="items-center gap-1 px-4 py-6">
          <RiTimeLine width={EMPTY_ICON_SIZE} height={EMPTY_ICON_SIZE} fill={colors.textTertiary} />
          <BloomText className="mt-1 text-center text-sm font-semibold text-muted-foreground">
            {t('home.recentlyViewed.noProperties')}
          </BloomText>
          <BloomText className="text-center text-xs text-muted-foreground">
            {t('home.recentlyViewed.noPropertiesDescription')}
          </BloomText>
        </View>
      );
    }
    return (
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
    );
  };

  return (
    <BaseWidget title={t('home.recentlyViewed.title')} icon={headerIcon}>
      {renderBody()}
      <View className="flex-row">
        <Button
          variant="text"
          size="small"
          trailingIcon={RiArrowRightSLine}
          onPress={() => router.push('/properties/recently-viewed')}
          accessibilityLabel={t('home.viewAll')}
        >
          {t('home.viewAll')}
        </Button>
      </View>
    </BaseWidget>
  );
}

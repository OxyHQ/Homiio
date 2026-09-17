import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { RiArrowDownLine, RiArrowUpLine, RiMapPinLine } from '@oxy.so/bloom/icons';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { formatMoney } from '@homiio/shared-types';
import { useColors } from '@/hooks/useThemeColor';
import { useNeighborhood } from '@/hooks/useNeighborhood';
import { useFormatting } from '@/utils/format';
import { BaseWidget } from './BaseWidget';

const HEADER_ICON_SIZE = 22;
const TREND_ICON_SIZE = 16;

interface NeighborhoodRatingWidgetProps {
  propertyId?: string;
  neighborhoodName?: string;
  city?: string;
  /** Kept for call-site compatibility; not used for lookups (geo is relational). */
  state?: string;
}

/**
 * Neighborhood metrics widget.
 *
 * Renders ONLY real, Homiio-derived metrics (listing count, average rent,
 * vs-city contrast) for the resolved neighborhood. There are no invented
 * walkability/transit/safety scores. When no neighborhood resolves (or the
 * lookup errors), the widget renders nothing rather than showing placeholder
 * data.
 *
 * Bloom `StatCards` was considered and rejected: every item there REQUIRES a
 * `delta` and a delta colour, and this widget has no honest period-over-period
 * change to show — filling that slot would be exactly the invented metric the
 * rule above forbids. The two figures render as plain Bloom typography instead.
 */
export function NeighborhoodRatingWidget({
  propertyId,
  neighborhoodName,
  city,
}: NeighborhoodRatingWidgetProps = {}) {
  const { t } = useTranslation();
  const colors = useColors();
  const { locale } = useFormatting();
  const { data: neighborhood, isLoading } = useNeighborhood({
    propertyId,
    name: neighborhoodName,
    city,
  });

  // No resolvable neighborhood (or an error) → hide the widget entirely.
  if (isLoading || !neighborhood) {
    return null;
  }

  const { name, city: cityName, listingCount, averageRent, currency, vsCity } = neighborhood;
  const currencyCode = currency ?? 'EUR';
  const cheaper = vsCity ? vsCity.percentDiff <= 0 : false;
  const TrendIcon = cheaper ? RiArrowDownLine : RiArrowUpLine;

  return (
    <BaseWidget
      title={t('property.neighborhood.title')}
      icon={<RiMapPinLine width={HEADER_ICON_SIZE} height={HEADER_ICON_SIZE} fill={colors.primary} />}
    >
      <View className="gap-3.5 py-2.5">
        <View className="gap-0.5">
          <BloomText className="text-base font-semibold text-foreground">{name}</BloomText>
          {cityName ? <BloomText className="text-[13px] text-muted-foreground">{cityName}</BloomText> : null}
        </View>

        <View className="flex-row gap-3">
          <View className="flex-1 gap-0.5">
            <BloomText className="text-lg font-bold text-foreground">{listingCount}</BloomText>
            <BloomText className="text-xs text-muted-foreground">{t('property.neighborhood.listings')}</BloomText>
          </View>
          {averageRent !== null ? (
            <View className="flex-1 gap-0.5">
              <BloomText className="text-lg font-bold text-foreground">
                {formatMoney(averageRent, currencyCode, locale)}
              </BloomText>
              <BloomText className="text-xs text-muted-foreground">
                {t('property.neighborhood.avgRentPerMonth')}
              </BloomText>
            </View>
          ) : null}
        </View>

        {vsCity ? (
          <View className="flex-row items-center gap-1.5">
            <TrendIcon
              width={TREND_ICON_SIZE}
              height={TREND_ICON_SIZE}
              fill={cheaper ? colors.success : colors.textSecondary}
            />
            <BloomText className="shrink text-[13px] text-muted-foreground">
              {vsCity.percentDiff === 0
                ? t('property.neighborhood.onParWithCity')
                : t('property.neighborhood.pctVsCity', {
                    pct: Math.abs(vsCity.percentDiff),
                    dir:
                      vsCity.percentDiff < 0
                        ? t('property.neighborhood.cheaper')
                        : t('property.neighborhood.pricier'),
                  })}
            </BloomText>
          </View>
        ) : null}
      </View>
    </BaseWidget>
  );
}

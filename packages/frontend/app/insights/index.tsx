import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSharedValue } from 'react-native-reanimated';
import { StatCards, type StatCardsItem } from '@oxy.so/bloom/stat-cards';
import {
  BarListCard,
  ChartCardSurface,
  ChartHeadline,
  ChartStatTiles,
} from '@oxy.so/bloom/chart-cards';
import { RiBookmarkLine, RiBuilding2Line, RiGroupLine, RiHome4Line } from '@oxy.so/bloom/icons';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import { useTheme } from '@oxy.so/bloom/theme';
import { analyticsService } from '@/services/analyticsService';
import { propertyService } from '@/services/propertyService';
import { Header } from '@/components/Header';
import { PageScrollView } from '@/components/PageScrollView';
import { HomeCarouselSection } from '@/components/HomeCarouselSection';
import { PropertyCard } from '@/components/PropertyCard';
import { InsightsSkeleton } from '@/components/ui/skeletons/InsightsSkeleton';
import { formatMoney, type Property } from '@homiio/shared-types';
import { SEARCH_PRICE_CURRENCY } from '@/components/search/types';
import { useFormatting } from '@/utils/format';
import { logger } from '@/utils/logger';

interface AppStats {
  totals: { properties: number; cities: number; saves: number; uniqueSavers: number };
  pricing: { averageRent: number; minRent: number; maxRent: number };
  topCities: { city: string; state: string; properties: number; averageRent: number }[];
  priceBuckets: { bucket: string; count: number }[];
}

type CityTab = 'listings' | 'rent';

export default function InsightsScreen() {
  const { locale } = useFormatting();
  const theme = useTheme();
  const router = useRouter();
  const scrollY = useSharedValue(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [appStats, setAppStats] = useState<AppStats | null>(null);
  const [topProperties, setTopProperties] = useState<Property[]>([]);
  const [topPropsLoading, setTopPropsLoading] = useState<boolean>(false);
  const [cityTab, setCityTab] = useState<CityTab>('listings');

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const statsRes = await analyticsService.getAppStats();
        if (active) setAppStats(statsRes);
        // Load top properties (simple: latest active listings)
        setTopPropsLoading(true);
        propertyService
          .getProperties({ limit: 8, status: 'published' })
          .then((res) => {
            if (active) setTopProperties(res.properties || []);
          })
          .catch(() => {
            if (active) setTopProperties([]);
          })
          .finally(() => {
            if (active) setTopPropsLoading(false);
          });
      } catch (e: unknown) {
        logger.error('Failed to load analytics:', e);
        const message = e instanceof Error ? e.message : 'Failed to load analytics';
        if (active) setError(message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const money = useMemo(
    () => (value: number) =>
      formatMoney(value, SEARCH_PRICE_CURRENCY, locale, { maximumFractionDigits: 0 }),
    [locale],
  );

  const kpis = useMemo<StatCardsItem[]>(() => {
    const number = new Intl.NumberFormat(locale);
    const ratio = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
    const totals = appStats?.totals ?? { properties: 0, cities: 0, saves: 0, uniqueSavers: 0 };
    const per = (a: number, b: number) => (b > 0 ? ratio.format(a / b) : '—');
    return [
      {
        icon: RiHome4Line,
        label: 'Properties',
        value: number.format(totals.properties),
        delta: `${per(totals.properties, totals.cities)} / city`,
        deltaColor: 'neutral',
      },
      {
        icon: RiBuilding2Line,
        label: 'Cities',
        value: number.format(totals.cities),
        delta: appStats?.topCities[0]?.city ?? '—',
        deltaColor: 'neutral',
      },
      {
        icon: RiBookmarkLine,
        label: 'Saves',
        value: number.format(totals.saves),
        delta: `${per(totals.saves, totals.properties)} / listing`,
        deltaColor: 'neutral',
      },
      {
        icon: RiGroupLine,
        label: 'Unique Savers',
        value: number.format(totals.uniqueSavers),
        delta: `${per(totals.saves, totals.uniqueSavers)} saves each`,
        deltaColor: 'neutral',
      },
    ];
  }, [appStats, locale]);

  if (loading) {
    return <InsightsSkeleton />;
  }

  if (error) {
    return (
      <View className="flex-1 items-center justify-center p-6">
        <BloomText style={{ color: theme.colors.text }}>{error}</BloomText>
      </View>
    );
  }

  const pricing = appStats?.pricing ?? { averageRent: 0, minRent: 0, maxRent: 0 };
  const buckets = (appStats?.priceBuckets ?? []).map((b) => ({
    label: String(b.bucket),
    value: b.count,
  }));
  const topCities = (appStats?.topCities ?? []).slice(0, 6);
  const cityLabel = (c: AppStats['topCities'][number]) =>
    c.state ? `${c.city}, ${c.state}` : c.city;

  return (
    <View className="flex-1">
      <Header
        options={{
          title: 'Insights',
          subtitle: 'Marketplace overview for rentals',
          showBackButton: true,
        }}
        scrollY={scrollY}
      />
      <PageScrollView scrollY={scrollY} className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Vertical rhythm between the stacked blocks is owned here by
                    NativeWind `gap` — no per-block stacking margins. */}
        <View className="w-full gap-6 md:gap-8 px-4 pt-4 pb-14">
          <StatCards stats={kpis} />

          <View className="gap-4 md:flex-row md:items-start">
            <View className="md:flex-1">
              <ChartCardSurface height="auto">
                <ChartHeadline label="Average Rent" value={pricing.averageRent} format={money} />
                <ChartStatTiles
                  items={[
                    { label: 'Min', value: money(pricing.minRent) },
                    { label: 'Max', value: money(pricing.maxRent) },
                  ]}
                />
              </ChartCardSurface>
            </View>

            <View className="md:flex-1">
              <BarListCard
                title="Price Distribution"
                metricLabel="Listings"
                metric="value"
                items={buckets}
                limit={6}
              />
            </View>
          </View>

          {topCities.length > 0 ? (
            <BarListCard
              tabs={[
                {
                  id: 'listings',
                  label: 'Top Cities',
                  items: topCities.map((c) => ({ label: cityLabel(c), value: c.properties })),
                },
                {
                  id: 'rent',
                  label: 'Average Rent',
                  items: topCities.map((c) => ({ label: cityLabel(c), value: c.averageRent })),
                },
              ]}
              onTabChange={(id) => setCityTab(id === 'rent' ? 'rent' : 'listings')}
              metric={cityTab === 'rent' ? 'value' : 'share'}
              metricLabel={cityTab === 'rent' ? 'Rent' : 'Listings'}
              format={money}
              limit={6}
            />
          ) : null}

          <View className="gap-2">
            <BloomText variant="title-3-semibold" style={{ color: theme.colors.text }}>
              Top Properties
            </BloomText>
            <HomeCarouselSection
              title=""
              items={topProperties}
              loading={topPropsLoading}
              minItemsToShow={1}
              renderItem={(property) => (
                <PropertyCard
                  property={property}
                  variant="featured"
                  // Horizontal carousel row — keep one cover photo so the
                  // in-card pager doesn't fight the row swipe.
                  enableImageCarousel={false}
                  onPress={() => router.push(`/properties/${property.id}`)}
                />
              )}
            />
          </View>
        </View>
      </PageScrollView>
    </View>
  );
}

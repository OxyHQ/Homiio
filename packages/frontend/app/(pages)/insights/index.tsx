import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
import { StatCards, type StatCardsItem } from '@oxy.so/bloom/stat-cards';
import { BarListCard } from '@oxy.so/bloom/chart-cards/bar-list';
import { ChartCardSurface } from '@oxy.so/bloom/chart-cards/surface';
import { ChartHeadline } from '@oxy.so/bloom/chart-cards/header';
import { ChartStatTiles } from '@oxy.so/bloom/chart-cards/stat-tiles';
import { RiBookmarkLine } from '@oxy.so/bloom/icons/RiBookmarkLine';
import { RiBuilding2Line } from '@oxy.so/bloom/icons/RiBuilding2Line';
import { RiGroupLine } from '@oxy.so/bloom/icons/RiGroupLine';
import { RiHome4Line } from '@oxy.so/bloom/icons/RiHome4Line';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import { useTheme } from '@oxy.so/bloom/theme';
import { analyticsService } from '@/services/analyticsService';
import { propertyService } from '@/services/propertyService';
import { Shelf, ShelfSkeleton } from '@oxy.so/bloom/media-shelf';
import { PropertyCard } from '@/components/PropertyCard';
import { InsightsSkeleton } from '@/components/ui/skeletons/InsightsSkeleton';
import { formatMoney } from '@homiio/shared-types/format/money';
import type { Property } from '@homiio/shared-types';
import { SEARCH_PRICE_CURRENCY } from '@/components/search/types';
import { useFormatting } from '@/utils/format';

interface AppStats {
  totals: { properties: number; cities: number; saves: number; uniqueSavers: number };
  pricing: { averageRent: number; minRent: number; maxRent: number };
  topCities: { city: string; state: string; properties: number; averageRent: number }[];
  priceBuckets: { bucket: string; count: number }[];
}

type CityTab = 'listings' | 'rent';

export default function InsightsScreen() {
  const { t } = useTranslation();
  const { locale } = useFormatting();
  const theme = useTheme();
  const router = useRouter();
  const [cityTab, setCityTab] = useState<CityTab>('listings');

  const statsQuery = useQuery({
    queryKey: ['analytics', 'appStats'],
    queryFn: (): Promise<AppStats> => analyticsService.getAppStats(),
  });
  const appStats = statsQuery.data ?? null;

  // Top properties (simple: latest active listings), loaded once the stats have.
  // A failure renders an empty shelf rather than an error.
  const topPropertiesQuery = useQuery({
    queryKey: ['insights', 'topProperties'],
    queryFn: async () => {
      const res = await propertyService.getProperties({ limit: 8, status: 'published' });
      return res.properties || [];
    },
    enabled: statsQuery.isSuccess,
  });
  const topProperties: Property[] = topPropertiesQuery.data ?? [];
  const topPropsLoading = topPropertiesQuery.isLoading;

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
        label: t('home.insights.kpi.properties'),
        value: number.format(totals.properties),
        delta: t('home.insights.kpi.perCity', { value: per(totals.properties, totals.cities) }),
        deltaColor: 'neutral',
      },
      {
        icon: RiBuilding2Line,
        label: t('home.insights.kpi.cities'),
        value: number.format(totals.cities),
        delta: appStats?.topCities[0]?.city ?? '—',
        deltaColor: 'neutral',
      },
      {
        icon: RiBookmarkLine,
        label: t('home.insights.kpi.saves'),
        value: number.format(totals.saves),
        delta: t('home.insights.kpi.perListing', { value: per(totals.saves, totals.properties) }),
        deltaColor: 'neutral',
      },
      {
        icon: RiGroupLine,
        label: t('home.insights.kpi.uniqueSavers'),
        value: number.format(totals.uniqueSavers),
        delta: t('home.insights.kpi.savesEach', { value: per(totals.saves, totals.uniqueSavers) }),
        deltaColor: 'neutral',
      },
    ];
  }, [appStats, locale, t]);

  const header = (
    <PageHeader
      title={t('home.insights.screenTitle')}
      subtitle={t('home.insights.subtitle')}
      titleAlign="center"
      leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
      onBack={router.canGoBack() ? router.back : undefined}
      backLabel={t('goBack')}
    />
  );

  if (statsQuery.isPending) {
    return (
      <Screen documentScroll header={header}>
        <ScreenScrollView>
          <InsightsSkeleton />
        </ScreenScrollView>
      </Screen>
    );
  }

  if (statsQuery.isError) {
    return (
      <Screen documentScroll header={header}>
        <ScreenScrollView contentContainerClassName="items-center p-6">
          <BloomText style={{ color: theme.colors.text }}>
            {statsQuery.error.message || t('home.insights.loadError')}
          </BloomText>
        </ScreenScrollView>
      </Screen>
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
    <Screen documentScroll header={header}>
      {/* Vertical rhythm between the stacked blocks is owned here by
          NativeWind `gap` — no per-block stacking margins. */}
      <ScreenScrollView contentContainerClassName="w-full gap-6 md:gap-8 px-4 pt-4 pb-14">
        <StatCards stats={kpis} />

        <View className="gap-4 md:flex-row md:items-start">
          <View className="md:flex-1">
            <ChartCardSurface height="auto">
              <ChartHeadline
                label={t('home.insights.averageRent')}
                value={pricing.averageRent}
                format={money}
              />
              <ChartStatTiles
                items={[
                  { label: t('home.insights.min'), value: money(pricing.minRent) },
                  { label: t('home.insights.max'), value: money(pricing.maxRent) },
                ]}
              />
            </ChartCardSurface>
          </View>

          <View className="md:flex-1">
            <BarListCard
              title={t('home.insights.priceDistribution')}
              metricLabel={t('home.insights.listings')}
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
                label: t('home.insights.topCities'),
                items: topCities.map((c) => ({ label: cityLabel(c), value: c.properties })),
              },
              {
                id: 'rent',
                label: t('home.insights.averageRent'),
                items: topCities.map((c) => ({ label: cityLabel(c), value: c.averageRent })),
              },
            ]}
            onTabChange={(id) => setCityTab(id === 'rent' ? 'rent' : 'listings')}
            metric={cityTab === 'rent' ? 'value' : 'share'}
            metricLabel={cityTab === 'rent' ? t('home.insights.rent') : t('home.insights.listings')}
            format={money}
            limit={6}
          />
        ) : null}

        {topPropsLoading ? (
          <ShelfSkeleton itemWidth={240} count={4} />
        ) : (
          <Shelf title={t('home.insights.topProperties')} itemWidth={240} contentInset={16}>
            {topProperties.map((property: Property) => (
              <PropertyCard
                key={property.id}
                property={property}
                onPress={() => router.push(`/properties/${property.id}`)}
              />
            ))}
          </Shelf>
        )}
      </ScreenScrollView>
    </Screen>
  );
}

import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, Dimensions, LayoutChangeEvent } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '@/styles/colors';
import { ThemedText } from '@/components/ThemedText';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { analyticsService, AnalyticsInsights } from '@/services/analyticsService';
import { propertyService } from '@/services/propertyService';
import { HomeCarouselSection } from '@/components/HomeCarouselSection';
import { PropertyCard } from '@/components/PropertyCard';
import { useRouter } from 'expo-router';
import { InsightsSkeleton } from '@/components/ui/skeletons/InsightsSkeleton';

// Chart width will adapt to 100% of available content width

export default function InsightsScreen() {
    const { t: _t } = useTranslation();
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [_data, setData] = useState<AnalyticsInsights | null>(null);
    const [appStats, setAppStats] = useState<{
        totals: { properties: number; cities: number; saves: number; uniqueSavers: number };
        pricing: { averageRent: number; minRent: number; maxRent: number };
        topCities: { city: string; state: string; properties: number; averageRent: number }[];
        priceBuckets: { bucket: string; count: number }[];
    } | null>(null);
    const [contentWidth, setContentWidth] = useState<number>(Dimensions.get('window').width);
    const [topProperties, setTopProperties] = useState<any[]>([]);
    const [topPropsLoading, setTopPropsLoading] = useState<boolean>(false);

    const handleLayout = (e: LayoutChangeEvent) => {
        const { width } = e.nativeEvent.layout;
        if (width && width !== contentWidth) setContentWidth(width);
    };

    // Simple SVG bar chart renderer for full control over style

    useEffect(() => {
        let active = true;
        (async () => {
            setLoading(true);
            setError(null);
            try {
                const [insightsRes, statsRes] = await Promise.all([
                    analyticsService.getAnalytics('30d'),
                    analyticsService.getAppStats(),
                ]);
                if (active) {
                    setData(insightsRes);
                    setAppStats(statsRes);
                }
                // Load top properties (simple: latest active listings)
                setTopPropsLoading(true);
                propertyService
                    .getProperties({ limit: 8, status: 'published', sort: 'createdAt' } as any)
                    .then((res) => {
                        if (active) setTopProperties(res.properties || []);
                    })
                    .catch(() => {
                        if (active) setTopProperties([]);
                    })
                    .finally(() => {
                        if (active) setTopPropsLoading(false);
                    });
            } catch (e: any) {
                if (active) setError(e?.message || 'Failed to load analytics');
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => {
            active = false;
        };
    }, []);

    // Removed time-series charts for a minimalist design

    if (loading) {
        return <InsightsSkeleton />;
    }

    if (error) {
        return (
            <View style={styles.centered}>
                <ThemedText style={{ color: colors.COLOR_BLACK }}>{error}</ThemedText>
            </View>
        );
    }

    return (
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false} onLayout={handleLayout}>
            <LinearGradient
                colors={[colors.primaryColor, colors.secondaryLight, colors.primaryLight]}
                locations={[0, 0.85, 1]}
                style={styles.header}
            >
                <ThemedText style={styles.title}>Insights</ThemedText>
                <ThemedText style={styles.subtitle}>Marketplace overview for rentals</ThemedText>
            </LinearGradient>

            <View style={styles.kpiRow}>
                <View style={[styles.kpiCard, { backgroundColor: '#ffffff' }]}>
                    <LinearGradient colors={['#4E67EB20', '#4E67EB10']} style={styles.kpiInner}>
                        <View style={styles.kpiIconCircle}>
                            <Ionicons name="home-outline" size={18} color={colors.primaryColor} />
                        </View>
                        <ThemedText style={styles.kpiValue}>{appStats?.totals.properties ?? 0}</ThemedText>
                        <ThemedText style={styles.kpiLabel}>Properties</ThemedText>
                    </LinearGradient>
                </View>
                <View style={[styles.kpiCard, { backgroundColor: '#ffffff' }]}>
                    <LinearGradient colors={['#22c55e20', '#22c55e10']} style={styles.kpiInner}>
                        <View style={[styles.kpiIconCircle, { backgroundColor: '#22c55e15' }]}>
                            <Ionicons name="business-outline" size={18} color="#16a34a" />
                        </View>
                        <ThemedText style={styles.kpiValue}>{appStats?.totals.cities ?? 0}</ThemedText>
                        <ThemedText style={styles.kpiLabel}>Cities</ThemedText>
                    </LinearGradient>
                </View>
                <View style={[styles.kpiCard, { backgroundColor: '#ffffff' }]}>
                    <LinearGradient colors={['#f59e0b20', '#f59e0b10']} style={styles.kpiInner}>
                        <View style={[styles.kpiIconCircle, { backgroundColor: '#f59e0b15' }]}>
                            <Ionicons name="bookmark-outline" size={18} color="#f59e0b" />
                        </View>
                        <ThemedText style={styles.kpiValue}>{appStats?.totals.saves ?? 0}</ThemedText>
                        <ThemedText style={styles.kpiLabel}>Saves</ThemedText>
                    </LinearGradient>
                </View>
                <View style={[styles.kpiCard, { backgroundColor: '#ffffff' }]}>
                    <LinearGradient colors={['#06b6d420', '#06b6d410']} style={styles.kpiInner}>
                        <View style={[styles.kpiIconCircle, { backgroundColor: '#06b6d415' }]}>
                            <Ionicons name="people-outline" size={18} color="#06b6d4" />
                        </View>
                        <ThemedText style={styles.kpiValue}>{appStats?.totals.uniqueSavers ?? 0}</ThemedText>
                        <ThemedText style={styles.kpiLabel}>Unique Savers</ThemedText>
                    </LinearGradient>
                </View>
            </View>

            <View style={styles.section}>
                <ThemedText style={styles.sectionTitle}>Average Rent</ThemedText>
                <View style={styles.metricRowTight}>
                    <View style={styles.metricCardSmall}>
                        <ThemedText style={styles.kpiValue}>{appStats?.pricing.averageRent ?? 0}</ThemedText>
                        <ThemedText style={styles.kpiLabel}>Average</ThemedText>
                    </View>
                    <View style={styles.metricCardSmall}>
                        <ThemedText style={styles.kpiValue}>{appStats?.pricing.minRent ?? 0}</ThemedText>
                        <ThemedText style={styles.kpiLabel}>Min</ThemedText>
                    </View>
                    <View style={styles.metricCardSmall}>
                        <ThemedText style={styles.kpiValue}>{appStats?.pricing.maxRent ?? 0}</ThemedText>
                        <ThemedText style={styles.kpiLabel}>Max</ThemedText>
                    </View>
                </View>
            </View>

            <View style={styles.section}>
                <View style={styles.card}>
                    <ThemedText style={styles.cardTitle}>Price Distribution</ThemedText>
                    <View style={[styles.chartInner]}>
                        <Svg width={contentWidth} height={260}>
                            {(() => {
                                const labels = (appStats?.priceBuckets || []).slice(0, 6).map((b) => String(b.bucket));
                                const dataVals = (appStats?.priceBuckets || []).slice(0, 6).map((b) => b.count);
                                const w = contentWidth;
                                const h = 260;
                                const yAxisWidth = 36;
                                const paddingRight = 16;
                                const paddingBottom = 26;
                                const topPadding = 10;
                                const innerW = w - yAxisWidth - paddingRight;
                                const innerH = h - paddingBottom - topPadding;
                                const maxVal = Math.max(1, ...dataVals);
                                const barCount = dataVals.length || 1;
                                const gap = 8;
                                const barW = Math.max(10, (innerW - gap * (barCount - 1)) / barCount);
                                const left = yAxisWidth;
                                const ticks = 4;
                                const formatTick = (val: number) => String(val);
                                const tickValues = Array.from({ length: ticks + 1 }, (_, i) => Math.round((maxVal / ticks) * i));

                                const bars = dataVals.map((v, i) => {
                                    const x = left + i * (barW + gap);
                                    const barH = Math.round((v / maxVal) * innerH);
                                    const y = h - paddingBottom - barH;
                                    return (
                                        <React.Fragment key={`bar-${i}`}>
                                            <Rect x={x} y={y} rx={25} ry={25} width={barW} height={barH} fill="#000" />
                                            <SvgText x={x + barW / 2} y={h - 8} fontSize="10" fill="#666" textAnchor="middle">
                                                {labels[i]}
                                            </SvgText>
                                        </React.Fragment>
                                    );
                                });

                                const yLabels = tickValues.map((val, i) => {
                                    const yTick = h - paddingBottom - Math.round((val / maxVal) * innerH);
                                    return (
                                        <React.Fragment key={`tick-${i}`}>
                                            <SvgText x={yAxisWidth - 6} y={yTick + 3} fontSize="10" fill="#666" textAnchor="end">
                                                {formatTick(val)}
                                            </SvgText>
                                        </React.Fragment>
                                    );
                                });

                                return [...bars, ...yLabels];
                            })()}
                        </Svg>
                    </View>
                </View>
            </View>

            <View style={styles.section}>
                <ThemedText style={styles.sectionTitle}>Top Cities</ThemedText>
                <View style={styles.citiesGrid}>
                    {(appStats?.topCities || []).slice(0, 6).map((c, idx) => (
                        <View key={`${c.city}-${idx}`} style={styles.cityCard}>
                            <View style={styles.cityHeaderRow}>
                                <View style={styles.cityIconCircle}>
                                    <Ionicons name="business-outline" size={18} color={colors.primaryColor} />
                                </View>
                                <View style={styles.cityTitleCol}>
                                    <ThemedText style={styles.cityName}>{c.city}</ThemedText>
                                    {c.state ? (
                                        <ThemedText style={styles.cityState}>{c.state}</ThemedText>
                                    ) : null}
                                </View>
                            </View>
                            <View style={styles.cityStatsRow}>
                                <View style={styles.cityStatChip}>
                                    <Ionicons name="home-outline" size={14} color={colors.COLOR_BLACK_LIGHT_3} />
                                    <ThemedText style={styles.cityStatText}>{c.properties}</ThemedText>
                                </View>
                                <View style={styles.cityStatChip}>
                                    <Ionicons name="cash-outline" size={14} color={colors.COLOR_BLACK_LIGHT_3} />
                                    <ThemedText style={styles.cityStatText}>${c.averageRent}</ThemedText>
                                </View>
                            </View>
                        </View>
                    ))}
                </View>
            </View>

            <View style={styles.section}>
                <ThemedText style={styles.sectionTitle}>Top Properties</ThemedText>
                <HomeCarouselSection
                    title=""
                    items={topProperties}
                    loading={topPropsLoading}
                    minItemsToShow={1}
                    renderItem={(property) => (
                        <PropertyCard
                            property={property}
                            variant="featured"
                            onPress={() => router.push(`/properties/${property._id || property.id}`)}
                        />
                    )}
                />
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingBottom: 24,
        alignItems: 'center',
    },
    centered: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    header: {
        width: '100%',
        paddingVertical: 32,
        paddingHorizontal: 16,
        marginBottom: 12,
    },
    title: {
        color: '#fff',
        fontSize: 24,
        fontWeight: 'bold' as any,
    },
    subtitle: {
        color: '#fff',
        opacity: 0.9,
        marginTop: 4,
    },
    kpiRow: {
        width: '100%',
        flexDirection: 'row',
        flexWrap: 'wrap',
        paddingHorizontal: 16,
        gap: 8,
        marginBottom: 4,
    },
    kpiCard: {
        flexGrow: 1,
        minWidth: 160,
        borderRadius: 16,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 3,
    },
    kpiInner: {
        padding: 16,
    },
    kpiIconCircle: {
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: '#4E67EB15',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8,
    },
    kpiValue: {
        fontSize: 22,
        color: colors.COLOR_BLACK,
        fontWeight: '700' as any,
    },
    kpiLabel: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_3,
        marginTop: 2,
    },
    section: {
        width: '100%',
        alignItems: 'center',
        marginTop: 8,
    },
    sectionTitle: {
        width: '100%',
        fontSize: 18,
        fontWeight: '600' as any,
        color: colors.COLOR_BLACK,
        paddingHorizontal: 16,
        marginBottom: 6,
    },
    card: {
        width: '100%',
        backgroundColor: '#fff',
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 3,
    },
    cardTitle: {
        fontSize: 22,
        fontWeight: '800' as any,
        color: colors.COLOR_BLACK,
        marginBottom: 8,
    },
    chartInner: {
        padding: 0,
    },
    metricRowTight: {
        width: '100%',
        flexDirection: 'row',
        gap: 8,
        paddingHorizontal: 16,
    },
    metricCardSmall: {
        flexGrow: 1,
        minWidth: 120,
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 3,
    },
    chart: {
        borderRadius: 16,
        backgroundColor: '#fff',
        paddingRight: 16,
    },
    citiesGrid: {
        width: '100%',
        paddingHorizontal: 16,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    cityCard: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 12,
        flexGrow: 1,
        minWidth: 160,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 3,
    },
    cityHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
        gap: 8,
    },
    cityIconCircle: {
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: '#4E67EB15',
        alignItems: 'center',
        justifyContent: 'center',
    },
    cityTitleCol: {
        flexDirection: 'column',
    },
    cityName: {
        fontSize: 14,
        color: colors.COLOR_BLACK,
        fontWeight: '600' as any,
    },
    cityState: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_3,
        marginTop: -2,
    },
    cityStatsRow: {
        flexDirection: 'row',
        gap: 8,
    },
    cityStatChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#f8fafc',
        borderRadius: 12,
        paddingVertical: 6,
        paddingHorizontal: 8,
    },
    cityStatText: {
        fontSize: 12,
        color: colors.COLOR_BLACK,
    },
});



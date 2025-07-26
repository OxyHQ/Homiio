import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSEO } from '@/hooks/useDocumentTitle';
import { LinearGradient } from 'expo-linear-gradient';
import { tipsService, TipArticle } from '@/services/tipsService';
import { Header } from '@/components/Header';

const IconComponent = Ionicons as any;

export default function TipsScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const [tipsData, setTipsData] = useState<TipArticle[]>([]);
    const [loading, setLoading] = useState(true);
    const [headerHeight, setHeaderHeight] = useState(0);

    // Set SEO for tips page
    useSEO({
        title: 'Rental Tips & Guides - Homiio',
        description: 'Expert advice and guides for renters. Learn how to find the perfect rental, avoid scams, understand contracts, and more.',
        keywords: 'rental tips, renting guide, rental advice, tenant tips, rental scams, rental contracts',
        type: 'website'
    });

    // Load tips from API
    useEffect(() => {
        const loadTips = async () => {
            try {
                setLoading(true);
                // Temporarily use fallback data while debugging API
                const fallbackTips = tipsService.getFallbackTips();
                if (fallbackTips && Array.isArray(fallbackTips)) {
                    setTipsData(fallbackTips);
                } else {
                    console.warn('Fallback tips not in expected format:', fallbackTips);
                    setTipsData([]);
                }
            } catch (error) {
                console.error('Failed to load tips:', error);
                setTipsData([]);
            } finally {
                setLoading(false);
            }
        };

        loadTips();
    }, []);

    const handleTipPress = (tip: TipArticle) => {
        // Navigate to the individual tip article using Expo Router
        router.push(`/tips/${tip.id}`);
    };

    return (
        <View style={{ flex: 1 }}>
            <View
                style={styles.stickyHeaderWrapper}
                onLayout={e => setHeaderHeight(e.nativeEvent.layout.height)}
            >
                <Header
                    options={{
                        title: t("home.tips.title"),
                        showBackButton: true
                    }}
                />
            </View>
            <ScrollView style={[styles.container, { paddingTop: headerHeight }]}>

                {/* Tips Grid */}
                <View style={styles.tipsGrid}>
                    {loading ? (
                        // Loading skeleton
                        Array.from({ length: 4 }).map((_, index) => (
                            <View key={index} style={styles.tipCard}>
                                <View style={styles.tipImageContainer}>
                                    <View style={[styles.tipImage, { backgroundColor: colors.COLOR_BLACK_LIGHT_4 }]}>
                                        <IconComponent name="hourglass-outline" size={32} color="white" />
                                    </View>
                                </View>
                                <View style={styles.tipContent}>
                                    <View style={[styles.tipTitle, { backgroundColor: colors.COLOR_BLACK_LIGHT_4, height: 20, borderRadius: 4 }]} />
                                    <View style={[styles.tipDescription, { backgroundColor: colors.COLOR_BLACK_LIGHT_4, height: 16, borderRadius: 4, marginBottom: 8 }]} />
                                    <View style={[styles.tipDescription, { backgroundColor: colors.COLOR_BLACK_LIGHT_4, height: 16, borderRadius: 4, width: '60%' }]} />
                                </View>
                            </View>
                        ))
                    ) : (
                        tipsData.map((tip) => (
                            <TouchableOpacity
                                key={tip.id}
                                style={styles.tipCard}
                                onPress={() => handleTipPress(tip)}
                                activeOpacity={0.8}
                            >
                                <View style={styles.tipImageContainer}>
                                    <LinearGradient
                                        colors={tip.gradientColors as [string, string]}
                                        style={styles.tipImage}
                                        start={{ x: 0, y: 0 }}
                                        end={{ x: 1, y: 1 }}
                                    >
                                        <IconComponent name={tip.icon} size={32} color="white" />
                                    </LinearGradient>
                                    <View style={styles.tipCategoryBadge}>
                                        <Text style={styles.tipCategoryText}>{tip.category}</Text>
                                    </View>
                                </View>

                                <View style={styles.tipContent}>
                                    <Text style={styles.tipTitle}>{tip.title}</Text>
                                    <Text style={styles.tipDescription}>{tip.description}</Text>

                                    <View style={styles.tipMeta}>
                                        <View style={styles.tipMetaItem}>
                                            <IconComponent name="time-outline" size={14} color={colors.COLOR_BLACK_LIGHT_4} />
                                            <Text style={styles.tipMetaText}>{tip.readTime}</Text>
                                        </View>
                                        <View style={styles.tipMetaItem}>
                                            <IconComponent name="calendar-outline" size={14} color={colors.COLOR_BLACK_LIGHT_4} />
                                            <Text style={styles.tipMetaText}>{tip.publishDate}</Text>
                                        </View>
                                    </View>
                                </View>
                            </TouchableOpacity>
                        ))
                    )}
                </View>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.COLOR_BACKGROUND,
    },

    // Tips Grid Styles
    tipsGrid: {
        padding: 16,
    },
    tipCard: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 3,
        overflow: 'hidden',
    },
    tipImageContainer: {
        height: 160,
        position: 'relative',
    },
    tipImage: {
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
    },
    tipCategoryBadge: {
        position: 'absolute',
        top: 12,
        left: 12,
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderRadius: 12,
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    tipCategoryText: {
        fontSize: 10,
        fontWeight: '600',
        color: colors.COLOR_BLACK,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    tipContent: {
        padding: 16,
    },
    tipTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.COLOR_BLACK,
        marginBottom: 8,
        fontFamily: 'Phudu',
        lineHeight: 24,
    },
    tipDescription: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        lineHeight: 20,
        marginBottom: 12,
    },
    tipMeta: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    tipMetaItem: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    tipMetaText: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_4,
        marginLeft: 4,
    },
    stickyHeaderWrapper: {
        zIndex: 100,
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        backgroundColor: colors.primaryLight,
    },
}); 
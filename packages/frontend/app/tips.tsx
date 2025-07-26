import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDocumentTitle, useSEO } from '@/hooks/useDocumentTitle';
import { LinearGradient } from 'expo-linear-gradient';
import { tipsService, TipArticle } from '@/services/tipsService';
import { Header } from '@/components/Header';

const IconComponent = Ionicons as any;

export default function TipsScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const [selectedTip, setSelectedTip] = useState<TipArticle | null>(null);
    const [tipsData, setTipsData] = useState<TipArticle[]>([]);
    const [loading, setLoading] = useState(true);

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
        setSelectedTip(tip);
    };

    const handleBackPress = () => {
        setSelectedTip(null);
    };

    // Simplified markdown renderer - Hermes compatible
    const renderMarkdown = (content: string) => {
        const lines = content.split('\n');
        const elements: React.ReactNode[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const key = `line-${i}`;

            if (line.startsWith('# ')) {
                // H1 heading
                elements.push(
                    <Text key={key} style={markdownStyles.heading1}>
                        {line.replace('# ', '')}
                    </Text>
                );
            } else if (line.startsWith('## ')) {
                // H2 heading
                elements.push(
                    <Text key={key} style={markdownStyles.heading2}>
                        {line.replace('## ', '')}
                    </Text>
                );
            } else if (line.startsWith('### ')) {
                // H3 heading
                elements.push(
                    <Text key={key} style={markdownStyles.heading3}>
                        {line.replace('### ', '')}
                    </Text>
                );
            } else if (line.startsWith('* ') || line.startsWith('- ')) {
                // List item
                elements.push(
                    <Text key={key} style={markdownStyles.list_item}>
                        • {line.replace(/^[\*\-]\s/, '')}
                    </Text>
                );
            } else if (line.startsWith('> ')) {
                // Blockquote
                elements.push(
                    <Text key={key} style={markdownStyles.blockquote}>
                        {line.replace('> ', '')}
                    </Text>
                );
            } else if (line === '') {
                // Empty line
                elements.push(<View key={key} style={{ height: 16 }} />);
            } else {
                // Regular paragraph - simplified for Hermes compatibility
                elements.push(
                    <Text key={key} style={markdownStyles.paragraph}>
                        {line}
                    </Text>
                );
            }
        }

        return elements;
    };

    if (selectedTip) {
        return (
            <SafeAreaView style={{ flex: 1 }} edges={['top']}>
                <Header
                    options={{
                        title: t("tips.article"),
                        showBackButton: true,
                        leftComponents: [
                            <TouchableOpacity key="back" onPress={handleBackPress} style={{ padding: 8 }}>
                                <IconComponent name="arrow-back" size={24} color={colors.COLOR_BLACK} />
                            </TouchableOpacity>
                        ]
                    }}
                />
                <ScrollView style={styles.container}>

                    {/* Article Content */}
                    <View style={styles.articleContainer}>
                        {/* Article Header */}
                        <View style={styles.articleImageContainer}>
                            <LinearGradient
                                colors={selectedTip.gradientColors as [string, string]}
                                style={styles.articleImage}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 1 }}
                            >
                                <IconComponent name={selectedTip.icon} size={48} color="white" />
                            </LinearGradient>
                            <View style={styles.articleCategoryBadge}>
                                <Text style={styles.articleCategoryText}>{selectedTip.category}</Text>
                            </View>
                        </View>

                        <View style={styles.articleContent}>
                            <Text style={styles.articleTitle}>{selectedTip.title}</Text>

                            <View style={styles.articleMeta}>
                                <View style={styles.articleMetaItem}>
                                    <IconComponent name="time-outline" size={16} color={colors.COLOR_BLACK_LIGHT_4} />
                                    <Text style={styles.articleMetaText}>{selectedTip.readTime}</Text>
                                </View>
                                <View style={styles.articleMetaItem}>
                                    <IconComponent name="calendar-outline" size={16} color={colors.COLOR_BLACK_LIGHT_4} />
                                    <Text style={styles.articleMetaText}>{selectedTip.publishDate}</Text>
                                </View>
                            </View>

                            <Text style={styles.articleDescription}>{selectedTip.description}</Text>

                            {/* Article Body */}
                            <View style={styles.articleBody}>
                                {renderMarkdown(selectedTip.content)}
                            </View>
                        </View>
                    </View>
                </ScrollView>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
            <Header
                options={{
                    title: t("home.tips.title"),
                    showBackButton: true,
                    leftComponents: [
                        <TouchableOpacity key="back" onPress={() => router.back()} style={{ padding: 8 }}>
                            <IconComponent name="arrow-back" size={24} color={colors.COLOR_BLACK} />
                        </TouchableOpacity>
                    ]
                }}
            />
            <ScrollView style={styles.container}>

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
        </SafeAreaView>
    );
}

const markdownStyles = StyleSheet.create({
    heading1: {
        fontSize: 24,
        fontWeight: '700',
        color: colors.COLOR_BLACK,
        marginBottom: 16,
        marginTop: 24,
        fontFamily: 'Phudu',
    },
    heading2: {
        fontSize: 20,
        fontWeight: '600',
        color: colors.COLOR_BLACK,
        marginBottom: 12,
        marginTop: 20,
        fontFamily: 'Phudu',
    },
    heading3: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.COLOR_BLACK,
        marginBottom: 8,
        marginTop: 16,
        fontFamily: 'Phudu',
    },
    paragraph: {
        fontSize: 16,
        color: colors.COLOR_BLACK,
        lineHeight: 24,
        marginBottom: 12,
    },
    list_item: {
        fontSize: 16,
        color: colors.COLOR_BLACK,
        lineHeight: 24,
        marginBottom: 8,
        marginLeft: 16,
    },

    blockquote: {
        borderLeftWidth: 4,
        borderLeftColor: colors.primaryColor,
        paddingLeft: 16,
        marginVertical: 12,
        fontStyle: 'italic',
        color: colors.COLOR_BLACK_LIGHT_3,
    },
});

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

    articleContainer: {
        flex: 1,
    },
    articleImageContainer: {
        height: 200,
        position: 'relative',
    },
    articleImage: {
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
    },
    articleCategoryBadge: {
        position: 'absolute',
        top: 16,
        left: 16,
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderRadius: 12,
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    articleCategoryText: {
        fontSize: 10,
        fontWeight: '600',
        color: colors.COLOR_BLACK,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    articleContent: {
        padding: 16,
    },
    articleTitle: {
        fontSize: 24,
        fontWeight: '700',
        color: colors.COLOR_BLACK,
        marginBottom: 12,
        fontFamily: 'Phudu',
        lineHeight: 32,
    },
    articleMeta: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_4,
    },
    articleMetaItem: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    articleMetaText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_4,
        marginLeft: 6,
    },
    articleDescription: {
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_3,
        lineHeight: 24,
        marginBottom: 24,
        fontStyle: 'italic',
    },
    articleBody: {
        marginBottom: 32,
    },
}); 
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams } from 'expo-router';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSEO } from '@/hooks/useDocumentTitle';
import { LinearGradient } from 'expo-linear-gradient';
import { tipsService, TipArticle } from '@/services/tipsService';
import { Header } from '@/components/Header';

const IconComponent = Ionicons as any;

export default function TipArticleScreen() {
    const { t } = useTranslation();
    const { id } = useLocalSearchParams<{ id: string }>();
    const [tip, setTip] = useState<TipArticle | null>(null);
    const [loading, setLoading] = useState(true);

    // Set SEO for individual tip article
    useSEO({
        title: tip ? `${tip.title} - Homiio` : 'Tip Article - Homiio',
        description: tip ? tip.description : 'Expert rental advice and guides.',
        keywords: 'rental tips, renting guide, rental advice, tenant tips',
        type: 'article'
    });

    // Load tip article from API
    useEffect(() => {
        const loadTip = async () => {
            if (!id) return;

            try {
                setLoading(true);
                // Temporarily use fallback data while debugging API
                const fallbackTips = tipsService.getFallbackTips();
                const foundTip = fallbackTips.find((t: TipArticle) => t.id === id);

                if (foundTip) {
                    setTip(foundTip);
                } else {
                    console.warn('Tip not found:', id);
                    setTip(null);
                }
            } catch (error) {
                console.error('Failed to load tip:', error);
                setTip(null);
            } finally {
                setLoading(false);
            }
        };

        loadTip();
    }, [id]);

    // Ultra-simplified markdown renderer - Hermes compatible
    const renderMarkdown = (content: string) => {
        if (!content) return [];

        const lines = content.split('\n');
        const elements: React.ReactNode[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const key = `line-${i}`;

            if (!line || line.trim() === '') {
                elements.push(<View key={key} style={{ height: 16 }} />);
                continue;
            }

            const trimmedLine = line.trim();

            if (trimmedLine.startsWith('# ')) {
                const text = trimmedLine.substring(2);
                elements.push(
                    <Text key={key} style={markdownStyles.heading1}>
                        {text}
                    </Text>
                );
            } else if (trimmedLine.startsWith('## ')) {
                const text = trimmedLine.substring(3);
                elements.push(
                    <Text key={key} style={markdownStyles.heading2}>
                        {text}
                    </Text>
                );
            } else if (trimmedLine.startsWith('### ')) {
                const text = trimmedLine.substring(4);
                elements.push(
                    <Text key={key} style={markdownStyles.heading3}>
                        {text}
                    </Text>
                );
            } else if (trimmedLine.startsWith('* ') || trimmedLine.startsWith('- ')) {
                const text = trimmedLine.substring(2);
                elements.push(
                    <Text key={key} style={markdownStyles.list_item}>
                        • {text}
                    </Text>
                );
            } else if (trimmedLine.startsWith('> ')) {
                const text = trimmedLine.substring(2);
                elements.push(
                    <Text key={key} style={markdownStyles.blockquote}>
                        {text}
                    </Text>
                );
            } else {
                elements.push(
                    <Text key={key} style={markdownStyles.paragraph}>
                        {trimmedLine}
                    </Text>
                );
            }
        }

        return elements;
    };

    if (loading) {
        return (
            <SafeAreaView style={{ flex: 1 }} edges={['top']}>
                <Header
                    options={{
                        title: t("tips.article"),
                        showBackButton: true
                    }}
                />
                <View style={styles.loadingContainer}>
                    <Text style={styles.loadingText}>Loading article...</Text>
                </View>
            </SafeAreaView>
        );
    }

    if (!tip) {
        return (
            <SafeAreaView style={{ flex: 1 }} edges={['top']}>
                <Header
                    options={{
                        title: t("tips.article"),
                        showBackButton: true
                    }}
                />
                <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>Article not found</Text>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
            <Header
                options={{
                    title: t("tips.article"),
                    showBackButton: true
                }}
            />
            <ScrollView style={styles.container}>
                {/* Article Content */}
                <View style={styles.articleContainer}>
                    {/* Article Header */}
                    <View style={styles.articleImageContainer}>
                        <LinearGradient
                            colors={tip.gradientColors as [string, string]}
                            style={styles.articleImage}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                        >
                            <IconComponent name={tip.icon} size={48} color="white" />
                        </LinearGradient>
                        <View style={styles.articleCategoryBadge}>
                            <Text style={styles.articleCategoryText}>{tip.category}</Text>
                        </View>
                    </View>

                    <View style={styles.articleContent}>
                        <Text style={styles.articleTitle}>{tip.title}</Text>

                        <View style={styles.articleMeta}>
                            <View style={styles.articleMetaItem}>
                                <IconComponent name="time-outline" size={16} color={colors.COLOR_BLACK_LIGHT_4} />
                                <Text style={styles.articleMetaText}>{tip.readTime}</Text>
                            </View>
                            <View style={styles.articleMetaItem}>
                                <IconComponent name="calendar-outline" size={16} color={colors.COLOR_BLACK_LIGHT_4} />
                                <Text style={styles.articleMetaText}>{tip.publishDate}</Text>
                            </View>
                        </View>

                        <Text style={styles.articleDescription}>{tip.description}</Text>

                        {/* Article Body */}
                        <View style={styles.articleBody}>
                            {renderMarkdown(tip.content)}
                        </View>
                    </View>
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
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_3,
    },
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    errorText: {
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_3,
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
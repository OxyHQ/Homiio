import React, { useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { H1, H2, H3, Text as BloomText } from '@oxyhq/bloom/typography';
import { Header } from '@/components/Header';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { TipsDetailSkeleton } from '@/components/ui/skeletons/TipsSkeleton';
import {
  formatTipDate,
  tipsService,
  type TipArticle,
} from '@/services/tipsService';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';
import { radius, spacing, withShadow } from '@/constants/styles';
import { colors } from '@/styles/colors';

function renderMarkdown(content: string): React.ReactNode[] {
  if (!content) return [];

  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let listBuffer: string[] = [];
  let listOrdered = false;

  const flushList = (index: number) => {
    if (listBuffer.length === 0) return;
    elements.push(
      <View key={`list-${index}`} style={styles.listBlock}>
        {listBuffer.map((item, itemIndex) => (
          <BloomText key={`list-${index}-${itemIndex}`} style={styles.listItem}>
            {listOrdered ? `${itemIndex + 1}. ${item}` : `• ${item}`}
          </BloomText>
        ))}
      </View>,
    );
    listBuffer = [];
    listOrdered = false;
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    if (!trimmed) {
      flushList(index);
      elements.push(<View key={`space-${index}`} style={styles.paragraphGap} />);
      return;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      if (listOrdered && listBuffer.length > 0) flushList(index);
      listOrdered = false;
      listBuffer.push(bulletMatch[1]);
      return;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      if (!listOrdered && listBuffer.length > 0) flushList(index);
      listOrdered = true;
      listBuffer.push(orderedMatch[1]);
      return;
    }

    flushList(index);

    if (trimmed.startsWith('# ')) {
      elements.push(
        <H1 key={`h1-${index}`} style={styles.heading1}>
          {trimmed.slice(2)}
        </H1>,
      );
      return;
    }

    if (trimmed.startsWith('## ')) {
      elements.push(
        <H2 key={`h2-${index}`} style={styles.heading2}>
          {trimmed.slice(3)}
        </H2>,
      );
      return;
    }

    if (trimmed.startsWith('### ')) {
      elements.push(
        <H3 key={`h3-${index}`} style={styles.heading3}>
          {trimmed.slice(4)}
        </H3>,
      );
      return;
    }

    if (trimmed.startsWith('> ')) {
      elements.push(
        <View key={`quote-${index}`} style={styles.blockquote}>
          <BloomText style={styles.blockquoteText}>{trimmed.slice(2)}</BloomText>
        </View>,
      );
      return;
    }

    elements.push(
      <BloomText key={`p-${index}`} style={styles.paragraph}>
        {trimmed}
      </BloomText>,
    );
  });

  flushList(lines.length);
  return elements;
}

function RelatedCard({ tip, onPress }: { tip: TipArticle; onPress: () => void }) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[styles.relatedCard, pressed && styles.relatedCardPressed]}
      accessibilityRole="button"
      accessibilityLabel={tip.title}
    >
      {tip.coverImageUrl ? (
        <Image source={{ uri: tip.coverImageUrl }} style={styles.relatedImage} resizeMode="cover" />
      ) : (
        <View style={[styles.relatedImage, styles.relatedFallback]}>
          <Ionicons name="newspaper-outline" size={24} color={colors.muted} />
        </View>
      )}
      <View style={styles.relatedBody}>
        <BloomText style={styles.relatedCategory}>{tip.category}</BloomText>
        <BloomText style={styles.relatedTitle} numberOfLines={2}>
          {tip.title}
        </BloomText>
        <BloomText style={styles.relatedMeta}>{tip.readTime}</BloomText>
      </View>
    </Pressable>
  );
}

export default function TipArticleScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const isWide = useIsScreenNotMobile();

  const tipQuery = useQuery({
    queryKey: ['tips', 'detail', slug],
    queryFn: () => tipsService.getTipBySlug(slug ?? ''),
    enabled: Boolean(slug),
  });

  const listQuery = useQuery({
    queryKey: ['tips', 'list'],
    queryFn: () => tipsService.listTips(),
  });

  const relatedTips = useMemo(() => {
    const all = listQuery.data?.tips ?? [];
    if (all.length < 2 || !slug) return [];
    return all.filter((tip) => tip.slug !== slug).slice(0, 3);
  }, [listQuery.data?.tips, slug]);

  const showRelated = (listQuery.data?.tips.length ?? 0) >= 2 && relatedTips.length > 0;

  if (!slug) {
    return (
      <View style={styles.root}>
        <Header options={{ title: t('tips.article'), showBackButton: true }} />
        <ErrorState
          icon="document-text-outline"
          title={t('tips.notFoundTitle', 'Article unavailable')}
          description={t('tips.notFoundDescription', 'This tip could not be loaded.')}
          retryLabel={t('tips.goBack', 'Go back')}
          onRetry={() => router.back()}
        />
      </View>
    );
  }

  if (tipQuery.isLoading) {
    return (
      <View style={styles.root}>
        <Header options={{ title: t('tips.article'), showBackButton: true }} />
        <TipsDetailSkeleton wide={isWide} />
      </View>
    );
  }

  if (tipQuery.isError || !tipQuery.data) {
    return (
      <View style={styles.root}>
        <Header options={{ title: t('tips.article'), showBackButton: true }} />
        <ErrorState
          icon="document-text-outline"
          title={t('tips.notFoundTitle', 'Article unavailable')}
          description={
            tipQuery.error instanceof Error
              ? tipQuery.error.message
              : t('tips.notFoundDescription', 'This tip could not be loaded.')
          }
          retryLabel={t('tips.goBack', 'Go back')}
          onRetry={() => router.back()}
        />
      </View>
    );
  }

  const tip = tipQuery.data;

  return (
    <View style={styles.root}>
      <Header options={{ title: t('tips.article'), showBackButton: true }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.hero, isWide && styles.heroWide]}>
          {tip.coverImageUrl ? (
            <Image
              source={{ uri: tip.coverImageUrl }}
              style={styles.heroImage}
              resizeMode="cover"
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View style={[styles.heroImage, styles.heroFallback]}>
              <Ionicons name="newspaper-outline" size={56} color={colors.muted} />
            </View>
          )}
        </View>

        <View style={styles.articleBlock}>
          <SectionEyebrow>{tip.category}</SectionEyebrow>
          <H1 style={styles.articleTitle}>{tip.title}</H1>
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Ionicons name="person-outline" size={14} color={colors.muted} />
              <BloomText style={styles.metaText}>{tip.author}</BloomText>
            </View>
            <View style={styles.metaItem}>
              <Ionicons name="time-outline" size={14} color={colors.muted} />
              <BloomText style={styles.metaText}>{tip.readTime}</BloomText>
            </View>
            <View style={styles.metaItem}>
              <Ionicons name="calendar-outline" size={14} color={colors.muted} />
              <BloomText style={styles.metaText}>{formatTipDate(tip.publishedAt)}</BloomText>
            </View>
          </View>
          <BloomText style={styles.description}>{tip.description}</BloomText>
        </View>

        <View style={styles.articleBody}>{renderMarkdown(tip.content)}</View>

        {showRelated ? (
          <View style={styles.relatedSection}>
            <H2 style={styles.relatedHeading}>
              {t('tips.relatedTitle', 'More to read')}
            </H2>
            <View style={styles.relatedGrid}>
              {relatedTips.map((related) => (
                <RelatedCard
                  key={related.slug}
                  tip={related}
                  onPress={() => router.push(`/tips/${related.slug}`)}
                />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: spacing['4xl'],
    gap: spacing['2xl'],
  },
  hero: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
  heroWide: {
    marginHorizontal: spacing.lg,
    borderRadius: radius.xl,
    ...withShadow('sm'),
  },
  heroImage: {
    width: '100%',
    aspectRatio: 16 / 9,
    minHeight: 220,
  },
  heroFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  articleBlock: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  articleTitle: {
    letterSpacing: -1,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  metaText: {
    fontSize: 13,
    color: colors.muted,
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.muted,
    fontStyle: 'italic',
  },
  articleBody: {
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
  },
  heading1: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  heading2: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  heading3: {
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  paragraph: {
    fontSize: 16,
    color: colors.COLOR_BLACK,
    lineHeight: 26,
    marginBottom: spacing.sm,
  },
  paragraphGap: {
    height: spacing.md,
  },
  listBlock: {
    gap: spacing.xs,
    marginBottom: spacing.sm,
    marginLeft: spacing.md,
  },
  listItem: {
    fontSize: 16,
    color: colors.COLOR_BLACK,
    lineHeight: 26,
  },
  blockquote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.primaryColor,
    paddingLeft: spacing.md,
    paddingVertical: spacing.sm,
    marginVertical: spacing.sm,
    backgroundColor: colors.infoSubtle,
    borderRadius: radius.md,
  },
  blockquoteText: {
    fontSize: 16,
    fontStyle: 'italic',
    color: colors.COLOR_BLACK_LIGHT_2,
    lineHeight: 24,
  },
  relatedSection: {
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  relatedHeading: {
    letterSpacing: -0.3,
  },
  relatedGrid: {
    gap: spacing.md,
  },
  relatedCard: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...withShadow('sm'),
  },
  relatedCardPressed: {
    opacity: 0.92,
  },
  relatedImage: {
    width: 112,
    height: 84,
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
  relatedFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  relatedBody: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingRight: spacing.md,
    gap: spacing.xs,
  },
  relatedCategory: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  relatedTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
    lineHeight: 20,
  },
  relatedMeta: {
    fontSize: 12,
    color: colors.muted,
  },
});

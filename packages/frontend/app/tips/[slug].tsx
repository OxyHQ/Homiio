/**
 * Tip detail — editorial article reader fed by the website Newsroom API.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import {
  H1,
  H2,
  H3,
  Text as BloomText,
} from '@oxyhq/bloom/typography';

import { Header } from '@/components/Header';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { TipDetailSkeleton } from '@/components/ui/skeletons/TipsSkeleton';
import {
  formatPublishDate,
  tipsService,
  toNewsroomLocale,
  type TipArticle,
} from '@/services/tipsService';
import { radius, spacing } from '@/constants/styles';
import { colors } from '@/styles/colors';

const renderMarkdown = (content: string): React.ReactNode[] => {
  if (!content) return [];
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];

  lines.forEach((line, i) => {
    const key = `line-${i}`;
    const trimmed = line.trim();

    if (!trimmed) {
      elements.push(<View key={key} style={{ height: spacing.md }} />);
      return;
    }

    if (trimmed.startsWith('# ')) {
      elements.push(
        <H1 key={key} style={styles.heading1}>
          {trimmed.substring(2)}
        </H1>,
      );
    } else if (trimmed.startsWith('## ')) {
      elements.push(
        <H2 key={key} style={styles.heading2}>
          {trimmed.substring(3)}
        </H2>,
      );
    } else if (trimmed.startsWith('### ')) {
      elements.push(
        <H3 key={key} style={styles.heading3}>
          {trimmed.substring(4)}
        </H3>,
      );
    } else if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
      elements.push(
        <BloomText key={key} style={styles.listItem}>
          • {trimmed.substring(2)}
        </BloomText>,
      );
    } else if (trimmed.startsWith('> ')) {
      elements.push(
        <View key={key} style={styles.blockquote}>
          <BloomText style={styles.blockquoteText}>
            {trimmed.substring(2)}
          </BloomText>
        </View>,
      );
    } else {
      elements.push(
        <BloomText key={key} style={styles.paragraph}>
          {trimmed}
        </BloomText>,
      );
    }
  });

  return elements;
};

interface RelatedCardProps {
  tip: TipArticle;
  onPress: () => void;
}

const RelatedCard: React.FC<RelatedCardProps> = ({ tip, onPress }) => {
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
        <Image
          source={{ uri: tip.coverImageUrl }}
          style={styles.relatedImage}
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
        />
      ) : (
        <View style={styles.relatedImagePlaceholder}>
          <Ionicons name="newspaper-outline" size={24} color={colors.muted} />
        </View>
      )}
      <View style={styles.relatedContent}>
        <BloomText style={styles.relatedTitle} numberOfLines={2}>
          {tip.title}
        </BloomText>
        <BloomText style={styles.relatedMeta}>{tip.readTime}</BloomText>
      </View>
    </Pressable>
  );
};

export default function TipArticleScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const locale = toNewsroomLocale(i18n.language);

  const tipQuery = useQuery({
    queryKey: ['tip', slug, locale],
    queryFn: () => tipsService.getTipBySlug(slug ?? '', locale),
    enabled: Boolean(slug),
  });

  const allTipsQuery = useQuery({
    queryKey: ['tips', 'related', locale],
    queryFn: () => tipsService.getTips({ locale }),
    enabled: Boolean(slug) && tipQuery.isSuccess,
  });

  const relatedTips = useMemo(() => {
    if (!slug || !allTipsQuery.data?.data) return [];
    const current = allTipsQuery.data.data.filter((entry) => entry.slug !== slug);
    const currentTags = new Set(tipQuery.data?.tags ?? []);
    const scored = current.map((entry) => {
      const overlap = entry.tags.filter((tag) => currentTags.has(tag)).length;
      return { entry, overlap };
    });
    scored.sort((a, b) => b.overlap - a.overlap);
    return scored.map((item) => item.entry).slice(0, 3);
  }, [allTipsQuery.data?.data, slug, tipQuery.data?.tags]);

  if (!slug) {
    return (
      <View style={styles.root}>
        <Header options={{ title: t('tips.article'), showBackButton: true }} />
        <ErrorState
          icon="document-text-outline"
          title={t('tips.unavailable')}
          description={t('tips.missingSlug')}
          retryLabel={t('common.goBack')}
          onRetry={() => router.back()}
        />
      </View>
    );
  }

  if (tipQuery.isPending) {
    return (
      <View style={styles.root}>
        <Header options={{ title: t('tips.article'), showBackButton: true }} />
        <TipDetailSkeleton />
      </View>
    );
  }

  if (tipQuery.isError || !tipQuery.data) {
    return (
      <View style={styles.root}>
        <Header options={{ title: t('tips.article'), showBackButton: true }} />
        <ErrorState
          icon="document-text-outline"
          title={t('tips.unavailable')}
          description={tipQuery.error?.message ?? t('tips.loadFailed')}
          retryLabel={t('common.goBack')}
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
        <View style={styles.hero}>
          {tip.coverImageUrl ? (
            <Image
              source={{ uri: tip.coverImageUrl }}
              style={styles.heroImage}
              contentFit="cover"
              transition={250}
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={styles.heroPlaceholder}>
              <Ionicons name="newspaper-outline" size={56} color={colors.muted} />
            </View>
          )}
          <View style={styles.heroBadge}>
            <BloomText style={styles.heroBadgeText}>{tip.category}</BloomText>
          </View>
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
            {tip.publishedAt ? (
              <View style={styles.metaItem}>
                <Ionicons name="calendar-outline" size={14} color={colors.muted} />
                <BloomText style={styles.metaText}>
                  {formatPublishDate(tip.publishedAt)}
                </BloomText>
              </View>
            ) : null}
          </View>
          <BloomText style={styles.description}>{tip.description}</BloomText>
        </View>

        <View style={styles.articleBody}>{renderMarkdown(tip.content)}</View>

        {relatedTips.length >= 2 ? (
          <View style={styles.relatedSection}>
            <H2 style={styles.relatedHeading}>
              {t('tips.related')}
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
    padding: spacing.lg,
    gap: spacing['2xl'],
    paddingBottom: spacing['4xl'],
  },
  hero: {
    position: 'relative',
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.surfaceElevated,
  },
  heroImage: {
    width: '100%',
    height: 280,
  },
  heroPlaceholder: {
    width: '100%',
    height: 280,
    backgroundColor: colors.infoSubtle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroBadge: {
    position: 'absolute',
    top: spacing.lg,
    left: spacing.lg,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  heroBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  articleBlock: {
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
  listItem: {
    fontSize: 16,
    color: colors.COLOR_BLACK,
    lineHeight: 26,
    marginBottom: spacing.xs,
    marginLeft: spacing.md,
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
    gap: spacing.md,
    marginTop: spacing.md,
  },
  relatedHeading: {
    letterSpacing: -0.3,
  },
  relatedGrid: {
    gap: spacing.md,
  },
  relatedCard: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  relatedCardPressed: {
    opacity: 0.92,
  },
  relatedImage: {
    width: 96,
    height: 96,
  },
  relatedImagePlaceholder: {
    width: 96,
    height: 96,
    backgroundColor: colors.infoSubtle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  relatedContent: {
    flex: 1,
    padding: spacing.md,
    justifyContent: 'center',
    gap: spacing.xs,
  },
  relatedTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  relatedMeta: {
    fontSize: 12,
    color: colors.muted,
  },
});

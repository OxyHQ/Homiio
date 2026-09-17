/**
 * Tip detail — editorial article reader fed by the website Newsroom API.
 *
 * Category pills are Bloom `Chip`s, meta glyphs are Remix icons and related
 * tips are Bloom `Card`s whose thumbnail zooms inside its mask
 * (`ZoomableImage`), matching the tips index.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Card } from '@oxy.so/bloom/card';
import { Chip } from '@oxy.so/bloom/chip';
import {
  RiCalendarLine,
  RiFileTextLine,
  RiNewspaperLine,
  RiTimeLine,
  RiUserLine,
} from '@oxy.so/bloom/icons';
import { useTheme } from '@oxy.so/bloom/theme';
import {
  H1,
  H2,
  H3,
  Text as BloomText,
} from '@oxy.so/bloom/typography';

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
import { ZoomableImage } from '@/components/ui/ZoomableImage';

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
  const theme = useTheme();
  const [pressed, setPressed] = useState(false);
  // Hover anywhere on the card zooms its thumbnail (web); press on native.
  const [hovered, setHovered] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityLabel={tip.title}
    >
      <Card variant="outlined" radius="radius-16" style={styles.relatedCard}>
        {tip.coverImageUrl ? (
          <ZoomableImage active={hovered || pressed} style={styles.relatedImage}>
            <Image
              source={{ uri: tip.coverImageUrl }}
              style={styles.relatedImageFill}
              contentFit="cover"
              transition={200}
              cachePolicy="memory-disk"
            />
          </ZoomableImage>
        ) : (
          <View
            style={[
              styles.relatedImage,
              styles.imagePlaceholder,
              { backgroundColor: theme.colors.backgroundSecondary },
            ]}
          >
            <RiNewspaperLine width={24} height={24} fill={theme.colors.textSecondary} />
          </View>
        )}
        <View style={styles.relatedContent}>
          <BloomText style={styles.relatedTitle} numberOfLines={2}>
            {tip.title}
          </BloomText>
          <BloomText style={[styles.relatedMeta, { color: theme.colors.textSecondary }]}>
            {tip.readTime}
          </BloomText>
        </View>
      </Card>
    </Pressable>
  );
};

export default function TipArticleScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
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

  // Hoisted to locals so the dependency expressions are plain identifiers. The
  // array said `allTipsQuery.data?.data` while the body read
  // `allTipsQuery.data.data` — the same value, but two different expressions,
  // which is what "inferred different dependency than source" was reporting.
  const allTips = allTipsQuery.data?.data;
  const currentTipTags = tipQuery.data?.tags;

  const relatedTips = useMemo(() => {
    if (!slug || !allTips) return [];
    const current = allTips.filter((entry) => entry.slug !== slug);
    const currentTags = new Set(currentTipTags ?? []);
    const scored = current.map((entry) => {
      const overlap = entry.tags.filter((tag) => currentTags.has(tag)).length;
      return { entry, overlap };
    });
    scored.sort((a, b) => b.overlap - a.overlap);
    return scored.map((item) => item.entry).slice(0, 3);
  }, [allTips, slug, currentTipTags]);

  if (!slug) {
    return (
      <View style={styles.root}>
        <Header options={{ title: t('tips.article'), showBackButton: true }} />
        <ErrorState
          icon={RiFileTextLine}
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
          icon={RiFileTextLine}
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
            <View
              style={[
                styles.heroImage,
                styles.imagePlaceholder,
                { backgroundColor: theme.colors.backgroundSecondary },
              ]}
            >
              <RiNewspaperLine width={56} height={56} fill={theme.colors.textSecondary} />
            </View>
          )}
          <Chip size="small" variant="solid" color="default" style={styles.heroBadge}>
            {tip.category}
          </Chip>
        </View>

        <View style={styles.articleBlock}>
          <SectionEyebrow>{tip.category}</SectionEyebrow>
          <H1 style={styles.articleTitle}>{tip.title}</H1>
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <RiUserLine width={14} height={14} fill={theme.colors.textSecondary} />
              <BloomText style={styles.metaText}>{tip.author}</BloomText>
            </View>
            <View style={styles.metaItem}>
              <RiTimeLine width={14} height={14} fill={theme.colors.textSecondary} />
              <BloomText style={styles.metaText}>{tip.readTime}</BloomText>
            </View>
            {tip.publishedAt ? (
              <View style={styles.metaItem}>
                <RiCalendarLine width={14} height={14} fill={theme.colors.textSecondary} />
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
  imagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroBadge: {
    position: 'absolute',
    top: spacing.lg,
    left: spacing.lg,
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
    overflow: 'hidden',
  },
  relatedImage: {
    width: 96,
    height: 96,
  },
  relatedImageFill: {
    width: '100%',
    height: '100%',
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
  },
  relatedMeta: {
    fontSize: 12,
  },
});

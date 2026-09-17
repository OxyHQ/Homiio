/**
 * Tips index — magazine-style editorial list fed by the website Newsroom API.
 *
 * Each tip is a Bloom `Card` (the cover photo zooms inside its mask through
 * `ZoomableImage`), tag filters and the category pill are Bloom `Chip`s, and
 * meta glyphs are Remix icons.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Card } from '@oxy.so/bloom/card';
import { Chip } from '@oxy.so/bloom/chip';
import { RiCalendarLine, RiNewspaperLine, RiTimeLine } from '@oxy.so/bloom/icons';
import { useTheme } from '@oxy.so/bloom/theme';
import { H2, H3, Text as BloomText } from '@oxy.so/bloom/typography';
import { useMediaQuery } from 'react-responsive';

import { Header } from '@/components/Header';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { ErrorState } from '@/components/ui/ErrorState';
import { TipsSkeleton } from '@/components/ui/skeletons/TipsSkeleton';
import {
  formatPublishDate,
  tipsService,
  toNewsroomLocale,
  type TipArticle,
} from '@/services/tipsService';
import { spacing } from '@/constants/styles';
import { colors } from '@/styles/colors';
import { ZoomableImage } from '@/components/ui/ZoomableImage';

interface TipCardProps {
  tip: TipArticle;
  onPress: () => void;
  featured?: boolean;
}

const TipCard: React.FC<TipCardProps> = ({ tip, onPress, featured = false }) => {
  const theme = useTheme();
  const [pressed, setPressed] = useState(false);
  // Hover anywhere on the card zooms its cover photo (web); press on native.
  const [hovered, setHovered] = useState(false);
  const metaFill = theme.colors.textSecondary;
  const secondary = { color: theme.colors.textSecondary };

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
      <Card
        variant="filled"
        radius={featured ? 'radius-24' : 'radius-16'}
        style={styles.tipCard}
      >
        <View style={[styles.tipImageContainer, featured && styles.tipImageFeatured]}>
          {tip.coverImageUrl ? (
            // The photo zooms inside its mask on hover anywhere on the card / press;
            // the category chip is a sibling above the zoom, so it stays put and
            // unclipped.
            <ZoomableImage active={hovered || pressed} style={styles.tipImageFill}>
              <Image
                source={{ uri: tip.coverImageUrl }}
                style={styles.tipImage}
                contentFit="cover"
                transition={200}
                cachePolicy="memory-disk"
              />
            </ZoomableImage>
          ) : (
            <View
              style={[
                styles.tipImagePlaceholder,
                { backgroundColor: theme.colors.backgroundSecondary },
              ]}
            >
              <RiNewspaperLine
                width={featured ? 48 : 32}
                height={featured ? 48 : 32}
                fill={metaFill}
              />
            </View>
          )}
          <Chip size="small" variant="solid" color="default" style={styles.tipCategoryBadge}>
            {tip.category}
          </Chip>
        </View>

        <View style={styles.tipContent}>
          <H3 style={featured ? styles.tipTitleFeatured : styles.tipTitle}>{tip.title}</H3>
          <BloomText
            style={[featured ? styles.tipDescriptionFeatured : styles.tipDescription, secondary]}
            numberOfLines={featured ? 3 : 2}
          >
            {tip.description}
          </BloomText>

          <View style={styles.tipMeta}>
            <View style={styles.tipMetaItem}>
              <RiTimeLine width={14} height={14} fill={metaFill} />
              <BloomText style={[styles.tipMetaText, secondary]}>{tip.readTime}</BloomText>
            </View>
            {tip.publishedAt ? (
              <View style={styles.tipMetaItem}>
                <RiCalendarLine width={14} height={14} fill={metaFill} />
                <BloomText style={[styles.tipMetaText, secondary]}>
                  {formatPublishDate(tip.publishedAt)}
                </BloomText>
              </View>
            ) : null}
          </View>
        </View>
      </Card>
    </Pressable>
  );
};

export default function TipsScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const isWide = useMediaQuery({ minWidth: 768 });
  const [activeTag, setActiveTag] = useState<string | undefined>(undefined);
  const locale = toNewsroomLocale(i18n.language);

  const tipsQuery = useQuery({
    queryKey: ['tips', locale],
    queryFn: () => tipsService.getTips({ locale }),
  });

  const allTips = useMemo(() => tipsQuery.data?.data ?? [], [tipsQuery.data]);

  const tips = useMemo(() => {
    if (!activeTag) return allTips;
    return allTips.filter((tip) => tip.tags.includes(activeTag));
  }, [activeTag, allTips]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const tip of allTips) {
      for (const tag of tip.tags) {
        tags.add(tag);
      }
    }
    return Array.from(tags).sort();
  }, [allTips]);

  const featuredTip = useMemo(
    () => tips.find((tip) => tip.featured) ?? tips[0] ?? null,
    [tips],
  );

  const gridTips = useMemo(
    () => (featuredTip ? tips.filter((tip) => tip.slug !== featuredTip.slug) : tips),
    [tips, featuredTip],
  );

  return (
    <View style={styles.root}>
      <Header
        options={{
          title: t('home.tips.title'),
          showBackButton: true,
        }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.titleBlock}>
          <SectionEyebrow>{t('home.tips.eyebrow')}</SectionEyebrow>
          <H2 style={styles.title}>{t('home.tips.title')}</H2>
          <BloomText style={styles.subtitle}>
            {t('home.tips.subtitle')}
          </BloomText>
        </View>

        {allTags.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tagRow}
          >
            <Chip
              onPress={() => setActiveTag(undefined)}
              variant={activeTag === undefined ? 'solid' : 'outlined'}
              color={activeTag === undefined ? 'primary' : 'default'}
              selected={activeTag === undefined}
            >
              {t('tips.all')}
            </Chip>
            {allTags.map((tag) => {
              const isActive = activeTag === tag;
              return (
                <Chip
                  key={tag}
                  onPress={() => setActiveTag(isActive ? undefined : tag)}
                  variant={isActive ? 'solid' : 'outlined'}
                  color={isActive ? 'primary' : 'default'}
                  selected={isActive}
                >
                  {tag}
                </Chip>
              );
            })}
          </ScrollView>
        ) : null}

        {tipsQuery.isPending ? (
          <TipsSkeleton itemCount={isWide ? 4 : 3} />
        ) : tipsQuery.isError ? (
          <ErrorState
            icon="cloud-offline-outline"
            title={t('tips.loadError')}
            description={tipsQuery.error?.message ?? t('tips.tryAgain')}
            onRetry={() => tipsQuery.refetch()}
          />
        ) : tips.length === 0 ? (
          <ErrorState
            icon="newspaper-outline"
            title={t('tips.emptyTitle')}
            description={t('tips.emptyDescription')}
          />
        ) : (
          <View style={styles.magazine}>
            {featuredTip ? (
              <TipCard
                tip={featuredTip}
                featured
                onPress={() => router.push(`/tips/${featuredTip.slug}`)}
              />
            ) : null}

            {gridTips.length > 0 ? (
              <View style={[styles.grid, isWide && styles.gridWide]}>
                {gridTips.map((tip) => (
                  <View key={tip.slug} style={isWide ? styles.gridItem : undefined}>
                    <TipCard tip={tip} onPress={() => router.push(`/tips/${tip.slug}`)} />
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        )}
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
    gap: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  titleBlock: {
    gap: spacing.xs,
  },
  title: {
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: colors.muted,
  },
  tagRow: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  magazine: {
    gap: spacing.xl,
  },
  grid: {
    gap: spacing.lg,
  },
  gridWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  gridItem: {
    width: '48%',
    flexGrow: 1,
  },
  tipCard: {
    overflow: 'hidden',
  },
  tipImageContainer: {
    position: 'relative',
    height: 180,
  },
  // The masked zoom wrapper fills the image box so the photo scales inside it.
  tipImageFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  tipImageFeatured: {
    height: 260,
  },
  tipImage: {
    width: '100%',
    height: '100%',
  },
  tipImagePlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tipCategoryBadge: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
  },
  tipContent: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  tipTitle: {
    letterSpacing: -0.3,
  },
  tipTitleFeatured: {
    letterSpacing: -0.4,
    fontSize: 22,
  },
  tipDescription: {
    fontSize: 14,
    lineHeight: 20,
  },
  tipDescriptionFeatured: {
    fontSize: 15,
    lineHeight: 22,
  },
  tipMeta: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.xs,
  },
  tipMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  tipMetaText: {
    fontSize: 12,
  },
});

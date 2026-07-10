/**
 * Tips index — magazine-style editorial list fed by the website Newsroom API.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Chip } from '@oxyhq/bloom/chip';
import { H2, H3, Text as BloomText } from '@oxyhq/bloom/typography';
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
import { radius, spacing, withShadow } from '@/constants/styles';
import { colors } from '@/styles/colors';

interface TipCardProps {
  tip: TipArticle;
  onPress: () => void;
  featured?: boolean;
}

const TipCard: React.FC<TipCardProps> = ({ tip, onPress, featured = false }) => {
  const [pressed, setPressed] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[
        styles.tipCard,
        featured && styles.tipCardFeatured,
        pressed && styles.tipCardPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={tip.title}
    >
      <View style={[styles.tipImageContainer, featured && styles.tipImageFeatured]}>
        {tip.coverImageUrl ? (
          <Image
            source={{ uri: tip.coverImageUrl }}
            style={styles.tipImage}
            contentFit="cover"
            transition={200}
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={styles.tipImagePlaceholder}>
            <Ionicons name="newspaper-outline" size={featured ? 48 : 32} color={colors.muted} />
          </View>
        )}
        <View style={styles.tipCategoryBadge}>
          <BloomText style={styles.tipCategoryText}>{tip.category}</BloomText>
        </View>
      </View>

      <View style={styles.tipContent}>
        <H3 style={featured ? styles.tipTitleFeatured : styles.tipTitle}>{tip.title}</H3>
        <BloomText
          style={featured ? styles.tipDescriptionFeatured : styles.tipDescription}
          numberOfLines={featured ? 3 : 2}
        >
          {tip.description}
        </BloomText>

        <View style={styles.tipMeta}>
          <View style={styles.tipMetaItem}>
            <Ionicons name="time-outline" size={14} color={colors.muted} />
            <BloomText style={styles.tipMetaText}>{tip.readTime}</BloomText>
          </View>
          {tip.publishedAt ? (
            <View style={styles.tipMetaItem}>
              <Ionicons name="calendar-outline" size={14} color={colors.muted} />
              <BloomText style={styles.tipMetaText}>
                {formatPublishDate(tip.publishedAt)}
              </BloomText>
            </View>
          ) : null}
        </View>
      </View>
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

  const allTips = tipsQuery.data?.data ?? [];

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
          <SectionEyebrow>{t('home.tips.eyebrow', 'Renting smarter')}</SectionEyebrow>
          <H2 style={styles.title}>{t('home.tips.title', 'Rental tips')}</H2>
          <BloomText style={styles.subtitle}>
            {t(
              'home.tips.subtitle',
              'Practical guides from local tenants, legal experts, and the Homiio editorial team.',
            )}
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
              {t('tips.all', 'All')}
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
            title={t('tips.loadError', "Couldn't load tips")}
            description={tipsQuery.error?.message ?? t('tips.tryAgain', 'Please try again.')}
            onRetry={() => tipsQuery.refetch()}
          />
        ) : tips.length === 0 ? (
          <ErrorState
            icon="newspaper-outline"
            title={t('tips.emptyTitle', 'No tips yet')}
            description={t(
              'tips.emptyDescription',
              'Check back soon for new rental guides and advice.',
            )}
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
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...withShadow('sm'),
  },
  tipCardFeatured: {
    borderRadius: radius.xl,
  },
  tipCardPressed: {
    opacity: 0.92,
  },
  tipImageContainer: {
    position: 'relative',
    height: 180,
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
    backgroundColor: colors.infoSubtle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tipCategoryBadge: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  tipCategoryText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    textTransform: 'uppercase',
    letterSpacing: 1,
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
    color: colors.muted,
    lineHeight: 20,
  },
  tipDescriptionFeatured: {
    fontSize: 15,
    color: colors.muted,
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
    color: colors.muted,
  },
});

/**
 * Tip detail — markdown article reader.
 *
 * Stream Q polish:
 *   - Bloom Typography (H1/H2/H3/Text) replaces raw <Text>.
 *   - Hero card uses radius.xl with withShadow('sm') and a category pill.
 *   - Loading uses Skeleton.Box; ErrorState shared with the rest of the app.
 */
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  H1,
  H2,
  H3,
  Text as BloomText,
} from '@oxyhq/bloom/typography';
import { Header } from '@/components/Header';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { tipsService, TipArticle } from '@/services/tipsService';
import { radius, spacing, withShadow } from '@/constants/styles';
import { colors } from '@/styles/colors';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

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


export default function TipArticleScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  // Tips are served synchronously from a local fallback set, so the article is
  // derived from `id` during render instead of being loaded in an effect.
  const { tip, error } = useMemo<{ tip: TipArticle | null; error: string | null }>(() => {
    if (!id) return { tip: null, error: null };
    try {
      const fallbackTips = tipsService.getFallbackTips();
      const foundTip = fallbackTips.find((entry) => entry.id === id) ?? null;
      return { tip: foundTip, error: foundTip ? null : 'Article not found' };
    } catch (err) {
      return {
        tip: null,
        error: err instanceof Error ? err.message : 'Failed to load tip',
      };
    }
  }, [id]);

  if (!tip || error) {
    return (
      <View style={styles.root}>
        <Header
          options={{ title: t('tips.article'), showBackButton: true }}
        />
        <ErrorState
          icon="document-text-outline"
          title="Article unavailable"
          description={error ?? 'This tip could not be loaded.'}
          retryLabel="Go back"
          onRetry={() => router.back()}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Header
        options={{ title: t('tips.article'), showBackButton: true }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <LinearGradient
            colors={tip.gradientColors as [string, string]}
            style={styles.heroImage}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Ionicons
              name={tip.icon as IoniconName}
              size={56}
              color={colors.white}
            />
          </LinearGradient>
          <View style={styles.heroBadge}>
            <BloomText style={styles.heroBadgeText}>{tip.category}</BloomText>
          </View>
        </View>

        <View style={styles.articleBlock}>
          <SectionEyebrow>{tip.category}</SectionEyebrow>
          <H1 style={styles.articleTitle}>{tip.title}</H1>
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Ionicons name="time-outline" size={14} color={colors.muted} />
              <BloomText style={styles.metaText}>{tip.readTime}</BloomText>
            </View>
            <View style={styles.metaItem}>
              <Ionicons
                name="calendar-outline"
                size={14}
                color={colors.muted}
              />
              <BloomText style={styles.metaText}>{tip.publishDate}</BloomText>
            </View>
          </View>
          <BloomText style={styles.description}>{tip.description}</BloomText>
        </View>

        <View style={styles.articleBody}>{renderMarkdown(tip.content)}</View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
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
    ...withShadow('sm'),
  },
  heroImage: {
    width: '100%',
    height: 220,
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
});

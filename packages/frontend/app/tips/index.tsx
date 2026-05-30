/**
 * Tips index — editorial cards covering rental tips, guides, and rights.
 *
 * Stream Q polish:
 *   - Bloom Typography (H2/H3/Text) throughout, no raw RN <Text>.
 *   - Hand-rolled TouchableOpacity card swapped for Pressable + Bloom-styled
 *     hero block. Each card sits on a withShadow('sm') white surface with
 *     radius.xl image and radius.lg outer shell.
 *   - Skeleton via existing TipsSkeleton on load.
 *   - Adds a SectionEyebrow + H2 hero so the index reads like editorial.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { H2, H3, Text as BloomText } from '@oxyhq/bloom/typography';
import { Header } from '@/components/Header';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { ErrorState } from '@/components/ui/ErrorState';
import { TipsSkeleton } from '@/components/ui/skeletons/TipsSkeleton';
import { tipsService, TipArticle } from '@/services/tipsService';
import { radius, spacing, withShadow } from '@/constants/styles';
import { colors } from '@/styles/colors';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TipCard: React.FC<{ tip: TipArticle; onPress: () => void }> = ({
  tip,
  onPress,
}) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [styles.tipCard, pressed && styles.tipCardPressed]}
    accessibilityRole="button"
    accessibilityLabel={tip.title}
  >
    <View style={styles.tipImageContainer}>
      <LinearGradient
        colors={tip.gradientColors as [string, string]}
        style={styles.tipImage}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <Ionicons name={tip.icon as IoniconName} size={36} color={colors.white} />
      </LinearGradient>
      <View style={styles.tipCategoryBadge}>
        <BloomText style={styles.tipCategoryText}>{tip.category}</BloomText>
      </View>
    </View>

    <View style={styles.tipContent}>
      <H3 style={styles.tipTitle}>{tip.title}</H3>
      <BloomText style={styles.tipDescription} numberOfLines={2}>
        {tip.description}
      </BloomText>

      <View style={styles.tipMeta}>
        <View style={styles.tipMetaItem}>
          <Ionicons name="time-outline" size={14} color={colors.muted} />
          <BloomText style={styles.tipMetaText}>{tip.readTime}</BloomText>
        </View>
        <View style={styles.tipMetaItem}>
          <Ionicons name="calendar-outline" size={14} color={colors.muted} />
          <BloomText style={styles.tipMetaText}>{tip.publishDate}</BloomText>
        </View>
      </View>
    </View>
  </Pressable>
);

export default function TipsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [tipsData, setTipsData] = useState<TipArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadTips = async () => {
      setLoading(true);
      try {
        const fallbackTips = tipsService.getFallbackTips();
        if (cancelled) return;
        if (Array.isArray(fallbackTips)) {
          setTipsData(fallbackTips);
        } else {
          setTipsData([]);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load tips');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadTips();
    return () => {
      cancelled = true;
    };
  }, []);

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

        {loading ? (
          <TipsSkeleton itemCount={4} />
        ) : error ? (
          <ErrorState
            icon="cloud-offline-outline"
            title="Couldn't load tips"
            description={error}
            onRetry={() => setError(null)}
          />
        ) : (
          <View style={styles.grid}>
            {tipsData.map((tip) => (
              <TipCard
                key={tip.id}
                tip={tip}
                onPress={() => router.push(`/tips/${tip.id}`)}
              />
            ))}
          </View>
        )}
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
  grid: {
    gap: spacing.lg,
  },
  tipCard: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...withShadow('sm'),
  },
  tipCardPressed: {
    opacity: 0.92,
  },
  tipImageContainer: {
    position: 'relative',
    height: 180,
  },
  tipImage: {
    width: '100%',
    height: '100%',
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
  tipDescription: {
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
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

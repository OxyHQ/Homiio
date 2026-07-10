/**
 * RewardsTeaser — "level up, get rewarded" gamification teaser.
 *
 * Renders `REWARD_TIERS` (the single source of truth shared with the backend)
 * as a horizontally-scrolling rail of flat tier cards. Each card shows a
 * medal-tinted icon, the tier name + point threshold, and its perks (labels
 * resolved from i18n `agent.rewards.perks.*`). When a partner's current points
 * are supplied, the tier they've reached is highlighted and others read as
 * locked — so the same teaser doubles as a progress map on the dashboard.
 *
 * Flat sections, per-section gutter (the rail bleeds to the edge; the header
 * stays inset), image/icon-forward — consistent with the home merchandising.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useMediaQuery } from 'react-responsive';

import { H1, Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import {
  ICON_SIZES,
  radius,
  resolvePagePadding,
  spacing,
  tracker,
} from '@/constants/styles';
import {
  REWARD_TIERS,
  tierForPoints,
  type RewardTier,
  type RewardTierKey,
} from '@homiio/shared-types';

/**
 * Medal tints per tier. These are intentionally literal metal colors (bronze /
 * silver / gold / slate-platinum) — they are NOT Bloom status tokens, they're
 * the universally-recognised reward-tier palette, kept colocated so the rail
 * reads at a glance.
 */
const TIER_TINTS: Record<RewardTierKey, string> = {
  bronze: '#B08D57',
  silver: '#9AA1A9',
  gold: '#E0A500',
  platinum: '#5B6B7B',
};

interface TierCardProps {
  tier: RewardTier;
  name: string;
  pointsLabel: string;
  perks: string[];
  reached: boolean;
  isCurrent: boolean;
  width: number;
}

const TierCard: React.FC<TierCardProps> = ({
  tier,
  name,
  pointsLabel,
  perks,
  reached,
  isCurrent,
  width,
}) => {
  const tint = TIER_TINTS[tier.key];
  return (
    <View
      style={[
        styles.card,
        { width },
        isCurrent && { borderColor: colors.primaryColor, borderWidth: 2 },
      ]}
    >
      <View style={[styles.medal, { backgroundColor: `${tint}22` }]}>
        <Ionicons name="medal" size={ICON_SIZES.lg} color={tint} />
      </View>
      <View style={styles.cardHead}>
        <BloomText style={styles.tierName}>{name}</BloomText>
        <BloomText style={styles.tierPoints}>{pointsLabel}</BloomText>
      </View>
      <View style={styles.perks}>
        {perks.map((perk) => (
          <View key={perk} style={styles.perkRow}>
            <Ionicons
              name={reached ? 'checkmark-circle' : 'ellipse-outline'}
              size={ICON_SIZES.sm}
              color={reached ? colors.success : colors.COLOR_BLACK_LIGHT_5}
            />
            <BloomText style={styles.perkLabel}>{perk}</BloomText>
          </View>
        ))}
      </View>
    </View>
  );
};

interface RewardsTeaserProps {
  /**
   * Current partner points. When provided, the reached tier is highlighted and
   * unreached tiers read as locked. Omit (undefined) on the marketing teaser.
   */
  points?: number;
}

export const RewardsTeaser: React.FC<RewardsTeaserProps> = ({ points }) => {
  const { t } = useTranslation();
  const isWide = useMediaQuery({ minWidth: 768 });
  const horizontalPadding = resolvePagePadding(isWide);

  const currentTierKey =
    points !== undefined ? tierForPoints(points).key : undefined;

  const cardWidth = isWide ? 260 : 220;

  const tierName = (key: RewardTierKey): string => t(`agent.rewards.tiers.${key}`);

  return (
    <View>
      <View style={[styles.header, { paddingHorizontal: horizontalPadding }]}>
        <H1 style={styles.title}>
          {t('agent.rewards.title')}
        </H1>
        <BloomText style={styles.subtitle}>
          {t('agent.rewards.subtitle')}
        </BloomText>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.rail, { paddingHorizontal: horizontalPadding }]}
      >
        {REWARD_TIERS.map((tier) => {
          const reached = points !== undefined && points >= tier.minPoints;
          return (
            <TierCard
              key={tier.key}
              tier={tier}
              name={tierName(tier.key)}
              pointsLabel={t('agent.rewards.pointsLabel', { count: tier.minPoints })}
              perks={tier.perkKeys.map((perkKey) => t(`agent.rewards.perks.${perkKey}`))}
              reached={reached}
              isCurrent={currentTierKey === tier.key}
              width={cardWidth}
            />
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    marginBottom: spacing.xl,
    gap: spacing.xs,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    letterSpacing: tracker.tight,
    lineHeight: 34,
  },
  subtitle: {
    fontSize: 15,
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 22,
    maxWidth: 520,
  },
  rail: {
    gap: spacing.lg,
    paddingVertical: spacing.xs,
  },
  card: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.md,
  },
  medal: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHead: {
    gap: 2,
  },
  tierName: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    letterSpacing: tracker.tight,
  },
  tierPoints: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  perks: {
    gap: spacing.sm,
  },
  perkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  perkLabel: {
    flex: 1,
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_2,
    lineHeight: 19,
  },
});

export default RewardsTeaser;

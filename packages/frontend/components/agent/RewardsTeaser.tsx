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
import { useMediaQuery } from 'react-responsive';

import { Card } from '@oxy.so/bloom/card';
import {
  RiCheckboxBlankCircleLine,
  RiCheckboxCircleFill,
  RiVipCrownLine,
} from '@oxy.so/bloom/icons';
import { useTheme } from '@oxy.so/bloom/theme';
import { H1, Text as BloomText } from '@oxy.so/bloom/typography';

import { resolvePagePadding, spacing, tracker } from '@/constants/styles';
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
  const theme = useTheme();
  const tint = TIER_TINTS[tier.key];
  return (
    <Card
      variant="outlined"
      radius="radius-16"
      className="gap-3 p-5"
      style={[{ width }, isCurrent && { borderColor: theme.colors.primary, borderWidth: 2 }]}
    >
      <View style={[styles.medal, { backgroundColor: `${tint}22` }]}>
        <RiVipCrownLine width={24} height={24} fill={tint} />
      </View>
      <View style={styles.cardHead}>
        <BloomText variant="headline-bold" style={{ color: theme.colors.text }}>
          {name}
        </BloomText>
        <BloomText variant="body-2-semibold" style={{ color: theme.colors.textSecondary }}>
          {pointsLabel}
        </BloomText>
      </View>
      <View style={styles.perks}>
        {perks.map((perk) => {
          const PerkIcon = reached ? RiCheckboxCircleFill : RiCheckboxBlankCircleLine;
          return (
            <View key={perk} style={styles.perkRow}>
              <PerkIcon
                width={16}
                height={16}
                fill={reached ? theme.colors.success : theme.colors.textTertiary}
              />
              <BloomText
                variant="body-regular"
                style={{ flex: 1, color: theme.colors.textSecondary }}
              >
                {perk}
              </BloomText>
            </View>
          );
        })}
      </View>
    </Card>
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
  const theme = useTheme();
  const isWide = useMediaQuery({ minWidth: 768 });
  const horizontalPadding = resolvePagePadding(isWide);

  const currentTierKey = points !== undefined ? tierForPoints(points).key : undefined;

  const cardWidth = isWide ? 260 : 220;

  const tierName = (key: RewardTierKey): string => t(`agent.rewards.tiers.${key}`);

  return (
    <View>
      <View style={[styles.header, { paddingHorizontal: horizontalPadding }]}>
        <H1 style={[styles.title, { color: theme.colors.text }]}>{t('agent.rewards.title')}</H1>
        <BloomText style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
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
    letterSpacing: tracker.tight,
    lineHeight: 34,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 520,
  },
  rail: {
    gap: spacing.lg,
    paddingVertical: spacing.xs,
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
  perks: {
    gap: spacing.sm,
  },
  perkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});

export default RewardsTeaser;

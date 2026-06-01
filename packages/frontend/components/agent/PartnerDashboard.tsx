/**
 * PartnerDashboard — the signed-in partner's earnings & activity panel.
 *
 * Composed of:
 *  - a 4-up stat grid (referrals / listings / pending / earned),
 *  - a points + tier block with a progress bar toward the next tier (tier is
 *    derived from points via `tierForPoints`, never stored, so it always agrees
 *    with the backend),
 *  - recent referrals (sourced properties) and recent commissions (the ledger).
 *
 * Earnings are shown in the commission's own currency (EUR — the ledger's
 * denomination), not the user's display currency, so the dashboard never
 * mis-states a payout via FX. Loading and empty states are handled inline.
 */
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import { useMediaQuery } from 'react-responsive';

import { H1, Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import {
  hairline,
  ICON_SIZES,
  radius,
  resolvePagePadding,
  spacing,
  tracker,
} from '@/constants/styles';
import {
  REWARD_TIERS,
  tierForPoints,
  type Commission,
  type CommissionOffering,
  type CommissionStatus,
  type PartnerStats,
  type Property,
  type RewardTierKey,
} from '@homiio/shared-types';

interface PartnerDashboardProps {
  stats: PartnerStats;
  points: number;
  referrals: Property[];
  commissions: Commission[];
  referralsLoading: boolean;
  earningsLoading: boolean;
}

/** Format a major-unit amount as a whole-unit currency string. */
function formatMoney(amount: number, currency: string): string {
  return Math.round(amount).toLocaleString('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/**
 * A populated city reference may ride on the address when the backend expands
 * the geo relation (it is not on the base `Address` type, which only carries
 * `cityId`). We read it defensively — as a plain string or a `{ name }` object —
 * without assuming it is present, so the label survives the geo model migration.
 */
interface PopulatedCity {
  name?: string;
}

function readCityName(address: Property['address']): string | undefined {
  const city = (address as { city?: string | PopulatedCity }).city;
  if (typeof city === 'string') return city || undefined;
  if (city && typeof city === 'object' && typeof city.name === 'string') {
    return city.name || undefined;
  }
  return undefined;
}

/**
 * Resolve a readable address line from a sourced property. Prefers a populated
 * city name, then the building-level street, then falls back to the country
 * code — all tolerant of the in-flight geo model (only base `Address` fields are
 * required, the city is read defensively).
 */
function propertyLabel(property: Property): string {
  const address = property.address;
  if (!address) return '—';
  const city = readCityName(address);
  const street = address.street;
  if (city) return street ? `${street}, ${city}` : city;
  return street || address.countryCode || '—';
}

export const PartnerDashboard: React.FC<PartnerDashboardProps> = ({
  stats,
  points,
  referrals,
  commissions,
  referralsLoading,
  earningsLoading,
}) => {
  const { t } = useTranslation();
  const isWide = useMediaQuery({ minWidth: 768 });
  const horizontalPadding = resolvePagePadding(isWide);

  const currentTier = useMemo(() => tierForPoints(points), [points]);

  // Progress toward the next tier. At the top tier there is no "next", so the
  // bar reads full and the caption switches to a max-tier message.
  const nextTier = useMemo(() => {
    const idx = REWARD_TIERS.findIndex((tier) => tier.key === currentTier.key);
    return idx >= 0 && idx < REWARD_TIERS.length - 1
      ? REWARD_TIERS[idx + 1]
      : undefined;
  }, [currentTier]);

  const progress = useMemo(() => {
    if (!nextTier) return 1;
    const span = nextTier.minPoints - currentTier.minPoints;
    if (span <= 0) return 1;
    return Math.min(Math.max((points - currentTier.minPoints) / span, 0), 1);
  }, [nextTier, currentTier, points]);

  const tierName = (key: RewardTierKey): string => t(`agent.rewards.tiers.${key}`, key);

  const offeringLabel = (offering: CommissionOffering): string =>
    t(`agent.calculator.offerings.${offering}`, offering);

  const statusLabel = (status: CommissionStatus): string =>
    t(`agent.dashboard.status.${status}`, status);

  const statusColor = (status: CommissionStatus): string => {
    switch (status) {
      case 'paid':
        return colors.success;
      case 'approved':
        return colors.primaryColor;
      case 'cancelled':
        return colors.danger;
      case 'pending':
      default:
        return colors.warning;
    }
  };

  const stat = (label: string, value: string) => (
    <View style={styles.statCell}>
      <H1 style={styles.statValue}>{value}</H1>
      <BloomText style={styles.statLabel}>{label}</BloomText>
    </View>
  );

  const recentReferrals = referrals.slice(0, 4);
  const recentCommissions = commissions.slice(0, 4);

  return (
    <View style={{ paddingHorizontal: horizontalPadding }}>
      <View style={styles.panel}>
        <H1 style={styles.heading}>{t('agent.dashboard.title', 'Your dashboard')}</H1>

        {/* Stat grid */}
        <View style={styles.statGrid}>
          {stat(
            t('agent.dashboard.referrals', 'Referrals'),
            String(stats.referredCount),
          )}
          {stat(
            t('agent.dashboard.listings', 'Listings'),
            String(stats.activeListings),
          )}
          {stat(
            t('agent.dashboard.pending', 'Pending'),
            formatMoney(stats.pendingEarnings, stats.currency),
          )}
          {stat(
            t('agent.dashboard.earned', 'Earned'),
            formatMoney(stats.paidEarnings, stats.currency),
          )}
        </View>

        {/* Points + tier + progress */}
        <View style={styles.tierBlock}>
          <View style={styles.tierHead}>
            <View style={styles.tierBadge}>
              <Ionicons name="medal" size={ICON_SIZES.md} color={colors.primaryColor} />
              <BloomText style={styles.tierName}>{tierName(currentTier.key)}</BloomText>
            </View>
            <BloomText style={styles.pointsValue}>
              {t('agent.dashboard.pointsValue', '{{count}} pts', { count: points })}
            </BloomText>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
          <BloomText style={styles.progressCaption}>
            {nextTier
              ? t('agent.dashboard.toNext', '{{points}} pts to {{tier}}', {
                  points: Math.max(nextTier.minPoints - points, 0),
                  tier: tierName(nextTier.key),
                })
              : t('agent.dashboard.maxTier', "You've reached the top tier.")}
          </BloomText>
        </View>

        {/* Recent referrals */}
        <View style={styles.listBlock}>
          <BloomText style={styles.listTitle}>
            {t('agent.dashboard.recentReferrals', 'Your referrals')}
          </BloomText>
          {referralsLoading ? (
            <BloomText style={styles.muted}>{t('common.loading', 'Loading…')}</BloomText>
          ) : recentReferrals.length === 0 ? (
            <BloomText style={styles.muted}>
              {t('agent.dashboard.noReferrals', 'No referred listings yet — share your link to get started.')}
            </BloomText>
          ) : (
            recentReferrals.map((property) => (
              <View key={String(property._id ?? property.id)} style={styles.row}>
                <Ionicons
                  name="home-outline"
                  size={ICON_SIZES.md}
                  color={colors.COLOR_BLACK_LIGHT_3}
                />
                <BloomText style={styles.rowText} numberOfLines={1}>
                  {propertyLabel(property)}
                </BloomText>
              </View>
            ))
          )}
        </View>

        {/* Recent commissions (ledger) */}
        <View style={styles.listBlock}>
          <BloomText style={styles.listTitle}>
            {t('agent.dashboard.recentEarnings', 'Recent earnings')}
          </BloomText>
          {earningsLoading ? (
            <BloomText style={styles.muted}>{t('common.loading', 'Loading…')}</BloomText>
          ) : recentCommissions.length === 0 ? (
            <BloomText style={styles.muted}>
              {t('agent.dashboard.noEarnings', "No earnings yet — you'll see payouts here when a referred deal closes.")}
            </BloomText>
          ) : (
            recentCommissions.map((commission) => (
              <View key={commission.id} style={styles.ledgerRow}>
                <View style={styles.ledgerLeft}>
                  <BloomText style={styles.ledgerAmount}>
                    {formatMoney(commission.amount, commission.currency)}
                  </BloomText>
                  <BloomText style={styles.ledgerMeta}>
                    {`${offeringLabel(commission.basis.offering)} · ${format(
                      new Date(commission.createdAt),
                      'MMM d, yyyy',
                    )}`}
                  </BloomText>
                </View>
                <View
                  style={[
                    styles.statusPill,
                    { backgroundColor: `${statusColor(commission.status)}1A` },
                  ]}
                >
                  <BloomText
                    style={[styles.statusText, { color: statusColor(commission.status) }]}
                  >
                    {statusLabel(commission.status)}
                  </BloomText>
                </View>
              </View>
            ))
          )}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  panel: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.xl,
    borderWidth: hairline.width,
    borderColor: colors.border,
    padding: spacing['2xl'],
    gap: spacing.xl,
  },
  heading: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    letterSpacing: tracker.tight,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  statCell: {
    width: '50%',
    paddingVertical: spacing.md,
    gap: 2,
  },
  statValue: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.COLOR_BLACK,
    letterSpacing: tracker.tight,
    lineHeight: 30,
  },
  statLabel: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    fontWeight: '600',
  },
  tierBlock: {
    gap: spacing.sm,
    paddingTop: spacing.lg,
    borderTopWidth: hairline.width,
    borderTopColor: hairline.color,
  },
  tierHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tierBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  tierName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  pointsValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  progressTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
    overflow: 'hidden',
  },
  progressFill: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryColor,
  },
  progressCaption: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  listBlock: {
    gap: spacing.sm,
    paddingTop: spacing.lg,
    borderTopWidth: hairline.width,
    borderTopColor: hairline.color,
  },
  listTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    marginBottom: spacing.xs,
  },
  muted: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  ledgerLeft: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  ledgerAmount: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  ledgerMeta: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  statusPill: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
});

export default PartnerDashboard;

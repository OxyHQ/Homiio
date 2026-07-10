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
import { Ionicons } from '@expo/vector-icons';
import { useMediaQuery } from 'react-responsive';

import { H1, Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { formatCurrency } from '@/utils/currency';
import { formatLocalized } from '@/utils/dateLocale';
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

/**
 * Whole-unit display (no decimals) for the ledger amounts. Earnings are shown in
 * the commission's OWN currency, so `formatCurrency` is used without FX
 * conversion — it only renders the symbol + grouped amount.
 */
const WHOLE_CURRENCY = { minimumFractionDigits: 0, maximumFractionDigits: 0 } as const;

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

interface ListSectionProps {
  title: string;
  loading: boolean;
  isEmpty: boolean;
  loadingText: string;
  emptyText: string;
  children: React.ReactNode;
}

/**
 * A titled dashboard list with the shared loading / empty / content switch, so
 * the "recent referrals" and "recent earnings" blocks don't duplicate the
 * branching. The caller renders the populated rows as `children`.
 */
const ListSection: React.FC<ListSectionProps> = ({
  title,
  loading,
  isEmpty,
  loadingText,
  emptyText,
  children,
}) => (
  <View style={styles.listBlock}>
    <BloomText style={styles.listTitle}>{title}</BloomText>
    {loading ? (
      <BloomText style={styles.muted}>{loadingText}</BloomText>
    ) : isEmpty ? (
      <BloomText style={styles.muted}>{emptyText}</BloomText>
    ) : (
      children
    )}
  </View>
);

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
    const currentIndex = REWARD_TIERS.findIndex((tier) => tier.key === currentTier.key);
    return currentIndex >= 0 && currentIndex < REWARD_TIERS.length - 1
      ? REWARD_TIERS[currentIndex + 1]
      : undefined;
  }, [currentTier]);

  // 0–1 fraction toward the next tier (full at the top tier). `ProgressBar`
  // clamps for display, so no manual clamp is needed here — only the
  // divide-by-zero guard.
  const progress = useMemo(() => {
    if (!nextTier) return 1;
    const pointsBetweenTiers = nextTier.minPoints - currentTier.minPoints;
    if (pointsBetweenTiers <= 0) return 1;
    return (points - currentTier.minPoints) / pointsBetweenTiers;
  }, [nextTier, currentTier, points]);

  const tierName = (key: RewardTierKey): string => t(`agent.rewards.tiers.${key}`);

  const offeringLabel = (offering: CommissionOffering): string =>
    t(`agent.calculator.offerings.${offering}`);

  const statusLabel = (status: CommissionStatus): string =>
    t(`agent.dashboard.status.${status}`);

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

  // The 4-up summary grid. Counts render as-is; the two money figures are shown
  // in the ledger's own currency (no FX) via `formatCurrency`.
  const summaryCells: ReadonlyArray<{ key: string; label: string; value: string }> = [
    {
      key: 'referrals',
      label: t('agent.dashboard.referrals'),
      value: String(stats.referredCount),
    },
    {
      key: 'listings',
      label: t('agent.dashboard.listings'),
      value: String(stats.activeListings),
    },
    {
      key: 'pending',
      label: t('agent.dashboard.pending'),
      value: formatCurrency(stats.pendingEarnings, stats.currency, WHOLE_CURRENCY),
    },
    {
      key: 'earned',
      label: t('agent.dashboard.earned'),
      value: formatCurrency(stats.paidEarnings, stats.currency, WHOLE_CURRENCY),
    },
  ];

  const recentReferrals = referrals.slice(0, 4);
  const recentCommissions = commissions.slice(0, 4);

  return (
    <View style={{ paddingHorizontal: horizontalPadding }}>
      <View style={styles.panel}>
        <H1 style={styles.heading}>{t('agent.dashboard.title')}</H1>

        {/* Stat grid */}
        <View style={styles.statGrid}>
          {summaryCells.map((cell) => (
            <View key={cell.key} style={styles.statCell}>
              <H1 style={styles.statValue}>{cell.value}</H1>
              <BloomText style={styles.statLabel}>{cell.label}</BloomText>
            </View>
          ))}
        </View>

        {/* Points + tier + progress */}
        <View style={styles.tierBlock}>
          <View style={styles.tierHead}>
            <View style={styles.tierBadge}>
              <Ionicons name="medal" size={ICON_SIZES.md} color={colors.primaryColor} />
              <BloomText style={styles.tierName}>{tierName(currentTier.key)}</BloomText>
            </View>
            <BloomText style={styles.pointsValue}>
              {t('agent.dashboard.pointsValue', { count: points })}
            </BloomText>
          </View>
          <ProgressBar
            progress={progress}
            height={8}
            color={colors.primaryColor}
            backgroundColor={colors.COLOR_BLACK_LIGHT_7}
            borderRadius={radius.pill}
          />
          <BloomText style={styles.progressCaption}>
            {nextTier
              ? t('agent.dashboard.toNext', {
                  points: Math.max(nextTier.minPoints - points, 0),
                  tier: tierName(nextTier.key),
                })
              : t('agent.dashboard.maxTier')}
          </BloomText>
        </View>

        {/* Recent referrals */}
        <ListSection
          title={t('agent.dashboard.recentReferrals')}
          loading={referralsLoading}
          isEmpty={recentReferrals.length === 0}
          loadingText={t('common.loading')}
          emptyText={t('agent.dashboard.noReferrals')}
        >
          {recentReferrals.map((property) => (
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
          ))}
        </ListSection>

        {/* Recent commissions (ledger) */}
        <ListSection
          title={t('agent.dashboard.recentEarnings')}
          loading={earningsLoading}
          isEmpty={recentCommissions.length === 0}
          loadingText={t('common.loading')}
          emptyText={t('agent.dashboard.noEarnings')}
        >
          {recentCommissions.map((commission) => {
            const tint = statusColor(commission.status);
            return (
              <View key={commission.id} style={styles.ledgerRow}>
                <View style={styles.ledgerLeft}>
                  <BloomText style={styles.ledgerAmount}>
                    {formatCurrency(commission.amount, commission.currency, WHOLE_CURRENCY)}
                  </BloomText>
                  <BloomText style={styles.ledgerMeta}>
                    {`${offeringLabel(commission.basis.offering)} · ${formatLocalized(
                      new Date(commission.createdAt),
                      'MMM d, yyyy',
                    )}`}
                  </BloomText>
                </View>
                <View style={[styles.statusPill, { backgroundColor: `${tint}1A` }]}>
                  <BloomText style={[styles.statusText, { color: tint }]}>
                    {statusLabel(commission.status)}
                  </BloomText>
                </View>
              </View>
            );
          })}
        </ListSection>
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

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
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMediaQuery } from 'react-responsive';

import { Card } from '@oxy.so/bloom/card';
import { Chip, type ChipHue } from '@oxy.so/bloom/chip';
import { Divider } from '@oxy.so/bloom/divider';
import {
  RiBuilding2Line,
  RiCoinsLine,
  RiHandCoinLine,
  RiHome4Line,
  RiUserAddLine,
  RiVipCrownLine,
} from '@oxy.so/bloom/icons';
import { Item } from '@oxy.so/bloom/item';
import { Loading } from '@oxy.so/bloom/loading';
import { StatBar } from '@oxy.so/bloom/stat-bar';
import { StatCards, type StatCardsItem } from '@oxy.so/bloom/stat-cards';
import { useTheme } from '@oxy.so/bloom/theme';
import { H2, Text as BloomText } from '@oxy.so/bloom/typography';

import { formatMoney } from '@homiio/shared-types';
import { useFormatting } from '@/utils/format';
import { formatLocalized } from '@/utils/dateLocale';
import { resolvePagePadding } from '@/constants/styles';
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
 * the commission's OWN currency, so `formatMoney` is used without FX
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
  emptyText,
  children,
}) => {
  const theme = useTheme();
  return (
    <View className="gap-2">
      <Divider />
      <BloomText variant="headline-semibold" style={{ color: theme.colors.text }}>
        {title}
      </BloomText>
      {loading ? (
        <Loading size="small" />
      ) : isEmpty ? (
        <BloomText variant="body-regular" style={{ color: theme.colors.textSecondary }}>
          {emptyText}
        </BloomText>
      ) : (
        children
      )}
    </View>
  );
};

/** Ledger status → Bloom Chip data hue. */
const STATUS_HUE: Record<CommissionStatus, ChipHue> = {
  paid: 'lime',
  approved: 'blue',
  cancelled: 'rose',
  pending: 'yellow',
};

export const PartnerDashboard: React.FC<PartnerDashboardProps> = ({
  stats,
  points,
  referrals,
  commissions,
  referralsLoading,
  earningsLoading,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const { locale } = useFormatting();
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

  // 0–1 fraction toward the next tier (full at the top tier). `StatBar`
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

  const statusLabel = (status: CommissionStatus): string => t(`agent.dashboard.status.${status}`);

  // The KPI cards. Counts render as-is; the two money figures are shown in the
  // ledger's own currency (no FX) via `formatMoney`. Each card's chip carries a
  // derived, copy-free companion figure: points earned, the live share of
  // referrals, the pending share of all earnings, and the current tier.
  const summaryCards = useMemo<StatCardsItem[]>(() => {
    const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
    const liveShare = stats.referredCount > 0 ? stats.activeListings / stats.referredCount : 0;
    const totalEarnings = stats.pendingEarnings + stats.paidEarnings;
    const pendingShare = totalEarnings > 0 ? stats.pendingEarnings / totalEarnings : 0;
    return [
      {
        icon: RiUserAddLine,
        label: t('agent.dashboard.referrals'),
        value: String(stats.referredCount),
        delta: t('agent.dashboard.pointsValue', { count: points }),
        deltaColor: points > 0 ? 'lime' : 'neutral',
      },
      {
        icon: RiBuilding2Line,
        label: t('agent.dashboard.listings'),
        value: String(stats.activeListings),
        delta: percent.format(liveShare),
        deltaColor: 'neutral',
      },
      {
        icon: RiHandCoinLine,
        label: t('agent.dashboard.pending'),
        value: formatMoney(stats.pendingEarnings, stats.currency, locale, WHOLE_CURRENCY),
        delta: percent.format(pendingShare),
        deltaColor: 'neutral',
      },
      {
        icon: RiCoinsLine,
        label: t('agent.dashboard.earned'),
        value: formatMoney(stats.paidEarnings, stats.currency, locale, WHOLE_CURRENCY),
        delta: t(`agent.rewards.tiers.${currentTier.key}`),
        deltaColor: stats.paidEarnings > 0 ? 'lime' : 'neutral',
      },
    ];
  }, [stats, points, currentTier, locale, t]);

  const recentReferrals = referrals.slice(0, 4);
  const recentCommissions = commissions.slice(0, 4);

  return (
    <View style={{ paddingHorizontal: horizontalPadding }}>
      <Card
        variant="outlined"
        radius="radius-24"
        className="w-full max-w-[720px] self-center gap-6 p-6"
      >
        <H2 style={{ color: theme.colors.text }}>{t('agent.dashboard.title')}</H2>

        <StatCards stats={summaryCards} columns={2} />

        {/* Points + tier + progress */}
        <View className="gap-2">
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-row items-center gap-2">
              <RiVipCrownLine width={20} height={20} fill={theme.colors.primary} />
              <BloomText variant="headline-semibold" style={{ color: theme.colors.text }}>
                {tierName(currentTier.key)}
              </BloomText>
            </View>
            <Chip size="medium" hue="gray">
              {t('agent.dashboard.pointsValue', { count: points })}
            </Chip>
          </View>
          {/* The caption is the bar's label: StatBar requires one, and it is
              exactly what the bar measures. */}
          <StatBar
            label={
              nextTier
                ? t('agent.dashboard.toNext', {
                    points: Math.max(nextTier.minPoints - points, 0),
                    tier: tierName(nextTier.key),
                  })
                : t('agent.dashboard.maxTier')
            }
            value={progress}
            max={1}
            height={8}
          />
        </View>

        {/* Recent referrals */}
        <ListSection
          title={t('agent.dashboard.recentReferrals')}
          loading={referralsLoading}
          isEmpty={recentReferrals.length === 0}
          emptyText={t('agent.dashboard.noReferrals')}
        >
          {recentReferrals.map((property) => (
            <Item
              key={String(property.id)}
              density="compact"
              leading={<RiHome4Line width={20} height={20} fill={theme.colors.icon} />}
              title={propertyLabel(property)}
            />
          ))}
        </ListSection>

        {/* Recent commissions (ledger) */}
        <ListSection
          title={t('agent.dashboard.recentEarnings')}
          loading={earningsLoading}
          isEmpty={recentCommissions.length === 0}
          emptyText={t('agent.dashboard.noEarnings')}
        >
          {recentCommissions.map((commission) => (
            <Item
              key={commission.id}
              density="compact"
              title={formatMoney(commission.amount, commission.currency, locale, WHOLE_CURRENCY)}
              subtitle={`${offeringLabel(commission.basis.offering)} · ${formatLocalized(
                new Date(commission.createdAt),
                'MMM d, yyyy',
              )}`}
              trailing={
                <Chip size="medium" hue={STATUS_HUE[commission.status] ?? 'yellow'}>
                  {statusLabel(commission.status)}
                </Chip>
              }
            />
          ))}
        </ListSection>
      </Card>
    </View>
  );
};

export default PartnerDashboard;

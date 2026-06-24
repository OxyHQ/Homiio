/**
 * Donate screen — Airbnb-2026 layout.
 *
 * The HERO (the rounded `LinearGradient` pill at the top) is intentionally
 * preserved. Everything BELOW it is flat, image-forward, and sits directly on
 * the app `colors.background` (no cardy shadows / borders):
 *
 *  - Contribution picker: a frequency `SegmentedControl` (one-time / monthly)
 *    + a flat selectable tier list (radio rows, not 3 bordered cards), driving
 *    a SINGLE primary Bloom `Button` CTA whose label tracks the selection.
 *  - "What your support enables": a flat `DetailIconGrid` icon list (reused
 *    from the property-detail design system) — no grey card.
 *  - Mission: one concise lead line + a flat checklist of goals.
 *
 * Each tier maps 1:1 to a billing product (`file` / `plus` / `founder`); the
 * CTA opens the existing Stripe checkout session for the selected product. The
 * checkout endpoint is `/api/billing/checkout` (the same one the subscription
 * store uses) — the previous `/api/billing/create-checkout-session` path was
 * never mounted, so the old flow 404'd.
 */
import React, { useMemo, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import { Button } from '@oxyhq/bloom/button';
import {
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlItemText,
} from '@oxyhq/bloom/segmented-control';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { Header } from '@/components/Header';
import { Section } from '@/components/property/Section';
import {
  DetailIconGrid,
  DetailIconCell,
  DetailIconRow,
  DETAIL_ICON_SIZE,
} from '@/components/property/DetailIconGrid';
import { TierRow } from '@/components/donate/TierRow';
import { colors } from '@/styles/colors';
import { hairline, radius, spacing, tracker } from '@/constants/styles';
import { api } from '@/utils/api';
import { logger } from '@/utils/logger';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

/** Donation frequency — drives which tiers are offered. */
type DonationFrequency = 'one-time' | 'monthly';

/** Billing products the checkout endpoint accepts (1:1 with a tier). */
type DonationProduct = 'file' | 'plus' | 'founder';

type DonationTier = {
  id: string;
  product: DonationProduct;
  frequency: DonationFrequency;
  title: string;
  subtitle: string;
  amount: number;
  currency: string;
  ctaLabel: string;
};

type ImpactArea = {
  icon: IoniconName;
  title: string;
};

export default function DonatePage() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [frequency, setFrequency] = useState<DonationFrequency>('monthly');

  const tiers = useMemo<DonationTier[]>(
    () => [
      {
        id: 'one-time-5',
        product: 'file',
        frequency: 'one-time',
        title: t('donations.page.tiers.supporter.title'),
        subtitle: t('donations.page.tiers.supporter.subtitle'),
        amount: 5,
        currency: '€',
        ctaLabel: t('donations.page.tiers.supporter.button'),
      },
      {
        id: 'monthly-10',
        product: 'plus',
        frequency: 'monthly',
        title: t('donations.page.tiers.monthly.title'),
        subtitle: t('donations.page.tiers.monthly.subtitle'),
        amount: 10,
        currency: '€',
        ctaLabel: t('donations.page.tiers.monthly.button'),
      },
      {
        id: 'founder-25',
        product: 'founder',
        frequency: 'monthly',
        title: t('donations.page.tiers.founder.title'),
        subtitle: t('donations.page.tiers.founder.subtitle'),
        amount: 25,
        currency: '€',
        ctaLabel: t('donations.page.tiers.founder.button'),
      },
    ],
    [t],
  );

  const impactAreas = useMemo<ImpactArea[]>(
    () => [
      { icon: 'construct-outline', title: t('donations.page.impact.areas.development.title') },
      { icon: 'shield-checkmark-outline', title: t('donations.page.impact.areas.safety.title') },
      { icon: 'document-text-outline', title: t('donations.page.impact.areas.legal.title') },
      { icon: 'bulb-outline', title: t('donations.page.impact.areas.innovation.title') },
      { icon: 'people-outline', title: t('donations.page.impact.areas.community.title') },
    ],
    [t],
  );

  const missionGoals = useMemo<string[]>(
    () => t('donations.page.mission.goals', { returnObjects: true }) as string[],
    [t],
  );

  const visibleTiers = useMemo(
    () => tiers.filter((tier) => tier.frequency === frequency),
    [tiers, frequency],
  );

  // Keep the selection valid for the active frequency. When the segmented
  // control flips, default to the first tier of that frequency (derived, no
  // effect needed).
  const [selectedTierId, setSelectedTierId] = useState<string>('monthly-10');
  const selectedTier =
    visibleTiers.find((tier) => tier.id === selectedTierId) ?? visibleTiers[0];

  const handleFrequencyChange = (next: DonationFrequency) => {
    setFrequency(next);
    const firstOfNext = tiers.find((tier) => tier.frequency === next);
    if (firstOfNext) setSelectedTierId(firstOfNext.id);
  };

  const handleDonate = async () => {
    if (!selectedTier) return;
    try {
      setLoading(true);
      const { data } = await api.post<{ success: boolean; url?: string; error?: { message?: string } }>(
        '/api/billing/checkout',
        { product: selectedTier.product },
      );
      if (data?.success && data.url) {
        await Linking.openURL(data.url);
      } else {
        throw new Error(data?.error?.message || t('donations.page.error.generic'));
      }
    } catch (error: unknown) {
      logger.error('Donation error:', error);
      const message = error instanceof Error ? error.message : t('donations.page.error.generic');
      Alert.alert(t('donations.page.error.title'), message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <Header
        options={{
          title: t('donations.page.title'),
          showBackButton: true,
        }}
      />

      <SafeAreaView style={styles.flex} edges={['bottom']}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero — preserved. */}
          <LinearGradient colors={[colors.info, colors.info + '90']} style={styles.heroSection}>
            <Ionicons name="heart" size={48} color={colors.white} />
            <BloomText style={styles.heroTitle}>{t('donations.page.subtitle')}</BloomText>
            <BloomText style={styles.heroDescription}>{t('donations.page.description')}</BloomText>
          </LinearGradient>

          {/* Contribution picker — frequency toggle + flat tier list. */}
          <View style={[styles.section, styles.firstSection]}>
            <Section
              title={t('donations.page.chooseContribution')}
              bodyStyle={styles.pickerBody}
            >
              <SegmentedControl<DonationFrequency>
                label={t('donations.page.frequency.label')}
                type="tabs"
                value={frequency}
                onChange={handleFrequencyChange}
              >
                <SegmentedControlItem value="monthly">
                  <SegmentedControlItemText>
                    {t('donations.page.frequency.monthly')}
                  </SegmentedControlItemText>
                </SegmentedControlItem>
                <SegmentedControlItem value="one-time">
                  <SegmentedControlItemText>
                    {t('donations.page.frequency.oneTime')}
                  </SegmentedControlItemText>
                </SegmentedControlItem>
              </SegmentedControl>

              <View style={styles.tierList}>
                {visibleTiers.map((tier) => (
                  <TierRow
                    key={tier.id}
                    title={tier.title}
                    subtitle={tier.subtitle}
                    amount={tier.amount}
                    currency={tier.currency}
                    periodLabel={
                      tier.frequency === 'monthly' ? t('donations.page.frequency.perMonth') : undefined
                    }
                    selected={selectedTier?.id === tier.id}
                    onSelect={() => setSelectedTierId(tier.id)}
                  />
                ))}
              </View>

              <Button
                variant="primary"
                size="large"
                onPress={handleDonate}
                loading={loading}
                disabled={!selectedTier}
                style={styles.cta}
                icon={<Ionicons name="heart" size={18} color={colors.primaryForeground} />}
              >
                {selectedTier?.ctaLabel ?? t('donations.page.tiers.monthly.button')}
              </Button>
            </Section>
          </View>

          {/* What your support enables — flat icon list. */}
          <View style={[styles.section, styles.divider]}>
            <Section title={t('donations.page.impact.title')}>
              <DetailIconGrid>
                {impactAreas.map((area) => (
                  <DetailIconCell key={area.title}>
                    <DetailIconRow
                      icon={
                        <Ionicons
                          name={area.icon}
                          size={DETAIL_ICON_SIZE}
                          color={colors.COLOR_BLACK_LIGHT_1}
                        />
                      }
                      label={area.title}
                    />
                  </DetailIconCell>
                ))}
              </DetailIconGrid>
            </Section>
          </View>

          {/* Mission — concise lead + flat checklist. */}
          <View style={[styles.section, styles.divider]}>
            <Section
              title={t('donations.page.mission.title')}
              subtitle={t('donations.page.mission.description')}
            >
              <View style={styles.goalList}>
                {missionGoals.map((goal) => (
                  <View key={goal} style={styles.goalRow}>
                    <Ionicons name="checkmark-circle" size={20} color={colors.primaryColor} />
                    <BloomText style={styles.goalText}>{goal}</BloomText>
                  </View>
                ))}
              </View>
            </Section>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing['6xl'],
  },
  // Hero — preserved from the previous design.
  heroSection: {
    padding: spacing['2xl'],
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    borderRadius: 200,
    paddingHorizontal: 35,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.white,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  heroDescription: {
    fontSize: 16,
    color: colors.white,
    textAlign: 'center',
    marginTop: spacing.md,
    opacity: 0.9,
    lineHeight: 22,
  },
  // Flat section rhythm — matches the property-detail page: equal vertical
  // breathing room, a single hairline between blocks, content on the page bg.
  section: {
    paddingVertical: spacing['2xl'],
  },
  firstSection: {
    paddingTop: spacing['3xl'],
  },
  divider: {
    borderTopWidth: hairline.width,
    borderTopColor: hairline.color,
  },
  pickerBody: {
    gap: spacing.xl,
  },
  tierList: {
    gap: spacing.sm,
  },
  cta: {
    width: '100%',
    borderRadius: radius.pill,
  },
  goalList: {
    gap: spacing.md,
  },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  goalText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    color: colors.COLOR_BLACK_LIGHT_2,
    letterSpacing: tracker.normal,
  },
});

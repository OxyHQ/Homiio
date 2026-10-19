/**
 * "Earn with Homiio" — the always-on agent (Partner) recruitment + dashboard
 * screen (route `/agent`), Airbnb-2026 style.
 *
 * State-aware, all derived from `usePartnerMe()` + Oxy auth (no `useEffect`):
 *
 *   signed out          → hero CTA "Start earning" opens the Oxy sign-in modal.
 *   signed in, no partner → hero CTA "Start earning" runs the join mutation;
 *                           on success the cache flips to `partner != null` and
 *                           the link card + dashboard reveal automatically.
 *   signed in, partner   → hero CTA "Share your link" scrolls to / surfaces the
 *                           referral card; the dashboard renders below.
 *
 * Section order: hero → how-it-works → earnings calculator → rewards teaser →
 * (partner only) referral link + dashboard → closing CTA banner. Sections are
 * flat with per-section gutter inside the page's `ScreenScrollView`.
 */
import React, { useCallback, useMemo } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
import { useOxy } from '@oxy.so/services/ui/client';

import { AgentHero } from '@/components/agent/AgentHero';
import { AgentHowItWorks } from '@/components/agent/AgentHowItWorks';
import { EarningsCalculator } from '@/components/agent/EarningsCalculator';
import { RewardsTeaser } from '@/components/agent/RewardsTeaser';
import { ReferralLinkCard } from '@/components/agent/ReferralLinkCard';
import { PartnerDashboard } from '@/components/agent/PartnerDashboard';
import { CtaBanner } from '@/components/CtaBanner';
import { usePartnerMe, useJoinPartner, useReferrals, useEarnings } from '@/hooks/usePartner';
import { shareReferralLink } from '@/utils/shareReferral';
import { toast } from '@oxy.so/bloom/toast';

export default function AgentScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isAuthenticated, openAccountDialog } = useOxy();

  const meQuery = usePartnerMe();
  const joinMutation = useJoinPartner();

  // Derived state — the single source of truth for which sections render.
  const partner = meQuery.data?.partner ?? null;
  const link = meQuery.data?.link ?? null;
  const stats = meQuery.data?.stats ?? null;
  const isPartner = partner !== null;

  const referralsQuery = useReferrals(isPartner);
  const earningsQuery = useEarnings(isPartner);

  // CTA copy + behaviour by state.
  const ctaLabel = useMemo(() => {
    if (!isAuthenticated || !isPartner) {
      return t('agent.cta.start');
    }
    return t('agent.cta.share');
  }, [isAuthenticated, isPartner, t]);

  const handleHeroCta = useCallback(async () => {
    if (!isAuthenticated) {
      // Logged-out visitor — prompt sign-in. After auth the "me" query enables
      // and the screen re-derives to the not-joined state.
      openAccountDialog();
      return;
    }
    if (!isPartner) {
      joinMutation.mutate(undefined, {
        onError: () => {
          toast.error(t('agent.join.error'));
        },
      });
      return;
    }
    // Already a partner — share the link straight from the hero (same behaviour
    // as the ReferralLinkCard's Share button, via the shared helper).
    if (link) {
      const outcome = await shareReferralLink({
        link,
        message: t('agent.referral.shareMessage', {
          link,
        }),
        title: t('agent.referral.shareTitle'),
      });
      if (outcome === 'copied') {
        toast.success(t('agent.referral.copied'));
      } else if (outcome === 'failed') {
        toast.error(t('agent.referral.shareFailed'));
      }
    }
  }, [isAuthenticated, isPartner, link, joinMutation, t, openAccountDialog]);

  return (
    <Screen
      documentScroll
      header={
        <PageHeader
          title={t('agent.menu.title')}
          titleAlign="center"
          leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
          onBack={router.canGoBack() ? router.back : undefined}
          backLabel={t('goBack')}
          transparent
          titleReveal="onScroll"
        />
      }
    >
      <ScreenScrollView>
        <AgentHero
          title={t('agent.hero.title')}
          subtitle={t('agent.hero.subtitle')}
          ctaLabel={ctaLabel}
          onPressCta={handleHeroCta}
          ctaLoading={joinMutation.isPending}
          trustLine={t('agent.hero.trust')}
        />

        {/* Section rhythm owned here by NativeWind `gap` (24px mobile / 32px
              web); post-hero sections only. Hero sits outside so it does not
              participate in the gap stack. */}
        <View className="gap-6 md:gap-8 pb-20">
          <AgentHowItWorks />

          <EarningsCalculator />

          <RewardsTeaser points={partner?.points} />

          {/* Partner-only: referral link + dashboard. Rendered only once the
                join has succeeded (or on a returning partner) — derived purely
                from the query, no effect. */}
          {isPartner && link ? <ReferralLinkCard link={link} /> : null}

          {isPartner && stats ? (
            <PartnerDashboard
              stats={stats}
              points={partner?.points ?? 0}
              referrals={referralsQuery.data ?? []}
              commissions={earningsQuery.data ?? []}
              referralsLoading={referralsQuery.isLoading}
              earningsLoading={earningsQuery.isLoading}
            />
          ) : null}

          <View className="px-4 md:px-8">
            <CtaBanner
              title={t('agent.banner.title')}
              subtitle={t('agent.banner.subtitle')}
              ctaLabel={t('agent.banner.cta')}
              image={require('@/assets/images/cta-agent.jpg')}
              trustLine={t('agent.banner.trust')}
              onPress={handleHeroCta}
            />
          </View>
        </View>
      </ScreenScrollView>
    </Screen>
  );
}

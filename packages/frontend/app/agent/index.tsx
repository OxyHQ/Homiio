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
 * flat with per-section gutter; the page root is the app background.
 */
import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useMediaQuery } from 'react-responsive';
import { showSignInModal, useOxy } from '@oxyhq/services';

import { Header } from '@/components/Header';
import { AgentHero } from '@/components/agent/AgentHero';
import { AgentHowItWorks } from '@/components/agent/AgentHowItWorks';
import { EarningsCalculator } from '@/components/agent/EarningsCalculator';
import { RewardsTeaser } from '@/components/agent/RewardsTeaser';
import { ReferralLinkCard } from '@/components/agent/ReferralLinkCard';
import { PartnerDashboard } from '@/components/agent/PartnerDashboard';
import { AgentCtaBanner } from '@/components/agent/AgentCtaBanner';
import { usePartnerMe, useJoinPartner, useReferrals, useEarnings } from '@/hooks/usePartner';
import { shareReferralLink } from '@/utils/shareReferral';
import { toast } from '@/lib/sonner';
import { colors } from '@/styles/colors';
import { resolveSectionSpacing, spacing } from '@/constants/styles';

export default function AgentScreen() {
  const { t } = useTranslation();
  const { isAuthenticated } = useOxy();
  const isWide = useMediaQuery({ minWidth: 768 });
  const sectionGap = resolveSectionSpacing(isWide);

  // Drive the transparent Header's scroll-in background from this screen's own
  // scroll position (the screen isn't inside the shared layout scroll context).
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

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
      return t('agent.cta.start', 'Start earning');
    }
    return t('agent.cta.share', 'Share your link');
  }, [isAuthenticated, isPartner, t]);

  const handleHeroCta = useCallback(async () => {
    if (!isAuthenticated) {
      // Logged-out visitor — prompt sign-in. After auth the "me" query enables
      // and the screen re-derives to the not-joined state.
      showSignInModal();
      return;
    }
    if (!isPartner) {
      joinMutation.mutate();
      return;
    }
    // Already a partner — share the link straight from the hero (same behaviour
    // as the ReferralLinkCard's Share button, via the shared helper).
    if (link) {
      const outcome = await shareReferralLink({
        link,
        message: t('agent.referral.shareMessage', 'List your home on Homiio: {{link}}', {
          link,
        }),
        title: t('agent.referral.shareTitle', 'Earn with Homiio'),
      });
      if (outcome === 'copied') {
        toast.success(t('agent.referral.copied', 'Link copied'));
      } else if (outcome === 'failed') {
        toast.error(t('agent.referral.shareFailed', 'Could not share the link'));
      }
    }
  }, [isAuthenticated, isPartner, link, joinMutation, t]);

  return (
    <View style={styles.root}>
      <Header options={{ transparent: true, showBackButton: true }} scrollY={scrollY} />

      <Animated.ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        <AgentHero
          title={t('agent.hero.title', 'Anyone can be a real estate agent.')}
          subtitle={t(
            'agent.hero.subtitle',
            'Bring a home to Homiio. When it rents or sells, you earn.',
          )}
          ctaLabel={ctaLabel}
          onPressCta={handleHeroCta}
          ctaLoading={joinMutation.isPending}
          trustLine={t('agent.hero.trust', 'No license needed. Work from your phone.')}
        />

        <View style={{ marginTop: sectionGap }}>
          <AgentHowItWorks />
        </View>

        <View style={{ marginTop: sectionGap }}>
          <EarningsCalculator />
        </View>

        <View style={{ marginTop: sectionGap }}>
          <RewardsTeaser points={partner?.points} />
        </View>

        {/* Partner-only: referral link + dashboard. Rendered only once the
            join has succeeded (or on a returning partner) — derived purely from
            the query, no effect. */}
        {isPartner && link ? (
          <View style={{ marginTop: sectionGap }}>
            <ReferralLinkCard link={link} />
          </View>
        ) : null}

        {isPartner && stats ? (
          <View style={{ marginTop: sectionGap }}>
            <PartnerDashboard
              stats={stats}
              points={partner?.points ?? 0}
              referrals={referralsQuery.data ?? []}
              commissions={earningsQuery.data ?? []}
              referralsLoading={referralsQuery.isLoading}
              earningsLoading={earningsQuery.isLoading}
            />
          </View>
        ) : null}

        <View style={{ marginTop: sectionGap }}>
          <AgentCtaBanner
            title={t('agent.banner.title', 'Start today. No license needed.')}
            subtitle={t('agent.banner.subtitle', 'Turn the homes around you into income.')}
            ctaLabel={t('agent.banner.cta', 'Become an agent')}
            trustLine={t('agent.banner.trust', 'No license needed. Work from your phone.')}
            onPress={handleHeroCta}
          />
        </View>
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingBottom: spacing['6xl'],
  },
});

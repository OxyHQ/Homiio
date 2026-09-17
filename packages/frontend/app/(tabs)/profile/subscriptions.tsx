/**
 * Profile → Subscriptions: the three billing products (pay per contract,
 * Homiio+, founder supporter) as Bloom `Card`s with Bloom `Button` CTAs.
 *
 * Info and errors are `toast`s; the one destructive decision (cancel the
 * subscription immediately) is a Bloom `confirm()`, which — unlike the
 * `Alert.alert` with buttons it replaced — also works on web.
 */
import React, { useEffect } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useOxy } from '@oxy.so/services';

import { Badge } from '@oxy.so/bloom/badge';
import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import { IconCircle } from '@oxy.so/bloom/icon-circle';
import {
  RiCheckboxCircleFill,
  RiFileTextLine,
  RiHeartLine,
  RiStarLine,
} from '@oxy.so/bloom/icons';
import { SettingsListGroup, SettingsListItem } from '@oxy.so/bloom/settings-list';
import { confirm } from '@oxy.so/bloom/surfaces';
import { useTheme } from '@oxy.so/bloom/theme';
import { toast } from '@oxy.so/bloom/toast';
import { H1, H3, Text as BloomText } from '@oxy.so/bloom/typography';

import { Header } from '@/components/Header';
import { contentClamp, spacing } from '@/constants/styles';
import { useSubscriptionStore } from '@/store/subscriptionStore';
import { api } from '@/utils/api';
import { getFormatLocale } from '@/utils/dateLocale';
import { logger } from '@/utils/logger';

type IconComponent = React.ComponentType<{ width?: number; height?: number; fill?: string }>;

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

export default function SubscriptionsScreen() {
  const { t, i18n } = useTranslation();
  const { colors: theme } = useTheme();
  const { oxyServices, activeSessionId } = useOxy();

  const {
    entitlements,
    isLoading,
    error,
    loadingStates,
    fetchEntitlements,
    startCheckout,
    openCustomerPortal,
    syncSubscription,
    cancelSubscription,
    resetError,
  } = useSubscriptionStore();

  // Fetch entitlements on mount
  useEffect(() => {
    if (oxyServices && activeSessionId) {
      fetchEntitlements(oxyServices, activeSessionId);
    }
  }, [oxyServices, activeSessionId, fetchEntitlements]);

  // Surface store errors
  useEffect(() => {
    if (error) {
      toast.error(error);
      resetError();
    }
  }, [error, resetError]);

  const plusActive = entitlements?.plusActive || false;
  const plusSince = entitlements?.plusSince;
  const plusCanceledAt = entitlements?.plusCanceledAt;
  const fileCredits = entitlements?.fileCredits || 0;
  const lastPayment = entitlements?.lastPaymentAt;
  const checkoutBusy = loadingStates.checkout;

  const onRefresh = async () => {
    if (oxyServices && activeSessionId) {
      await fetchEntitlements(oxyServices, activeSessionId);
    }
  };

  /** Runs `action` with a session, or explains why it cannot. */
  const withSession = async (
    action: (services: NonNullable<typeof oxyServices>, sessionId: string) => Promise<void>,
  ) => {
    if (!oxyServices || !activeSessionId) {
      toast.error(t('subscriptions.authRequired'));
      return;
    }
    await action(oxyServices, activeSessionId);
  };

  const handleStartCheckout = (product: 'plus' | 'file' | 'founder') =>
    withSession(async (services, sessionId) => {
      try {
        await startCheckout(product, services, sessionId);
      } catch (checkoutError: unknown) {
        logger.error('Failed to start checkout:', checkoutError);
        toast.error(getErrorMessage(checkoutError, t('subscriptions.checkoutFailed')));
      }
    });

  const handleManageSubscription = () =>
    withSession(async (services, sessionId) => {
      try {
        await openCustomerPortal(services, sessionId);
      } catch (portalError: unknown) {
        logger.error('Failed to open subscription management:', portalError);
        toast.error(getErrorMessage(portalError, t('subscriptions.portalFailed')));
      }
    });

  const handleSyncSubscription = () =>
    withSession(async (services, sessionId) => {
      try {
        await syncSubscription(services, sessionId);
        toast.success(t('subscriptions.syncSuccess'));
      } catch (syncError: unknown) {
        logger.error('Failed to sync subscription:', syncError);
        toast.error(getErrorMessage(syncError, t('subscriptions.syncFailed')));
      }
    });

  const handleCancelSubscription = (immediate: boolean) =>
    withSession(async (services, sessionId) => {
      if (immediate) {
        const ok = await confirm({
          title: t('subscriptions.page.cancelImmediateTitle'),
          description: t('subscriptions.page.cancelImmediateBody'),
          confirmLabel: t('subscriptions.page.yesCancelNow'),
          cancelLabel: t('subscriptions.page.no'),
          destructive: true,
        });
        if (!ok) return;
      }
      try {
        await cancelSubscription(immediate, services, sessionId);
        toast.success(
          immediate
            ? t('subscriptions.cancelImmediateSuccess')
            : t('subscriptions.cancelEndOfPeriodSuccess'),
        );
      } catch (cancelError: unknown) {
        logger.error('Failed to cancel subscription:', cancelError);
        toast.error(getErrorMessage(cancelError, t('subscriptions.cancelFailed')));
      }
    });

  const handleDebugSubscription = async () => {
    try {
      const response = await api.get('/api/billing/debug-subscription');
      if (response.data.success) {
        const info = response.data.debugInfo;
        toast.info('Debug Info', {
          description:
            `Database Active: ${info.database.plusActive}\n` +
            `Stripe Status: ${info.stripe?.status || 'Error'}\n` +
            `Cancel at Period End: ${info.stripe?.cancel_at_period_end || 'N/A'}\n` +
            `Needs Sync: ${info.comparison?.needsSync || 'Unknown'}\n` +
            `Sync Action: ${info.comparison?.syncAction || 'Unknown'}`,
          duration: 10000,
        });
      }
    } catch (debugError: unknown) {
      logger.error('Failed to debug subscription:', debugError);
      toast.error(getErrorMessage(debugError, t('subscriptions.debugFailed')));
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return t('subscriptions.page.notAvailable');
    return new Date(dateString).toLocaleDateString(getFormatLocale(i18n.language), {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const plusCta = plusActive
    ? t('subscriptions.page.plus.manage')
    : plusCanceledAt
      ? t('subscriptions.page.plus.resubscribe')
      : t('subscriptions.page.plus.subscribeNow');

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <Header options={{ title: t('subscriptions.title'), showBackButton: true }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={onRefresh} />}
      >
        <View style={styles.hero}>
          <IconCircle icon={RiStarLine} size="lg" />
          <H1 style={styles.heroTitle}>{t('subscriptions.page.headerTitle')}</H1>
          <BloomText style={[styles.heroSubtitle, { color: theme.textSecondary }]}>
            {t('subscriptions.page.headerSubtitle')}
          </BloomText>
          <BloomText style={[styles.heroIntro, { color: theme.textSecondary }]}>
            {t('subscriptions.page.introText')}
          </BloomText>
        </View>

        <ProductCard
          icon={RiFileTextLine}
          title={t('subscriptions.page.payPerContract.title')}
          price={t('subscriptions.page.payPerContract.price')}
          description={t('subscriptions.page.payPerContract.description')}
        >
          <Button
            variant="secondary"
            size="large"
            fullWidth
            loading={checkoutBusy}
            disabled={checkoutBusy}
            onPress={() => void handleStartCheckout('file')}
          >
            {t('subscriptions.page.payPerContract.reviewButton')}
          </Button>
        </ProductCard>

        <ProductCard
          icon={RiStarLine}
          highlighted
          title={t('subscriptions.page.plus.title')}
          price={t('subscriptions.page.plus.price')}
          description={t('subscriptions.page.plus.description')}
          badge={
            plusActive ? (
              <Badge content={t('subscriptions.page.plus.activeBadge')} color="success" variant="subtle" size="small" />
            ) : plusCanceledAt ? (
              <Badge
                content={t('subscriptions.page.plus.canceledBadge', { date: formatDate(plusCanceledAt) })}
                color="error"
                variant="subtle"
                size="small"
              />
            ) : null
          }
        >
          <View style={styles.features}>
            {[
              t('subscriptions.page.plus.featureHistory'),
              t('subscriptions.page.plus.featureAlerts'),
              t('subscriptions.page.plus.featureSupport'),
            ].map((feature) => (
              <View key={feature} style={styles.featureRow}>
                <RiCheckboxCircleFill width={18} height={18} fill={theme.success} />
                <BloomText style={styles.featureText}>{feature}</BloomText>
              </View>
            ))}
          </View>
          <Button
            variant="primary"
            size="large"
            fullWidth
            loading={!plusActive && checkoutBusy}
            disabled={checkoutBusy}
            onPress={() => void (plusActive ? handleManageSubscription() : handleStartCheckout('plus'))}
          >
            {plusCta}
          </Button>
        </ProductCard>

        <ProductCard
          icon={RiHeartLine}
          title={t('subscriptions.page.founder.title')}
          price={t('subscriptions.page.founder.price')}
          description={t('subscriptions.page.founder.description')}
        >
          <Button
            variant="secondary"
            size="large"
            fullWidth
            loading={checkoutBusy}
            disabled={checkoutBusy}
            onPress={() => void handleStartCheckout('founder')}
          >
            {t('subscriptions.page.founder.becomeSupporter')}
          </Button>
        </ProductCard>

        <BloomText style={[styles.footer, { color: theme.textSecondary }]}>
          {t('subscriptions.page.footer')}
        </BloomText>

        {/* Developer tooling — only in development builds. */}
        {__DEV__ ? (
          <View style={styles.debug}>
            <SettingsListGroup title="Debug Info">
              <SettingsListItem title="Plus Active" value={plusActive ? 'Yes' : 'No'} />
              <SettingsListItem
                title="Subscription ID"
                value={entitlements?.plusStripeSubscriptionId || 'None'}
              />
              <SettingsListItem title="File Credits" value={String(fileCredits)} />
              <SettingsListItem title="Last Payment" value={formatDate(lastPayment)} />
              <SettingsListItem title="Plus Since" value={formatDate(plusSince)} />
              <SettingsListItem title="Plus Canceled" value={formatDate(plusCanceledAt)} />
            </SettingsListGroup>
            <SettingsListGroup title="Actions">
              {plusActive ? (
                <SettingsListItem
                  title="Cancel at Period End"
                  destructive
                  onPress={() => void handleCancelSubscription(false)}
                />
              ) : null}
              {plusActive ? (
                <SettingsListItem
                  title="Cancel Immediately"
                  destructive
                  onPress={() => void handleCancelSubscription(true)}
                />
              ) : null}
              <SettingsListItem title="Sync from Stripe" onPress={() => void handleSyncSubscription()} />
              <SettingsListItem title="Debug Subscription" onPress={() => void handleDebugSubscription()} />
            </SettingsListGroup>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

interface ProductCardProps {
  icon: IconComponent;
  title: string;
  price: string;
  description: string;
  highlighted?: boolean;
  badge?: React.ReactNode;
  children: React.ReactNode;
}

const ProductCard: React.FC<ProductCardProps> = ({
  icon: Icon,
  title,
  price,
  description,
  highlighted,
  badge,
  children,
}) => {
  const { colors: theme } = useTheme();
  return (
    <Card
      variant={highlighted ? 'filled' : 'outlined'}
      radius="radius-24"
      style={[styles.card, highlighted && { borderWidth: 2, borderColor: theme.primary }]}
    >
      {badge ? <View style={styles.badgeRow}>{badge}</View> : null}
      <View style={styles.cardHeader}>
        <Icon width={24} height={24} fill={theme.primary} />
        <View style={styles.cardTitleWrap}>
          <H3>{title}</H3>
          <BloomText style={[styles.price, { color: theme.primary }]}>{price}</BloomText>
        </View>
      </View>
      <BloomText style={[styles.cardDescription, { color: theme.textSecondary }]}>
        {description}
      </BloomText>
      {children}
    </Card>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scroll: {
    width: '100%',
    maxWidth: contentClamp.copy,
    alignSelf: 'center',
    padding: spacing.lg,
    paddingBottom: spacing['4xl'],
    gap: spacing.lg,
  },
  hero: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  heroTitle: {
    textAlign: 'center',
  },
  heroSubtitle: {
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
  },
  heroIntro: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  card: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  badgeRow: {
    flexDirection: 'row',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  cardTitleWrap: {
    flex: 1,
    gap: 2,
  },
  price: {
    fontSize: 16,
    fontWeight: '600',
  },
  cardDescription: {
    fontSize: 15,
    lineHeight: 20,
  },
  features: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  featureText: {
    flex: 1,
    fontSize: 14,
  },
  footer: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  debug: {
    marginTop: spacing.lg,
  },
});

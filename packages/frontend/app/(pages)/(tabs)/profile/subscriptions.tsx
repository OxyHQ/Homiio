/**
 * Profile → Subscriptions: the three billing products (pay per contract,
 * Homiio+, founder supporter) as Bloom `Card`s with Bloom `Button` CTAs.
 *
 * Info and errors are `toast`s; the one destructive decision (cancel the
 * subscription immediately) is a Bloom `confirm()`, which — unlike the
 * `Alert.alert` with buttons it replaced — also works on web.
 */
import type React from 'react';
import { useRef } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useOxy } from '@oxy.so/services/ui/client';

import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { Badge } from '@oxy.so/bloom/badge';
import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import { IconCircle } from '@oxy.so/bloom/icon-circle';
import { RiCheckboxCircleFill } from '@oxy.so/bloom/icons/RiCheckboxCircleFill';
import { RiFileTextLine } from '@oxy.so/bloom/icons/RiFileTextLine';
import { RiHeartLine } from '@oxy.so/bloom/icons/RiHeartLine';
import { RiStarLine } from '@oxy.so/bloom/icons/RiStarLine';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
import { SettingsListGroup, SettingsListItem } from '@oxy.so/bloom/settings-list';
import { confirm } from '@oxy.so/bloom/surfaces';
import { useTheme } from '@oxy.so/bloom/theme';
import { toast } from '@oxy.so/bloom/toast';
import { H1, H3, Text as BloomText } from '@oxy.so/bloom/typography';

import { contentClamp, spacing } from '@/constants/styles';
import {
  accountOwnerKey,
  type AccountOwner,
  useAccountOwnerGuard,
  withAccountOwner,
} from '@/hooks/useAccountOwner';
import { ErrorState } from '@/components/ui/ErrorState';
import { ProfileSkeleton } from '@/components/ui/skeletons/ProfileSkeleton';
import type { Entitlements } from '@/store/subscriptionStore';
import { api } from '@/utils/api';
import { getFormatLocale } from '@/utils/dateLocale';
import { logger } from '@/utils/logger';

type IconComponent = React.ComponentType<{ width?: number; height?: number; fill?: string }>;

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const DEFAULT_ENTITLEMENTS: Entitlements = {
  plusActive: false,
  fileCredits: 0,
  founderSupporter: false,
  processedSessions: [],
};

type EntitlementsResponse = { success: boolean; entitlements: Entitlements };

/** Validate the required fields guaranteed by the profile entitlements GET. */
function parseEntitlements(value: unknown): Entitlements {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid entitlements');
  const data = value as Record<string, unknown>;
  if (
    typeof data.plusActive !== 'boolean' ||
    typeof data.fileCredits !== 'number' ||
    !Number.isSafeInteger(data.fileCredits) ||
    typeof data.founderSupporter !== 'boolean' ||
    !Array.isArray(data.processedSessions) ||
    !data.processedSessions.every((session) => typeof session === 'string')
  ) {
    throw new Error('Invalid entitlements');
  }
  for (const field of [
    'plusSince',
    'plusCanceledAt',
    'plusStripeSubscriptionId',
    'lastPaymentAt',
    'founderSince',
  ]) {
    if (data[field] != null && typeof data[field] !== 'string') {
      throw new Error('Invalid entitlements');
    }
  }
  return value as Entitlements;
}

/** Posts a billing action bound to the account observed when it was started. */
async function postForEntitlements(
  endpoint: string,
  body: object,
  failure: string,
  owner: AccountOwner,
) {
  const { data } = await api.post<EntitlementsResponse>(endpoint, body, { owner });
  if (!data?.success) throw new Error(failure);
  return data.entitlements || DEFAULT_ENTITLEMENTS;
}

type Product = 'plus' | 'file' | 'founder';

export default function SubscriptionsScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors: theme } = useTheme();
  const { openAccountDialog } = useOxy();
  const { owner, isCurrent } = useAccountOwnerGuard();
  const queryClient = useQueryClient();
  const owners = useRef(new WeakMap<{ product: Product }, AccountOwner>());
  const entitlementsKey = [
    'profiles',
    'me',
    'entitlements',
    'owned-v1',
    ...accountOwnerKey(owner),
  ] as const;
  const entitlementsQuery = useQuery({
    queryKey: entitlementsKey,
    queryFn: () =>
      withAccountOwner(owner, async (current) => {
        const { data } = await api.get<{ success: boolean; entitlements: unknown }>(
          '/api/profiles/me/entitlements',
          {
            owner: current,
          },
        );
        if (data?.success !== true) throw new Error('Failed to load entitlements');
        return parseEntitlements(data.entitlements);
      }),
    enabled: Boolean(owner?.sessionId),
  });
  const entitlements = entitlementsQuery.data ?? null;

  const checkoutMutation = useMutation({
    mutationFn: async (action: { product: Product }) => {
      const captured = owners.current.get(action);
      if (!captured || !isCurrent(captured)) throw new Error('The active account changed');
      const { product } = action;
      if (product === 'plus' && entitlements?.plusActive) {
        throw new Error('You already have Homiio+ subscription');
      }
      if (product === 'file' && entitlements?.plusActive) {
        throw new Error('File uploads are included in your Homiio+ subscription');
      }
      return withAccountOwner(captured, async (current) => {
        const { data } = await api.post<{ success: boolean; url: string }>(
          '/api/billing/checkout',
          { product },
          { owner: current },
        );
        if (!data?.success) throw new Error('Failed to create checkout session');
        return data.url;
      });
    },
  });

  const plusActive = entitlements?.plusActive || false;
  const plusSince = entitlements?.plusSince;
  const plusCanceledAt = entitlements?.plusCanceledAt;
  const fileCredits = entitlements?.fileCredits || 0;
  const lastPayment = entitlements?.lastPaymentAt;
  const checkoutBusy = checkoutMutation.isPending;

  const handleStartCheckout = async (product: Product) => {
    if (!owner || !isCurrent(owner)) return;
    const action = { product };
    owners.current.set(action, owner);
    try {
      const url = await checkoutMutation.mutateAsync(action);
      if (!isCurrent(owner)) return;
      await Linking.openURL(url);
    } catch (error: unknown) {
      if (!isCurrent(owner)) return;
      logger.error('Failed to start checkout:', error);
      toast.error(getErrorMessage(error, t('subscriptions.checkoutFailed')));
    }
  };

  const handleManageSubscription = async () => {
    if (!owner || !isCurrent(owner)) return;
    try {
      const subscriptionId = entitlements?.plusStripeSubscriptionId;
      if (!subscriptionId) throw new Error('No subscription found to manage');
      const { data } = await withAccountOwner(owner, (current) =>
        api.post<{
          success: boolean;
          url: string;
          error?: { code: string; message: string };
        }>('/api/billing/customer-portal', { subscriptionId }, { owner: current }),
      );
      if (!isCurrent(owner)) return;
      if (!data?.success)
        throw new Error(data?.error?.message || 'Failed to create customer portal session');
      await Linking.openURL(data.url);
    } catch (error: unknown) {
      if (!isCurrent(owner)) return;
      logger.error('Failed to open subscription management:', error);
      toast.error(getErrorMessage(error, t('subscriptions.portalFailed')));
    }
  };

  const handleSyncSubscription = async () => {
    if (!owner || !isCurrent(owner)) return;
    try {
      const next = await withAccountOwner(owner, (current) =>
        postForEntitlements(
          '/api/billing/sync-subscription',
          {},
          'Failed to sync subscription',
          current,
        ),
      );
      if (!isCurrent(owner)) return;
      queryClient.setQueryData(entitlementsKey, next);
      toast.success(t('subscriptions.syncSuccess'));
    } catch (error: unknown) {
      if (!isCurrent(owner)) return;
      logger.error('Failed to sync subscription:', error);
      toast.error(getErrorMessage(error, t('subscriptions.syncFailed')));
    }
  };

  const handleCancelSubscription = async (immediate: boolean) => {
    if (!owner || !isCurrent(owner)) return;
    if (immediate) {
      const ok = await confirm({
        title: t('subscriptions.page.cancelImmediateTitle'),
        description: t('subscriptions.page.cancelImmediateBody'),
        confirmLabel: t('subscriptions.page.yesCancelNow'),
        cancelLabel: t('subscriptions.page.no'),
        destructive: true,
      });
      if (!ok || !isCurrent(owner)) return;
    }
    try {
      const next = await withAccountOwner(owner, (current) =>
        postForEntitlements(
          '/api/billing/cancel-subscription',
          { immediate },
          'Failed to cancel subscription',
          current,
        ),
      );
      if (!isCurrent(owner)) return;
      queryClient.setQueryData(entitlementsKey, next);
      toast.success(
        immediate
          ? t('subscriptions.cancelImmediateSuccess')
          : t('subscriptions.cancelEndOfPeriodSuccess'),
      );
    } catch (error: unknown) {
      if (!isCurrent(owner)) return;
      logger.error('Failed to cancel subscription:', error);
      toast.error(getErrorMessage(error, t('subscriptions.cancelFailed')));
    }
  };

  const handleDebugSubscription = async () => {
    if (!owner || !isCurrent(owner)) return;
    try {
      const response = await withAccountOwner(owner, (current) =>
        api.get('/api/billing/debug-subscription', { owner: current }),
      );
      if (!isCurrent(owner)) return;
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
    } catch (error: unknown) {
      if (!isCurrent(owner)) return;
      logger.error('Failed to debug subscription:', error);
      toast.error(getErrorMessage(error, t('subscriptions.debugFailed')));
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

  if (!owner?.sessionId) {
    return (
      <Screen documentScroll>
        <ErrorState
          title={t('contracts.detail.signAccountUnavailable')}
          onRetry={() => openAccountDialog()}
          retryLabel={t('settings.sections.account')}
        />
      </Screen>
    );
  }
  if (
    entitlementsQuery.isError ||
    (entitlementsQuery.isPending && entitlementsQuery.fetchStatus === 'paused')
  ) {
    return (
      <Screen documentScroll>
        <ErrorState
          title={t('subscriptions.loadFailed')}
          description={t('profile.loadFailedHint')}
          onRetry={() => {
            if (isCurrent(owner)) void entitlementsQuery.refetch();
          }}
          retryLabel={t('common.retry')}
        />
      </Screen>
    );
  }
  if (entitlementsQuery.isPending)
    return (
      <Screen documentScroll>
        <ProfileSkeleton />
      </Screen>
    );

  return (
    <Screen
      documentScroll
      header={
        <PageHeader
          title={t('subscriptions.title')}
          titleAlign="center"
          leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
          onBack={router.canGoBack() ? router.back : undefined}
          backLabel={t('goBack')}
        />
      }
    >
      <ScreenScrollView contentContainerStyle={styles.content}>
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
            size="lg"
            fullWidth
            loading={checkoutBusy}
            disabled={checkoutBusy}
            onPress={() => void handleStartCheckout('file')}
            tone="neutral"
            appearance="outline"
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
              <Badge
                content={t('subscriptions.page.plus.activeBadge')}
                color="success"
                variant="subtle"
                size="sm"
              />
            ) : plusCanceledAt ? (
              <Badge
                content={t('subscriptions.page.plus.canceledBadge', {
                  date: formatDate(plusCanceledAt),
                })}
                color="error"
                variant="subtle"
                size="sm"
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
            size="lg"
            fullWidth
            loading={!plusActive && checkoutBusy}
            disabled={checkoutBusy}
            onPress={() =>
              void (plusActive ? handleManageSubscription() : handleStartCheckout('plus'))
            }
            tone="accent"
            appearance="solid"
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
            size="lg"
            fullWidth
            loading={checkoutBusy}
            disabled={checkoutBusy}
            onPress={() => void handleStartCheckout('founder')}
            tone="neutral"
            appearance="outline"
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
              <SettingsListItem
                title="Sync from Stripe"
                onPress={() => void handleSyncSubscription()}
              />
              <SettingsListItem
                title="Debug Subscription"
                onPress={() => void handleDebugSubscription()}
              />
            </SettingsListGroup>
          </View>
        ) : null}
      </ScreenScrollView>
    </Screen>
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
      appearance={highlighted ? 'subtle' : 'outline'}
      radius="radius-24"
      border={highlighted ? 'medium' : undefined}
      style={[styles.card, highlighted && { borderColor: theme.primary }]}
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
  content: {
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

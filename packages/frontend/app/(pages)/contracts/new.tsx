/**
 * New contract (lease draft) — landlord flow.
 *
 * Leases are created from an APPROVED tenant application: the landlord-only
 * bridge (`POST /api/applications/:id/create-lease`) resolves the property,
 * tenant and rent server-side and returns a draft lease the landlord then
 * edits/signs on `/contracts/[id]`. This screen requires an `?application=`
 * param; without it we guide the user to their applications instead of faking a
 * manual form we cannot wire (there is no standalone tenant picker).
 */
import React, { useCallback } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
import { toast } from '@oxy.so/bloom/toast';

import { Admonition } from '@oxy.so/bloom/admonition';
import { Button } from '@oxy.so/bloom/button';
import { Loading } from '@oxy.so/bloom/loading';
import { SettingsListGroup, SettingsListItem } from '@oxy.so/bloom/settings-list';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text as BloomText, H2 } from '@oxy.so/bloom/typography';
import { TenantApplicationStatus } from '@homiio/shared-types/application';

import { Card } from '@oxy.so/bloom/card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useProperty } from '@/hooks';
import { useApplicationById } from '@/hooks/useApplicationQueries';
import { useCreateLeaseFromApplication } from '@/hooks/useLeaseQueries';
import { getPropertyImageSource, getPropertyTitle } from '@/utils/propertyUtils';
import { formatLocalized } from '@/utils/dateLocale';
import { radius, spacing } from '@/constants/styles';
import { RiFileTextLine } from '@oxy.so/bloom/icons/RiFileTextLine';
import { RiGalleryLine } from '@oxy.so/bloom/icons/RiGalleryLine';

export default function NewContractScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ application?: string }>();
  const applicationId =
    typeof params.application === 'string' ? params.application : params.application?.[0];

  const applicationQuery = useApplicationById(applicationId);
  const application = applicationQuery.data;
  const { property } = useProperty(application?.propertyId ?? '');
  const createLease = useCreateLeaseFromApplication();
  const { colors: themeColors } = useTheme();

  const formatDate = useCallback((raw?: string): string => {
    if (!raw) return '—';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return formatLocalized(date, 'EEE, MMM d, yyyy');
  }, []);

  const handleCreate = useCallback(async () => {
    if (!applicationId) return;
    try {
      const lease = await createLease.mutateAsync(applicationId);
      toast.success(t('contracts.new.toastCreated'));
      router.replace(`/contracts/${lease.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('contracts.new.toastCreateFailed');
      toast.error(message);
    }
  }, [applicationId, createLease, router, t]);

  const header = (
    <PageHeader
      title={t('contracts.new.title')}
      titleAlign="center"
      leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
      onBack={router.canGoBack() ? router.back : undefined}
      backLabel={t('goBack')}
    />
  );

  if (!applicationId) {
    return (
      <Screen documentScroll header={header}>
        <ScreenScrollView contentContainerStyle={styles.centerWrap}>
          <EmptyState
            icon={RiFileTextLine}
            title={t('contracts.new.noApplicationTitle')}
            description={t('contracts.new.noApplicationDescription')}
            actionText={t('contracts.new.viewApplications')}
            actionIcon={RiGalleryLine}
            onAction={() => router.replace('/applications')}
          />
        </ScreenScrollView>
      </Screen>
    );
  }

  if (applicationQuery.isPending) {
    return (
      <Screen documentScroll header={header}>
        <ScreenScrollView contentContainerStyle={styles.centerWrap}>
          <Loading variant="spinner" size="md" />
        </ScreenScrollView>
      </Screen>
    );
  }

  if (applicationQuery.isError || !application) {
    return (
      <Screen documentScroll header={header}>
        <ScreenScrollView contentContainerStyle={styles.centerWrap}>
          <ErrorState
            title={t('contracts.new.applicationUnavailableTitle')}
            description={
              applicationQuery.error?.message ?? t('contracts.new.loadFailedDescription')
            }
            retryLabel={t('contracts.new.goBack')}
            onRetry={() => router.back()}
          />
        </ScreenScrollView>
      </Screen>
    );
  }

  const isApproved = application.status === TenantApplicationStatus.APPROVED;
  const propertyTitle = property ? getPropertyTitle(property) : t('contracts.new.propertyFallback');
  const imageSource = property ? getPropertyImageSource(property) : null;

  return (
    <Screen documentScroll header={header}>
      <ScreenScrollView contentContainerStyle={styles.content}>
        <View style={[styles.thumbWrap, { backgroundColor: themeColors.backgroundSecondary }]}>
          {imageSource ? (
            <Image source={imageSource} style={styles.thumb} resizeMode="cover" />
          ) : (
            <View style={styles.thumb} />
          )}
        </View>

        <Card radius="radius-16" className="p-5" appearance="outline">
          <H2 style={styles.title}>{propertyTitle}</H2>
          <BloomText style={[styles.subtitle, { color: themeColors.textSecondary }]}>
            {t('contracts.new.subtitle')}
          </BloomText>
        </Card>

        <SettingsListGroup title={t('contracts.new.seededTerms')}>
          <SettingsListItem
            title={t('contracts.new.moveIn')}
            value={formatDate(application.moveInDate)}
          />
          <SettingsListItem
            title={t('contracts.new.leaseTerm')}
            value={t('contracts.new.leaseTermMonths', { count: application.leaseTermMonths })}
          />
        </SettingsListGroup>

        {!isApproved ? (
          <Admonition type="warning">{t('contracts.new.notApprovedWarning')}</Admonition>
        ) : null}

        <Button
          size="lg"
          onPress={handleCreate}
          disabled={!isApproved || createLease.isPending}
          loading={createLease.isPending}
          style={styles.footerButton}
          tone="accent"
          appearance="solid"
        >
          {t('contracts.new.createButton')}
        </Button>
      </ScreenScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  centerWrap: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing['2xl'],
  },
  thumbWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.photo,
    overflow: 'hidden',
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 13,
  },
  footerButton: {
    alignSelf: 'stretch',
  },
});

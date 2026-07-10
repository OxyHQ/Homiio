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
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { toast } from '@/lib/sonner';

import { Button } from '@oxyhq/bloom/button';
import { Loading } from '@oxyhq/bloom/loading';
import { Text as BloomText, H2 } from '@oxyhq/bloom/typography';
import { TenantApplicationStatus } from '@homiio/shared-types';

import { Header } from '@/components/Header';
import { CardSurface } from '@/components/ui/CardSurface';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useProperty } from '@/hooks';
import { useApplicationById } from '@/hooks/useApplicationQueries';
import { useCreateLeaseFromApplication } from '@/hooks/useLeaseQueries';
import { getPropertyImageSource, getPropertyTitle } from '@/utils/propertyUtils';
import { formatLocalized } from '@/utils/dateLocale';
import { colors } from '@/styles/colors';
import { radius, spacing, tracker } from '@/constants/styles';

interface DetailRowProps {
  label: string;
  value: string;
}

const DetailRow: React.FC<DetailRowProps> = ({ label, value }) => (
  <View style={styles.detailRow}>
    <BloomText style={styles.detailLabel}>{label}</BloomText>
    <BloomText style={styles.detailValue}>{value}</BloomText>
  </View>
);

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
      const message =
        error instanceof Error ? error.message : t('contracts.new.toastCreateFailed');
      toast.error(message);
    }
  }, [applicationId, createLease, router, t]);

  const header = (
    <Header
      options={{
        showBackButton: true,
        title: t('contracts.new.title'),
        titlePosition: 'center',
      }}
    />
  );

  if (!applicationId) {
    return (
      <View style={styles.root}>
        {header}
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.centerWrap}>
            <EmptyState
              icon="document-text-outline"
              title={t('contracts.new.noApplicationTitle')}
              description={t('contracts.new.noApplicationDescription')}
              actionText={t('contracts.new.viewApplications')}
              actionIcon="albums-outline"
              onAction={() => router.replace('/applications')}
            />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (applicationQuery.isPending) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.centerWrap}>
          <Loading variant="spinner" size="medium" />
        </View>
      </View>
    );
  }

  if (applicationQuery.isError || !application) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.centerWrap}>
          <ErrorState
            title={t('contracts.new.applicationUnavailableTitle')}
            description={
              applicationQuery.error?.message ?? t('contracts.new.loadFailedDescription')
            }
            retryLabel={t('contracts.new.goBack')}
            onRetry={() => router.back()}
          />
        </View>
      </View>
    );
  }

  const isApproved = application.status === TenantApplicationStatus.APPROVED;
  const propertyTitle = property
    ? getPropertyTitle(property)
    : t('contracts.new.propertyFallback');
  const imageSource = property ? getPropertyImageSource(property) : null;

  return (
    <View style={styles.root}>
      {header}
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.thumbWrap}>
            {imageSource ? (
              <Image source={imageSource} style={styles.thumb} resizeMode="cover" />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]} />
            )}
          </View>

          <CardSurface>
            <H2 style={styles.title}>{propertyTitle}</H2>
            <BloomText style={styles.subtitle}>{t('contracts.new.subtitle')}</BloomText>
          </CardSurface>

          <CardSurface>
            <BloomText style={styles.sectionLabel}>{t('contracts.new.seededTerms')}</BloomText>
            <DetailRow
              label={t('contracts.new.moveIn')}
              value={formatDate(application.moveInDate)}
            />
            <DetailRow
              label={t('contracts.new.leaseTerm')}
              value={t('contracts.new.leaseTermMonths', { count: application.leaseTermMonths })}
            />
          </CardSurface>

          {!isApproved ? (
            <BloomText style={styles.warning}>{t('contracts.new.notApprovedWarning')}</BloomText>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Button
            variant="primary"
            size="large"
            onPress={handleCreate}
            disabled={!isApproved || createLease.isPending}
            loading={createLease.isPending}
            style={styles.footerButton}
          >
            {t('contracts.new.createButton')}
          </Button>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  centerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing['2xl'],
  },
  thumbWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.photo,
    overflow: 'hidden',
    backgroundColor: colors.mutedSubtle,
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  thumbPlaceholder: {
    backgroundColor: colors.mutedSubtle,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: colors.muted,
    letterSpacing: tracker.eyebrow,
    marginBottom: spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
  },
  detailLabel: {
    fontSize: 13,
    color: colors.muted,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  warning: {
    fontSize: 13,
    color: colors.warning,
    fontStyle: 'italic',
  },
  footer: {
    padding: spacing.lg,
  },
  footerButton: {
    alignSelf: 'stretch',
  },
});

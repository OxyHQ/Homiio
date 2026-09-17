/**
 * Application detail (applicant + landlord view).
 *
 * Shows the submitted application payload. Renders role-appropriate actions:
 *  - Applicant on submitted/reviewing: "Withdraw" (confirm dialog)
 *  - Landlord on approved:             "Create lease" → /contracts/new?application=
 *    (the landlord-only bridge seeds a draft lease from this application)
 *
 * Documents are linked via signed S3 URLs returned by the API.
 *
 * The property is an outlined Bloom `Card`; terms, finances, references and
 * documents are Bloom `SettingsListGroup`s shared with the landlord's view
 * (`components/applications/ApplicationDetailGroups`); status is the
 * Chip-based `ApplicationStatusBadge`. Loading is Bloom `Loading`, errors the
 * shared ErrorState component.
 */
import React, { useCallback, useMemo } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { toast } from '@oxy.so/bloom/toast';
import { useTheme } from '@oxy.so/bloom/theme';
import { RiAlertLine, RiCloseLine, RiEditLine } from '@oxy.so/bloom/icons';

import { Button } from '@oxy.so/bloom/button';
import { Loading } from '@oxy.so/bloom/loading';
import { Text as BloomText, H2 } from '@oxy.so/bloom/typography';
import { TenantApplicationStatus } from '@homiio/shared-types';

import { Header } from '@/components/Header';
import { PageScrollView } from '@/components/PageScrollView';
import { ApplicationStatusBadge } from '@/components/ApplicationStatusBadge';
import {
  ApplicationDocumentsGroup,
  ApplicationFinancesGroup,
  ApplicationReferencesGroup,
  ApplicationTermsGroup,
} from '@/components/applications/ApplicationDetailGroups';
import { confirm } from '@oxy.so/bloom/surfaces';
import { useProperty } from '@/hooks';
import { useProfile } from '@/context/ProfileContext';
import {
  useApplicationById,
  useUpdateApplicationMutation,
} from '@/hooks/useApplicationQueries';
import {
  getPropertyImageSource,
  getPropertyTitle,
} from '@/utils/propertyUtils';
import { Card } from '@oxy.so/bloom/card';
import { ErrorState } from '@/components/ui/ErrorState';
import { radius, spacing, tracker } from '@/constants/styles';

export default function ApplicationDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : params.id?.[0];
  const applicationQuery = useApplicationById(id);
  const updateMutation = useUpdateApplicationMutation();
  const { profile } = useProfile();

  const application = applicationQuery.data;
  const { property } = useProperty(application?.propertyId ?? '');

  const role = useMemo<'applicant' | 'landlord' | null>(() => {
    if (!application || !profile) return null;
    const sessionOxyUserId = profile?.oxyUserId;
    if (!sessionOxyUserId) return null;
    if (String(application.landlordOxyUserId) === sessionOxyUserId) return 'landlord';
    if (String(application.applicantOxyUserId) === sessionOxyUserId) return 'applicant';
    return null;
  }, [application, profile]);

  const canWithdraw = useMemo<boolean>(() => {
    if (!application || role !== 'applicant') return false;
    return (
      application.status === TenantApplicationStatus.SUBMITTED ||
      application.status === TenantApplicationStatus.REVIEWING
    );
  }, [application, role]);

  const showCreateLease = useMemo<boolean>(() => {
    if (!application) return false;
    return (
      role === 'landlord' &&
      application.status === TenantApplicationStatus.APPROVED
    );
  }, [application, role]);

  const handleWithdraw = useCallback(async () => {
    if (!id || !application) return;
    const ok = await confirm({
      title: 'Withdraw application?',
      description:
        'The landlord will see this application as withdrawn. You can submit a new one for this property afterwards.',
      confirmLabel: 'Withdraw',
      destructive: true,
    });
    if (!ok) return;
    try {
      await updateMutation.mutateAsync({
        id,
        input: { status: TenantApplicationStatus.WITHDRAWN },
      });
      toast.success(t('applications.toast.withdrawn'));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t('applications.toast.withdrawFailed');
      toast.error(message);
    }
  }, [id, application, updateMutation, t]);

  const handleCreateLease = useCallback(() => {
    if (!id) return;
    router.push({
      pathname: '/contracts/new',
      params: { application: id },
    });
  }, [id, router]);

  const header = (
    <Header
      options={{
        showBackButton: true,
        title: 'Application',
      }}
    />
  );

  if (!id) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        {header}
        <View style={styles.centerWrap}>
          <ErrorState
            icon={RiAlertLine}
            title="Invalid application id"
            description="The link you followed is missing the application reference."
            retryLabel="Go back"
            onRetry={() => router.back()}
          />
        </View>
      </View>
    );
  }

  if (applicationQuery.isPending) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        {header}
        <View style={styles.centerWrap}>
          <Loading variant="spinner" size="medium" />
        </View>
      </View>
    );
  }

  if (applicationQuery.isError || !application) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        {header}
        <View style={styles.centerWrap}>
          <ErrorState
            title="Application unavailable"
            description={
              applicationQuery.error?.message ?? 'This application could not be loaded.'
            }
            retryLabel="Go back"
            onRetry={() => router.back()}
          />
        </View>
      </View>
    );
  }

  const propertyTitle = property ? getPropertyTitle(property) : 'Property';
  const secondaryText = { color: theme.colors.textSecondary };
  const imageSource = property ? getPropertyImageSource(property) : null;

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      {header}
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <PageScrollView contentContainerStyle={styles.content}>
          <View style={[styles.thumbWrap, { backgroundColor: theme.colors.backgroundSecondary }]}>
            {imageSource ? (
              <Image source={imageSource} style={styles.thumb} resizeMode="cover" />
            ) : (
              <View style={styles.thumb} />
            )}
          </View>

          <Card variant="outlined" radius="radius-16" className="p-5">
            <View style={styles.headerRow}>
              <H2 style={styles.title}>{propertyTitle}</H2>
              <ApplicationStatusBadge status={application.status} />
            </View>
            {property?.address ? (
              <BloomText style={[styles.subtitle, secondaryText]}>
                {[property.address.cityName, property.address.countryName]
                  .filter(Boolean)
                  .join(', ')}
              </BloomText>
            ) : null}
          </Card>

          <View style={styles.groups}>
            <ApplicationTermsGroup application={application} />
            <ApplicationFinancesGroup application={application} />
            <ApplicationReferencesGroup application={application} />
            <ApplicationDocumentsGroup application={application} />
          </View>

          {application.notes ? (
            <Card variant="outlined" radius="radius-16" className="p-5">
              <BloomText style={[styles.sectionLabel, secondaryText]}>Notes</BloomText>
              <BloomText style={styles.notesBody}>{application.notes}</BloomText>
            </Card>
          ) : null}

          {(showCreateLease || canWithdraw) ? (
            <View style={styles.actionRow}>
              {showCreateLease ? (
                <Button
                  variant="primary"
                  size="medium"
                  leadingIcon={RiEditLine}
                  onPress={handleCreateLease}
                  style={styles.actionButton}
                >
                  Create lease
                </Button>
              ) : null}
              {canWithdraw ? (
                <Button
                  variant="ghost"
                  size="medium"
                  leadingIcon={RiCloseLine}
                  onPress={() => void handleWithdraw()}
                  disabled={updateMutation.isPending}
                  style={styles.actionButton}
                >
                  Withdraw application
                </Button>
              ) : null}
            </View>
          ) : null}
        </PageScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
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
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    flex: 1,
  },
  subtitle: {
    fontSize: 13,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: tracker.eyebrow,
    marginBottom: spacing.sm,
  },
  groups: {
    gap: spacing.lg,
  },
  notesBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
    minWidth: 120,
  },
});

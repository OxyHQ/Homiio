/**
 * Landlord application detail — full applicant payload + review actions.
 *
 * Stream Q polish:
 *   - Bloom Typography and Avatar; the property is a Card, and the terms,
 *     references and documents are Bloom `SettingsListGroup`s shared with the
 *     applicant's view (`components/applications/ApplicationDetailGroups`).
 *   - The applicant is their Oxy display name, never a raw account id.
 *   - Review decisions go through a Bloom Dialog holding a Textarea for notes.
 *   - An approved application links to `/contracts/new?application=<id>`, the
 *     only lease-create entry point.
 *   - Shared EmptyState / ErrorState components.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useFormatting } from '@/utils/format';
import { toast } from '@oxy.so/bloom/toast';
import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import { useTheme } from '@oxy.so/bloom/theme';
import {
  RiAlertLine,
  RiCheckLine,
  RiCloseLine,
  RiEditLine,
  RiErrorWarningFill,
  RiEyeLine,
  RiLockLine,
} from '@oxy.so/bloom/icons';
import * as Skeleton from '@oxy.so/bloom/skeleton';
import { Text as BloomText, H2, H3 } from '@oxy.so/bloom/typography';
import { Avatar } from '@oxy.so/bloom/avatar';
import { Textarea } from '@oxy.so/bloom/textarea';
import { Profile, TenantApplication, TenantApplicationStatus } from '@homiio/shared-types';
import { Header } from '@/components/Header';
import { PageScrollView } from '@/components/PageScrollView';
import { ApplicationStatusBadge } from '@/components/ApplicationStatusBadge';
import {
  ApplicationDocumentsGroup,
  ApplicationReferencesGroup,
  ApplicationTermsGroup,
  formatApplicationIncome,
} from '@/components/applications/ApplicationDetailGroups';
import { Dialog } from '@oxy.so/bloom/dialog';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { useProperty } from '@/hooks';
import { useOxyAvatars } from '@/hooks/useOxyAvatars';
import { useProfile } from '@/context/ProfileContext';
import {
  useApplicationById,
  useUpdateApplicationMutation,
} from '@/hooks/useApplicationQueries';
import profileService from '@/services/profileService';
import {
  getPropertyImageSource,
  getPropertyTitle,
} from '@/utils/propertyUtils';
import { radius, spacing } from '@/constants/styles';

type ReviewAction = 'reviewing' | 'approve' | 'reject';

const REVIEW_TRANSITIONS: Record<ReviewAction, TenantApplicationStatus> = {
  reviewing: TenantApplicationStatus.REVIEWING,
  approve: TenantApplicationStatus.APPROVED,
  reject: TenantApplicationStatus.REJECTED,
};

const getReviewLabels = (
  t: (key: string) => string,
): Record<
  ReviewAction,
  { title: string; message: string; confirmLabel: string; successToast: string }
> => ({
  reviewing: {
    title: t('applications.landlord.review.reviewing.title'),
    message: t('applications.landlord.review.reviewing.message'),
    confirmLabel: t('applications.landlord.review.reviewing.confirm'),
    successToast: t('applications.landlord.review.reviewing.successToast'),
  },
  approve: {
    title: t('applications.landlord.review.approve.title'),
    message: t('applications.landlord.review.approve.message'),
    confirmLabel: t('applications.landlord.review.approve.confirm'),
    successToast: t('applications.landlord.review.approve.successToast'),
  },
  reject: {
    title: t('applications.landlord.review.reject.title'),
    message: t('applications.landlord.review.reject.message'),
    confirmLabel: t('applications.landlord.review.reject.confirm'),
    successToast: t('applications.landlord.review.reject.successToast'),
  },
});

/**
 * Applicant avatar to render: prefer the Oxy avatar file id (resolved to a URL
 * downstream by the registered ImageResolver), else a profile-local custom
 * avatar. `getAvatarFileId` comes from {@link useOxyAvatars} (batched lookup).
 */
const getApplicantAvatarFileId = (
  profile: Profile | null | undefined,
  getAvatarFileId: (oxyUserId: string | undefined | null) => string | undefined,
): string | undefined => {
  if (!profile) return undefined;
  return (
    getAvatarFileId(profile.oxyUserId) ||
    profile.personalProfile?.personalInfo?.avatar ||
    profile.avatar
  );
};

const DetailSkeleton: React.FC = () => (
  <View style={styles.content}>
    <View style={styles.skeletonHeaderRow}>
      <Skeleton.Circle size={56} />
      <View style={styles.skeletonBody}>
        <Skeleton.Text style={{ width: 180, lineHeight: 18 }} />
        <Skeleton.Text style={{ width: 220, lineHeight: 14 }} />
      </View>
      <Skeleton.Pill size={20} />
    </View>
    <Skeleton.Box width="100%" height={180} borderRadius={radius.xl} />
    <Card variant="outlined" radius="radius-16" style={styles.card}>
      <Skeleton.Text style={{ width: 140, lineHeight: 16 }} />
      <Skeleton.Text style={{ width: 220, lineHeight: 14 }} />
      <Skeleton.Text style={{ width: 200, lineHeight: 14 }} />
    </Card>
  </View>
);

export default function LandlordApplicationDetailScreen() {
  const { t } = useTranslation();
  const { locale } = useFormatting();
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : params.id?.[0];
  const applicationQuery = useApplicationById(id);
  const updateMutation = useUpdateApplicationMutation();
  const { profile } = useProfile();

  const application: TenantApplication | undefined = applicationQuery.data;
  const { property } = useProperty(application?.propertyId ?? '');

  const applicantQuery = useQuery({
    queryKey: ['profile-by-id', application?.applicantOxyUserId ?? ''],
    queryFn: async () =>
      profileService.getProfileByOxyUserId(String(application?.applicantOxyUserId)),
    enabled: Boolean(application?.applicantOxyUserId),
    staleTime: 1000 * 60 * 5,
  });

  // Resolve the applicant's Oxy avatar file id (batched, cached). Called
  // unconditionally so hook order is stable across the loading/error branches.
  const { getAvatarFileId, usersById } = useOxyAvatars([application?.applicantOxyUserId]);

  const isLandlord = useMemo<boolean>(() => {
    if (!application || !profile) return false;
    const sessionOxyUserId = profile?.oxyUserId;
    if (!sessionOxyUserId) return false;
    return String(application.landlordOxyUserId) === sessionOxyUserId;
  }, [application, profile]);

  const [pendingAction, setPendingAction] = useState<ReviewAction | null>(null);
  const [actionNotes, setActionNotes] = useState('');
  const reviewLabels = useMemo(() => getReviewLabels(t), [t]);

  const handleOpen = useCallback((action: ReviewAction) => {
    setActionNotes('');
    setPendingAction(action);
  }, []);

  const handleClose = useCallback(() => {
    if (updateMutation.isPending) return;
    setPendingAction(null);
    setActionNotes('');
  }, [updateMutation.isPending]);

  const handleCreateLease = useCallback(() => {
    if (!id) return;
    router.push({ pathname: '/contracts/new', params: { application: id } });
  }, [id, router]);

  const handleConfirm = useCallback(async () => {
    if (!id || !pendingAction) return;
    const status = REVIEW_TRANSITIONS[pendingAction];
    const trimmedNotes = actionNotes.trim();
    try {
      await updateMutation.mutateAsync({
        id,
        input: {
          status,
          notes: trimmedNotes ? trimmedNotes : undefined,
        },
      });
      toast.success(reviewLabels[pendingAction].successToast);
      setPendingAction(null);
      setActionNotes('');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t('applications.landlord.toastUpdateFailed');
      toast.error(message);
    }
  }, [id, pendingAction, actionNotes, updateMutation, reviewLabels, t]);

  if (!id) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <Header
          options={{
            showBackButton: true,
            title: t('applications.card.applicantFallback'),
          }}
        />
        <ErrorState
          icon={RiErrorWarningFill}
          title={t('applications.landlord.invalidTitle')}
          description={t('applications.landlord.invalidDescription')}
          onRetry={() => router.back()}
          retryLabel={t('goBack')}
        />
      </View>
    );
  }

  if (applicationQuery.isPending) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <Header
          options={{
            showBackButton: true,
            title: t('applications.card.applicantFallback'),
          }}
        />
        <PageScrollView>
          <DetailSkeleton />
        </PageScrollView>
      </View>
    );
  }

  if (applicationQuery.isError || !application) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <Header
          options={{
            showBackButton: true,
            title: t('applications.card.applicantFallback'),
          }}
        />
        <ErrorState
          icon={RiAlertLine}
          title={t('applications.landlord.unavailableTitle')}
          description={
            applicationQuery.error?.message ??
            t('applications.landlord.unavailableDescription')
          }
          onRetry={() => applicationQuery.refetch()}
        />
      </View>
    );
  }

  if (!isLandlord) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <Header
          options={{
            showBackButton: true,
            title: t('applications.card.applicantFallback'),
          }}
        />
        <ErrorState
          icon={RiLockLine}
          title={t('applications.landlord.notAuthorisedTitle')}
          description={t('applications.landlord.notAuthorisedDescription')}
          onRetry={() => router.back()}
          retryLabel={t('goBack')}
        />
      </View>
    );
  }

  const applicant = applicantQuery.data ?? null;
  const applicantUser = usersById.get(application.applicantOxyUserId);
  const applicantName =
    applicantUser?.name?.displayName?.trim() ||
    applicantUser?.username ||
    t('applications.card.applicantFallback');
  const applicantAvatar = getApplicantAvatarFileId(applicant, getAvatarFileId);
  const propertyTitle = property ? getPropertyTitle(property) : t('applications.card.propertyFallback');
  const imageSource = property ? getPropertyImageSource(property) : null;

  const canMoveToReviewing =
    application.status === TenantApplicationStatus.SUBMITTED;
  const canCreateLease = application.status === TenantApplicationStatus.APPROVED;
  const secondaryText = { color: theme.colors.textSecondary };
  const canDecide =
    application.status === TenantApplicationStatus.SUBMITTED ||
    application.status === TenantApplicationStatus.REVIEWING;

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <Header
        options={{
          showBackButton: true,
          title: t('applications.card.applicantFallback'),
        }}
      />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <PageScrollView contentContainerStyle={styles.content}>
          <View style={styles.applicantHeader}>
            <Avatar
              size={56}
              name={applicantName}
              source={applicantAvatar ?? null}
              variant="thumb"
            />
            <View style={styles.applicantHeaderText}>
              <H2 style={styles.applicantName}>{applicantName}</H2>
              <BloomText style={[styles.subtitle, secondaryText]}>
                {t(`profile.edit.options.employmentStatus.${application.employmentStatus}`)} ·{' '}
                {formatApplicationIncome(application, locale)}{' '}
                {t('applications.card.perMonth')}
              </BloomText>
            </View>
            <ApplicationStatusBadge status={application.status} />
          </View>

          <View style={[styles.heroCard, { backgroundColor: theme.colors.backgroundSecondary }]}>
            {imageSource ? (
              <Image
                source={imageSource}
                style={styles.thumb}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.thumb} />
            )}
          </View>

          <Card variant="outlined" radius="radius-16" style={styles.card}>
            <SectionEyebrow>{t('applications.card.propertyFallback')}</SectionEyebrow>
            <H3 style={styles.cardHeading}>{propertyTitle}</H3>
            {property?.address ? (
              <BloomText style={[styles.subtitle, secondaryText]}>
                {[property.address.cityName, property.address.countryName]
                  .filter(Boolean)
                  .join(', ')}
              </BloomText>
            ) : null}
          </Card>

          <ApplicationTermsGroup application={application} />
          <ApplicationReferencesGroup application={application} />
          <ApplicationDocumentsGroup application={application} />

          {application.notes ? (
            <Card variant="outlined" radius="radius-16" style={styles.card}>
              <SectionEyebrow>{t('applications.landlord.sectionNotes')}</SectionEyebrow>
              <BloomText style={styles.notesBody}>{application.notes}</BloomText>
            </Card>
          ) : null}

          {canCreateLease ? (
            <View style={styles.actionRow}>
              <Button
                variant="primary"
                size="medium"
                leadingIcon={RiEditLine}
                onPress={handleCreateLease}
                style={styles.actionButton}
              >
                {t('applications.landlord.createLease')}
              </Button>
            </View>
          ) : canDecide ? (
            <View style={styles.actionRow}>
              <Button
                variant="secondary"
                size="medium"
                leadingIcon={RiEyeLine}
                onPress={() => handleOpen('reviewing')}
                disabled={!canMoveToReviewing || updateMutation.isPending}
                style={styles.actionButton}
              >
                {t('applications.landlord.review.reviewing.confirm')}
              </Button>
              <Button
                variant="primary"
                size="medium"
                leadingIcon={RiCheckLine}
                onPress={() => handleOpen('approve')}
                disabled={updateMutation.isPending}
                style={styles.actionButton}
              >
                {t('applications.landlord.review.approve.confirm')}
              </Button>
              <Button
                variant="ghost"
                size="medium"
                leadingIcon={RiCloseLine}
                onPress={() => handleOpen('reject')}
                disabled={updateMutation.isPending}
                style={styles.actionButton}
              >
                {t('applications.landlord.review.reject.confirm')}
              </Button>
            </View>
          ) : null}
        </PageScrollView>

        <Dialog
          placement="center"
          open={pendingAction !== null}
          onClose={handleClose}
          dismissOnBackdrop={!updateMutation.isPending}
          maxWidth={420}
          title={pendingAction ? reviewLabels[pendingAction].title : ''}
          label={pendingAction ? reviewLabels[pendingAction].title : ''}
          description={pendingAction ? reviewLabels[pendingAction].message : ''}
          actions={[
            {
              label: pendingAction ? reviewLabels[pendingAction].confirmLabel : '',
              color: pendingAction === 'reject' ? 'destructive' : 'default',
              disabled: updateMutation.isPending,
              shouldCloseOnPress: false,
              onPress: () => void handleConfirm(),
            },
            {
              label: t('common.cancel'),
              color: 'cancel',
              disabled: updateMutation.isPending,
              shouldCloseOnPress: false,
              onPress: handleClose,
            },
          ]}
        >
          <Textarea
            label={t('applications.landlord.notesLabel')}
            value={actionNotes}
            onChangeText={setActionNotes}
            rows={4}
            autoResize
            maxLength={4000}
            disabled={updateMutation.isPending}
            placeholder={t('applications.landlord.notesPlaceholder')}
          />
        </Dialog>
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
  skeletonHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  skeletonBody: {
    flex: 1,
    gap: spacing.sm,
  },
  applicantHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  applicantHeaderText: {
    flex: 1,
    gap: spacing.xs,
  },
  applicantName: {
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
  },
  heroCard: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  card: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardHeading: {
    letterSpacing: -0.3,
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
    minWidth: 140,
  },
});

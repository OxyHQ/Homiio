/**
 * Landlord application detail — full applicant payload + review actions.
 *
 * Stream Q polish:
 *   - Bloom Typography (H2 / Text), Bloom Avatar, Bloom Button, Divider.
 *   - withShadow('sm') cards with radius.lg.
 *   - All Pressables replaced by Bloom Button.
 *   - Shared EmptyState / ErrorState components.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { toast } from '@/lib/sonner';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@oxyhq/bloom/button';
import * as Skeleton from '@oxyhq/bloom/skeleton';
import { Text as BloomText, H2, H3 } from '@oxyhq/bloom/typography';
import { Avatar } from '@oxyhq/bloom/avatar';
import { TextFieldInput } from '@oxyhq/bloom/text-field';
import {
  Profile,
  TenantApplication,
  TenantApplicationDocument,
  TenantApplicationStatus,
} from '@homiio/shared-types';
import { Header } from '@/components/Header';
import { ApplicationStatusBadge } from '@/components/ApplicationStatusBadge';
import { ConfirmDialog } from '@/components/ConfirmDialog';
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
import { radius, spacing, withShadow } from '@/constants/styles';
import { colors } from '@/styles/colors';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

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

const formatCurrency = (amount: number): string => {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toFixed(0)}`;
  }
};

const formatDate = (raw: string): string => {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return format(date, 'EEE, MMM d, yyyy');
};

const docIcon = (type: string): IoniconName => {
  switch (type) {
    case 'id':
      return 'card-outline';
    case 'income':
      return 'cash-outline';
    case 'reference':
      return 'mail-outline';
    default:
      return 'document-text-outline';
  }
};

const openDocument = (url: string) => {
  if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  Linking.openURL(url).catch(() => {
    toast.error(i18next.t('applications.landlord.toastOpenDocumentFailed'));
  });
};

const getApplicantDisplayName = (
  profile: Profile | null | undefined,
): string => {
  if (!profile) return 'Applicant';
  switch (profile.profileType) {
    case 'personal': {
      const bio = profile.personalProfile?.personalInfo?.bio;
      return bio?.trim() || profile.oxyUserId || 'Applicant';
    }
    case 'agency':
      return (
        profile.agencyProfile?.legalCompanyName?.trim() ||
        profile.oxyUserId ||
        'Agency'
      );
    case 'business':
      return (
        profile.businessProfile?.legalCompanyName?.trim() ||
        profile.oxyUserId ||
        'Business'
      );
    case 'cooperative':
      return (
        profile.cooperativeProfile?.legalName?.trim() ||
        profile.oxyUserId ||
        'Cooperative'
      );
    default:
      return profile.oxyUserId || 'Applicant';
  }
};

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

interface DocumentRowProps {
  document: TenantApplicationDocument;
}

const DocumentRow: React.FC<DocumentRowProps> = ({ document }) => {
  const { t } = useTranslation();

  return (
  <Pressable
    onPress={() => openDocument(document.url)}
    style={styles.documentRow}
    accessibilityRole="link"
    accessibilityLabel={`Open document ${document.filename}`}
  >
    <View style={styles.documentIcon}>
      <Ionicons
        name={docIcon(document.type)}
        size={18}
        color={colors.COLOR_BLACK_LIGHT_2}
      />
    </View>
    <View style={styles.documentMeta}>
      <BloomText style={styles.documentName} numberOfLines={1}>
        {document.filename}
      </BloomText>
      <BloomText style={styles.documentType}>
        {t(`applications.documentType.${document.type}`)}
      </BloomText>
    </View>
    <Ionicons
      name="open-outline"
      size={18}
      color={colors.COLOR_BLACK_LIGHT_3}
    />
  </Pressable>
  );
};

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
    <View style={styles.card}>
      <Skeleton.Text style={{ width: 140, lineHeight: 16 }} />
      <Skeleton.Text style={{ width: 220, lineHeight: 14 }} />
      <Skeleton.Text style={{ width: 200, lineHeight: 14 }} />
    </View>
  </View>
);

export default function LandlordApplicationDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : params.id?.[0];
  const applicationQuery = useApplicationById(id);
  const updateMutation = useUpdateApplicationMutation();
  const { primaryProfile } = useProfile();

  const application: TenantApplication | undefined = applicationQuery.data;
  const { property } = useProperty(application?.propertyId ?? '');

  const applicantQuery = useQuery({
    queryKey: ['profile-by-id', application?.applicantProfileId ?? ''],
    queryFn: async () =>
      profileService.getProfileById(String(application?.applicantProfileId)),
    enabled: Boolean(application?.applicantProfileId),
    staleTime: 1000 * 60 * 5,
  });

  // Resolve the applicant's Oxy avatar file id (batched, cached). Called
  // unconditionally so hook order is stable across the loading/error branches.
  const { getAvatarFileId } = useOxyAvatars([applicantQuery.data?.oxyUserId]);

  const isLandlord = useMemo<boolean>(() => {
    if (!application || !primaryProfile) return false;
    const profileId = primaryProfile._id ?? primaryProfile.id;
    if (!profileId) return false;
    return String(application.landlordProfileId) === String(profileId);
  }, [application, primaryProfile]);

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
      <View style={styles.root}>
        <Header
          options={{
            showBackButton: true,
            title: 'Applicant',
            titlePosition: 'center',
          }}
        />
        <ErrorState
          icon="alert-circle-outline"
          title="Invalid application"
          description="We couldn't find this application id."
          onRetry={() => router.back()}
          retryLabel="Go back"
        />
      </View>
    );
  }

  if (applicationQuery.isPending) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            showBackButton: true,
            title: 'Applicant',
            titlePosition: 'center',
          }}
        />
        <ScrollView contentContainerStyle={styles.content}>
          <DetailSkeleton />
        </ScrollView>
      </View>
    );
  }

  if (applicationQuery.isError || !application) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            showBackButton: true,
            title: 'Applicant',
            titlePosition: 'center',
          }}
        />
        <ErrorState
          icon="cloud-offline-outline"
          title="Application unavailable"
          description={
            applicationQuery.error?.message ??
            'This application could not be loaded.'
          }
          onRetry={() => applicationQuery.refetch()}
        />
      </View>
    );
  }

  if (!isLandlord) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            showBackButton: true,
            title: 'Applicant',
            titlePosition: 'center',
          }}
        />
        <ErrorState
          icon="lock-closed-outline"
          title="Not authorised"
          description="Only the landlord assigned to this property can review the application."
          onRetry={() => router.back()}
          retryLabel="Go back"
        />
      </View>
    );
  }

  const applicant = applicantQuery.data ?? null;
  const applicantName = getApplicantDisplayName(applicant);
  const applicantAvatar = getApplicantAvatarFileId(applicant, getAvatarFileId);
  const propertyTitle = property ? getPropertyTitle(property) : 'Property';
  const imageSource = property ? getPropertyImageSource(property) : null;

  const canMoveToReviewing =
    application.status === TenantApplicationStatus.SUBMITTED;
  const canDecide =
    application.status === TenantApplicationStatus.SUBMITTED ||
    application.status === TenantApplicationStatus.REVIEWING;

  return (
    <View style={styles.root}>
      <Header
        options={{
          showBackButton: true,
          title: 'Applicant',
          titlePosition: 'center',
        }}
      />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.applicantHeader}>
            <Avatar
              size={56}
              name={applicantName}
              source={applicantAvatar ?? null}
              variant="thumb"
            />
            <View style={styles.applicantHeaderText}>
              <H2 style={styles.applicantName}>{applicantName}</H2>
              <BloomText style={styles.subtitle}>
                {t(`profile.edit.options.employmentStatus.${application.employmentStatus}`)} ·{' '}
                {formatCurrency(application.monthlyIncome)} / mo
              </BloomText>
            </View>
            <ApplicationStatusBadge status={application.status} />
          </View>

          <View style={styles.heroCard}>
            {imageSource ? (
              <Image
                source={imageSource}
                style={styles.thumb}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]} />
            )}
          </View>

          <View style={styles.card}>
            <SectionEyebrow>Property</SectionEyebrow>
            <H3 style={styles.cardHeading}>{propertyTitle}</H3>
            {property?.address ? (
              <BloomText style={styles.subtitle}>
                {[property.address.cityName, property.address.countryName]
                  .filter(Boolean)
                  .join(', ')}
              </BloomText>
            ) : null}
          </View>

          <View style={styles.card}>
            <SectionEyebrow>Tenancy</SectionEyebrow>
            <View style={styles.detailList}>
              <DetailRow label="Move-in" value={formatDate(application.moveInDate)} />
              <DetailRow
                label="Lease term"
                value={`${application.leaseTermMonths} months`}
              />
              <DetailRow
                label="Submitted"
                value={formatDate(application.submittedAt)}
              />
              {application.decidedAt ? (
                <DetailRow
                  label="Decided"
                  value={formatDate(application.decidedAt)}
                />
              ) : null}
            </View>
          </View>

          <View style={styles.card}>
            <SectionEyebrow>References</SectionEyebrow>
            {application.referenceContacts.length === 0 ? (
              <BloomText style={styles.emptyHint}>
                No references provided.
              </BloomText>
            ) : (
              <View style={styles.referenceList}>
                {application.referenceContacts.map((reference, index) => (
                  <View
                    key={`${reference.email}-${index}`}
                    style={styles.referenceCard}
                  >
                    <BloomText style={styles.referenceName}>
                      {reference.name}
                    </BloomText>
                    <BloomText style={styles.referenceMeta}>
                      {t(`profile.edit.options.referenceRelationship.${reference.relationship}`)} ·{' '}
                      {reference.phone}
                    </BloomText>
                    <BloomText style={styles.referenceMeta}>
                      {reference.email}
                    </BloomText>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.card}>
            <SectionEyebrow>Documents</SectionEyebrow>
            {application.documents.length === 0 ? (
              <BloomText style={styles.emptyHint}>
                No documents attached.
              </BloomText>
            ) : (
              <View style={styles.documentList}>
                {application.documents.map((document) => (
                  <DocumentRow key={document.url} document={document} />
                ))}
              </View>
            )}
          </View>

          {application.notes ? (
            <View style={styles.card}>
              <SectionEyebrow>Notes</SectionEyebrow>
              <BloomText style={styles.notesBody}>{application.notes}</BloomText>
            </View>
          ) : null}

          <View style={styles.actionRow}>
            <Button
              variant="secondary"
              size="medium"
              onPress={() => handleOpen('reviewing')}
              disabled={!canMoveToReviewing || updateMutation.isPending}
              style={styles.actionButton}
            >
              Mark as reviewing
            </Button>
            <Button
              variant="primary"
              size="medium"
              onPress={() => handleOpen('approve')}
              disabled={!canDecide || updateMutation.isPending}
              style={styles.actionButton}
            >
              Approve
            </Button>
            <Button
              variant="ghost"
              size="medium"
              onPress={() => handleOpen('reject')}
              disabled={!canDecide || updateMutation.isPending}
              style={styles.actionButton}
            >
              Reject
            </Button>
          </View>
        </ScrollView>

        <ConfirmDialog
          visible={pendingAction !== null}
          title={pendingAction ? reviewLabels[pendingAction].title : ''}
          message={pendingAction ? reviewLabels[pendingAction].message : ''}
          confirmLabel={
            pendingAction ? reviewLabels[pendingAction].confirmLabel : ''
          }
          confirmDestructive={pendingAction === 'reject'}
          loading={updateMutation.isPending}
          onConfirm={handleConfirm}
          onCancel={handleClose}
        >
          <TextFieldInput
            label="Notes to applicant (optional)"
            value={actionNotes}
            onChangeText={setActionNotes}
            multiline
            maxLength={4000}
            placeholder="Share next steps or a reason for your decision."
          />
        </ConfirmDialog>
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
    color: colors.muted,
  },
  heroCard: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.mutedSubtle,
    ...withShadow('sm'),
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  thumbPlaceholder: {
    backgroundColor: colors.mutedSubtle,
  },
  card: {
    backgroundColor: colors.surfaceElevated,
    padding: spacing.lg,
    borderRadius: radius.lg,
    gap: spacing.sm,
    ...withShadow('sm'),
  },
  cardHeading: {
    letterSpacing: -0.3,
  },
  detailList: {
    gap: 0,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
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
  emptyHint: {
    fontSize: 13,
    color: colors.muted,
  },
  referenceList: {
    gap: 0,
  },
  referenceCard: {
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 2,
  },
  referenceName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  referenceMeta: {
    fontSize: 12,
    color: colors.muted,
  },
  documentList: {
    gap: 0,
  },
  documentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  documentIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.mutedSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  documentMeta: {
    flex: 1,
    gap: 2,
  },
  documentName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  documentType: {
    fontSize: 12,
    color: colors.muted,
  },
  notesBody: {
    fontSize: 14,
    color: colors.COLOR_BLACK,
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

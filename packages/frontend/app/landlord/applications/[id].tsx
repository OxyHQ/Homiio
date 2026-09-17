/**
 * Landlord application detail — full applicant payload + review actions.
 *
 * Stream Q polish:
 *   - Bloom Typography, Avatar, Card sections, Item rows for documents.
 *   - Review decisions go through a Bloom Dialog holding a Textarea for notes.
 *   - An approved application links to `/contracts/new?application=<id>`, the
 *     only lease-create entry point.
 *   - Shared EmptyState / ErrorState components.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Image, Linking, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useFormatting } from '@/utils/format';
import i18next from 'i18next';
import { toast } from '@oxy.so/bloom/toast';
import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import { Item } from '@oxy.so/bloom/item';
import { useTheme } from '@oxy.so/bloom/theme';
import {
  RiAlertLine,
  RiCheckLine,
  RiCloseLine,
  RiEditLine,
  RiErrorWarningFill,
  RiExternalLinkLine,
  RiEyeLine,
  RiFileTextLine,
  RiLockLine,
  RiMailLine,
  RiUserLine,
  RiWallet3Line,
} from '@oxy.so/bloom/icons';
import * as Skeleton from '@oxy.so/bloom/skeleton';
import { Text as BloomText, H2, H3 } from '@oxy.so/bloom/typography';
import { Avatar } from '@oxy.so/bloom/avatar';
import { Textarea } from '@oxy.so/bloom/textarea';
import {
  Profile,
  TenantApplication,
  TenantApplicationDocument,
  TenantApplicationStatus,
  formatMoney,
} from '@homiio/shared-types';
import { Header } from '@/components/Header';
import { PageScrollView } from '@/components/PageScrollView';
import { ApplicationStatusBadge } from '@/components/ApplicationStatusBadge';
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

/** A tenant's declared income has no currency field; it is quoted in euros. */
const APPLICATION_INCOME_CURRENCY = 'EUR';
/** Income reads as a round figure — cents on a salary are noise. */
const INCOME_FORMAT = { minimumFractionDigits: 0, maximumFractionDigits: 0 } as const;

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

const formatDate = (raw: string): string => {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return format(date, 'EEE, MMM d, yyyy');
};

const DocIcon: React.FC<{ type: string; size: number; fill: string }> = ({ type, size, fill }) => {
  switch (type) {
    case 'id':
      return <RiUserLine width={size} height={size} fill={fill} />;
    case 'income':
      return <RiWallet3Line width={size} height={size} fill={fill} />;
    case 'reference':
      return <RiMailLine width={size} height={size} fill={fill} />;
    default:
      return <RiFileTextLine width={size} height={size} fill={fill} />;
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
  const bio = profile.personalProfile?.personalInfo?.bio;
  return bio?.trim() || profile.oxyUserId || 'Applicant';
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
  const theme = useTheme();

  return (
    <Item
      onPress={() => openDocument(document.url)}
      accessibilityRole="link"
      accessibilityLabel={`Open document ${document.filename}`}
      leading={
        <View style={[styles.documentIcon, { backgroundColor: theme.colors.backgroundSecondary }]}>
          <DocIcon type={document.type} size={18} fill={theme.colors.icon} />
        </View>
      }
      title={document.filename}
      subtitle={t(`applications.documentType.${document.type}`)}
      trailing={<RiExternalLinkLine width={18} height={18} fill={theme.colors.textSecondary} />}
    />
  );
};

interface DetailRowProps {
  label: string;
  value: string;
}

const DetailRow: React.FC<DetailRowProps> = ({ label, value }) => {
  const theme = useTheme();
  return (
    <View style={[styles.detailRow, { borderBottomColor: theme.colors.border }]}>
      <BloomText style={[styles.detailLabel, { color: theme.colors.textSecondary }]}>{label}</BloomText>
      <BloomText style={styles.detailValue}>{value}</BloomText>
    </View>
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
  const { getAvatarFileId } = useOxyAvatars([applicantQuery.data?.oxyUserId]);

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
            title: 'Applicant',
          }}
        />
        <ErrorState
          icon={RiErrorWarningFill}
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
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <Header
          options={{
            showBackButton: true,
            title: 'Applicant',
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
            title: 'Applicant',
          }}
        />
        <ErrorState
          icon={RiAlertLine}
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
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <Header
          options={{
            showBackButton: true,
            title: 'Applicant',
          }}
        />
        <ErrorState
          icon={RiLockLine}
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
          title: 'Applicant',
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
                {formatMoney(application.monthlyIncome, APPLICATION_INCOME_CURRENCY, locale, INCOME_FORMAT)} / mo
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
            <SectionEyebrow>Property</SectionEyebrow>
            <H3 style={styles.cardHeading}>{propertyTitle}</H3>
            {property?.address ? (
              <BloomText style={[styles.subtitle, secondaryText]}>
                {[property.address.cityName, property.address.countryName]
                  .filter(Boolean)
                  .join(', ')}
              </BloomText>
            ) : null}
          </Card>

          <Card variant="outlined" radius="radius-16" style={styles.card}>
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
          </Card>

          <Card variant="outlined" radius="radius-16" style={styles.card}>
            <SectionEyebrow>References</SectionEyebrow>
            {application.referenceContacts.length === 0 ? (
              <BloomText style={[styles.emptyHint, secondaryText]}>
                No references provided.
              </BloomText>
            ) : (
              <View style={styles.referenceList}>
                {application.referenceContacts.map((reference, index) => (
                  <View
                    key={`${reference.email}-${index}`}
                    style={[styles.referenceCard, { borderBottomColor: theme.colors.border }]}
                  >
                    <BloomText style={styles.referenceName}>
                      {reference.name}
                    </BloomText>
                    <BloomText style={[styles.referenceMeta, secondaryText]}>
                      {t(`profile.edit.options.referenceRelationship.${reference.relationship}`)} ·{' '}
                      {reference.phone}
                    </BloomText>
                    <BloomText style={[styles.referenceMeta, secondaryText]}>
                      {reference.email}
                    </BloomText>
                  </View>
                ))}
              </View>
            )}
          </Card>

          <Card variant="outlined" radius="radius-16" style={styles.card}>
            <SectionEyebrow>Documents</SectionEyebrow>
            {application.documents.length === 0 ? (
              <BloomText style={[styles.emptyHint, secondaryText]}>
                No documents attached.
              </BloomText>
            ) : (
              <View style={styles.documentList}>
                {application.documents.map((document) => (
                  <DocumentRow key={document.url} document={document} />
                ))}
              </View>
            )}
          </Card>

          {application.notes ? (
            <Card variant="outlined" radius="radius-16" style={styles.card}>
              <SectionEyebrow>Notes</SectionEyebrow>
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
                Create lease
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
                Mark as reviewing
              </Button>
              <Button
                variant="primary"
                size="medium"
                leadingIcon={RiCheckLine}
                onPress={() => handleOpen('approve')}
                disabled={updateMutation.isPending}
                style={styles.actionButton}
              >
                Approve
              </Button>
              <Button
                variant="ghost"
                size="medium"
                leadingIcon={RiCloseLine}
                onPress={() => handleOpen('reject')}
                disabled={updateMutation.isPending}
                style={styles.actionButton}
              >
                Reject
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
            label="Notes to applicant (optional)"
            value={actionNotes}
            onChangeText={setActionNotes}
            rows={4}
            autoResize
            maxLength={4000}
            disabled={updateMutation.isPending}
            placeholder="Share next steps or a reason for your decision."
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
  detailList: {
    gap: 0,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  detailLabel: {
    fontSize: 13,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  emptyHint: {
    fontSize: 13,
  },
  referenceList: {
    gap: 0,
  },
  referenceCard: {
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  referenceName: {
    fontSize: 14,
    fontWeight: '600',
  },
  referenceMeta: {
    fontSize: 12,
  },
  documentList: {
    gap: 0,
  },
  documentIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
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

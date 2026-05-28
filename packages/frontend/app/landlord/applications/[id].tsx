/**
 * Landlord application detail — full applicant payload + review actions.
 *
 * Allowed transitions (mirrors backend):
 *   submitted -> reviewing -> approved | rejected
 *
 * Approve / Reject both prompt for optional landlord notes inside the
 * confirm dialog (Bloom TextField).
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { toast } from 'sonner';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@oxyhq/bloom/button';
import { Text as BloomText, H3 } from '@oxyhq/bloom/typography';
import { Avatar } from '@oxyhq/bloom/avatar';
import * as TextField from '@oxyhq/bloom/text-field';
import {
  Profile,
  TenantApplication,
  TenantApplicationDocument,
  TenantApplicationStatus,
} from '@homiio/shared-types';
import { Header } from '@/components/Header';
import { ApplicationStatusBadge } from '@/components/ApplicationStatusBadge';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useProperty } from '@/hooks';
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
import { colors } from '@/styles/colors';

const IconComponent = Ionicons as unknown as React.ComponentType<{
  name: string;
  size?: number;
  color?: string;
  style?: object;
}>;

type ReviewAction = 'reviewing' | 'approve' | 'reject';

const REVIEW_TRANSITIONS: Record<ReviewAction, TenantApplicationStatus> = {
  reviewing: TenantApplicationStatus.REVIEWING,
  approve: TenantApplicationStatus.APPROVED,
  reject: TenantApplicationStatus.REJECTED,
};

const REVIEW_LABELS: Record<ReviewAction, {
  title: string;
  message: string;
  confirmLabel: string;
  successToast: string;
}> = {
  reviewing: {
    title: 'Mark as reviewing?',
    message: 'Lets the applicant know you have their application open. You can still approve or reject afterwards.',
    confirmLabel: 'Mark as reviewing',
    successToast: 'Application moved to reviewing',
  },
  approve: {
    title: 'Approve application?',
    message: 'The applicant will be notified and can move forward to sign the lease.',
    confirmLabel: 'Approve',
    successToast: 'Application approved',
  },
  reject: {
    title: 'Reject application?',
    message: 'The applicant will be notified. This cannot be undone — but they can submit a new application later.',
    confirmLabel: 'Reject',
    successToast: 'Application rejected',
  },
};

const formatEmployment = (status: string): string =>
  status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

const formatRelationship = formatEmployment;

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

const docIcon = (type: string): string => {
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
    toast.error('Could not open the document.');
  });
};

const getApplicantDisplayName = (profile: Profile | null | undefined): string => {
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

const getApplicantAvatarUrl = (
  profile: Profile | null | undefined,
): string | undefined => {
  if (!profile) return undefined;
  if (profile.oxyUserId) {
    return `https://cdn.oxy.so/avatars/${profile.oxyUserId}`;
  }
  return profile.personalProfile?.personalInfo?.avatar || profile.avatar;
};

interface DocumentRowProps {
  document: TenantApplicationDocument;
}

const DocumentRow: React.FC<DocumentRowProps> = ({ document }) => (
  <Pressable
    onPress={() => openDocument(document.url)}
    style={styles.documentRow}
    accessibilityRole="link"
    accessibilityLabel={`Open document ${document.filename}`}
  >
    <IconComponent
      name={docIcon(document.type)}
      size={20}
      color={colors.primaryDark}
    />
    <View style={styles.documentMeta}>
      <BloomText style={styles.documentName} numberOfLines={1}>
        {document.filename}
      </BloomText>
      <BloomText style={styles.documentType}>
        {formatRelationship(document.type)}
      </BloomText>
    </View>
    <IconComponent
      name="open-outline"
      size={18}
      color={colors.COLOR_BLACK_LIGHT_3}
    />
  </Pressable>
);

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

export default function LandlordApplicationDetailScreen() {
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
    queryFn: async () => profileService.getProfileById(String(application?.applicantProfileId)),
    enabled: Boolean(application?.applicantProfileId),
    staleTime: 1000 * 60 * 5,
  });

  const isLandlord = useMemo<boolean>(() => {
    if (!application || !primaryProfile) return false;
    const profileId = primaryProfile._id ?? primaryProfile.id;
    if (!profileId) return false;
    return String(application.landlordProfileId) === String(profileId);
  }, [application, primaryProfile]);

  const [pendingAction, setPendingAction] = useState<ReviewAction | null>(null);
  const [actionNotes, setActionNotes] = useState('');

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
      toast.success(REVIEW_LABELS[pendingAction].successToast);
      setPendingAction(null);
      setActionNotes('');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not update application';
      toast.error(message);
    }
  }, [id, pendingAction, actionNotes, updateMutation]);

  if (!id) {
    return (
      <View style={styles.errorView}>
        <BloomText>Invalid application id.</BloomText>
      </View>
    );
  }

  if (applicationQuery.isPending) {
    return (
      <View style={styles.loadingView}>
        <ActivityIndicator color={colors.primaryColor} />
      </View>
    );
  }

  if (applicationQuery.isError || !application) {
    return (
      <View style={styles.errorView}>
        <BloomText style={styles.errorTitle}>Application unavailable</BloomText>
        <BloomText style={styles.errorSubtitle}>
          {applicationQuery.error?.message ?? 'This application could not be loaded.'}
        </BloomText>
        <Button variant="primary" size="medium" onPress={() => router.back()}>
          Go back
        </Button>
      </View>
    );
  }

  if (!isLandlord) {
    return (
      <View style={styles.errorView}>
        <BloomText style={styles.errorTitle}>Not authorised</BloomText>
        <BloomText style={styles.errorSubtitle}>
          Only the landlord assigned to this property can review the application.
        </BloomText>
        <Button variant="primary" size="medium" onPress={() => router.back()}>
          Go back
        </Button>
      </View>
    );
  }

  const applicant = applicantQuery.data ?? null;
  const applicantName = getApplicantDisplayName(applicant);
  const applicantAvatar = getApplicantAvatarUrl(applicant);
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
            />
            <View style={styles.applicantHeaderText}>
              <H3 style={styles.applicantName}>{applicantName}</H3>
              <BloomText style={styles.subtitle}>
                {formatEmployment(application.employmentStatus)} ·{' '}
                {formatCurrency(application.monthlyIncome)} / mo
              </BloomText>
            </View>
            <ApplicationStatusBadge status={application.status} />
          </View>

          <View style={styles.thumbWrap}>
            {imageSource ? (
              <Image source={imageSource} style={styles.thumb} resizeMode="cover" />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]} />
            )}
          </View>

          <View style={styles.section}>
            <BloomText style={styles.sectionLabel}>Property</BloomText>
            <BloomText style={styles.propertyName}>{propertyTitle}</BloomText>
            {property?.address ? (
              <BloomText style={styles.subtitle}>
                {[property.address.city, property.address.country]
                  .filter(Boolean)
                  .join(', ')}
              </BloomText>
            ) : null}
          </View>

          <View style={styles.section}>
            <BloomText style={styles.sectionLabel}>Tenancy</BloomText>
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

          <View style={styles.section}>
            <BloomText style={styles.sectionLabel}>References</BloomText>
            {application.referenceContacts.length === 0 ? (
              <BloomText style={styles.emptyHint}>No references provided.</BloomText>
            ) : (
              application.referenceContacts.map((reference, index) => (
                <View key={`${reference.email}-${index}`} style={styles.referenceCard}>
                  <BloomText style={styles.referenceName}>
                    {reference.name}
                  </BloomText>
                  <BloomText style={styles.referenceMeta}>
                    {formatRelationship(reference.relationship)} · {reference.phone}
                  </BloomText>
                  <BloomText style={styles.referenceMeta}>{reference.email}</BloomText>
                </View>
              ))
            )}
          </View>

          <View style={styles.section}>
            <BloomText style={styles.sectionLabel}>Documents</BloomText>
            {application.documents.length === 0 ? (
              <BloomText style={styles.emptyHint}>No documents attached.</BloomText>
            ) : (
              application.documents.map((document) => (
                <DocumentRow key={document.url} document={document} />
              ))
            )}
          </View>

          {application.notes ? (
            <View style={styles.section}>
              <BloomText style={styles.sectionLabel}>Notes</BloomText>
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
          title={pendingAction ? REVIEW_LABELS[pendingAction].title : ''}
          message={pendingAction ? REVIEW_LABELS[pendingAction].message : ''}
          confirmLabel={pendingAction ? REVIEW_LABELS[pendingAction].confirmLabel : ''}
          confirmDestructive={pendingAction === 'reject'}
          loading={updateMutation.isPending}
          onConfirm={handleConfirm}
          onCancel={handleClose}
        >
          <TextField.Input
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
    backgroundColor: colors.primaryLight,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  loadingView: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorView: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  errorSubtitle: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    textAlign: 'center',
  },
  applicantHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 8,
  },
  applicantHeaderText: {
    flex: 1,
    gap: 2,
  },
  applicantName: {
    fontSize: 18,
    fontWeight: '700',
  },
  thumbWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  thumbPlaceholder: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
  section: {
    gap: 8,
    paddingVertical: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: colors.COLOR_BLACK_LIGHT_3,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  propertyName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  subtitle: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
  },
  detailLabel: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  emptyHint: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_4,
    fontStyle: 'italic',
  },
  referenceCard: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
  },
  referenceName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  referenceMeta: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  documentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
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
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  notesBody: {
    fontSize: 14,
    color: colors.COLOR_BLACK,
    lineHeight: 20,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionButton: {
    flex: 1,
    minWidth: 120,
  },
});

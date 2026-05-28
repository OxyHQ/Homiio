/**
 * Application detail (applicant + landlord view).
 *
 * Shows the submitted application payload. Renders role-appropriate actions:
 *  - Applicant on submitted/reviewing: "Withdraw" (confirm dialog)
 *  - Applicant on approved:            "Sign lease" (deep link placeholder)
 *  - Landlord actions live on the dedicated /landlord/applications/[id]
 *    screen so this stays focused on the applicant flow.
 *
 * Documents are linked via signed S3 URLs returned by the API.
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
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@oxyhq/bloom/button';
import { Text as BloomText, H3 } from '@oxyhq/bloom/typography';
import {
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

export default function ApplicationDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : params.id?.[0];
  const applicationQuery = useApplicationById(id);
  const updateMutation = useUpdateApplicationMutation();
  const { primaryProfile } = useProfile();

  const application = applicationQuery.data;
  const { property } = useProperty(application?.propertyId ?? '');

  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  const role = useMemo<'applicant' | 'landlord' | null>(() => {
    if (!application || !primaryProfile) return null;
    const profileId = primaryProfile._id ?? primaryProfile.id;
    if (!profileId) return null;
    if (String(application.landlordProfileId) === String(profileId)) return 'landlord';
    if (String(application.applicantProfileId) === String(profileId)) return 'applicant';
    return null;
  }, [application, primaryProfile]);

  const canWithdraw = useMemo<boolean>(() => {
    if (!application || role !== 'applicant') return false;
    return (
      application.status === TenantApplicationStatus.SUBMITTED ||
      application.status === TenantApplicationStatus.REVIEWING
    );
  }, [application, role]);

  const showSignLease = useMemo<boolean>(() => {
    if (!application) return false;
    return (
      role === 'applicant' &&
      application.status === TenantApplicationStatus.APPROVED
    );
  }, [application, role]);

  const handleWithdraw = useCallback(async () => {
    if (!id || !application) return;
    try {
      await updateMutation.mutateAsync({
        id,
        input: { status: TenantApplicationStatus.WITHDRAWN },
      });
      toast.success('Application withdrawn');
      setConfirmWithdraw(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not withdraw application';
      toast.error(message);
    }
  }, [id, application, updateMutation]);

  const handleSignLease = useCallback(() => {
    if (!id) return;
    router.push({
      pathname: '/leases/new',
      params: { application: id },
    });
  }, [id, router]);

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

  const propertyTitle = property ? getPropertyTitle(property) : 'Property';
  const imageSource = property ? getPropertyImageSource(property) : null;

  return (
    <View style={styles.root}>
      <Header
        options={{
          showBackButton: true,
          title: 'Application',
          titlePosition: 'center',
        }}
      />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.thumbWrap}>
            {imageSource ? (
              <Image source={imageSource} style={styles.thumb} resizeMode="cover" />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]} />
            )}
          </View>

          <View style={styles.section}>
            <View style={styles.headerRow}>
              <H3 style={styles.title}>{propertyTitle}</H3>
              <ApplicationStatusBadge status={application.status} />
            </View>
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
            <BloomText style={styles.sectionLabel}>Finances</BloomText>
            <DetailRow
              label="Monthly income"
              value={formatCurrency(application.monthlyIncome)}
            />
            <DetailRow
              label="Employment"
              value={formatEmployment(application.employmentStatus)}
            />
          </View>

          <View style={styles.section}>
            <BloomText style={styles.sectionLabel}>References</BloomText>
            {application.referenceContacts.length === 0 ? (
              <BloomText style={styles.emptyHint}>
                No references provided.
              </BloomText>
            ) : (
              application.referenceContacts.map((reference, index) => (
                <View key={`${reference.email}-${index}`} style={styles.referenceCard}>
                  <BloomText style={styles.referenceName}>
                    {reference.name}
                  </BloomText>
                  <BloomText style={styles.referenceMeta}>
                    {formatRelationship(reference.relationship)} ·{' '}
                    {reference.phone}
                  </BloomText>
                  <BloomText style={styles.referenceMeta}>
                    {reference.email}
                  </BloomText>
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
            {showSignLease ? (
              <Button
                variant="primary"
                size="medium"
                onPress={handleSignLease}
                style={styles.actionButton}
              >
                Sign lease
              </Button>
            ) : null}
            {canWithdraw ? (
              <Button
                variant="ghost"
                size="medium"
                onPress={() => setConfirmWithdraw(true)}
                disabled={updateMutation.isPending}
                style={styles.actionButton}
              >
                Withdraw application
              </Button>
            ) : null}
          </View>
        </ScrollView>

        <ConfirmDialog
          visible={confirmWithdraw}
          title="Withdraw application?"
          message="The landlord will see this application as withdrawn. You can submit a new one for this property afterwards."
          confirmLabel="Withdraw"
          confirmDestructive
          loading={updateMutation.isPending}
          onConfirm={handleWithdraw}
          onCancel={() => setConfirmWithdraw(false)}
        />
      </SafeAreaView>
    </View>
  );
}

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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    flex: 1,
  },
  subtitle: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: colors.COLOR_BLACK_LIGHT_3,
    letterSpacing: 0.5,
    marginBottom: 4,
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

/**
 * Contract (lease) detail — landlord + tenant view.
 *
 * Shows the lease terms, rent, signature state, an auto-generated read-only
 * payment schedule (populated once the lease is active), and documents. Actions
 * are role- and status-aware:
 *   - Sign: a party whose signature is still missing (draft / pending_signatures)
 *   - Terminate: a party while the lease is pending_signatures or active
 *   - Delete: the landlord while the lease is still a draft
 *   - Add document: any party (uploaded to the images API, metadata stored)
 *
 * Backend remains the source of truth for every transition; the UI only
 * surfaces actions the backend would accept.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Image, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { format } from 'date-fns';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { toast } from '@/lib/sonner';

import { Button } from '@oxyhq/bloom/button';
import { Loading } from '@oxyhq/bloom/loading';
import { Text as BloomText, H2 } from '@oxyhq/bloom/typography';
import { LeaseStatus } from '@homiio/shared-types';

import { Header } from '@/components/Header';
import { CardSurface } from '@/components/ui/CardSurface';
import { ErrorState } from '@/components/ui/ErrorState';
import { StatusBadge, type StatusType } from '@/components/ui/StatusBadge';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useProperty } from '@/hooks';
import { useProfile } from '@/context/ProfileContext';
import {
  useLease,
  useSignLease,
  useTerminateLease,
  useDeleteLease,
  useUploadLeaseDocument,
} from '@/hooks/useLeaseQueries';
import { getPropertyImageSource, getPropertyTitle } from '@/utils/propertyUtils';
import { colors } from '@/styles/colors';
import { radius, spacing, tracker } from '@/constants/styles';

type Role = 'landlord' | 'tenant' | 'cotenant';

const formatDate = (raw?: string): string => {
  if (!raw) return '—';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return format(date, 'MMM d, yyyy');
};

const formatMoney = (amount?: number, currency?: string): string => {
  if (amount === undefined || amount === null) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} ${currency ?? ''}`.trim();
  }
};

const openDocument = (url: string): void => {
  if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  Linking.openURL(url).catch(() => toast.error('Could not open the document.'));
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

export default function ContractDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : params.id?.[0];

  const leaseQuery = useLease(id);
  const lease = leaseQuery.data;
  const { primaryProfile } = useProfile();
  const { property: fetchedProperty } = useProperty(lease?.propertyId ?? '');

  const signMutation = useSignLease(id ?? '');
  const terminateMutation = useTerminateLease(id ?? '');
  const deleteMutation = useDeleteLease();
  const uploadMutation = useUploadLeaseDocument(id ?? '');

  const [pendingAction, setPendingAction] = useState<'sign' | 'terminate' | 'delete' | null>(
    null,
  );

  const role = useMemo<Role | null>(() => {
    if (!lease || !primaryProfile) return null;
    const profileId = String(primaryProfile._id ?? primaryProfile.id ?? '');
    if (!profileId) return null;
    if (lease.landlordProfileId === profileId) return 'landlord';
    if (lease.tenantProfileId === profileId) return 'tenant';
    if ((lease.coTenants ?? []).some((ct) => ct.profileId === profileId)) return 'cotenant';
    return null;
  }, [lease, primaryProfile]);

  const handleSign = useCallback(async () => {
    if (!id) return;
    try {
      await signMutation.mutateAsync({ signature: 'accepted-in-app', acceptTerms: true });
      toast.success('Lease signed');
      setPendingAction(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not sign the lease');
      setPendingAction(null);
    }
  }, [id, signMutation]);

  const handleTerminate = useCallback(async () => {
    if (!id) return;
    try {
      await terminateMutation.mutateAsync({});
      toast.success('Lease terminated');
      setPendingAction(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not terminate the lease');
      setPendingAction(null);
    }
  }, [id, terminateMutation]);

  const handleDelete = useCallback(async () => {
    if (!id) return;
    try {
      await deleteMutation.mutateAsync(id);
      toast.success('Draft deleted');
      setPendingAction(null);
      router.back();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete the draft');
      setPendingAction(null);
    }
  }, [id, deleteMutation, router]);

  const handleAddDocument = useCallback(async () => {
    if (!id) return;
    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== 'granted') {
        toast.error('Media library permission is required to attach a document.');
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    try {
      await uploadMutation.mutateAsync({
        uri: asset.uri,
        name: asset.fileName ?? `lease-document-${Date.now()}.jpg`,
        type: 'other',
      });
      toast.success('Document added');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add the document');
    }
  }, [id, uploadMutation]);

  const header = (
    <Header
      options={{ showBackButton: true, title: 'Contract', titlePosition: 'center' }}
    />
  );

  if (!id) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.centerWrap}>
          <ErrorState
            icon="warning-outline"
            title="Invalid contract id"
            description="The link is missing the contract reference."
            retryLabel="Go back"
            onRetry={() => router.back()}
          />
        </View>
      </View>
    );
  }

  if (leaseQuery.isPending) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.centerWrap}>
          <Loading variant="spinner" size="medium" />
        </View>
      </View>
    );
  }

  if (leaseQuery.isError || !lease) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.centerWrap}>
          <ErrorState
            title="Contract unavailable"
            description={leaseQuery.error?.message ?? 'This contract could not be loaded.'}
            retryLabel="Go back"
            onRetry={() => router.back()}
          />
        </View>
      </View>
    );
  }

  const property = lease.property ?? fetchedProperty;
  const propertyTitle = property ? getPropertyTitle(property) : 'Property';
  const imageSource = property ? getPropertyImageSource(property) : null;

  const isParty = role === 'landlord' || role === 'tenant';
  const mySignature =
    role === 'landlord'
      ? lease.signatures?.landlord
      : role === 'tenant'
        ? lease.signatures?.tenant
        : undefined;
  const canSign =
    isParty &&
    (lease.status === LeaseStatus.DRAFT || lease.status === LeaseStatus.PENDING_SIGNATURES) &&
    Boolean(mySignature) &&
    !mySignature?.signed;
  const canTerminate =
    isParty &&
    (lease.status === LeaseStatus.ACTIVE || lease.status === LeaseStatus.PENDING_SIGNATURES);
  const canDelete = role === 'landlord' && lease.status === LeaseStatus.DRAFT;

  const payments = lease.paymentSchedule ?? [];
  const documents = lease.documents ?? [];
  const busy =
    signMutation.isPending || terminateMutation.isPending || deleteMutation.isPending;

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
            <View style={styles.headerRow}>
              <H2 style={styles.title}>{propertyTitle}</H2>
              <StatusBadge status={lease.status as StatusType} />
            </View>
            {property?.address ? (
              <BloomText style={styles.subtitle}>
                {[property.address.cityName, property.address.countryName]
                  .filter(Boolean)
                  .join(', ')}
              </BloomText>
            ) : null}
          </CardSurface>

          <CardSurface>
            <BloomText style={styles.sectionLabel}>Term</BloomText>
            <DetailRow label="Start" value={formatDate(lease.leaseTerms?.startDate)} />
            <DetailRow label="End" value={formatDate(lease.leaseTerms?.endDate)} />
          </CardSurface>

          <CardSurface>
            <BloomText style={styles.sectionLabel}>Rent</BloomText>
            <DetailRow
              label="Monthly rent"
              value={formatMoney(lease.rentDetails?.monthlyRent, lease.rentDetails?.currency)}
            />
            {lease.rentDetails?.securityDeposit ? (
              <DetailRow
                label="Security deposit"
                value={formatMoney(lease.rentDetails.securityDeposit, lease.rentDetails.currency)}
              />
            ) : null}
            {lease.rentDetails?.dueDate ? (
              <DetailRow label="Due day" value={`Day ${lease.rentDetails.dueDate} of the month`} />
            ) : null}
          </CardSurface>

          <CardSurface>
            <BloomText style={styles.sectionLabel}>Signatures</BloomText>
            <DetailRow
              label="Landlord"
              value={lease.signatures?.landlord?.signed ? 'Signed' : 'Pending'}
            />
            <DetailRow
              label="Tenant"
              value={lease.signatures?.tenant?.signed ? 'Signed' : 'Pending'}
            />
          </CardSurface>

          {payments.length > 0 ? (
            <CardSurface>
              <BloomText style={styles.sectionLabel}>Payment schedule</BloomText>
              {payments.map((payment) => (
                <View key={payment.id} style={styles.paymentRow}>
                  <View style={styles.paymentMeta}>
                    <BloomText style={styles.paymentPrimary}>
                      {payment.description || payment.type}
                    </BloomText>
                    <BloomText style={styles.paymentSecondary}>
                      {formatDate(payment.dueDate)}
                    </BloomText>
                  </View>
                  <View style={styles.paymentAmountWrap}>
                    <BloomText style={styles.paymentAmount}>
                      {formatMoney(payment.amount, lease.rentDetails?.currency)}
                    </BloomText>
                    <StatusBadge
                      status={
                        (payment.status === 'paid'
                          ? 'completed'
                          : payment.status === 'overdue'
                            ? 'error'
                            : payment.status === 'cancelled'
                              ? 'cancelled'
                              : 'pending') as StatusType
                      }
                      size="small"
                    />
                  </View>
                </View>
              ))}
            </CardSurface>
          ) : null}

          <CardSurface>
            <View style={styles.docHeader}>
              <BloomText style={styles.sectionLabel}>Documents</BloomText>
              {isParty ? (
                <Button
                  variant="secondary"
                  size="small"
                  onPress={handleAddDocument}
                  disabled={uploadMutation.isPending}
                  loading={uploadMutation.isPending}
                  icon={<Ionicons name="add" size={16} color={colors.COLOR_BLACK} />}
                >
                  Add
                </Button>
              ) : null}
            </View>
            {documents.length === 0 ? (
              <BloomText style={styles.emptyHint}>No documents attached.</BloomText>
            ) : (
              documents.map((document) => (
                <Pressable
                  key={document.id}
                  onPress={() => openDocument(document.url)}
                  style={styles.documentRow}
                  accessibilityRole="link"
                  accessibilityLabel={`Open document ${document.name}`}
                >
                  <Ionicons name="document-text-outline" size={20} color={colors.primaryDark} />
                  <View style={styles.documentMeta}>
                    <BloomText style={styles.documentName} numberOfLines={1}>
                      {document.name}
                    </BloomText>
                    <BloomText style={styles.documentType}>
                      {document.type.replace(/_/g, ' ')}
                    </BloomText>
                  </View>
                  <Ionicons name="open-outline" size={18} color={colors.muted} />
                </Pressable>
              ))
            )}
          </CardSurface>

          {(canSign || canTerminate || canDelete) ? (
            <View style={styles.actionRow}>
              {canSign ? (
                <Button
                  variant="primary"
                  size="medium"
                  onPress={() => setPendingAction('sign')}
                  disabled={busy}
                  style={styles.actionButton}
                >
                  Sign lease
                </Button>
              ) : null}
              {canTerminate ? (
                <Button
                  variant="secondary"
                  size="medium"
                  onPress={() => setPendingAction('terminate')}
                  disabled={busy}
                  style={styles.actionButton}
                >
                  Terminate
                </Button>
              ) : null}
              {canDelete ? (
                <Button
                  variant="ghost"
                  size="medium"
                  onPress={() => setPendingAction('delete')}
                  disabled={busy}
                  style={styles.actionButton}
                >
                  Delete draft
                </Button>
              ) : null}
            </View>
          ) : null}
        </ScrollView>

        <ConfirmDialog
          visible={pendingAction === 'sign'}
          title="Sign this lease?"
          message="By signing you agree to the lease terms. Once both parties sign, the lease becomes active."
          confirmLabel="Sign"
          loading={signMutation.isPending}
          onConfirm={handleSign}
          onCancel={() => setPendingAction(null)}
        />
        <ConfirmDialog
          visible={pendingAction === 'terminate'}
          title="Terminate lease?"
          message="This records a termination notice and ends the lease. This cannot be undone."
          confirmLabel="Terminate"
          confirmDestructive
          loading={terminateMutation.isPending}
          onConfirm={handleTerminate}
          onCancel={() => setPendingAction(null)}
        />
        <ConfirmDialog
          visible={pendingAction === 'delete'}
          title="Delete draft?"
          message="This permanently removes the draft lease."
          confirmLabel="Delete"
          confirmDestructive
          loading={deleteMutation.isPending}
          onConfirm={handleDelete}
          onCancel={() => setPendingAction(null)}
        />
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
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
    gap: spacing.md,
  },
  paymentMeta: {
    flex: 1,
    gap: 2,
  },
  paymentPrimary: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
    textTransform: 'capitalize',
  },
  paymentSecondary: {
    fontSize: 12,
    color: colors.muted,
  },
  paymentAmountWrap: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  paymentAmount: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  docHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  emptyHint: {
    fontSize: 13,
    color: colors.muted,
    fontStyle: 'italic',
  },
  documentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md - 2,
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
    color: colors.muted,
    textTransform: 'capitalize',
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

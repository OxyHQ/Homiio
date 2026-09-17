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
import React, { useCallback, useMemo } from 'react';
import { Image, Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import * as ImagePicker from 'expo-image-picker';
import { toast } from '@oxy.so/bloom/toast';

import { Button } from '@oxy.so/bloom/button';
import {
  RiAddLine,
  RiAlertLine,
  RiExternalLinkLine,
  RiFileTextLine,
} from '@oxy.so/bloom/icons';
import { Item } from '@oxy.so/bloom/item';
import { useTheme } from '@oxy.so/bloom/theme';
import { Loading } from '@oxy.so/bloom/loading';
import { Text as BloomText, H2 } from '@oxy.so/bloom/typography';
import { LeaseStatus } from '@homiio/shared-types';

import { Header } from '@/components/Header';
import { Card } from '@oxy.so/bloom/card';
import { ErrorState } from '@/components/ui/ErrorState';
import { ContractStatusBadge, LeasePaymentStatusBadge } from '@/components/ContractStatusBadge';
import { confirm } from '@oxy.so/bloom/surfaces';
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
import { formatLocalized } from '@/utils/dateLocale';
import { radius, spacing, tracker } from '@/constants/styles';

type Role = 'landlord' | 'tenant' | 'cotenant';

const formatDate = (raw?: string): string => {
  if (!raw) return '—';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return formatLocalized(date, 'MMM d, yyyy');
};

const formatMoney = (amount?: number, currency?: string): string => {
  if (amount === undefined || amount === null) return '—';
  try {
    return new Intl.NumberFormat(i18next.language, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} ${currency ?? ''}`.trim();
  }
};

const openDocument = (url: string, t: (key: string) => string): void => {
  if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  Linking.openURL(url).catch(() => toast.error(t('contracts.detail.toastOpenDocumentFailed')));
};

interface DetailRowProps {
  label: string;
  value: string;
}

const DetailRow: React.FC<DetailRowProps> = ({ label, value }) => {
  const { colors } = useTheme();
  return (
    <View style={[styles.detailRow, { borderBottomColor: colors.border }]}>
      <BloomText style={[styles.detailLabel, { color: colors.textSecondary }]}>{label}</BloomText>
      <BloomText style={styles.detailValue}>{value}</BloomText>
    </View>
  );
};

export default function ContractDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : params.id?.[0];

  const { colors } = useTheme();
  const leaseQuery = useLease(id);
  const lease = leaseQuery.data;
  const { profile } = useProfile();
  const { property: fetchedProperty } = useProperty(lease?.propertyId ?? '');

  const signMutation = useSignLease(id ?? '');
  const terminateMutation = useTerminateLease(id ?? '');
  const deleteMutation = useDeleteLease();
  const uploadMutation = useUploadLeaseDocument(id ?? '');

  const role = useMemo<Role | null>(() => {
    if (!lease || !profile) return null;
    const sessionOxyUserId = profile?.oxyUserId;
    if (!sessionOxyUserId) return null;
    if (lease.landlordOxyUserId === sessionOxyUserId) return 'landlord';
    if (lease.tenantOxyUserId === sessionOxyUserId) return 'tenant';
    if ((lease.coTenants ?? []).some((ct) => ct.oxyUserId === sessionOxyUserId)) return 'cotenant';
    return null;
  }, [lease, profile]);

  const handleSign = useCallback(async () => {
    if (!id) return;
    try {
      await signMutation.mutateAsync({ signature: 'accepted-in-app', acceptTerms: true });
      toast.success(t('contracts.detail.toastSigned'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('contracts.detail.toastSignFailed'));
    }
  }, [id, signMutation, t]);

  const handleTerminate = useCallback(async () => {
    if (!id) return;
    try {
      await terminateMutation.mutateAsync({});
      toast.success(t('contracts.detail.toastTerminated'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('contracts.detail.toastTerminateFailed'));
    }
  }, [id, terminateMutation, t]);

  const handleDelete = useCallback(async () => {
    if (!id) return;
    try {
      await deleteMutation.mutateAsync(id);
      toast.success(t('contracts.detail.toastDeleted'));
      router.back();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('contracts.detail.toastDeleteFailed'));
    }
  }, [id, deleteMutation, router, t]);

  const confirmAction = useCallback(
    async (action: 'sign' | 'terminate' | 'delete') => {
      const options = {
        sign: {
          title: t('contracts.detail.confirmSignTitle'),
          description: t('contracts.detail.confirmSignExtended'),
          confirmLabel: t('contracts.detail.confirmSignAction'),
          destructive: false,
          run: handleSign,
        },
        terminate: {
          title: t('contracts.detail.confirmTerminateShortTitle'),
          description: t('contracts.detail.confirmTerminateExtended'),
          confirmLabel: t('contracts.detail.terminate'),
          destructive: true,
          run: handleTerminate,
        },
        delete: {
          title: t('contracts.detail.confirmDeleteTitle'),
          description: t('contracts.detail.confirmDeleteExtended'),
          confirmLabel: t('contracts.detail.confirmDeleteAction'),
          destructive: true,
          run: handleDelete,
        },
      }[action];
      const { run, ...prompt } = options;
      if (await confirm({ ...prompt, cancelLabel: t('common.cancel') })) {
        await run();
      }
    },
    [handleSign, handleTerminate, handleDelete, t],
  );

  const handleAddDocument = useCallback(async () => {
    if (!id) return;
    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== 'granted') {
        toast.error(t('contracts.detail.permissionRequired'));
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
      toast.success(t('contracts.detail.toastDocumentAdded'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('contracts.detail.toastDocumentFailed'));
    }
  }, [id, uploadMutation, t]);

  const header = (
    <Header
      options={{
        showBackButton: true,
        title: t('contracts.detail.title'),
      }}
    />
  );

  if (!id) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        {header}
        <View style={styles.centerWrap}>
          <ErrorState
            icon={RiAlertLine}
            title={t('contracts.detail.invalidIdTitle')}
            description={t('contracts.detail.invalidIdDescription')}
            retryLabel={t('contracts.detail.goBack')}
            onRetry={() => router.back()}
          />
        </View>
      </View>
    );
  }

  if (leaseQuery.isPending) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        {header}
        <View style={styles.centerWrap}>
          <Loading variant="spinner" size="medium" />
        </View>
      </View>
    );
  }

  if (leaseQuery.isError || !lease) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        {header}
        <View style={styles.centerWrap}>
          <ErrorState
            title={t('contracts.detail.unavailableTitle')}
            description={
              leaseQuery.error?.message ?? t('contracts.detail.unavailableDescription')
            }
            retryLabel={t('contracts.detail.goBack')}
            onRetry={() => router.back()}
          />
        </View>
      </View>
    );
  }

  const property = lease.property ?? fetchedProperty;
  const propertyTitle = property
    ? getPropertyTitle(property)
    : t('contracts.detail.propertyFallback');
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
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {header}
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.thumbWrap, { backgroundColor: colors.backgroundSecondary }]}>
            {imageSource ? (
              <Image source={imageSource} style={styles.thumb} resizeMode="cover" />
            ) : (
              <View style={styles.thumb} />
            )}
          </View>

          <Card variant="outlined" radius="radius-16" className="p-5">
            <View style={styles.headerRow}>
              <H2 style={styles.title}>{propertyTitle}</H2>
              <ContractStatusBadge status={lease.status} />
            </View>
            {property?.address ? (
              <BloomText style={[styles.subtitle, { color: colors.textSecondary }]}>
                {[property.address.cityName, property.address.countryName]
                  .filter(Boolean)
                  .join(', ')}
              </BloomText>
            ) : null}
          </Card>

          <Card variant="outlined" radius="radius-16" className="p-5">
            <BloomText style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('contracts.detail.term')}</BloomText>
            <DetailRow label={t('contracts.detail.start')} value={formatDate(lease.leaseTerms?.startDate)} />
            <DetailRow label={t('contracts.detail.end')} value={formatDate(lease.leaseTerms?.endDate)} />
          </Card>

          <Card variant="outlined" radius="radius-16" className="p-5">
            <BloomText style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('contracts.detail.rent')}</BloomText>
            <DetailRow
              label={t('contracts.detail.monthlyRent')}
              value={formatMoney(lease.rentDetails?.monthlyRent, lease.rentDetails?.currency)}
            />
            {lease.rentDetails?.securityDeposit ? (
              <DetailRow
                label={t('contracts.detail.securityDeposit')}
                value={formatMoney(lease.rentDetails.securityDeposit, lease.rentDetails.currency)}
              />
            ) : null}
            {lease.rentDetails?.dueDate ? (
              <DetailRow
                label={t('contracts.detail.dueDayLabel')}
                value={t('contracts.detail.dueDay', { day: lease.rentDetails.dueDate })}
              />
            ) : null}
          </Card>

          <Card variant="outlined" radius="radius-16" className="p-5">
            <BloomText style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('contracts.detail.signatures')}</BloomText>
            <DetailRow
              label={t('contracts.detail.landlord')}
              value={
                lease.signatures?.landlord?.signed
                  ? t('contracts.detail.signed')
                  : t('contracts.detail.signaturePending')
              }
            />
            <DetailRow
              label={t('contracts.detail.tenant')}
              value={
                lease.signatures?.tenant?.signed
                  ? t('contracts.detail.signed')
                  : t('contracts.detail.signaturePending')
              }
            />
          </Card>

          {payments.length > 0 ? (
            <Card variant="outlined" radius="radius-16" className="p-5">
              <BloomText style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('contracts.detail.payments')}</BloomText>
              {payments.map((payment) => (
                <Item
                  key={payment.id}
                  role="listitem"
                  density="compact"
                  title={payment.description || payment.type}
                  subtitle={formatDate(payment.dueDate)}
                  titleStyle={styles.paymentTitle}
                  trailing={
                    <View style={styles.paymentAmountWrap}>
                      <BloomText style={styles.paymentAmount}>
                        {formatMoney(payment.amount, lease.rentDetails?.currency)}
                      </BloomText>
                      <LeasePaymentStatusBadge status={payment.status} />
                    </View>
                  }
                />
              ))}
            </Card>
          ) : null}

          <Card variant="outlined" radius="radius-16" className="p-5">
            <View style={styles.docHeader}>
              <BloomText style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('contracts.detail.documents')}</BloomText>
              {isParty ? (
                <Button
                  variant="secondary"
                  size="small"
                  onPress={handleAddDocument}
                  disabled={uploadMutation.isPending}
                  loading={uploadMutation.isPending}
                  leadingIcon={RiAddLine}
                >
                  {t('contracts.detail.addShort')}
                </Button>
              ) : null}
            </View>
            {documents.length === 0 ? (
              <BloomText style={[styles.emptyHint, { color: colors.textSecondary }]}>{t('contracts.detail.emptyDocuments')}</BloomText>
            ) : (
              documents.map((document) => (
                <Item
                  key={document.id}
                  onPress={() => openDocument(document.url, t)}
                  accessibilityRole="link"
                  accessibilityLabel={t('contracts.detail.openDocument', { name: document.name })}
                  leading={<RiFileTextLine width={20} height={20} fill={colors.primary} />}
                  title={document.name}
                  subtitle={t(`contracts.documentType.${document.type}`)}
                  trailing={<RiExternalLinkLine width={18} height={18} fill={colors.icon} />}
                />
              ))
            )}
          </Card>

          {(canSign || canTerminate || canDelete) ? (
            <View style={styles.actionRow}>
              {canSign ? (
                <Button
                  variant="primary"
                  size="medium"
                  onPress={() => void confirmAction('sign')}
                  disabled={busy}
                  style={styles.actionButton}
                >
                  {t('contracts.detail.signLease')}
                </Button>
              ) : null}
              {canTerminate ? (
                <Button
                  variant="secondary"
                  size="medium"
                  onPress={() => void confirmAction('terminate')}
                  disabled={busy}
                  style={styles.actionButton}
                >
                  {t('contracts.detail.terminate')}
                </Button>
              ) : null}
              {canDelete ? (
                <Button
                  variant="ghost"
                  size="medium"
                  onPress={() => void confirmAction('delete')}
                  disabled={busy}
                  style={styles.actionButton}
                >
                  {t('contracts.detail.deleteDraft')}
                </Button>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
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
  paymentTitle: {
    textTransform: 'capitalize',
  },
  paymentAmountWrap: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  paymentAmount: {
    fontSize: 13,
    fontWeight: '700',
  },
  docHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  emptyHint: {
    fontSize: 13,
    fontStyle: 'italic',
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

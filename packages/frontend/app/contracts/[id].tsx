/**
 * Contract (lease) detail — landlord + tenant view.
 *
 * Bloom's tenancy family (`@oxy.so/bloom/tenancy`) end to end: the
 * `LeaseSummaryCard` (parties, term and how much of it has run, rent, deposit,
 * the next payment owed), the lease's `TenancyTimeline` — REAL events now
 * (#518 §7.4), one row per thing that happened — the read-only schedule as a
 * `RentPaymentList` (populated once the lease is active) and the documents as a
 * `DocumentList`. `components/tenancy/leaseTenancy.ts` maps the lease onto them.
 * From 1024 the history sits in a side column. Actions are role- and
 * status-aware, under the lease card:
 *   - Sign: any party whose signature is still missing, CO-TENANTS INCLUDED
 *     (draft / pending_signatures) — see `canSign` below
 *   - Terminate: a principal while the lease is pending_signatures or active
 *   - Delete: the landlord while the lease is still a draft
 *   - Add document: any party (the file itself goes to the lease's own
 *     authenticated endpoint, and a PDF is the ordinary case)
 *
 * Backend remains the source of truth for every transition; the UI only
 * surfaces actions the backend would accept.
 */
import React, { useCallback, useMemo } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as DocumentPicker from 'expo-document-picker';
import { toast } from '@oxy.so/bloom/toast';

import { Button } from '@oxy.so/bloom/button';
import { RiAddLine, RiAlertLine } from '@oxy.so/bloom/icons';
import { useTheme } from '@oxy.so/bloom/theme';
import { Loading } from '@oxy.so/bloom/loading';
import { LeaseSummaryCard } from '@oxy.so/bloom/tenancy';
import { LeaseStatus } from '@homiio/shared-types';

import { Header } from '@/components/Header';
import { ErrorState } from '@/components/ui/ErrorState';
import { ContractStatusBadge } from '@/components/ContractStatusBadge';
import { leaseSummaryProps, signingSubject } from '@/components/tenancy/leaseTenancy';
import {
  LeaseDocumentsSection,
  LeaseHistorySection,
  LeasePaymentsSection,
} from '@/components/tenancy/LeaseSections';
import { useLeaseFormatContext } from '@/components/tenancy/useLeaseFormatContext';
import { useIsDesktop } from '@/hooks/useOptimizedMediaQuery';
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
import { radius, spacing } from '@/constants/styles';

type Role = 'landlord' | 'tenant' | 'cotenant';

/**
 * What the picker offers, matching the allowlist `routes/leases.ts` enforces.
 * PDF first because it is the ordinary shape of a tenancy document.
 */
const LEASE_DOCUMENT_TYPES = ['application/pdf', 'image/*'];
/** The server's cap, repeated here only to fail fast before an upload. */
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export default function ContractDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : params.id?.[0];

  const { colors } = useTheme();
  const isDesktop = useIsDesktop();
  const leaseQuery = useLease(id);
  const lease = leaseQuery.data;
  const leases = useMemo(() => [lease], [lease]);
  const format = useLeaseFormatContext(leases);
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

  /**
   * The digest of the terms THIS render is showing (#518 §7.4).
   *
   * Read out of the query before the callback closes over it: an inline
   * `lease?.termsSha256` is an optional chain the React Compiler cannot
   * preserve as a dependency, which is a lint ERROR here rather than a warning.
   */
  const shownTermsSha256 = lease?.termsSha256;

  /**
   * Sign, bound to the version on screen.
   *
   * The server refuses the signature if the landlord amended the lease in
   * between, and the message it sends back is what the toast shows — a failure
   * a person can act on ("review the new terms"), rather than a signature
   * quietly attached to something they never read.
   *
   * Nothing is sent as the "signature" any more. It used to be the literal
   * `'accepted-in-app'`, which this file chose and the server stored verbatim
   * in a column no read could return.
   */
  const handleSign = useCallback(async () => {
    if (!id) return;
    try {
      await signMutation.mutateAsync({ acceptTerms: true, termsSha256: shownTermsSha256 });
      toast.success(t('contracts.detail.toastSigned'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('contracts.detail.toastSignFailed'));
    }
  }, [id, shownTermsSha256, signMutation, t]);

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
          // The dialog NAMES what is about to be signed — the contract document
          // if the lease has one, the terms alone if it does not (#518 §7.4).
          // `signingSubject` reproduces the server's own choice rather than
          // making a second one; naming a different document from the one the
          // signature records would be worse than naming none.
          description: lease
            ? `${t('contracts.detail.confirmSignExtended')}\n\n${signingSubject(lease, format)}`
            : t('contracts.detail.confirmSignExtended'),
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
    [format, handleSign, handleTerminate, handleDelete, lease, t],
  );

  /**
   * Pick a document and attach it.
   *
   * `DocumentPicker`, not `ImagePicker`: a tenancy agreement, an addendum and
   * an insurance certificate are PDFs far more often than photographs, and the
   * image picker could not offer one. It also needs no media-library
   * permission, because it hands back only the file the person chose.
   *
   * The size is checked here as a courtesy — the server enforces the same 10 MB
   * cap, and a person who picked a 40 MB scan deserves to be told before
   * waiting for the upload to fail.
   */
  const handleAddDocument = useCallback(async () => {
    if (!id) return;
    const result = await DocumentPicker.getDocumentAsync({
      type: LEASE_DOCUMENT_TYPES,
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    const filename = asset.name ?? `lease-document-${Date.now()}`;
    if (asset.size != null && asset.size > MAX_DOCUMENT_BYTES) {
      toast.error(t('contracts.detail.documentTooLarge', { name: filename }));
      return;
    }
    try {
      await uploadMutation.mutateAsync({
        uri: asset.uri,
        name: filename,
        filename,
        mimeType: asset.mimeType ?? undefined,
        file: asset.file,
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
  /**
   * Have I already signed? (#518 §7.4)
   *
   * Read from `signatureRecords`, which covers all three seats, with the
   * `signatures` cache as the fallback for a response that predates them. A
   * CO-TENANT can sign now — they could not before, while the lease listed them
   * as a party and `isFullySigned` read a status they had no way to reach — so
   * the old landlord/tenant-only lookup would leave the one person whose
   * signature the lease is waiting for with no button.
   */
  const mySignature = (lease.signatureRecords ?? []).some(
    (record) => record.signerOxyUserId === profile?.oxyUserId,
  )
    ? true
    : lease.signatureRecords
      ? false
      : role === 'landlord'
        ? Boolean(lease.signatures?.landlord?.signed)
        : role === 'tenant'
          ? Boolean(lease.signatures?.tenant?.signed)
          : false;
  const canSign =
    role !== null &&
    (lease.status === LeaseStatus.DRAFT || lease.status === LeaseStatus.PENDING_SIGNATURES) &&
    !mySignature;
  const canTerminate =
    isParty &&
    (lease.status === LeaseStatus.ACTIVE || lease.status === LeaseStatus.PENDING_SIGNATURES);
  const canDelete = role === 'landlord' && lease.status === LeaseStatus.DRAFT;

  const busy =
    signMutation.isPending || terminateMutation.isPending || deleteMutation.isPending;

  const actions =
    canSign || canTerminate || canDelete ? (
      <>
        {canSign ? (
          <Button
            variant="primary"
            size="small"
            onPress={() => void confirmAction('sign')}
            disabled={busy}
          >
            {t('contracts.detail.signLease')}
          </Button>
        ) : null}
        {canTerminate ? (
          <Button
            variant="secondary"
            size="small"
            onPress={() => void confirmAction('terminate')}
            disabled={busy}
          >
            {t('contracts.detail.terminate')}
          </Button>
        ) : null}
        {canDelete ? (
          <Button
            variant="ghost"
            size="small"
            onPress={() => void confirmAction('delete')}
            disabled={busy}
          >
            {t('contracts.detail.deleteDraft')}
          </Button>
        ) : null}
      </>
    ) : undefined;

  // The published city and country only — never the street line.
  const cityLine = property?.address
    ? [property.address.cityName, property.address.countryName].filter(Boolean).join(', ')
    : '';

  const history = <LeaseHistorySection lease={lease} format={format} compact={isDesktop} />;

  const thumbnail = imageSource ? (
    <View style={[styles.thumbWrap, { backgroundColor: colors.backgroundSecondary }]}>
      <Image source={imageSource} style={styles.thumb} resizeMode="cover" />
    </View>
  ) : null;

  const main = (
    <View style={styles.column}>
      <View style={styles.statusRow}>
        <ContractStatusBadge status={lease.status} />
      </View>
      <LeaseSummaryCard
        {...leaseSummaryProps(lease, propertyTitle, format)}
        subtitle={cityLine || undefined}
        headingLevel={2}
        actions={actions}
      />

      {isDesktop ? null : history}

      <LeasePaymentsSection lease={lease} format={format} />

      <LeaseDocumentsSection
        lease={lease}
        format={format}
        action={
          // Any party, co-tenants included — which is what the endpoint has
          // always accepted. `isParty` here would hide the button from exactly
          // the people this change lets sign.
          role !== null ? (
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
          ) : null
        }
      />
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {header}
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          {isDesktop ? (
            <View style={styles.wideRow}>
              {main}
              <View style={styles.aside}>
                {thumbnail}
                {history}
              </View>
            </View>
          ) : (
            <>
              {thumbnail}
              {main}
            </>
          )}
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
    paddingBottom: spacing['4xl'],
  },
  centerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing['2xl'],
  },
  wideRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing['2xl'],
  },
  column: {
    flex: 1,
    minWidth: 0,
    gap: spacing.lg,
  },
  aside: {
    width: 340,
    gap: spacing.lg,
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
  statusRow: {
    flexDirection: 'row',
  },
});

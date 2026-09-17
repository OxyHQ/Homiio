/**
 * The tenancy sections a lease is read through, shared by the contract detail
 * (`/contracts/[id]`) and My home (`/my-home`): a heading over each Bloom
 * tenancy part, with every default English string replaced by Homiio's.
 *
 * `leaseTenancy.ts` does the mapping; these only lay the parts out.
 */
import React from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { DocumentList, RentPaymentList, TenancyTimeline } from '@oxy.so/bloom/tenancy';
import { toast } from '@oxy.so/bloom/toast';
import { H3 } from '@oxy.so/bloom/typography';
import type { Lease, LeaseDocument } from '@homiio/shared-types';

import { spacing } from '@/constants/styles';
import {
  leaseDocuments,
  leaseTimeline,
  rentPayments,
  rentTotals,
  type LeaseFormatContext,
} from './leaseTenancy';

/** A section heading over a tenancy part, with an optional action on the right. */
export const LeaseSectionTitle: React.FC<{ title: string; action?: React.ReactNode }> = ({
  title,
  action,
}) => (
  <View style={styles.sectionTitle}>
    <H3 style={styles.sectionHeading}>{title}</H3>
    {action}
  </View>
);

interface SectionProps {
  lease: Lease;
  format: LeaseFormatContext;
}

/** The lease's history as a `TenancyTimeline`. `compact` suits a side column. */
export const LeaseHistorySection: React.FC<SectionProps & { compact?: boolean }> = ({
  lease,
  format,
  compact = false,
}) => {
  const { t } = useTranslation();
  return (
    <View style={styles.section}>
      <LeaseSectionTitle title={t('contracts.tenancy.history')} />
      <TenancyTimeline
        events={leaseTimeline(lease, format)}
        density={compact ? 'compact' : 'comfortable'}
        accessibilityLabel={t('contracts.tenancy.history')}
        stateLabels={{
          current: t('contracts.tenancy.stateCurrent'),
          upcoming: t('contracts.tenancy.stateUpcoming'),
        }}
      />
    </View>
  );
};

/**
 * The payment schedule as a `RentPaymentList`, or nothing while the lease has
 * no schedule (one is generated when it becomes active). No receipt button:
 * the API has no receipt to download.
 */
export const LeasePaymentsSection: React.FC<SectionProps> = ({ lease, format }) => {
  const { t } = useTranslation();
  const payments = rentPayments(lease, format);
  if (payments.length === 0) return null;
  const totals = rentTotals(lease, format);
  return (
    <View style={styles.section}>
      <LeaseSectionTitle title={t('contracts.detail.payments')} />
      <RentPaymentList
        payments={payments}
        paidThisYear={totals.paidThisYear}
        paidThisYearLabel={t('contracts.tenancy.paidThisYear')}
        outstanding={totals.hasOutstanding ? totals.outstanding : undefined}
        outstandingLabel={t('contracts.tenancy.outstanding')}
        outstandingTone={totals.hasOutstanding ? 'error' : 'default'}
        statusLabels={{
          paid: t('payments.status.paid'),
          pending: t('statusBadge.pending'),
          overdue: t('payments.status.overdue'),
          partial: t('contracts.tenancy.paymentStatus.partial'),
        }}
        columnLabels={{
          month: t('contracts.tenancy.column.payment'),
          dueDate: t('payments.dueDate'),
          method: t('contracts.tenancy.column.method'),
          amount: t('payments.amount'),
          status: t('contracts.list.columnStatus'),
        }}
        formatDueDate={(date) => t('contracts.tenancy.dueOn', { date })}
      />
    </View>
  );
};

/** Opens a lease document: a new tab on web, the OS handler on native. */
export function openLeaseDocument(document: LeaseDocument, failedLabel: string): void {
  if (Platform.OS === 'web') {
    window.open(document.url, '_blank', 'noopener,noreferrer');
    return;
  }
  Linking.openURL(document.url).catch(() => toast.error(failedLabel));
}

/** The lease's documents as a `DocumentList`, with an optional heading action (add). */
export const LeaseDocumentsSection: React.FC<SectionProps & { action?: React.ReactNode }> = ({
  lease,
  format,
  action,
}) => {
  const { t } = useTranslation();
  return (
    <View style={styles.section}>
      <LeaseSectionTitle title={t('contracts.detail.documents')} action={action} />
      <DocumentList
        documents={leaseDocuments(lease, format, (document) =>
          openLeaseDocument(document, t('contracts.detail.toastOpenDocumentFailed')),
        )}
        viewLabel={(document) => t('contracts.detail.openDocument', { name: document.name })}
        emptyLabel={t('contracts.detail.emptyDocuments')}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  sectionHeading: {
    flexShrink: 1,
  },
});

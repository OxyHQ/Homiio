/**
 * A `Lease` read as Bloom's tenancy family (`@oxy.so/bloom/tenancy`).
 *
 * Every part in that family is deterministic on purpose: it takes pre-formatted
 * strings and never reads the clock. This module is where Homiio does the
 * reading — the dates in the reader's language, the elapsed share of the lease,
 * "in 5 days" — so the contract detail and the contracts inbox describe the same
 * lease the same way.
 *
 * Nothing here is invented. A party whose Oxy account does not resolve is left
 * out rather than drawn as "Unknown"; a payment the schedule does not have is
 * not a next payment; a receipt, a document status or a signature date the API
 * did not send is simply not drawn.
 */
import type { TFunction } from 'i18next';
import { differenceInCalendarDays, formatDistanceStrict } from 'date-fns';
import {
  formatMoney,
  LeaseStatus,
  type Lease,
  type LeaseDocument,
  type LeasePayment,
} from '@homiio/shared-types';
import type {
  LeaseNextPayment,
  LeaseParty,
  LeaseSummaryCardProps,
  RentPayment,
  RentPaymentStatus,
  TenancyDocument,
  TenancyDocumentType,
  TenancyTimelineEvent,
} from '@oxy.so/bloom/tenancy';

import { formatLocalized, formatRelativeTime, getDateFnsLocale } from '@/utils/dateLocale';

/** A resolved Oxy account: a display name and an avatar file id for the `ImageResolver`. */
export interface LeasePartyIdentity {
  name: string;
  avatar?: string;
}

export type ResolveLeaseParty = (oxyUserId: string) => LeasePartyIdentity | null;

export interface LeaseFormatContext {
  t: TFunction;
  /** A BCP-47 tag from `getFormatLocale`, for money. */
  locale: string;
  resolveParty: ResolveLeaseParty;
  now?: Date;
}

/** A payment is "due" rather than "upcoming" this many days before its date. */
const DUE_SOON_DAYS = 7;

const toDate = (raw?: string): Date | null => {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatLeaseDate = (raw?: string): string => {
  const date = toDate(raw);
  return date ? formatLocalized(date, 'd MMM yyyy') : '—';
};

const money = (amount: number | undefined, lease: Lease, locale: string): string =>
  formatMoney(amount ?? 0, lease.rentDetails?.currency ?? 'EUR', locale, { maximumFractionDigits: 0 });

/** Every Oxy account a lease names, for one batched `useOxyAvatars` lookup. */
export function leasePartyIds(lease: Lease | undefined): string[] {
  if (!lease) return [];
  return [
    lease.landlordOxyUserId,
    lease.tenantOxyUserId,
    ...(lease.coTenants ?? []).map((coTenant) => coTenant.oxyUserId),
  ].filter(Boolean);
}

function leaseParties(lease: Lease, { t, resolveParty }: LeaseFormatContext): LeaseParty[] {
  const entries: [string, string][] = [
    [lease.landlordOxyUserId, t('contracts.detail.landlord')],
    [lease.tenantOxyUserId, t('contracts.detail.tenant')],
    ...(lease.coTenants ?? []).map(
      (coTenant): [string, string] => [coTenant.oxyUserId, t('contracts.tenancy.coTenant')],
    ),
  ];
  return entries.flatMap(([oxyUserId, role]) => {
    const identity = oxyUserId ? resolveParty(oxyUserId) : null;
    return identity ? [{ name: identity.name, role, avatar: identity.avatar }] : [];
  });
}

/** The first payment still owed, in due-date order. */
export function nextOwedPayment(lease: Lease): LeasePayment | undefined {
  return [...(lease.paymentSchedule ?? [])]
    .filter((payment) => payment.status === 'pending' || payment.status === 'overdue')
    .sort((a, b) => (toDate(a.dueDate)?.getTime() ?? 0) - (toDate(b.dueDate)?.getTime() ?? 0))[0];
}

function nextPayment(lease: Lease, { locale, now = new Date() }: LeaseFormatContext): LeaseNextPayment | undefined {
  const payment = nextOwedPayment(lease);
  const due = toDate(payment?.dueDate);
  if (!payment || !due) return undefined;
  const days = differenceInCalendarDays(due, now);
  const status: LeaseNextPayment['status'] =
    payment.status === 'overdue' || days < 0 ? 'overdue' : days <= DUE_SOON_DAYS ? 'due' : 'upcoming';
  return {
    // What is still owed: a part-paid instalment is not owed in full.
    amount: money(payment.amount - (payment.paidAmount ?? 0), lease, locale),
    date: formatLocalized(due, 'd MMM'),
    status,
    statusLabel: formatRelativeTime(due),
  };
}

/**
 * The card's data for a lease (everything but `actions`). The progress bar and
 * "N months left" are drawn only while the lease is ACTIVE and inside its term —
 * a draft has not started and a terminated lease did not run to its end date.
 */
export function leaseSummaryProps(
  lease: Lease,
  title: string,
  context: LeaseFormatContext,
): Omit<LeaseSummaryCardProps, 'actions'> {
  const { t, locale, now = new Date() } = context;
  const start = toDate(lease.leaseTerms?.startDate);
  const end = toDate(lease.leaseTerms?.endDate);
  const running =
    lease.status === LeaseStatus.ACTIVE && start && end && end > start && now >= start && now <= end;
  const deposit = lease.rentDetails?.securityDeposit;
  return {
    title,
    parties: leaseParties(lease, context),
    startDate: formatLeaseDate(lease.leaseTerms?.startDate),
    endDate: formatLeaseDate(lease.leaseTerms?.endDate),
    periodLabel: t('contracts.tenancy.period'),
    progress: running ? (now.getTime() - start.getTime()) / (end.getTime() - start.getTime()) : undefined,
    remainingLabel: running
      ? t('contracts.tenancy.remaining', {
          duration: formatDistanceStrict(end, now, { locale: getDateFnsLocale() }),
        })
      : undefined,
    rent: money(lease.rentDetails?.monthlyRent, lease, locale),
    rentLabel: t('contracts.detail.monthlyRent'),
    deposit: deposit ? money(deposit, lease, locale) : undefined,
    depositLabel: t('contracts.detail.securityDeposit'),
    nextPayment: nextPayment(lease, context),
    nextPaymentLabel: t('contracts.tenancy.nextPayment'),
  };
}

const RENT_STATUS: Record<Exclude<LeasePayment['status'], 'cancelled'>, RentPaymentStatus> = {
  paid: 'paid',
  pending: 'pending',
  overdue: 'overdue',
};

/**
 * The schedule as `RentPaymentList` rows, newest first.
 *
 * A CANCELLED instalment is not owed and has no Bloom status (the list knows
 * paid, pending, overdue and partial), so it is left out rather than painted in
 * a tone that would claim otherwise. A pending instalment with money already
 * received is `partial`.
 */
export function rentPayments(lease: Lease, { t, locale }: LeaseFormatContext): RentPayment[] {
  return [...(lease.paymentSchedule ?? [])]
    .filter((payment): payment is LeasePayment & { status: keyof typeof RENT_STATUS } => payment.status !== 'cancelled')
    .sort((a, b) => (toDate(b.dueDate)?.getTime() ?? 0) - (toDate(a.dueDate)?.getTime() ?? 0))
    .map((payment) => {
      const due = toDate(payment.dueDate);
      const partial =
        payment.status !== 'paid' && (payment.paidAmount ?? 0) > 0 && (payment.paidAmount ?? 0) < payment.amount;
      return {
        id: payment.id,
        month:
          payment.type === 'deposit'
            ? t('contracts.detail.securityDeposit')
            : payment.type !== 'rent'
              ? t(`contracts.tenancy.paymentType.${payment.type}`)
              : due
              ? formatLocalized(due, 'LLLL yyyy')
              : t('contracts.detail.monthlyRent'),
        dueDate: due ? formatLocalized(due, 'd MMM yyyy') : '—',
        amount: partial
          ? t('contracts.tenancy.partialAmount', {
              paid: money(payment.paidAmount, lease, locale),
              total: money(payment.amount, lease, locale),
            })
          : money(payment.amount, lease, locale),
        method: payment.paymentMethod || undefined,
        status: partial ? 'partial' : RENT_STATUS[payment.status],
      };
    });
}

/** "Paid this year" and "Outstanding", from the schedule itself. */
export function rentTotals(
  lease: Lease,
  { locale, now = new Date() }: LeaseFormatContext,
): { paidThisYear: string; outstanding: string; hasOutstanding: boolean } {
  let paid = 0;
  let outstanding = 0;
  for (const payment of lease.paymentSchedule ?? []) {
    const paidOn = toDate(payment.paidDate) ?? toDate(payment.dueDate);
    if (payment.status === 'paid' && paidOn?.getFullYear() === now.getFullYear()) {
      paid += payment.paidAmount ?? payment.amount;
    }
    if (payment.status === 'overdue') {
      outstanding += payment.amount - (payment.paidAmount ?? 0);
    }
  }
  return {
    paidThisYear: money(paid, lease, locale),
    outstanding: money(outstanding, lease, locale),
    hasOutstanding: outstanding > 0,
  };
}

const IMAGE_EXTENSION = /\.(?:jpe?g|png|webp|gif|heic|heif|avif)(?:$|\?)/i;

function documentType(document: LeaseDocument): TenancyDocumentType {
  const source = `${document.name} ${document.url}`;
  if (/\.pdf(?:$|\?|\s)/i.test(source)) return 'pdf';
  if (IMAGE_EXTENSION.test(document.name) || IMAGE_EXTENSION.test(document.url)) return 'image';
  if (/\.(?:docx?|odt|rtf)(?:$|\?|\s)/i.test(source)) return 'document';
  return 'other';
}

/** The lease's documents as `DocumentList` rows: the kind of document and when it was added. */
export function leaseDocuments(
  lease: Lease,
  { t }: LeaseFormatContext,
  onView: (document: LeaseDocument) => void,
): TenancyDocument[] {
  return (lease.documents ?? []).map((document) => ({
    id: document.id,
    name: document.name,
    type: documentType(document),
    date: [t(`contracts.documentType.${document.type}`), formatLeaseDate(document.uploadedDate)]
      .filter((part) => part && part !== '—')
      .join(' · '),
    onView: () => onView(document),
  }));
}

/**
 * The lease's history, oldest first: the draft, each party's signature, the
 * start and the end. A signature still missing is the CURRENT step while the
 * lease awaits it; dates not yet reached are upcoming. A terminated or cancelled
 * lease ends on that outcome instead of on an end date it never reached.
 */
export function leaseTimeline(lease: Lease, { t, now = new Date() }: LeaseFormatContext): TenancyTimelineEvent[] {
  const awaitingSignatures =
    lease.status === LeaseStatus.DRAFT || lease.status === LeaseStatus.PENDING_SIGNATURES;
  const signature = (
    key: 'landlord' | 'tenant',
  ): TenancyTimelineEvent => {
    const signed = lease.signatures?.[key]?.signed;
    return {
      id: `signed-${key}`,
      title: t(signed ? `contracts.tenancy.${key}Signed` : `contracts.tenancy.${key}Pending`),
      date: signed ? formatLeaseDate(lease.signatures?.[key]?.signedDate) : undefined,
      state: signed ? 'complete' : awaitingSignatures ? 'current' : 'upcoming',
      tone: signed ? 'success' : 'warning',
    };
  };
  const dated = (id: string, title: string, raw: string | undefined): TenancyTimelineEvent => {
    const date = toDate(raw);
    return {
      id,
      title,
      date: formatLeaseDate(raw),
      state: date && date <= now && !awaitingSignatures ? 'complete' : 'upcoming',
    };
  };

  const events: TenancyTimelineEvent[] = [
    { id: 'created', title: t('contracts.tenancy.created'), date: formatLeaseDate(lease.createdAt) },
    signature('landlord'),
    signature('tenant'),
    dated('start', t('contracts.tenancy.starts'), lease.leaseTerms?.startDate),
  ];
  if (lease.status === LeaseStatus.TERMINATED || lease.status === LeaseStatus.CANCELLED) {
    events.push({
      id: 'outcome',
      title: t(lease.status === LeaseStatus.TERMINATED ? 'statusBadge.terminated' : 'statusBadge.cancelled'),
      tone: 'error',
    });
  } else {
    events.push(dated('end', t('contracts.tenancy.ends'), lease.leaseTerms?.endDate));
  }
  return events;
}

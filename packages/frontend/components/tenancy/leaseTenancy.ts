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
  type LeaseEvent,
  type LeaseEventType,
  type LeasePayment,
  type LeaseSignatureRecord,
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

/**
 * Which icon a document row draws, from its NAME.
 *
 * It used to sniff the storage URL's extension too. That URL is gone from the
 * wire shape — it was an unauthenticated link to the document (#518 §7.4) — and
 * the name is what remains. New uploads are filed under the picked filename, so
 * the extension is there; an older row filed under a typed label falls through
 * to the generic icon, which is a worse icon and not a worse document.
 */
function documentType(document: LeaseDocument): TenancyDocumentType {
  if (/\.pdf(?:$|\?|\s)/i.test(document.name)) return 'pdf';
  if (IMAGE_EXTENSION.test(document.name)) return 'image';
  if (/\.(?:docx?|odt|rtf)(?:$|\?|\s)/i.test(document.name)) return 'document';
  return 'other';
}

/**
 * The lease's documents as `DocumentList` rows: the kind of document, when it
 * was added, and whether anybody has SIGNED it (#518 §7.4).
 *
 * The signed marker is drawn from `signatureRecords[].documentId` and from
 * nothing else. A screen that inferred it — "this is the lease agreement, and
 * the lease is signed, so this is the signed one" — would tick a document
 * uploaded after the signatures were made, which is exactly the claim the
 * content digest exists to stop anybody making.
 */
export function leaseDocuments(
  lease: Lease,
  { t }: LeaseFormatContext,
  onView: (document: LeaseDocument) => void,
): TenancyDocument[] {
  const signedDocumentIds = new Set(
    (lease.signatureRecords ?? [])
      .map((signature) => signature.documentId)
      .filter((id): id is string => Boolean(id)),
  );
  return (lease.documents ?? []).map((document) => ({
    id: document.id,
    name: document.name,
    type: documentType(document),
    date: [t(`contracts.documentType.${document.type}`), formatLeaseDate(document.uploadedDate)]
      .filter((part) => part && part !== '—')
      .join(' · '),
    ...(signedDocumentIds.has(document.id)
      ? {
          status: 'signed' as const,
          statusLabel: t('contracts.tenancy.documentSigned'),
        }
      : {}),
    onView: () => onView(document),
  }));
}

/** The tone each recorded event is drawn in. Absent means Bloom's default. */
const EVENT_TONE: Partial<Record<LeaseEventType, TenancyTimelineEvent['tone']>> = {
  signed: 'success',
  activated: 'success',
  amended: 'warning',
  terminated: 'error',
};

/**
 * The line under a `signed` entry: WHAT that person signed (#518 §7.4).
 *
 * Every branch describes a real state of the signature row, and the one that
 * matters most is the third: a document that predates content hashing is bound
 * by id and not by contents, so the screen says so instead of implying the
 * bytes were checked. Saying nothing at all would be the same claim, made
 * silently.
 */
function signatureDescription(
  signature: LeaseSignatureRecord,
  t: TFunction,
): string {
  const bound = signature.documentName
    ? signature.documentSha256
      ? t('contracts.tenancy.signedDocument', { name: signature.documentName })
      : t('contracts.tenancy.signedDocumentUnhashed', { name: signature.documentName })
    : t('contracts.tenancy.signedTermsOnly');
  return signature.bindsCurrentTerms
    ? bound
    : `${bound} · ${t('contracts.tenancy.signatureStale')}`;
}

/** One recorded event as a timeline entry. Everything here happened. */
function recordedEvent(
  event: LeaseEvent,
  lease: Lease,
  { t, resolveParty }: LeaseFormatContext,
): TenancyTimelineEvent {
  const signature = (lease.signatureRecords ?? []).find(
    (record) => event.type === 'signed' && record.signerOxyUserId === event.actorOxyUserId,
  );
  const actor = event.actorOxyUserId ? resolveParty(event.actorOxyUserId) : null;
  const description =
    event.type === 'signed' && signature
      ? signatureDescription(signature, t)
      : event.type === 'amended'
        ? t('contracts.tenancy.amendedInvalidates')
        : // `detail` is the document's name or the termination's reason — the
          // server's verbatim datum, never a phrase to translate. A `renewed`
          // entry's detail is the new lease's id, which is not something to
          // show a person, so it is left off.
          event.type === 'document_added' || event.type === 'terminated'
          ? event.detail
          : undefined;
  return {
    id: `event-${event.id}`,
    title: t(`contracts.tenancy.event.${event.type}`),
    date: formatLeaseDate(event.occurredAt),
    ...(actor ? { actor: actor.name } : {}),
    ...(description ? { description } : {}),
    state: 'complete',
    ...(EVENT_TONE[event.type] ? { tone: EVENT_TONE[event.type] } : {}),
  };
}

/** Whose signature the lease is still waiting for, in party order. */
function pendingSignatories(lease: Lease, { t, resolveParty }: LeaseFormatContext): TenancyTimelineEvent[] {
  const signed = new Set((lease.signatureRecords ?? []).map((record) => record.signerOxyUserId));
  const seats: { id: string; oxyUserId: string; label: string }[] = [
    { id: 'landlord', oxyUserId: lease.landlordOxyUserId, label: t('contracts.tenancy.landlordPending') },
    { id: 'tenant', oxyUserId: lease.tenantOxyUserId, label: t('contracts.tenancy.tenantPending') },
    ...(lease.coTenants ?? []).map((coTenant, index) => ({
      id: `cotenant-${index}`,
      oxyUserId: coTenant.oxyUserId,
      label: t('contracts.tenancy.coTenantPending'),
    })),
  ];
  return seats
    .filter((seat) => seat.oxyUserId && !signed.has(seat.oxyUserId))
    .map((seat) => {
      const identity = resolveParty(seat.oxyUserId);
      return {
        id: `pending-${seat.id}`,
        title: seat.label,
        ...(identity ? { actor: identity.name } : {}),
        state: 'current' as const,
        tone: 'warning' as const,
      };
    });
}

/**
 * The lease's history, oldest first — from EVENT ROWS (#518 §7.4, #519 §7.4).
 *
 * This used to invent the whole thing on every render out of `createdAt`, the
 * two signature booleans and the two term dates, so a document arriving or a
 * notice being served could not appear at all and "the landlord signed" was a
 * boolean redrawn as history. Each entry is now a row the server wrote when the
 * thing happened.
 *
 * Three kinds of entry, and the difference between them is what they claim:
 *
 *  - **Recorded events** — `state: 'complete'`, because each one is a fact.
 *  - **Pending signatures** — `state: 'current'`. Not events and never drawn as
 *    such: nobody signing is not something that happened, it is something that
 *    has not. They are here because "whose signature are we waiting for" is the
 *    question the screen exists to answer while a lease is unsigned.
 *  - **The term's dates** — scheduled facts about the lease rather than history,
 *    marked `complete` only once they are in the past. A terminated or
 *    cancelled lease gets no end date at all, because it did not reach one; its
 *    `terminated` event is already in the list above.
 *
 * ## The fallback, and why it is not a fallback for very long
 *
 * A lease created before migration 0028 has no event rows, and the list read
 * does not load them at all. `events === undefined` and `events: []` are
 * therefore both possible and neither means "nothing happened", so the old
 * derivation is kept for exactly that case — a legacy lease with an empty
 * history renders what it always did instead of an empty column.
 */
export function leaseTimeline(lease: Lease, context: LeaseFormatContext): TenancyTimelineEvent[] {
  const { t, now = new Date() } = context;
  const recorded = lease.events ?? [];
  if (recorded.length === 0) return legacyLeaseTimeline(lease, context);

  const closed =
    lease.status === LeaseStatus.TERMINATED || lease.status === LeaseStatus.CANCELLED;
  const events: TenancyTimelineEvent[] = [
    ...recorded.map((event) => recordedEvent(event, lease, context)),
    ...pendingSignatories(lease, context),
  ];

  const startDate = toDate(lease.leaseTerms?.startDate);
  events.push({
    id: 'start',
    title: t('contracts.tenancy.starts'),
    date: formatLeaseDate(lease.leaseTerms?.startDate),
    state: startDate && startDate <= now ? 'complete' : 'upcoming',
  });
  if (!closed) {
    const endDate = toDate(lease.leaseTerms?.endDate);
    events.push({
      id: 'end',
      title: t('contracts.tenancy.ends'),
      date: formatLeaseDate(lease.leaseTerms?.endDate),
      state: endDate && endDate <= now ? 'complete' : 'upcoming',
    });
  }
  return events;
}

/**
 * The pre-0028 derivation, for a lease that carries no event rows.
 *
 * Unchanged from what every lease used to get. It is kept whole rather than
 * blended into the function above, so there is no shape in which half a
 * timeline is real and half is inferred with nothing to tell them apart.
 */
function legacyLeaseTimeline(
  lease: Lease,
  { t, now = new Date() }: LeaseFormatContext,
): TenancyTimelineEvent[] {
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

/**
 * What a party is about to sign, for the confirmation dialog (#518 §7.4).
 *
 * The SERVER decides the binding — the most recent `lease_agreement` document,
 * or the terms alone — so this reproduces that choice rather than making one:
 * a dialog naming a different document from the one the signature records would
 * be worse than a dialog naming none.
 */
export function signingSubject(lease: Lease, { t }: LeaseFormatContext): string {
  const contract = [...(lease.documents ?? [])]
    .filter((document) => document.type === 'lease_agreement')
    .sort((a, b) => (toDate(b.uploadedDate)?.getTime() ?? 0) - (toDate(a.uploadedDate)?.getTime() ?? 0))[0];
  return contract
    ? t('contracts.tenancy.signingDocument', { name: contract.name })
    : t('contracts.tenancy.signingTermsOnly');
}

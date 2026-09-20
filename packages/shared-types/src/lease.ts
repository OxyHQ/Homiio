/**
 * Lease-related types shared across Homiio frontend and backend.
 *
 * The Mongoose `Lease` schema (`packages/backend/models/schemas/LeaseSchema.ts`)
 * and the `toLeaseDTO` serializer are the single authority for this shape. These
 * interfaces mirror that authority: owner references are session `landlordOxyUserId` /
 * `tenantOxyUserId`, terms live under `leaseTerms`, money under `rentDetails`,
 * and `status` uses the schema enum (`pending_signatures`, plural). There is no
 * legacy flat shape.
 */

import { Property } from './property';
import { Profile } from './profile';

export enum LeaseStatus {
  DRAFT = 'draft',
  PENDING_SIGNATURES = 'pending_signatures',
  ACTIVE = 'active',
  EXPIRED = 'expired',
  TERMINATED = 'terminated',
  CANCELLED = 'cancelled',
}

/** Currency codes accepted by the lease `rentDetails` block. */
export type LeaseCurrency = 'USD' | 'EUR' | 'GBP' | 'CAD';

export interface LeaseTerms {
  startDate: string;
  endDate: string;
  renewalOptions?: 'none' | 'automatic' | 'optional';
  renewalNoticeRequired?: number;
  terminationNoticeRequired?: number;
}

export interface LeaseRentDetails {
  monthlyRent: number;
  currency: LeaseCurrency;
  dueDate?: number;
  lateFee?: {
    amount: number;
    gracePeriod: number;
  };
  securityDeposit?: number;
  petDeposit?: number;
}

export interface LeaseSignature {
  signed: boolean;
  signedDate?: string;
  digitalSignature?: string;
}

/**
 * The two principals' signatures, as a CACHE of {@link LeaseSignatureRecord}.
 *
 * Kept because every existing contract screen reads it, and because the shape
 * answers the one question a summary needs — "is my signature still missing?" —
 * in one field. What it cannot answer is WHAT was signed, which is why
 * `Lease.signatureRecords` exists beside it and is the authority (#518 §7.4).
 */
export interface LeaseSignatures {
  landlord: LeaseSignature;
  tenant: LeaseSignature;
}

/** Which seat on the lease a signature was made from. */
export type LeaseSignatureParty = 'landlord' | 'tenant' | 'co_tenant';

/**
 * One signature, bound to what was signed (#518 §7.4, #519 §7.4).
 *
 * §7.4 requires a signature to name the version and document that were
 * displayed, and the participant who made it. The three fields that do that are
 * `termsSha256`, the `document*` pair and `signerOxyUserId`.
 */
export interface LeaseSignatureRecord {
  id: string;
  party: LeaseSignatureParty;
  signerOxyUserId: string;
  /** How they signed. One value today; see the backend schema. */
  method: 'in_app_acceptance';
  signedAt: string;
  /** The digest of the lease's terms at the instant of signing. */
  termsSha256: string;
  /**
   * Whether those terms are still the lease's current terms.
   *
   * Computed by the server rather than by comparing two digests here: the
   * canonicalization that produces them lives on the backend, and a client that
   * re-implemented it subtly wrong would draw "signed" over a version nobody
   * signed. `false` means the lease was amended after this signature.
   */
  bindsCurrentTerms: boolean;
  /** The contract document, when the lease had one. */
  documentId?: string;
  /** Its name at the time, so a screen can say what was signed. */
  documentName?: string;
  /**
   * The digest of that document's bytes.
   *
   * Absent in two different cases, and the pair with `documentId` tells them
   * apart: no document at all (both absent), and a document uploaded before
   * Homiio hashed contents (an id with no digest — the weakest binding, and
   * one a screen should say so about rather than present as bound).
   */
  documentSha256?: string;
}

/** What a tenancy timeline entry can be. */
export type LeaseEventType =
  | 'created'
  | 'amended'
  | 'signed'
  | 'activated'
  | 'document_added'
  | 'terminated'
  | 'renewed';

/**
 * One thing that HAPPENED to a tenancy (#518 §7.4).
 *
 * The timeline used to be recomputed on the client from lease scalars, so
 * anything that was not a scalar — a document arriving, a notice being served,
 * an amendment invalidating a signature — could not appear on it at all.
 */
export interface LeaseEvent {
  id: string;
  /** Monotonic within a lease. Two events in one transaction share an instant. */
  position: number;
  type: LeaseEventType;
  /** Absent on a system event; `activated` is the one that has no actor. */
  actorOxyUserId?: string;
  /**
   * The datum that made the event legible at the time — a document's name, a
   * termination's reason, a renewal's new lease id. NEVER a translated phrase:
   * the reader's language is not a property of what happened.
   */
  detail?: string;
  occurredAt: string;
}

export interface LeaseCoTenant {
  oxyUserId: string;
  role?: 'primary' | 'secondary' | 'guarantor';
  signedDate?: string;
  status?: 'pending' | 'signed' | 'declined';
}

export type LeasePaymentType = 'rent' | 'deposit' | 'fee' | 'utility';
export type LeasePaymentStatus = 'pending' | 'paid' | 'overdue' | 'cancelled';

export interface LeasePayment {
  id: string;
  dueDate: string;
  amount: number;
  type: LeasePaymentType;
  description?: string;
  status: LeasePaymentStatus;
  paidDate?: string;
  paidAmount?: number;
  paymentMethod?: string;
  transactionId?: string;
}

export type LeaseDocumentType =
  | 'lease_agreement'
  | 'addendum'
  | 'inspection_report'
  | 'insurance'
  | 'other';

export interface LeaseDocument {
  id: string;
  name: string;
  /**
   * Where to ASK for the bytes — a Homiio API path, not a link to an object.
   *
   * `url` is gone from this shape on purpose. It held
   * `<publicUrl>/api/images/file/<key>`: the unauthenticated route that also
   * serves listing photos, delivered with a year of `public` cache. A tenancy
   * agreement, an inspection report and an insurance certificate were therefore
   * permanent, shareable links held by everyone who could see the lease, and
   * the objects — which live in a private bucket — were reachable for exactly
   * that reason.
   *
   * Fetching this path requires the session, and the handler behind it proves
   * the viewer is the landlord, the tenant or a co-tenant before a byte moves.
   * It is not something `Linking.openURL` can open: see
   * `utils/privateDocument.ts` on the client.
   */
  downloadPath: string;
  type: LeaseDocumentType;
  uploadedBy: string;
  uploadedDate: string;
  /**
   * SHA-256 of the stored bytes (#518 §7.4).
   *
   * Absent on a document uploaded before Homiio recorded one. Published so a
   * party can see for themselves that the document in front of them is the one
   * a signature names, rather than being told the answer.
   */
  contentSha256?: string;
}

export interface Lease {
  id: string;
  propertyId: string;
  property?: Property;
  roomId?: string;
  landlordOxyUserId: string;
  landlord?: Profile;
  tenantOxyUserId: string;
  tenant?: Profile;
  coTenants?: LeaseCoTenant[];
  status: LeaseStatus;
  leaseTerms: LeaseTerms;
  rentDetails: LeaseRentDetails;
  signatures: LeaseSignatures;
  /**
   * The digest of the terms as this response renders them (#518 §7.4).
   *
   * Send it back on `POST /:id/sign` and the server refuses with `409` if the
   * lease changed in between, so a signature can never bind to a version its
   * signer was not shown. Optional only because an older response has none.
   */
  termsSha256?: string;
  /**
   * Every signature, with what it binds to. The authority; `signatures` above
   * is its cache.
   *
   * ABSENT rather than empty when the read did not load them — the contracts
   * list does not. `[]` means nobody has signed, which is a different fact.
   */
  signatureRecords?: LeaseSignatureRecord[];
  /** The timeline, oldest first. Same absent-vs-empty rule as above. */
  events?: LeaseEvent[];
  documents?: LeaseDocument[];
  paymentSchedule?: LeasePayment[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLeaseData {
  propertyId: string;
  tenantOxyUserId: string;
  roomId?: string;
  leaseTerms: LeaseTerms;
  rentDetails: LeaseRentDetails;
  coTenants?: LeaseCoTenant[];
}

export interface UpdateLeaseData {
  tenantOxyUserId?: string;
  roomId?: string;
  leaseTerms?: Partial<LeaseTerms>;
  rentDetails?: Partial<LeaseRentDetails>;
  coTenants?: LeaseCoTenant[];
  notes?: string;
}

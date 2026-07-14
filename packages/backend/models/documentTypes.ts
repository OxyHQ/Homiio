/**
 * Lightweight Mongoose document/model interfaces for the schemas declared
 * under `models/schemas/*`. The legacy schema files are still CJS and don't
 * expose typed documents, so these types capture the fields callers actually
 * use, plus the custom static methods registered on each schema.
 *
 * Each document type intersects `Document` with a struct of well-known fields
 * AND `Record<string, unknown>` so per-schema fields not enumerated here
 * remain accessible (subdocuments, virtuals, instance-only fields). Tightening
 * any of these is a non-breaking change.
 */

import type { Document, Model, Types } from 'mongoose';

type Id = Types.ObjectId;
type Loose = Record<string, unknown>;

/**
 * Recursively-loose nested object. Each property reads back as another
 * `Nested` value, so chained optional access keeps compiling without `any`
 * and without `unknown` short-circuiting the chain. Numeric / boolean /
 * string leaves are reachable through the same `Nested` type (every operator
 * that needs a primitive narrows the value at the call site).
 */
export interface Nested {
  [key: string]: Nested | undefined;
}

// ---------- Billing ----------

export type IBilling = Document & {
  _id: Id;
  oxyUserId: string;
  plusActive: boolean;
  plusSince?: Date;
  plusCanceledAt?: Date;
  plusStripeSubscriptionId?: string;
  fileCredits: number;
  lastPaymentAt?: Date;
  processedSessions: string[];
  founderSupporter: boolean;
  founderSince?: Date;
  createdAt: Date;
  updatedAt: Date;
  addFileCredit(amount?: number): Promise<IBilling>;
  consumeFileCredit(): Promise<{ consumed: boolean; remaining: number | 'unlimited' }>;
  activatePlus(stripeSubscriptionId?: string): Promise<IBilling>;
  deactivatePlus(): Promise<IBilling>;
  addProcessedSession(sessionId: string): Promise<IBilling>;
  isSessionProcessed(sessionId: string): boolean;
} & Loose;

export interface IBillingModel extends Model<IBilling> {
  findByOxyUserId(oxyUserId: string): Promise<IBilling | null>;
  findByStripeSubscriptionId(subscriptionId: string): Promise<IBilling | null>;
  findActiveSubscriptions(): Promise<IBilling[]>;
}

// ---------- Lease ----------

/**
 * A subdocument inside `Lease.paymentSchedule` / `Lease.documents`. Stored as
 * a regular Mongoose array, so each element is a Document with `.toJSON()` and
 * `_id`. The exact field set is open — call sites read specific keys.
 */
export type ILeaseSubdoc = Document & Loose;

export type ILease = Document & {
  _id: Id;
  propertyId: Id;
  roomId?: Id;
  landlordOxyUserId: string;
  tenantOxyUserId: string;
  coTenants: ILeaseSubdoc[];
  leaseTerms: Loose;
  rentDetails: Loose;
  paymentSchedule: Types.DocumentArray<ILeaseSubdoc>;
  documents: Types.DocumentArray<ILeaseSubdoc>;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  generatePaymentSchedule?: () => void;
  signAsLandlord(digitalSignature?: string): Promise<ILease>;
  signAsTenant(digitalSignature?: string): Promise<ILease>;
  recordPayment(paymentId: string, amount: number, paymentMethod: string, transactionId?: string): Promise<ILease>;
  scheduleInspection(inspectionData: Loose): Promise<ILease>;
} & Loose;

export interface ILeaseModel extends Model<ILease> {
  findByProperty(propertyId: Id | string, options?: Loose): Promise<ILease[]>;
  findByTenant(tenantOxyUserId: string, options?: Loose): Promise<ILease[]>;
  findByLandlord(landlordOxyUserId: string, options?: Loose): Promise<ILease[]>;
  findActive(): Promise<ILease[]>;
}

// ---------- Profile ----------

export interface IProfileChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: Date;
}

/**
 * Agency-profile slice. Stores membership/role rows and is updated through
 * the `addAgencyMember` / `removeAgencyMember` / `updateAgencyMemberRole`
 * instance methods. The remaining fields are open (Loose) — the schema stores
 * a Mixed subdocument with branding/contact details that are read directly.
 */
export type IProfile = Document & {
  _id: Id;
  oxyUserId: string;
  personalProfile?: Loose;
  chatHistory?: IProfileChatMessage[];
  createdAt: Date;
  updatedAt: Date;
} & Loose;

export interface IProfileModel extends Model<IProfile> {
  findByOxyUserId(oxyUserId: string, select?: string | null): Promise<IProfile | null>;
  findByOxyUserIdAndUpdate(
    oxyUserId: string,
    updateData: Loose,
  ): Promise<IProfile | null>;
}

// ---------- Reservation ----------

export type IReservation = Document & {
  _id: Id;
  propertyId: Id;
  guestOxyUserId: string;
  hostOxyUserId: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
} & Loose;

// ---------- Tenant Application ----------

export type ITenantApplication = Document & {
  _id: Id;
  propertyId: Id;
  applicantOxyUserId: string;
  landlordOxyUserId: string;
  status: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
} & Loose;

// ---------- Viewing Request ----------

export type IViewingRequest = Document & {
  _id: Id;
  propertyId: Id;
  status: string;
  createdAt: Date;
  updatedAt: Date;
} & Loose;

// ---------- Saved / Folders / Searches / Recent ----------

export type ISaved = Document & {
  _id: Id;
  oxyUserId?: string;
  targetType?: string;
  targetId?: Id;
  folderId?: Id;
  createdAt: Date;
  updatedAt: Date;
} & Loose;

export type ISavedSearch = Document & {
  _id: Id;
  oxyUserId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
} & Loose;

/** Each saved-property row inside a `SavedPropertyFolder.properties` array. */
export interface ISavedFolderEntry {
  propertyId: Id;
  notes?: string;
  savedAt?: Date;
  [key: string]: unknown;
}

export type ISavedPropertyFolder = Document & {
  _id: Id;
  oxyUserId: string;
  name: string;
  properties: Types.DocumentArray<ISavedFolderEntry & Document>;
  createdAt: Date;
  updatedAt: Date;
} & Loose;

export type IRecentlyViewed = Document & {
  _id: Id;
  oxyUserId: string;
  propertyId: Id;
  viewedAt: Date;
} & Loose;

// ---------- Notification ----------

export type INotification = Document & {
  _id: Id;
  type: string;
  title: string;
  read: boolean;
  createdAt: Date;
  updatedAt: Date;
} & Loose;

// ---------- Conversation ----------

export interface IConversationMessage {
  _id?: Id;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: Date;
  attachments?: Array<{ type?: string; name?: string; url?: string; size?: number }>;
}

export type IConversation = Document & {
  _id: Id;
  profileId: string;
  title: string;
  messages: IConversationMessage[];
  status: string;
  topic?: string;
  metadata?: Loose;
  sharing?: Loose;
  analytics?: Loose;
  createdAt: Date;
  updatedAt: Date;
  generateShareToken(expiresInHours?: number): Promise<IConversation>;
  revokeSharing(): Promise<IConversation>;
} & Loose;

export interface IConversationModel extends Model<IConversation> {
  findByShareToken(shareToken: string): Promise<IConversation | null>;
}

// ---------- Geo collections ----------

export type ICountry = Document & {
  _id: Id;
  code: string;
  name: string;
} & Loose;

export type IRegion = Document & {
  _id: Id;
  countryId: Id;
  name: string;
} & Loose;

export type ICity = Document & {
  _id: Id;
  countryId: Id;
  regionId?: Id;
  name: string;
  /** Recomputes and persists this city's `propertiesCount`. */
  updatePropertiesCount(): Promise<ICity>;
} & Loose;

export interface ICityModel extends Model<ICity> {
  /** Returns a chainable Query so callers can attach `.populate(...)`. */
  getPopularCities(limit?: number): import('mongoose').Query<ICity[], ICity>;
}

export type INeighborhood = Document & {
  _id: Id;
  cityId: Id;
  name: string;
} & Loose;

// ---------- Exchange / Reviews ----------

/**
 * Date-bounded availability window stored on every exchange request leg. The
 * wire shape uses ISO-date strings (see `ExchangeWindow` in shared-types) but
 * Mongoose hydrates both ends to `Date`. We type the persisted shape as
 * `start`/`end` of `Date | string` so `parseWindow` (which accepts either) is
 * happy and callers that need a true Date can narrow as needed.
 */
export interface IExchangeWindow {
  start: Date | string;
  end: Date | string;
}

export type IExchangeRequest = Document & {
  _id: Id;
  requesterOxyUserId: string;
  hostOxyUserId: string;
  propertyId: Id;
  mode: string;
  status: string;
  message?: string;
  offeredPropertyId?: Id;
  requestedWindow?: IExchangeWindow;
  offeredWindow?: IExchangeWindow;
  createdAt: Date;
  updatedAt: Date;
} & Loose;

export type IExchangeReview = Document & {
  _id: Id;
  exchangeRequestId: Id;
  reviewerOxyUserId: string;
  rating: number;
  comment?: string;
  createdAt: Date;
  updatedAt: Date;
} & Loose;

// ---------- Agency ----------

export type IAgency = Document & {
  _id: Id;
  name: string;
  normalizedName: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
} & Loose;

export interface IAgencyModel extends Model<IAgency> {
  /**
   * Resolve a raw agency name to a persisted Agency, creating it on first
   * sight. The SOLE write path for the collection. `null` when the name is
   * too short to identify an agency.
   */
  findOrCreateByName(rawName: unknown): Promise<IAgency | null>;
}

// ---------- Reports ----------

export type IListingReport = Document & {
  _id: Id;
  propertyId: Id;
  reason: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
} & Loose;

// ---------- Partners & Commissions ----------

export type IPartner = Document & {
  _id: Id;
  name: string;
  status: string;
  /** Gamification points awarded as partners refer & close deals. */
  points: number;
  createdAt: Date;
  updatedAt: Date;
} & Loose;

export type ICommission = Document & {
  _id: Id;
  partnerId: Id;
  amount: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
} & Loose;

// ---------- Images ----------

export type IImage = Document & {
  _id: Id;
  entityType: string;
  entityId: Id;
  url: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
} & Loose;

// ---------- Place POI ----------

export type IPlacePoi = Document & {
  _id: Id;
  name: string;
} & Loose;

// ---------- Roommate Request ----------

export type IRoommateRequest = Document & {
  _id: Id;
  fromOxyUserId: Id;
  toOxyUserId: Id;
  status: string;
  createdAt: Date;
  updatedAt: Date;
} & Loose;

// ---------- Roommate Relationship ----------

export type IRoommateRelationship = Document & {
  _id: Id;
  oxyUser1Id: Id;
  oxyUser2Id: Id;
  requestId?: Id;
  matchScore: number;
  status: 'active' | 'ended';
  startDate: Date;
  endDate?: Date;
  createdAt: Date;
  updatedAt: Date;
} & Loose;

// ---------- Eviction solidarity board ----------

/** GeoJSON point kept on every eviction case's `location`. */
export interface IEvictionPoint {
  type: 'Point';
  coordinates: [number, number];
}

export interface IEvictionLocation {
  label: string;
  coordinates: IEvictionPoint;
  precision: 'exact' | 'approximate';
  city?: string;
  countryCode?: string;
}

/** A single RSVP row. Stored with `select: false`; never serialized publicly. */
export interface IEvictionAttendee {
  oxyUserId: string;
  at?: Date;
}

/** An owner-authored timeline subdocument inside `EvictionCase.updates`. */
export type IEvictionUpdateSubdoc = Document & {
  _id: Id;
  message: string;
  newScheduledAt?: Date;
  newStatus?: string;
  createdAt: Date;
} & Loose;

export type IEvictionCase = Document & {
  _id: Id;
  oxyUserId: string;
  title: string;
  description: string;
  location: IEvictionLocation;
  scheduledAt: Date;
  status: string;
  agencyId?: Id;
  contactInfo?: Loose;
  coverImage?: { imageId?: Id; url?: string };
  updates: Types.DocumentArray<IEvictionUpdateSubdoc>;
  /** Selected only via `.select('+attendees')`; absent by default. */
  attendees?: IEvictionAttendee[];
  attendeeCount: number;
  createdAt: Date;
  updatedAt: Date;
} & Loose;

export type IEvictionComment = Document & {
  _id: Id;
  caseId: Id;
  oxyUserId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
} & Loose;

export type IEvictionReport = Document & {
  _id: Id;
  caseId: Id;
  reporterOxyUserId: string;
  reason: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
} & Loose;

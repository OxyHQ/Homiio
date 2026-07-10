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
  landlordProfileId: Id;
  tenantProfileId: Id;
  coTenants: ILeaseSubdoc[];
  leaseTerms: Loose;
  rentDetails: Loose;
  paymentSchedule: Types.DocumentArray<ILeaseSubdoc>;
  documents: Types.DocumentArray<ILeaseSubdoc>;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  generatePaymentSchedule?: () => void;
  signAsLandlord(ipAddress: string | undefined, digitalSignature?: string): Promise<ILease>;
  signAsTenant(ipAddress: string | undefined, digitalSignature?: string): Promise<ILease>;
  recordPayment(paymentId: string, amount: number, paymentMethod: string, transactionId?: string): Promise<ILease>;
  scheduleInspection(inspectionData: Loose): Promise<ILease>;
} & Loose;

export interface ILeaseModel extends Model<ILease> {
  findByProperty(propertyId: Id | string, options?: Loose): Promise<ILease[]>;
  findByTenant(tenantProfileId: Id | string, options?: Loose): Promise<ILease[]>;
  findByLandlord(landlordProfileId: Id | string, options?: Loose): Promise<ILease[]>;
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
export interface IAgencyMember {
  oxyUserId: string;
  role: 'owner' | 'admin' | 'member' | string;
  addedBy?: string;
  addedAt?: Date;
}

export type IAgencyProfileSlice = Loose & {
  members: IAgencyMember[];
};

export type IProfile = Document & {
  _id: Id;
  oxyUserId: string;
  profileType: string;
  isActive: boolean;
  isPrimary: boolean;
  isAnonymous?: boolean;
  personalProfile?: Loose;
  agencyProfile?: IAgencyProfileSlice;
  businessProfile?: Loose;
  cooperativeProfile?: Loose;
  chatHistory?: IProfileChatMessage[];
  createdAt: Date;
  updatedAt: Date;
  addAgencyMember(oxyUserId: string, role: string, addedBy: string): Promise<IProfile>;
  removeAgencyMember(oxyUserId: string): Promise<IProfile>;
  updateAgencyMemberRole(oxyUserId: string, newRole: string): Promise<IProfile>;
  calculateTrustScore(forceRecalculate?: boolean): Promise<unknown>;
  updateTrustScore(factor: string, value: unknown): Promise<IProfile>;
} & Loose;

export interface IProfileModel extends Model<IProfile> {
  findActiveByOxyUserId(oxyUserId: string, select?: string | null): Promise<IProfile | null>;
  findByOxyUserId(oxyUserId: string, select?: string | null): Promise<IProfile[]>;
  findByOxyUserIdAndType(oxyUserId: string, profileType: string): Promise<IProfile | null>;
  findActiveByOxyUserIdAndUpdate(
    oxyUserId: string,
    updateData: Loose,
  ): Promise<IProfile | null>;
  findAgencyMemberships?(...args: unknown[]): Promise<unknown>;
  activateProfile?(...args: unknown[]): Promise<unknown>;
}

// ---------- Reservation ----------

export type IReservation = Document & {
  _id: Id;
  propertyId: Id;
  profileId: Id;
  oxyUserId?: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
} & Loose;

// ---------- Tenant Application ----------

export type ITenantApplication = Document & {
  _id: Id;
  propertyId: Id;
  applicantProfileId: Id;
  landlordProfileId: Id;
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
  profileId?: Id;
  targetType?: string;
  targetId?: Id;
  folderId?: Id;
  createdAt: Date;
  updatedAt: Date;
} & Loose;

export type ISavedSearch = Document & {
  _id: Id;
  profileId: Id;
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
  profileId: Id;
  name: string;
  properties: Types.DocumentArray<ISavedFolderEntry & Document>;
  createdAt: Date;
  updatedAt: Date;
} & Loose;

export type IRecentlyViewed = Document & {
  _id: Id;
  profileId: Id;
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
  requesterProfileId: Id;
  hostProfileId: Id;
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
  reviewerProfileId: Id;
  rating: number;
  comment?: string;
  createdAt: Date;
  updatedAt: Date;
} & Loose;

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
  fromProfileId: Id;
  toProfileId: Id;
  status: string;
  createdAt: Date;
  updatedAt: Date;
} & Loose;

// ---------- Roommate Relationship ----------

export type IRoommateRelationship = Document & {
  _id: Id;
  profile1Id: Id;
  profile2Id: Id;
  requestId?: Id;
  matchScore: number;
  status: 'active' | 'ended';
  startDate: Date;
  endDate?: Date;
  createdAt: Date;
  updatedAt: Date;
} & Loose;

// ---------- Tip ----------

export type ITip = Document & {
  _id: Id;
  title: string;
  createdAt: Date;
  updatedAt: Date;
} & Loose;

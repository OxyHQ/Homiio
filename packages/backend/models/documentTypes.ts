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

import type { Document, Model, Query, Types } from 'mongoose';
import type {
  AvailabilityWindowStatus,
  CancellationPolicy,
  ExchangeMode,
  HousingType,
  ImageEntityType,
  ImageVariantKeys,
  ImageVariantUrls,
  LayoutType,
  OfferingType,
  PropertyPriceEthics,
  PropertyStatus,
  PropertyType,
  UtilitiesIncluded,
} from '@homiio/shared-types';

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

// ---------- Property ----------
//
// The runtime model lives in `models/schemas/PropertySchema.ts`; these are the
// types callers annotate against. They used to sit in a `models/Property.ts`
// that ALSO called `model('Property', …)` a second time — a duplicate
// registration that never fired only because every one of its importers used
// `import type`, so TypeScript erased the module entirely. That is a live
// `OverwriteModelError` waiting for the first value import, and it meant the
// authoritative schema was typed against an interface declared next to a rival
// schema nobody ran. The types moved here, where the rest of this package's
// document interfaces already live, and that file is gone.

export interface IProperty extends Document {
  _id: Id;
  oxyUserId?: string;
  addressId: Id;
  source?: string;
  sourceId?: string;
  sourceUrl?: string;
  isExternal?: boolean;
  externalContact?: {
    phone?: string;
    email?: string;
    whatsapp?: string;
    name?: string;
    agencyName?: string;
    kind?: 'owner' | 'agency' | 'private' | 'unknown';
  };
  /**
   * Restriction/nuance flags derived from the listing's free text at ingest by
   * `classifyListingContent` (external listings only). Portals bury these in
   * prose instead of structured fields; only flags that fire are present.
   */
  listingFlags?: {
    /** Rental restricted to students ("solo estudiantes", "students only"). */
    studentsOnly?: boolean;
    /** Advertised as a flat but the body rents a single room / a share. */
    roomNotFullUnit?: boolean;
    /** Seasonal / temporary lease ("temporada", "short let"), not a home. */
    temporaryOnly?: boolean;
    /** Restricted to one gender ("solo chicas", "women only"). */
    genderRestricted?: boolean;
    /** Requires proof of employment/income ("nómina", "working professionals only"). */
    workersOnly?: boolean;
    /** An agency fee is payable by the tenant/buyer ("honorarios de agencia"). */
    agencyFeePayable?: boolean;
    /** Pets not allowed ("no se admiten mascotas", "no pets"). */
    noPets?: boolean;
    /** Smoking not allowed ("no fumadores", "non-smoking"). */
    noSmoking?: boolean;
    /** No couples ("no parejas", "no couples"). */
    noCouples?: boolean;
    /** UK: no housing benefit ("no DSS"). */
    noDSS?: boolean;
    /** Best-effort detected description language (ISO 639-1). */
    detectedLanguage?: 'es' | 'ca' | 'en' | 'fr' | 'nl' | 'de' | 'it';
  };
  expiresAt?: Date;
  type: PropertyType;
  housingType?: HousingType;
  layoutType?: LayoutType;
  description?: string;
  squareFootage?: number;
  bedrooms?: number;
  bathrooms?: number;
  /** The single source of truth for how this listing is offered. */
  offerings: OfferingType[];
  /** Monthly-rent pricing, present iff `offerings` includes `LONG_TERM_RENT`. */
  longTermRent?: {
    monthlyAmount: number;
    currency: string;
    deposit?: number;
    applicationFee?: number;
    lateFee?: number;
    utilities?: UtilitiesIncluded;
  };
  /** Per-night pricing, present iff `offerings` includes `SHORT_TERM_RENT`. */
  shortTermRent?: {
    nightlyRate: number;
    currency: string;
    cleaningFee?: number;
    serviceFee?: number;
    taxesPercent?: number;
    minNights?: number;
    maxNights?: number;
    instantBook?: boolean;
    deposit?: number;
  };
  amenities?: string[];
  images?: Array<{
    /** Reference to the canonical Image document (entityType 'property'). */
    imageId?: Id;
    /** Ready-to-render URL — the stored medium variant. Preserves the legacy shape. */
    url: string;
    caption?: string;
    isPrimary?: boolean;
    order?: number;
    /** All processed variant URLs, for callers that want a specific rendition. */
    urls?: {
      original?: string;
      small?: string;
      medium?: string;
      large?: string;
    };
  }>;
  /**
   * Denormalized flag: true when `images` holds at least one entry. Kept in
   * lock-step with `images` by the schema pre-save / pre-update hooks so
   * discovery feeds can rank image-bearing listings first with an index-backed
   * sort. Always derived from `images` — never written directly.
   */
  hasImages?: boolean;
  status: PropertyStatus;
  floor?: number;
  hasElevator?: boolean;
  parkingSpaces?: number;
  yearBuilt?: number;
  furnishedStatus?: 'furnished' | 'unfurnished' | 'partially_furnished' | 'not_specified';
  utilitiesIncluded?: boolean;
  petFriendly?: boolean;
  petPolicy?: 'allowed' | 'not_allowed' | 'case_by_case' | 'not_specified';
  petFee?: number;
  parkingType?: 'none' | 'street' | 'assigned' | 'garage';
  hasBalcony?: boolean;
  hasGarden?: boolean;
  proximityToTransport?: boolean;
  proximityToSchools?: boolean;
  proximityToShopping?: boolean;
  availableFrom?: Date;
  leaseTerm?: string;
  maxGuests?: number;
  smokingAllowed?: boolean;
  partiesAllowed?: boolean;
  guestsAllowed?: boolean;
  // Short-term (vacation) calendar
  availabilityWindows?: Array<{
    start: Date;
    end: Date;
    status: AvailabilityWindowStatus;
  }>;
  cancellationPolicy?: CancellationPolicy;
  sale?: {
    price: number;
    currency: string;
    pricePerSqm?: number;
    estimatedYield?: number;
    isPriceReduced?: boolean;
    chainStatus?: 'no_chain' | 'chain' | 'unknown';
  };
  exchange?: {
    mode: ExchangeMode;
    availabilityWindows: Array<{
      start: Date;
      end: Date;
      status: AvailabilityWindowStatus;
    }>;
    minStay?: number;
    maxStay?: number;
    welcomeNote?: string;
    languages?: string[];
    mealsIncluded?: boolean;
    requiresReciprocity?: boolean;
  };
  isVerified?: boolean;
  isEcoFriendly?: boolean;
  views?: number;
  lastSaved?: Date;
  /** Soft-delete timestamp: set when the listing is archived via deleteProperty. */
  deletedAt?: Date | null;
  /**
   * Community-moderation state, written only by the CrowdSource enforcement
   * service. Never present in any editable-fields allowlist — see the schema.
   */
  moderation?: {
    restricted?: boolean;
    restrictedAt?: Date;
    restrictedByDecisionId?: string;
  };
  parentPropertyId?: Id;
  rating?: {
    average: number;
    count: number;
  };
  /** Partner attribution: set on create when the listing originated from a partner referral link. */
  sourcedByPartner?: Id;
  /** Audit copy of the referral code captured at create time (partners may rotate codes). */
  sourcedByReferralCode?: string;
  /** Relational Agency link (resolved from portal contact agency name on external listings). */
  agencyId?: Id;
  /** Server-computed ethical + market price score. */
  priceEthics?: Omit<PropertyPriceEthics, 'scoredAt'> & { scoredAt: Date };
  /** Populated runtime virtual added by the `toJSON`/`toObject` transform when `addressId` is populated. */
  address?: Record<string, unknown>;
  /** Auto-managed by `timestamps: true`. */
  createdAt: Date;
  /** Auto-managed by `timestamps: true`. */
  updatedAt: Date;
}

/**
 * Mongoose `Query` shape that the geospatial statics return. `findNearby` /
 * `findWithinRadius` are written as `async function` over an early-return
 * empty array, but their non-empty path returns a `Property.find(...).populate(...)`
 * Query. Call sites chain `.find()`, `.skip()`, `.limit()`, `.clone()`,
 * `.countDocuments()` on the result — so we expose the Query type, which is a
 * thenable that callers can also `await`.
 */
export type PropertyQuery = Query<IProperty[], IProperty>;

/** Custom statics defined on the runtime Property schema. */
export interface IPropertyModel extends Model<IProperty> {
  findByOxyUser(oxyUserId: string, options?: Record<string, unknown>): PropertyQuery;
  findAvailable(filters?: Record<string, unknown>): PropertyQuery;
  search(searchParams: Record<string, unknown>): Promise<IProperty[]>;
  /** Returns a chainable Query (or an empty array when no addresses match). */
  findNearby(longitude: number, latitude: number, maxDistance?: number): PropertyQuery;
  /** Returns a chainable Query (or an empty array when no addresses match). */
  findWithinRadius(longitude: number, latitude: number, radiusInMeters: number): PropertyQuery;
  findInPolygon(coordinates: number[][]): PropertyQuery;
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
  /**
   * Declared rather than left to `Loose`. The lease schema carries this shape
   * and `LeaseSchema.ts` describes it accurately in its own local interface;
   * omitting it here made every `lease.signatures.*` read `unknown`.
   */
  signatures: {
    landlord: { signed: boolean; signedDate?: Date; digitalSignature?: string };
    tenant: { signed: boolean; signedDate?: Date; digitalSignature?: string };
  };
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
  /**
   * Mostly `Loose` still, but the roommate settings path is declared because
   * tests and controllers read into it. Left as `Loose` it bottomed out in
   * `unknown` a level down, so every read through it was unchecked.
   */
  personalProfile?: {
    settings?: {
      roommate?: {
        enabled?: boolean;
        preferences?: {
          ageRange?: { min?: number; max?: number };
          budget?: { min?: number; max?: number };
          gender?: string;
          moveInDate?: Date;
        } & Loose;
      } & Loose;
    } & Loose;
  } & Loose;
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
  /** Cover art resolved by `cityCoverSyncService`; both are on the schema. */
  coverImageId?: Id;
  imageIds?: Id[];
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
  entityType: ImageEntityType;
  entityId: Id;
  url: string;
  /**
   * The processed-variant fields. `imageUploadService.ImageDocument` has always
   * described these accurately; leaving them off here meant a document read back
   * from the `Image` model was not assignable to the shape the service returns.
   */
  keys: ImageVariantKeys;
  urls: ImageVariantUrls;
  format: string;
  bytes: number;
  width?: number;
  height?: number;
  caption?: string;
  isPrimary?: boolean;
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

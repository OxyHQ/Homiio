/**
 * Eviction solidarity board types shared across Homiio frontend and backend.
 *
 * An eviction case is a PUBLIC notice that a bailiff is expected at a place on a
 * date, so neighbours can turn up. It is also, unavoidably, information about a
 * household that is about to lose its home — which is why every type below is
 * shaped by `docs/adr/0003-privacy-verification-publication.md` §7 rather than
 * by what would be convenient to render.
 *
 * ## The three rules this module encodes in its TYPES rather than in prose
 *
 * **The public location and the private location are two different types, and
 * only one of them has a wire representation on a public response.**
 * {@link EvictionLocationPublic} is what every board and detail response
 * carries; {@link EvictionLocationPrivate} is returned by ONE endpoint, to a
 * caller holding an unexpired, unrevoked access grant, and is never embedded in
 * an {@link EvictionCase}. A single `location` field carrying either shape
 * depending on the viewer is how an exact coordinate reaches a cache.
 *
 * **The public precision vocabulary cannot express `exact`.** ADR 0003 §3.1
 * defines a seven-level ladder; {@link EvictionPublicPrecision} is the
 * three-level subset the board may publish, so "publish this case exactly" is
 * not a value anybody can pass. Raising it would be a type change, which is a
 * decision somebody makes on purpose.
 *
 * **A coordinate rounded to three decimals is NOT the model.** It looks exact to
 * every consumer while being wrong by up to ~110 m — the worst of both. The
 * board publishes a centre AND a stated radius, so a map can draw the honest
 * uncertainty. See {@link EvictionLocationPublic.radiusMeters}.
 *
 * The affected household is not modelled at all. There is no field here for its
 * name, its contact, its composition or its unit, and that is stronger than
 * marking such fields private (ADR 0003 §7.2).
 */

import { ISODate } from './common';

/** Lifecycle of an eviction case. Defaults to `UPCOMING` at creation. */
export enum EvictionCaseStatus {
  UPCOMING = 'upcoming',
  STOPPED = 'stopped',
  POSTPONED = 'postponed',
  EXECUTED = 'executed',
  CANCELLED = 'cancelled',
}

/**
 * Which status a case may move to from each status, as one table both halves of
 * the stack read.
 *
 * `executed` and `cancelled` are TERMINAL: an eviction that happened did not
 * un-happen, and an order that was cancelled is answered by opening a new case
 * rather than by reviving this one. That is what stops a cancelled notice
 * reappearing on the `upcoming` board — the board's status filter is the second
 * half of the same guarantee, and neither alone is enough.
 *
 * Declared here rather than in the backend because the frontend must not offer a
 * transition the server will refuse: a disabled control is a better answer than
 * a 409.
 *
 * Keyed by the STRING LITERAL rather than by the enum member, deliberately. The
 * backend's column type is the literal union the CHECK is built from, and a TS
 * string enum is not indexable by a literal — so an enum-keyed table would force
 * a cast at every backend call site, which is exactly where a second, drifting
 * copy of this table gets written instead.
 */
export type EvictionCaseStatusValue = `${EvictionCaseStatus}`;

export const EVICTION_STATUS_TRANSITIONS: Readonly<
  Record<EvictionCaseStatusValue, readonly EvictionCaseStatusValue[]>
> = {
  upcoming: ['postponed', 'stopped', 'executed', 'cancelled'],
  postponed: ['upcoming', 'stopped', 'executed', 'cancelled'],
  stopped: ['upcoming', 'postponed', 'executed', 'cancelled'],
  executed: [],
  cancelled: [],
};

/** Whether `from → to` is a transition the server will accept. */
export function isValidEvictionStatusTransition(
  from: EvictionCaseStatusValue,
  to: EvictionCaseStatusValue,
): boolean {
  return EVICTION_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * How precise a PUBLIC eviction location may be.
 *
 * The subset of ADR 0003 §3.1's ladder that the board is allowed to publish, in
 * DECREASING precision order. `exact` and `building` are deliberately absent:
 * publishing either is publishing which home a bailiff is coming to, and the
 * only route to it is an access grant on a private endpoint, never a value in
 * this union.
 *
 *  - `street`              a street, no number, no unit.
 *  - `neighborhood`        the named neighbourhood only.
 *  - `approximate_radius`  a disc: a stated centre and a stated radius, with the
 *                          true point uniformly distributed inside it.
 */
export type EvictionPublicPrecision = 'street' | 'neighborhood' | 'approximate_radius';

/**
 * What every public consumer of a case sees about WHERE it is.
 *
 * `approximateCoordinates` is `[longitude, latitude]` — GeoJSON's ordering, and
 * the one place in this contract the pair is positional. It is generated
 * server-side from a fresh random offset and is NOT the stored point rounded;
 * `radiusMeters` states how far the true point may be from it.
 */
export interface EvictionLocationPublic {
  /** Street or area. Sanitised server-side to a street-or-coarser form. */
  label: string;
  city?: string;
  /** ISO-3166-1 alpha-2. */
  countryCode?: string;
  /** `[longitude, latitude]`. Absent when the precision publishes no point. */
  approximateCoordinates?: [number, number];
  precision: EvictionPublicPrecision;
  /** The radius the true point lies within, in metres. */
  radiusMeters?: number;
}

/**
 * Whether, and on whose authority, an exact location may ever be disclosed.
 *
 * `householdAuthorizedExact` is the ONE authorisation event ADR 0003 §7.3
 * accepts: the affected household asking for it. Not an RSVP, not the
 * organiser's discretion, not a signed-in flag. When it is `false` the exact
 * columns are NULL in the database — the value was never stored, which is
 * stronger than withholding it.
 */
export interface EvictionLocationAccessPolicy {
  householdAuthorizedExact: boolean;
  householdAuthorizedAt?: ISODate;
  /** Ceiling on how long any single grant may last, in hours. */
  maxGrantHours: number;
}

/**
 * The private half of a case's location.
 *
 * NEVER a field of {@link EvictionCase}. It is the body of
 * `GET /api/evictions/:id/location/exact`, served only to the holder of an
 * unexpired, unrevoked {@link EvictionLocationAccessGrant}, and every service of
 * it writes an audit row.
 */
export interface EvictionLocationPrivate {
  /** `[longitude, latitude]`. */
  exactCoordinates?: [number, number];
  exactAddress?: string;
  accessPolicy: EvictionLocationAccessPolicy;
}

/** Why an actor was given the exact location. Concrete, never "because asked". */
export enum EvictionLocationAccessPurpose {
  /** Legal representation of the affected household. */
  LEGAL_REPRESENTATION = 'legal_representation',
  /** On-the-day accompaniment coordinated with the household. */
  ACCOMPANIMENT = 'accompaniment',
  /** Arranging emergency housing for the household. */
  EMERGENCY_HOUSING = 'emergency_housing',
}

/** One actor's time-bounded, revocable permission to read the exact location. */
export interface EvictionLocationAccessGrant {
  id: string;
  caseId: string;
  granteeOxyUserId: string;
  purpose: EvictionLocationAccessPurpose;
  grantedAt: ISODate;
  expiresAt: ISODate;
  revokedAt?: ISODate;
}

/** What happened to a grant, or under it. Append-only. */
export enum EvictionLocationAccessAction {
  GRANTED = 'granted',
  REVOKED = 'revoked',
  READ = 'read',
  DENIED = 'denied',
}

/** One append-only audit row, readable by the case's accountable organiser. */
export interface EvictionLocationAccessAuditEntry {
  id: string;
  caseId: string;
  actorOxyUserId: string;
  action: EvictionLocationAccessAction;
  purpose?: EvictionLocationAccessPurpose;
  /** Why a `DENIED` row was written — expired, revoked, or never granted. */
  denialReason?: 'no_grant' | 'expired' | 'revoked' | 'not_authorized_by_household';
  createdAt: ISODate;
}

/** How to reach the organisers. Tier R; detail-only, and never in a list. */
export interface EvictionContactInfo {
  phone?: string;
  email?: string;
  telegram?: string;
  whatsapp?: string;
  instructions?: string;
}

/**
 * What has happened to a case, as a closed vocabulary.
 *
 * A timeline entry is IMMUTABLE once written — there is no route that edits one,
 * and a database trigger refuses an `UPDATE` — so a status that was later
 * corrected still shows what was published at the time. Silently rewriting the
 * original is the failure this exists to prevent.
 */
export enum EvictionTimelineEventType {
  CASE_CREATED = 'case_created',
  DATE_CHANGED = 'date_changed',
  LOCATION_PRECISION_CHANGED = 'location_precision_changed',
  INSTRUCTIONS_UPDATED = 'instructions_updated',
  POSTPONED = 'postponed',
  STOPPED = 'stopped',
  EXECUTED = 'executed',
  CANCELLED = 'cancelled',
  LEGAL_RESOURCE_ADDED = 'legal_resource_added',
  ORGANIZATION_VERIFIED = 'organization_verified',
  CORRECTION_PUBLISHED = 'correction_published',
  PRECAUTIONARY_HOLD_APPLIED = 'precautionary_hold_applied',
  NOTE = 'note',
}

/**
 * Who did it, at a precision a public timeline may carry.
 *
 * The organiser's Oxy id is already on the case, so naming it here discloses
 * nothing new. Everything else is `system` — a sweep, a report threshold — and
 * deliberately anonymous: "three people reported this" must not become "these
 * three people reported this" (ADR 0003 §5.8).
 */
export type EvictionTimelineActor =
  | { kind: 'organizer'; oxyUserId: string }
  | { kind: 'system' };

export interface EvictionTimelineEvent {
  id: string;
  /** Monotonic within a case, computed in SQL. Ties are impossible. */
  position: number;
  eventType: EvictionTimelineEventType;
  actor: EvictionTimelineActor;
  /** The organiser's explanation, or a fixed system sentence. */
  message: string;
  newScheduledAt?: ISODate;
  newStatus?: EvictionCaseStatus;
  createdAt: ISODate;
}

/** What a case needs from the people reading it. */
export enum EvictionHelpNeedType {
  PRESENCE = 'presence',
  LEGAL_SUPPORT = 'legal_support',
  TRANSLATION = 'translation',
  TRANSPORT = 'transport',
  TEMPORARY_HOUSING = 'temporary_housing',
  OUTREACH = 'outreach',
  ORGANIZATION_CONTACT = 'organization_contact',
}

/**
 * Donations are deliberately NOT a member of {@link EvictionHelpNeedType}.
 *
 * #358 puts them behind "only if a safe flow is approved" and its own
 * out-of-scope list names handling money without a financial and anti-fraud
 * review. An enum member would be the first half of that flow shipping without
 * the second.
 */
export interface EvictionHelpNeed {
  type: EvictionHelpNeedType;
  /** A public note from the organiser. Never a private contact. */
  note?: string;
}

/** A channel a collective deliberately published for itself. */
export interface EvictionOrganizationChannel {
  kind: 'website' | 'telegram' | 'mastodon' | 'email' | 'phone';
  value: string;
  label?: string;
}

/**
 * The collective coordinating a case — NOT the agency carrying the eviction out.
 *
 * `verified` is strictly stronger than authorship and is never settable through
 * any API route: it means Homiio checked a public source that identifies the
 * collective, and it exists only on curated rows. Anybody may name an
 * organisation on their own case; nobody can make one verified by doing so.
 *
 * `publicChannels` is served ONLY when `verified` is true. An unverified row's
 * channels are a third party's contact details published on the say-so of
 * somebody who is not that third party, which ADR 0003 §4.5 forbids outright.
 */
export interface EvictionOrganization {
  id: string;
  name: string;
  description?: string;
  publicChannels: EvictionOrganizationChannel[];
  verified: boolean;
  verifiedAt?: ISODate;
  /** The public source that was checked. Present only when verified. */
  verificationSource?: string;
}

/** A legal or housing resource, scoped to the jurisdiction it applies in. */
export interface JurisdictionResource {
  /** ISO-3166-1 alpha-2, uppercase. */
  countryCode: string;
  /** Homiio region id, when the resource is narrower than the country. */
  regionId?: string;
  resourceType: 'legal_aid' | 'tenant_union' | 'emergency_housing' | 'official_info';
  title: string;
  url: string;
  /** Who published it — an organisation or an authority, never "the internet". */
  source: string;
  verifiedAt: ISODate;
  validUntil?: ISODate;
  /** BCP-47 language tags. Never empty. */
  languages: string[];
}

/** A resource as the API serves it, with the id a client keys on. */
export interface JurisdictionResourceWithId extends JurisdictionResource {
  id: string;
}

/**
 * Why somebody flagged a case.
 *
 * Its own vocabulary rather than the listing one: "this location is too precise"
 * and "this exposes personal data" have no counterpart on a property listing,
 * and they are the two that carry a consequence beyond a counter.
 */
export enum EvictionReportReason {
  FALSE_INFORMATION = 'false_information',
  PERSONAL_DATA_EXPOSED = 'personal_data_exposed',
  LOCATION_TOO_PRECISE = 'location_too_precise',
  OUTDATED = 'outdated',
  HARASSMENT = 'harassment',
  SPAM = 'spam',
  DANGEROUS_CONTACT = 'dangerous_contact',
}

/**
 * The reasons that trigger a PRECAUTIONARY HOLD on the first report.
 *
 * A hold reduces the published precision to `neighborhood` and withholds the
 * free-text description until the organiser responds. It does not delete the
 * case, does not hide its existence, its date or its status, and is visible on
 * the timeline.
 *
 * One report is the threshold for these two, and that asymmetry is deliberate:
 * a wrongly-held case costs supporters some navigation, and a wrongly-published
 * one costs a household its safety. Every other reason follows the community
 * threshold the rest of Homiio uses.
 */
export const EVICTION_PRECAUTIONARY_HOLD_REASONS: readonly EvictionReportReason[] = [
  EvictionReportReason.PERSONAL_DATA_EXPOSED,
  EvictionReportReason.LOCATION_TOO_PRECISE,
];

/** Reports of any reason at or above this count mark a case disputed. */
export const EVICTION_DISPUTED_REPORT_THRESHOLD = 3;

/**
 * How a case's publication is currently constrained, and why.
 *
 * Separate from {@link EvictionCaseStatus} on purpose: a case can be both
 * `upcoming` and held, and folding "held" into the status would make the status
 * mean two things and break the transition table.
 */
export interface EvictionModerationState {
  /** Precision reduced and description withheld pending the organiser's reply. */
  precautionaryHold: boolean;
  /** Enough reports that the case's accuracy is publicly in question. */
  disputed: boolean;
  /** When the constraint was applied. */
  since?: ISODate;
}

export interface EvictionCase {
  id: string;
  /** Oxy user id of the organiser. */
  oxyUserId: string;
  title: string;
  /**
   * The organiser's description, sanitised and — under a precautionary hold —
   * withheld entirely rather than partially redacted.
   */
  description?: string;
  location: EvictionLocationPublic;
  /**
   * Whether an exact location exists AND the household authorised disclosing it.
   * A boolean, so a client can offer the request flow; never the value itself.
   */
  exactLocationAvailable: boolean;
  scheduledAt: ISODate;
  status: EvictionCaseStatus;
  moderation: EvictionModerationState;
  /** The agency carrying the eviction out, when one is named. */
  agencyId?: string;
  organization?: EvictionOrganization;
  helpNeeds: EvictionHelpNeed[];
  /**
   * How to reach the organisers. DETAIL responses only, and only for the owner
   * or a CONFIRMED supporter — an RSVP alone is not enough (ADR 0003 §7.3.1).
   * List responses never carry it for any viewer.
   */
  contactInfo?: EvictionContactInfo;
  /**
   * `true` on a detail response when the case HAS contact the viewer may not see
   * yet. Never set on a list, and never set when there is no contact at all.
   */
  contactLocked?: boolean;
  /** Why the contact is locked, so the UI can say what would unlock it. */
  contactLockReason?: 'not_attending' | 'not_confirmed' | 'revoked';
  coverImage?: { imageId?: string; url?: string };
  timeline: EvictionTimelineEvent[];
  /** People who said they will show up. The roster itself is never disclosed. */
  attendeeCount: number;
  /** Whether the viewer RSVP'd (set only for a signed-in viewer). */
  isAttending?: boolean;
  /** Whether the viewer is FOLLOWING (set only for a signed-in viewer). */
  isFollowing?: boolean;
  /** Whether the viewer owns this case (set only for a signed-in viewer). */
  isOwner?: boolean;
  /**
   * Metres from the centre the caller scoped by. Present only when the query
   * carried a centre, so it can never be reverse-engineered from a global feed.
   */
  distanceMeters?: number;
  createdAt: ISODate;
  updatedAt: ISODate;
}

/** A public comment thread entry on an eviction case. */
export interface EvictionComment {
  id: string;
  caseId: string;
  oxyUserId: string;
  body: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

/**
 * How a board request says WHERE it is asking about.
 *
 * There is no "unset" member, and that is the point: ADR 0002's second
 * invariant is that location is never implicit, so the board refuses a request
 * that names no scope rather than answering with the world. `global` is a
 * member so the world stays reachable — deliberately, by name, never by
 * omission or by a geocoding failure falling through.
 */
export type EvictionBoardScope =
  | { kind: 'global' }
  | { kind: 'city'; city: string }
  | { kind: 'bbox'; swLat: number; swLng: number; neLat: number; neLng: number }
  | { kind: 'radius'; lat: number; lng: number; radiusMeters: number }
  | { kind: 'following' }
  | { kind: 'attending' };

/** How the board is ordered. Every option ends in a stable id tie-break. */
export type EvictionBoardSort = 'soonest' | 'distance' | 'recently_updated' | 'newest';

/** Everything a board request may narrow by, beyond its scope. */
export interface EvictionBoardFilters {
  status?: EvictionCaseStatus;
  scheduledFrom?: ISODate;
  scheduledTo?: ISODate;
  organizationId?: string;
  helpNeed?: EvictionHelpNeedType;
  /** Only cases whose last change is within this many days. */
  updatedWithinDays?: number;
}

/**
 * Payload the client sends to open a new case.
 *
 * `oxyUserId`, `status`, the timeline, the roster, the moderation state, the
 * published coordinates and every organisation verification field are resolved
 * server-side and are intentionally absent. The client supplies the TRUE
 * coordinates once; the server derives the published disc from them and, unless
 * the household authorised exact publication, never stores what it was given.
 */
export interface CreateEvictionCaseData {
  title: string;
  description: string;
  location: {
    label: string;
    /** `[longitude, latitude]`. Used to derive the public disc, then discarded. */
    coordinates: [number, number];
    city?: string;
    countryCode?: string;
    /** The precision to publish at. Cannot request `exact`; that is not a member. */
    precision?: EvictionPublicPrecision;
  };
  /**
   * The affected household's own authorisation to store and share an exact
   * location. Absent or `false` means the exact coordinates are never stored.
   */
  householdAuthorizedExact?: boolean;
  /** Only stored when `householdAuthorizedExact` is true. */
  exactAddress?: string;
  scheduledAt: ISODate;
  contactInfo?: EvictionContactInfo;
  coverImage?: { imageId?: string; url?: string };
  agencyName?: string;
  organizationName?: string;
  helpNeeds?: EvictionHelpNeed[];
}

/** Fields the owner may change on an existing case (adds `status`). */
export type UpdateEvictionCaseData = Partial<CreateEvictionCaseData> & {
  status?: EvictionCaseStatus;
};

/** Payload the owner sends to append a timeline event. */
export interface CreateEvictionTimelineEventData {
  message: string;
  eventType?: EvictionTimelineEventType;
  newScheduledAt?: ISODate;
  newStatus?: EvictionCaseStatus;
}

/** Payload the client sends to report a case (the backend resolves the reporter). */
export interface CreateEvictionReportInput {
  reason: EvictionReportReason;
  details?: string;
  contactEmail?: string;
}

/** Payload the organiser sends to grant one actor the exact location. */
export interface CreateEvictionLocationGrantInput {
  granteeOxyUserId: string;
  purpose: EvictionLocationAccessPurpose;
  /** Clamped server-side to the policy's `maxGrantHours`. */
  hours: number;
}

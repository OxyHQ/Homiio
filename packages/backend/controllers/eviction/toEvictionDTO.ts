/**
 * The eviction DTO boundary — and the only place a case becomes a wire object.
 *
 * ## This file is an ALLOWLIST, and it is checked twice
 *
 * Every field of the returned object is written out by hand. There is no spread
 * of a row anywhere in this module, and there is no `...rest`. That is the first
 * check, and it is the one a reviewer can see.
 *
 * The second is stronger and is not in this file: {@link EvictionCaseRow} is
 * `Omit<row, PROTECTED_COLUMNS_BY_TABLE['eviction_cases']>`, so
 * `row.contactPhone` and `row.locationExactLongitude` do not EXIST on the input
 * type. A serializer that tries to emit an exact coordinate does not ship a
 * leak; it fails `tsc`. `__tests__/integration/evictionPrivacy.test.ts` performs
 * exactly that mutation and records the failure, because a privacy rule nothing
 * breaks on is a rule nobody knows is still there.
 *
 * ## The exact location is not a field of this type at all
 *
 * `EvictionCase` carries `exactLocationAvailable: boolean` and nothing else. The
 * private half is `EvictionLocationPrivate`, returned by one endpoint, to a
 * caller holding a live grant, with an audit row per read. A single `location`
 * field that carried either shape depending on the viewer is how an exact
 * coordinate ends up in a cache keyed only by case id.
 *
 * ## The contact block arrives as an ARGUMENT
 *
 * `toEvictionDTO` cannot query, and the five contact columns are not on its
 * input row, so a caller that wants to emit them must have called
 * `readCaseContact` deliberately. The board never does. That is the same
 * decision as the timeline and the attendee count arriving as parameters: a
 * caller who forgets gets an empty value from their own hand rather than a
 * silently different response.
 */

import {
  EvictionCaseStatus,
  EvictionHelpNeedType,
  EvictionTimelineEventType,
  type EvictionCase,
  type EvictionComment,
  type EvictionContactInfo,
  type EvictionHelpNeed,
  type EvictionLocationPublic,
  type EvictionModerationState,
  type EvictionOrganization,
  type EvictionPublicPrecision,
  type EvictionTimelineActor,
  type EvictionTimelineEvent,
} from '@homiio/shared-types';
import { EVICTION_MAX_PUBLIC_RADIUS_METERS } from '../../db/schema/evictions';
import type {
  EvictionCaseContact,
  EvictionCaseRow,
  EvictionCaseUpdateRow,
  EvictionCaseWithTimeline,
  EvictionCommentRow,
  EvictionHelpNeedRow,
  EvictionOrganizationRow,
} from '../../db/evictions/evictionRepository';

/** Why the organiser's contact is withheld from a viewer who can see the case. */
type ContactLockReason = NonNullable<EvictionCase['contactLockReason']>;

export interface ToEvictionDTOOptions {
  /** The signed-in viewer, if any — drives `isOwner`. */
  readonly viewerOxyUserId?: string | null;
  /**
   * Whether this viewer has RSVP'd, resolved by the caller.
   *
   * Left `undefined` for an anonymous viewer: the field is ABSENT from the
   * response rather than `false`, which is what tells a client "not asked" apart
   * from "asked and no" (ADR 0003 §4.1.3).
   */
  readonly isAttending?: boolean;
  /** Whether this viewer follows the case. Same absent-vs-false rule. */
  readonly isFollowing?: boolean;
  /** Whether this viewer satisfied the §7.3.1 second factor on this case. */
  readonly isConfirmedSupporter?: boolean;
  /** Whether the organiser withdrew this viewer's confirmed access. */
  readonly isRevokedSupporter?: boolean;
  /**
   * The organiser's contact, read deliberately by the caller.
   *
   * Present ONLY on detail responses. A list caller passes nothing, so contact
   * cannot reach a feed for any viewer — including the owner.
   */
  readonly contact?: EvictionCaseContact;
}

/**
 * The column value → enum member map.
 *
 * The column's type is the string-literal union the CHECK is built from, and
 * `EvictionCaseStatus` is a TypeScript enum; a literal is not assignable to one.
 * An exhaustive record is how that conversion stays compiler-checked — adding a
 * status fails to compile here until it is mapped, rather than falling through
 * to a default that quietly reports `upcoming`.
 */
const STATUS_BY_COLUMN_VALUE: Readonly<Record<EvictionCaseRow['status'], EvictionCaseStatus>> = {
  upcoming: EvictionCaseStatus.UPCOMING,
  stopped: EvictionCaseStatus.STOPPED,
  postponed: EvictionCaseStatus.POSTPONED,
  executed: EvictionCaseStatus.EXECUTED,
  cancelled: EvictionCaseStatus.CANCELLED,
};

const EVENT_TYPE_BY_COLUMN_VALUE: Readonly<
  Record<EvictionCaseUpdateRow['eventType'], EvictionTimelineEventType>
> = {
  case_created: EvictionTimelineEventType.CASE_CREATED,
  date_changed: EvictionTimelineEventType.DATE_CHANGED,
  location_precision_changed: EvictionTimelineEventType.LOCATION_PRECISION_CHANGED,
  instructions_updated: EvictionTimelineEventType.INSTRUCTIONS_UPDATED,
  postponed: EvictionTimelineEventType.POSTPONED,
  stopped: EvictionTimelineEventType.STOPPED,
  executed: EvictionTimelineEventType.EXECUTED,
  cancelled: EvictionTimelineEventType.CANCELLED,
  legal_resource_added: EvictionTimelineEventType.LEGAL_RESOURCE_ADDED,
  organization_verified: EvictionTimelineEventType.ORGANIZATION_VERIFIED,
  correction_published: EvictionTimelineEventType.CORRECTION_PUBLISHED,
  precautionary_hold_applied: EvictionTimelineEventType.PRECAUTIONARY_HOLD_APPLIED,
  note: EvictionTimelineEventType.NOTE,
};

const HELP_NEED_BY_COLUMN_VALUE: Readonly<
  Record<EvictionHelpNeedRow['needType'], EvictionHelpNeedType>
> = {
  presence: EvictionHelpNeedType.PRESENCE,
  legal_support: EvictionHelpNeedType.LEGAL_SUPPORT,
  translation: EvictionHelpNeedType.TRANSLATION,
  transport: EvictionHelpNeedType.TRANSPORT,
  temporary_housing: EvictionHelpNeedType.TEMPORARY_HOUSING,
  outreach: EvictionHelpNeedType.OUTREACH,
  organization_contact: EvictionHelpNeedType.ORGANIZATION_CONTACT,
};

/** A stored string, trimmed, with the empty case reported as absent. */
function optionalText(value: string | null): string | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

/**
 * The public location, at the precision this case is currently allowed.
 *
 * Three states, and they are not the same reduction:
 *
 *  - **Under a precautionary hold**, NO coordinate is published at all. The hold
 *    exists because somebody reported the location as too precise or as exposing
 *    personal data, and the strongest answer available without redrawing the
 *    offset is to stop pointing at anything. Redrawing would be worse than
 *    useless: every fresh draw is an independent sample around the true point,
 *    and a public observer collecting several of them can average towards it.
 *  - **Archived**, the centre stays and the radius widens to the board's
 *    maximum. The case is off the board and out of search by then, and what
 *    remains is meant to be readable as "an eviction was scheduled in that
 *    neighbourhood" — which needs a neighbourhood.
 *  - **Otherwise**, the stored centre and the stored radius, exactly as
 *    computed at write time.
 */
function toPublicLocation(row: EvictionCaseRow): EvictionLocationPublic {
  const held = row.precautionaryHoldAt !== null;
  const archived = row.archivedAt !== null;
  const precision: EvictionPublicPrecision =
    held || archived ? 'neighborhood' : row.locationPrecision;

  const base = {
    label: row.locationLabel,
    city: optionalText(row.locationCity),
    countryCode: optionalText(row.locationCountryCode),
    precision,
  };

  if (held) return base;

  return {
    ...base,
    // Longitude FIRST — GeoJSON's ordering, and the one place the named columns
    // go back to being a positional pair.
    approximateCoordinates: [row.locationLongitude, row.locationLatitude],
    radiusMeters: archived
      ? Math.max(row.locationRadiusMeters, EVICTION_MAX_PUBLIC_RADIUS_METERS)
      : row.locationRadiusMeters,
  };
}

/** The organiser's contact block, or `undefined` when every handle is empty. */
function toContactInfo(contact: EvictionCaseContact): EvictionContactInfo | undefined {
  const info: EvictionContactInfo = {
    phone: optionalText(contact.contactPhone),
    email: optionalText(contact.contactEmail),
    telegram: optionalText(contact.contactTelegram),
    whatsapp: optionalText(contact.contactWhatsapp),
    instructions: optionalText(contact.contactInstructions),
  };
  return Object.values(info).some((entry) => entry !== undefined) ? info : undefined;
}

function toCoverImage(row: EvictionCaseRow): { imageId?: string; url?: string } | undefined {
  const imageId = optionalText(row.coverImageId);
  const url = optionalText(row.coverImageUrl);
  if (!imageId && !url) return undefined;
  return { imageId, url };
}

/**
 * Who the timeline says did it.
 *
 * A NULL actor is the `system` variant and stays anonymous: a report threshold
 * firing must not become "these people reported this", which would turn the
 * timeline into a retaliation channel (ADR 0003 §5.8).
 */
function toTimelineActor(row: EvictionCaseUpdateRow): EvictionTimelineActor {
  return row.actorOxyUserId === null
    ? { kind: 'system' }
    : { kind: 'organizer', oxyUserId: row.actorOxyUserId };
}

function toTimelineEvent(row: EvictionCaseUpdateRow): EvictionTimelineEvent {
  return {
    id: row.id,
    // `Number(...)` at the boundary, not a cast: `position` is `bigint`, which
    // postgres.js decodes as a STRING on any path drizzle's own result mapper
    // does not run (a raw `db.execute`, for one). Typing it `number` and
    // shipping `"2"` is the failure this coercion exists for.
    position: Number(row.position),
    eventType: EVENT_TYPE_BY_COLUMN_VALUE[row.eventType],
    actor: toTimelineActor(row),
    message: row.message,
    newScheduledAt: row.newScheduledAt === null ? undefined : row.newScheduledAt.toISOString(),
    newStatus: row.newStatus === null ? undefined : STATUS_BY_COLUMN_VALUE[row.newStatus],
    createdAt: row.createdAt.toISOString(),
  };
}

function toHelpNeed(row: EvictionHelpNeedRow): EvictionHelpNeed {
  return {
    type: HELP_NEED_BY_COLUMN_VALUE[row.needType],
    note: optionalText(row.note),
  };
}

/**
 * The organising collective.
 *
 * `publicChannels` is emitted ONLY for a verified organisation. An unverified
 * row's channels were typed by whoever opened a case, about somebody else, and
 * ADR 0003 §4.5 is categorical: *"a third party's identifiers are tier R and are
 * disclosed only to a party with a direct relationship to the record, never
 * publicly, whatever flag the storing user set."* Verification is what makes the
 * channel the collective's OWN published act.
 */
function toOrganization(row: EvictionOrganizationRow): EvictionOrganization {
  const verified = row.verifiedAt !== null;
  return {
    id: row.id,
    name: row.name,
    description: optionalText(row.description),
    publicChannels: verified ? row.publicChannels : [],
    verified,
    verifiedAt: row.verifiedAt === null ? undefined : row.verifiedAt.toISOString(),
    verificationSource: verified ? optionalText(row.verificationSource) : undefined,
  };
}

function toModerationState(row: EvictionCaseRow): EvictionModerationState {
  const precautionaryHold = row.precautionaryHoldAt !== null;
  const disputed = row.disputedAt !== null;
  const since = precautionaryHold ? row.precautionaryHoldAt : row.disputedAt;
  return {
    precautionaryHold,
    disputed,
    since: since === null ? undefined : since.toISOString(),
  };
}

/**
 * Decide whether the organiser's contact may be emitted, and why not.
 *
 * The rule changed with #358 and the change is the point (ADR 0003 §7.3.1, F8):
 * an RSVP alone used to unlock four contact handles for any signed-in caller,
 * which is a one-tap contact harvest aimed at the person a landlord's agent most
 * wants to reach. A CONFIRMED supporter — RSVP plus a second factor — unlocks
 * it now.
 */
function resolveContactAccess(
  options: ToEvictionDTOOptions,
  isOwner: boolean | undefined,
): { unlocked: boolean; reason: ContactLockReason } {
  if (isOwner === true) return { unlocked: true, reason: 'not_confirmed' };
  if (options.isRevokedSupporter === true) return { unlocked: false, reason: 'revoked' };
  if (options.isAttending !== true) return { unlocked: false, reason: 'not_attending' };
  if (options.isConfirmedSupporter !== true) {
    return { unlocked: false, reason: 'not_confirmed' };
  }
  return { unlocked: true, reason: 'not_confirmed' };
}

export function toEvictionDTO(
  source: EvictionCaseWithTimeline,
  options: ToEvictionDTOOptions = {},
): EvictionCase {
  const row = source.evictionCase;
  const viewer = options.viewerOxyUserId ?? undefined;
  const isOwner = viewer ? row.oxyUserId === viewer : undefined;

  // Contact gating — DETAIL only, because a LIST caller passes no `contact` at
  // all. `contactLocked` is set only when there is something to unlock: teasing
  // a lock over an empty contact block tells a viewer the organiser published
  // details they did not.
  let contactInfo: EvictionContactInfo | undefined;
  let contactLocked: boolean | undefined;
  let contactLockReason: ContactLockReason | undefined;
  if (options.contact) {
    const block = toContactInfo(options.contact);
    const access = resolveContactAccess(options, isOwner);
    if (access.unlocked) {
      contactInfo = block;
    } else if (block) {
      contactLocked = true;
      contactLockReason = access.reason;
    }
  }

  const held = row.precautionaryHoldAt !== null;

  return {
    id: row.id,
    oxyUserId: row.oxyUserId,
    title: row.title,
    // Withheld ENTIRELY under a hold rather than partially redacted. A partial
    // redaction of prose that was reported as exposing somebody's details is a
    // guess about which sentence did it.
    description: held ? undefined : row.description,
    location: toPublicLocation(row),
    // A boolean, never the value: this tells a client whether the request flow
    // is worth offering, and nothing more.
    exactLocationAvailable: row.locationHouseholdAuthorizedAt !== null,
    scheduledAt: row.scheduledAt.toISOString(),
    status: STATUS_BY_COLUMN_VALUE[row.status],
    moderation: toModerationState(row),
    agencyId: row.agencyId ?? undefined,
    organization: source.organization ? toOrganization(source.organization) : undefined,
    helpNeeds: source.helpNeeds.map(toHelpNeed),
    contactInfo,
    contactLocked,
    contactLockReason,
    coverImage: toCoverImage(row),
    timeline: source.timeline.map(toTimelineEvent),
    attendeeCount: source.attendeeCount,
    isAttending: options.isAttending,
    isFollowing: options.isFollowing,
    isOwner,
    distanceMeters: source.distanceMeters,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toEvictionCommentDTO(row: EvictionCommentRow): EvictionComment {
  return {
    id: row.id,
    caseId: row.caseId,
    oxyUserId: row.oxyUserId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

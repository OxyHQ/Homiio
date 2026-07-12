/**
 * Eviction solidarity board types shared across Homiio frontend and backend.
 *
 * An `EvictionCase` is a PUBLIC, community-visible notice of an upcoming
 * eviction (desalojo / desahucio) so neighbours and activists can show up to
 * help. It is deliberately privacy-minimal: NO tenant identity, NO unit number,
 * and — when the reporter marks the location `approximate` — coordinates are
 * rounded server-side so the exact home is never pinpointed. Attendees (people
 * who RSVP that they will show up) are never exposed publicly; only the
 * aggregate `attendeeCount` is.
 *
 * The Mongoose schema (`models/schemas/EvictionCaseSchema.ts`) is the single
 * authority; these interfaces mirror its serialized (`toJSON`) shape.
 */

import { ISODate } from './common';
import { ListingReportReason } from './report';

/** Lifecycle of an eviction case. Defaults to `UPCOMING` at creation. */
export enum EvictionCaseStatus {
  UPCOMING = 'upcoming',
  STOPPED = 'stopped',
  POSTPONED = 'postponed',
  EXECUTED = 'executed',
  CANCELLED = 'cancelled',
}

/**
 * How precise the reporter allowed the location to be. `approximate` (the
 * default) rounds the coordinates server-side so the exact building is not
 * pinpointed; `exact` keeps the reported coordinates verbatim.
 */
export type EvictionLocationPrecision = 'exact' | 'approximate';

export interface EvictionLocation {
  /** Human-readable place (street/area) — never a full unit-level address. */
  label: string;
  coordinates: { type: 'Point'; coordinates: [number, number] };
  precision: EvictionLocationPrecision;
  city?: string;
  /** ISO-2 country code. */
  countryCode?: string;
}

/** How to reach the organisers / solidarity network for this case. */
export interface EvictionContactInfo {
  phone?: string;
  email?: string;
  telegram?: string;
  whatsapp?: string;
  instructions?: string;
}

/** A timeline entry posted by the case owner (reschedule, status change, note). */
export interface EvictionUpdate {
  id: string;
  message: string;
  newScheduledAt?: ISODate;
  newStatus?: EvictionCaseStatus;
  createdAt: ISODate;
}

export interface EvictionCase {
  id: string;
  /** Oxy user id of the reporter/owner. */
  oxyUserId: string;
  title: string;
  description: string;
  location: EvictionLocation;
  scheduledAt: ISODate;
  status: EvictionCaseStatus;
  /** Optional link to the agency/landlord entity driving the eviction. */
  agencyId?: string;
  /**
   * How to reach the organisers. Exposed on the DETAIL DTO only when the viewer
   * is the owner or has RSVP'd ("asiste para ver cómo ayudar"). When the case
   * has contact details the viewer isn't allowed to see yet, this is omitted and
   * `contactLocked` is `true` instead. List DTOs never carry contact at all.
   */
  contactInfo?: EvictionContactInfo;
  /**
   * `true` on the detail DTO when the case HAS organiser contact details but the
   * viewer must RSVP first to unlock them. Never set on list responses, and
   * never set when the case simply has no contact details.
   */
  contactLocked?: boolean;
  coverImage?: { imageId?: string; url?: string };
  updates: EvictionUpdate[];
  /** Aggregate count of people who RSVP'd — the individual attendees are never exposed. */
  attendeeCount: number;
  /** Whether the requesting viewer has RSVP'd (only set for a signed-in viewer). */
  isAttending?: boolean;
  /** Whether the requesting viewer owns this case (only set for a signed-in viewer). */
  isOwner?: boolean;
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
 * Payload the client sends to open a new case. `oxyUserId`, `status`,
 * `attendeeCount`, `attendees`, `updates` and `agencyId` are all resolved
 * server-side and are intentionally absent. `agencyName` is resolved to an
 * `agencyId` only when the Agency model is available.
 */
export interface CreateEvictionCaseData {
  title: string;
  description: string;
  location: EvictionLocation;
  scheduledAt: ISODate;
  contactInfo?: EvictionContactInfo;
  coverImage?: { imageId?: string; url?: string };
  agencyName?: string;
}

/** Fields the owner may change on an existing case (adds `status`). */
export type UpdateEvictionCaseData = Partial<CreateEvictionCaseData> & {
  status?: EvictionCaseStatus;
};

/** Payload the owner sends to append a timeline update. */
export interface CreateEvictionUpdateData {
  message: string;
  newScheduledAt?: ISODate;
  newStatus?: EvictionCaseStatus;
}

/** Payload the client sends to report a case (the backend resolves the reporter). */
export interface CreateEvictionReportInput {
  reason: ListingReportReason;
  details?: string;
  contactEmail?: string;
}

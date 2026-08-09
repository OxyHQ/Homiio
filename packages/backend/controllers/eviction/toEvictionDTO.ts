/**
 * Eviction DTO serializers.
 *
 * Convert the rows the repository returns into the shape the frontend consumes
 * (`EvictionCase` / `EvictionComment` in `@homiio/shared-types`). The wire shape
 * is UNCHANGED by the Postgres port and must stay that way — a shipped client
 * reads `location.coordinates` as GeoJSON and `attendeeCount` as a number, and
 * neither is a fact about how the row is stored.
 *
 * ## The three things the port changed, and what each means here
 *
 * **A case is now three inputs, not one document.** `updates[]` is a table and
 * the RSVP roster is a table, so the timeline rows and the attendee COUNT are
 * passed in explicitly ({@link EvictionCaseWithTimeline}) rather than read off
 * the document. That is deliberate: this function cannot query, so a caller that
 * forgets the timeline gets an empty array from its own hand rather than a
 * silently truncated response, and every caller is one grep away.
 *
 * **`attendeeCount` is no longer stored.** It is `count(*)` over
 * `eviction_case_attendees`, which is why the count arrives as a parameter and
 * why the DTO still exposes it under the same name — the number the board shows
 * as turnout did not change meaning, only where it comes from.
 *
 * **Ids are already strings.** The Mongo version carried an ObjectId/populated
 * ref reducer and a `toObject()` branch for the document-vs-`lean()` split;
 * neither has a counterpart, and both are gone.
 *
 * The `location.coordinates` GeoJSON array is REBUILT here from the two named
 * columns, longitude first — the only place in the eviction path where the pair
 * becomes positional again, and the reason it is written out rather than
 * spread.
 */

import {
  EvictionCaseStatus,
  type EvictionCase,
  type EvictionComment,
  type EvictionContactInfo,
  type EvictionLocation,
  type EvictionUpdate,
} from '@homiio/shared-types';
import type {
  EvictionCaseRow,
  EvictionCaseUpdateRow,
  EvictionCaseWithTimeline,
  EvictionCommentRow,
} from '../../db/evictions/evictionRepository';

interface ToEvictionDTOOptions {
  /** The signed-in viewer, if any — drives `isOwner` / `isAttending`. */
  viewerOxyUserId?: string | null;
  /**
   * Whether this viewer has RSVP'd, resolved by the caller.
   *
   * Left `undefined` for an anonymous viewer, exactly as before: the field is
   * absent from the response rather than `false`, which is what tells a client
   * "not asked" apart from "asked and no".
   */
  isAttending?: boolean;
  /**
   * DETAIL contexts opt in to contact resolution. When `true`, organiser
   * contact is included for an owner/attendee viewer, otherwise `contactLocked`
   * is set (when the case actually has contact to reveal). LIST contexts leave
   * this `false` so contact never appears in a feed, regardless of viewer.
   */
  includeContact?: boolean;
}

/**
 * The column value → enum member map.
 *
 * The column's type is the string-literal union the CHECK is built from, and
 * `EvictionCaseStatus` is a TypeScript enum; a literal is not assignable to one.
 * An exhaustive record is how that conversion stays compiler-checked — adding a
 * status to `EVICTION_CASE_STATUSES` fails to compile here until it is mapped,
 * rather than falling through to a default that quietly reports `upcoming`.
 */
const STATUS_BY_COLUMN_VALUE: Readonly<Record<EvictionCaseRow['status'], EvictionCaseStatus>> = {
  upcoming: EvictionCaseStatus.UPCOMING,
  stopped: EvictionCaseStatus.STOPPED,
  postponed: EvictionCaseStatus.POSTPONED,
  executed: EvictionCaseStatus.EXECUTED,
  cancelled: EvictionCaseStatus.CANCELLED,
};

/** A stored string, trimmed, with the empty case reported as absent. */
function optionalText(value: string | null): string | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function optionalIso(value: Date | null): string | undefined {
  return value === null ? undefined : value.toISOString();
}

function toLocation(row: EvictionCaseRow): EvictionLocation {
  return {
    label: row.locationLabel,
    // Longitude FIRST — GeoJSON's ordering, and the one place the named columns
    // go back to being a positional pair.
    coordinates: { type: 'Point', coordinates: [row.locationLongitude, row.locationLatitude] },
    precision: row.locationPrecision,
    city: optionalText(row.locationCity),
    countryCode: optionalText(row.locationCountryCode),
  };
}

/** The organiser's contact block, or `undefined` when every handle is empty. */
function toContactInfo(row: EvictionCaseRow): EvictionContactInfo | undefined {
  const contact: EvictionContactInfo = {
    phone: optionalText(row.contactPhone),
    email: optionalText(row.contactEmail),
    telegram: optionalText(row.contactTelegram),
    whatsapp: optionalText(row.contactWhatsapp),
    instructions: optionalText(row.contactInstructions),
  };
  return Object.values(contact).some((entry) => entry !== undefined) ? contact : undefined;
}

function toCoverImage(row: EvictionCaseRow): { imageId?: string; url?: string } | undefined {
  const imageId = optionalText(row.coverImageId);
  const url = optionalText(row.coverImageUrl);
  if (!imageId && !url) return undefined;
  return { imageId, url };
}

function toUpdate(row: EvictionCaseUpdateRow): EvictionUpdate {
  return {
    id: row.id,
    message: row.message,
    newScheduledAt: optionalIso(row.newScheduledAt),
    newStatus: row.newStatus === null ? undefined : STATUS_BY_COLUMN_VALUE[row.newStatus],
    createdAt: row.createdAt.toISOString(),
  };
}

export function toEvictionDTO(
  source: EvictionCaseWithTimeline,
  options: ToEvictionDTOOptions = {},
): EvictionCase {
  const row = source.evictionCase;
  const viewer = options.viewerOxyUserId ?? undefined;
  const isAttending = options.isAttending;
  const isOwner = viewer ? row.oxyUserId === viewer : undefined;

  // Contact gating — DETAIL only. Owners and confirmed attendees see the
  // organiser contact; everyone else gets `contactLocked` (but only when there
  // is contact to unlock — never tease a lock over an empty contact block).
  let contactInfo: EvictionContactInfo | undefined;
  let contactLocked: boolean | undefined;
  if (options.includeContact) {
    const contact = toContactInfo(row);
    const unlocked = isOwner === true || isAttending === true;
    if (unlocked) {
      contactInfo = contact;
    } else if (contact) {
      contactLocked = true;
    }
  }

  return {
    id: row.id,
    oxyUserId: row.oxyUserId,
    title: row.title,
    description: row.description,
    location: toLocation(row),
    scheduledAt: row.scheduledAt.toISOString(),
    status: STATUS_BY_COLUMN_VALUE[row.status],
    agencyId: row.agencyId ?? undefined,
    contactInfo,
    contactLocked,
    coverImage: toCoverImage(row),
    updates: source.updates.map(toUpdate),
    attendeeCount: source.attendeeCount,
    isAttending,
    isOwner,
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

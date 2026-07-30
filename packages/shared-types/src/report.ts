/**
 * Listing report types shared across Homiio frontend and backend.
 *
 * A `ListingReport` is filed by a signed-in user against a property listing to
 * flag a problem (inaccurate info, suspected scam, inappropriate content, an
 * already-rented listing, …). Reports feed the trust & safety review queue;
 * they are DISTINCT from a `Review` (public rating of an address) and carry no
 * public visibility.
 */

import { ISODate } from './common';

/**
 * Why a listing is being reported. `OTHER` requires free-text details.
 *
 * These are ALLEGATIONS — what a reporter claims, never what is true. They are
 * translated into the universal moderation taxonomy by
 * `services/moderation/reportTaxonomy.ts` in the backend, and a jury classifies
 * the material itself and may confirm something else entirely.
 *
 * ## Why `PRIVACY` and `UNSAFE` exist
 *
 * Both were added because the universal taxonomy has a code for them that no
 * reporter could previously reach, and both are housing cases rather than
 * general-marketplace ones:
 *
 * - `PRIVACY` — a listing that exposes where somebody actually lives. A home
 *   with a current tenant, photographed and addressed in public, is a real
 *   Homiio harm and the only report surface for it used to be `OTHER`.
 * - `UNSAFE` — a dwelling advertised in a condition nobody should be asked to
 *   live in (no heating, damp, blocked fire exit, uninhabitable).
 *
 * A reason NOT added, deliberately: there is still no way for a reporter to
 * allege that a listing is *illegal* (an unlicensed short-let, an illegal
 * sublet), so `commerce.prohibited_item` stays unreachable. And there is no way
 * to allege housing DISCRIMINATION, even though ingest already detects
 * restrictions like "no benefit claimants" or "women only" in listing text
 * (`Property.listingFlags`). Those flags are a classifier's reading, not a
 * person's claim, so the backend carries them as report metadata and never as an
 * allegation — putting a machine's guess in front of a jury as if a human had
 * asserted it is exactly the thing that would make the allegation worthless.
 * Both gaps are product decisions, not oversights.
 */
export enum ListingReportReason {
  INACCURATE = 'inaccurate',
  SCAM = 'scam',
  INAPPROPRIATE = 'inappropriate',
  UNAVAILABLE = 'unavailable',
  /** The listing exposes someone's home, address or personal details. */
  PRIVACY = 'privacy',
  /** The home is advertised in an unsafe or uninhabitable condition. */
  UNSAFE = 'unsafe',
  OTHER = 'other',
}

/** Trust & safety triage state for a filed report. */
export enum ListingReportStatus {
  OPEN = 'open',
  REVIEWING = 'reviewing',
  RESOLVED = 'resolved',
  DISMISSED = 'dismissed',
}

export interface ListingReport {
  id: string;
  propertyId: string;
  /** Profile id of the reporter (resolved from the authenticated session). */
  reporterOxyUserId: string;
  reason: ListingReportReason;
  /** Free-text context. Required when `reason` is `OTHER`. */
  details?: string;
  /** Optional reply-to address the reporter chose to share. */
  contactEmail?: string;
  status: ListingReportStatus;
  createdAt: ISODate;
  updatedAt: ISODate;
}

/** Payload the client sends to file a report (the backend resolves the reporter). */
export interface CreateListingReportInput {
  reason: ListingReportReason;
  details?: string;
  contactEmail?: string;
}

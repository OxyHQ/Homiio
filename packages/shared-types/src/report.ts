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

/** Why a listing is being reported. `OTHER` requires free-text details. */
export enum ListingReportReason {
  INACCURATE = 'inaccurate',
  SCAM = 'scam',
  INAPPROPRIATE = 'inappropriate',
  UNAVAILABLE = 'unavailable',
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
  reporterProfileId: string;
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

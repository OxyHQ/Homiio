/**
 * Home-exchange types shared across Homiio frontend and backend.
 *
 * An `ExchangeRequest` is a home-swap or free-hosting request against a listing
 * carrying the EXCHANGE intent. It is DISTINCT from a `Reservation` (paid
 * vacation booking) and a `ViewingRequest` (in-person tour for the rent flow).
 *
 * Ids and timestamps are plain `string`s here (ISO-8601 for dates): shared-types
 * MUST NOT depend on mongoose. The backend casts these to ObjectId/Date.
 */

import { ExchangeMode, ExchangeRequestStatus, ISODate } from './common';

/** A half-open date range `[start, end)` for an exchange stay. */
export interface ExchangeWindow {
  start: ISODate;
  end: ISODate;
}

export interface ExchangeRequest {
  id: string;
  propertyId: string;
  /** Profile making the request (the would-be guest / swapper). */
  requesterOxyUserId: string;
  /** Profile that owns the requested listing (the host). */
  hostOxyUserId: string;
  mode: ExchangeMode;
  /** For a SWAP: the property the requester offers in return. */
  offeredPropertyId?: string;
  /** Dates the requester wants to stay in the host's property. */
  requestedWindow: ExchangeWindow;
  /** For a SWAP: dates the host could stay in the requester's property. */
  offeredWindow?: ExchangeWindow;
  message?: string;
  status: ExchangeRequestStatus;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface CreateExchangeRequestData {
  propertyId: string;
  mode: ExchangeMode;
  offeredPropertyId?: string;
  requestedWindow: ExchangeWindow;
  offeredWindow?: ExchangeWindow;
  message?: string;
}

export interface UpdateExchangeRequestData {
  status?: ExchangeRequestStatus;
  message?: string;
}

/** Per-category 1-5 ratings captured alongside an exchange review. */
export interface ExchangeReviewCategories {
  communication?: number;
  cleanliness?: number;
  accuracy?: number;
  hospitality?: number;
}

export interface ExchangeReview {
  id: string;
  exchangeRequestId: string;
  /** Profile writing the review. */
  reviewerOxyUserId: string;
  /** Profile being reviewed. */
  subjectOxyUserId: string;
  /** Overall rating, 1-5. */
  rating: number;
  comment?: string;
  categories?: ExchangeReviewCategories;
  createdAt: ISODate;
  updatedAt: ISODate;
}

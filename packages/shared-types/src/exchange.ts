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
  /**
   * The stay is paid for in GUEST POINTS (#518 §7.5).
   *
   * An explicit opt-in on the REQUEST, never a property of the mode. `host`
   * with this flag `false` is free hosting and stays free hosting — #518 §7.5
   * forbids renaming one as the other, and a flag that defaulted to `true`
   * would do exactly that to every existing request.
   */
  usesGuestPoints: boolean;
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
  /**
   * Pay for this stay in guest points. Absent means no — free hosting.
   *
   * Only a `host` request may set it: a swap is already reciprocal, so charging
   * points for one would take payment for a night the host is also receiving.
   */
  usesGuestPoints?: boolean;
  /**
   * The caller's own idempotency key for the point RESERVATION, required when
   * `usesGuestPoints` is set.
   *
   * On the request rather than minted by the server, for the reason the rent
   * ledger states: the point of a key is that the SECOND attempt carries the
   * first one's, and only the caller knows the two attempts are the same
   * intent.
   */
  guestPointsIdempotencyKey?: string;
}

export interface UpdateExchangeRequestData {
  status?: ExchangeRequestStatus;
  message?: string;
  /**
   * The host's own key for the CREDIT an accepted points stay produces.
   *
   * Optional, unlike the guest's key on the request: a host's credit is one per
   * stay by definition, so the server derives a deterministic key when none is
   * sent. See `hostCreditKey` in `exchangeController`.
   */
  guestPointsIdempotencyKey?: string;
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

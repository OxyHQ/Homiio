/**
 * Home exchanges — the use cases (Couchsurfing-style), and the reviews the two
 * parties write once an exchange is complete.
 *
 * Called by `controllers/exchangeController.ts`,
 * `controllers/exchangeReviewController.ts` and the catalogue tools
 * (`capabilities/handlers/exchanges.ts`). Every function takes the acting
 * account explicitly and refuses with the route's own `AppError`.
 *
 *  - SWAP: reciprocal home swap (each party stays in the other's home)
 *  - HOST: one-way free hosting (guest stays, no reciprocity)
 *
 * Operates only on listings carrying the EXCHANGE offering. An ExchangeRequest
 * transitions: pending -> confirmed | declined | cancelled, pending|confirmed ->
 * cancelled, and confirmed -> completed.
 *
 * ## Guest points ride on this lifecycle (#518 §7.5, #519 §7.5)
 *
 * A request may declare `usesGuestPoints`, and when it does the transitions
 * above are also the points lifecycle: creating RESERVES the cost against the
 * requester, confirming SETTLES it and credits the host, declining or
 * cancelling RELEASES it. Nothing else in Homiio moves a point.
 *
 * The flag is on the REQUEST and not on the mode, deliberately: #518 §7.5
 * forbids renaming free hosting as points, and a fourth mode would make the two
 * indistinguishable in a listing's own configuration. A `host` request with the
 * flag unset is free hosting and stays free hosting.
 */

import type { CreateExchangeRequestData, ExchangeReviewCategories } from '@homiio/shared-types';
import {
  ExchangeMode,
  ExchangeRequestStatus,
  GUEST_POINT_IDEMPOTENCY_KEY_PATTERN,
  guestPointsForWindow,
  OfferingType,
} from '@homiio/shared-types';

import { getDb } from '../db/postgres';
import {
  createExchangeRequest as createExchangeRequestRow,
  findExchangeRequestById,
  isExchangeStatus,
  listExchangeRequests,
  serializeExchangeRequest,
  setExchangeRequestMessage,
  transitionExchangeRequest,
  type ExchangeModeValue,
  type ExchangeStatusValue,
  type ExchangeWindowInput,
} from '../db/exchanges/exchangeReads';
import {
  createExchangeReview as createExchangeReviewRow,
  ExchangeAlreadyReviewedError,
  listReviewsForExchange,
  listReviewsForSubject,
  serializeExchangeReview,
} from '../db/exchanges/exchangeReviewReads';
import { findOccupancyConflict, type OccupancyConflict } from '../db/availability/occupancy';
import {
  lockPropertyBookingBases,
  type PropertyBookingBasis,
} from '../db/properties/propertyBookingBasis';
import {
  releaseStayPoints,
  reserveStayPoints,
  settleStayPoints,
} from '../db/guestPoints/guestPointsLedger';
import { logger } from '../middlewares/logging';
import { AppError } from '../middlewares/errorHandler';
import { externalListingOutcome, type ExternalListingOutcome } from './bookingOutcomes';

export type ExchangeDto = Record<string, unknown>;

// ---- Tunable constants (no magic numbers / strings inline) ----
/** Default page size for list endpoints. */
const DEFAULT_PAGE_SIZE = 10;
/** Hard cap on page size to protect the database. */
const MAX_PAGE_SIZE = 100;

/**
 * Whether a listing's configured exchange `mode` accepts a request of the given
 * `requestedMode`. A `both` listing accepts swap OR host; a `swap` listing only
 * accepts swap; a `host` listing only accepts host. A request mode of `both` is
 * not a concrete request and is never acceptable.
 */
function modeAccepts(listingMode: string, requestedMode: string): boolean {
  if (requestedMode !== ExchangeMode.SWAP && requestedMode !== ExchangeMode.HOST) {
    return false;
  }
  if (listingMode === ExchangeMode.BOTH) {
    return true;
  }
  return listingMode === requestedMode;
}

/** A property carries the EXCHANGE offering. */
function hasExchangeOffering(property: PropertyBookingBasis): boolean {
  return property.offerings.includes(OfferingType.EXCHANGE);
}

/**
 * Parse + validate a requested/offered window into concrete Dates. The wire
 * shape uses ISO strings (`ExchangeWindow`) but persisted windows are read
 * back as `Date`, so accept either at the boundary.
 */
function parseWindow(
  window: { start: Date | string; end: Date | string } | undefined,
): { start: Date; end: Date } | null {
  if (!window?.start || !window.end) {
    return null;
  }
  const start = window.start instanceof Date ? window.start : new Date(window.start);
  const end = window.end instanceof Date ? window.end : new Date(window.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }
  if (start.getTime() >= end.getTime()) {
    return null;
  }
  return { start, end };
}

/**
 * The refusal for whatever already holds the dates on ONE of the two homes.
 *
 * An exchange used to look only at `exchange_requests`, so a home with a
 * confirmed paid stay in it was still swappable and a host's blocked fortnight
 * did not exist as far as this domain was concerned. The conflict is now the
 * shared one (`db/availability/occupancy.ts`), and `role` is what turns it into
 * the message the requester needs: which of their two homes is the problem.
 */
function occupancyError(conflict: OccupancyConflict, role: 'requested' | 'offered'): AppError {
  const subject = role === 'requested' ? 'Requested dates' : 'Offered dates';
  const code = role === 'requested' ? 'DATE_CONFLICT' : 'OFFERED_DATE_CONFLICT';
  switch (conflict.kind) {
    case 'reservation':
      return new AppError(`${subject} conflict with a booked stay`, 409, code);
    case 'exchange':
      return new AppError(`${subject} conflict with a confirmed exchange`, 409, code);
    default:
      return new AppError(`${subject} are blocked by the host calendar`, 409, code);
  }
}

/**
 * Whether this request is paid for in guest points, and with which key.
 *
 * Refuses rather than coerces. A `swap` asking to pay points is not a typo to
 * be silently corrected — it is somebody about to be charged for a night they
 * are also hosting — and `exchange_requests_points_mode_check` would refuse the
 * row anyway, with an error naming a constraint instead of a person.
 *
 * @throws {AppError} 400 when points are asked for on a swap, or without a key.
 */
function readGuestPointsIntent(
  body: Pick<CreateExchangeRequestData, 'usesGuestPoints' | 'guestPointsIdempotencyKey'>,
  mode: string,
): { readonly idempotencyKey: string } | null {
  if (body.usesGuestPoints !== true) return null;
  if (mode !== ExchangeMode.HOST) {
    throw new AppError(
      'Guest points pay for a one-way stay; a swap is already reciprocal',
      400,
      'POINTS_NOT_APPLICABLE',
    );
  }
  const key =
    typeof body.guestPointsIdempotencyKey === 'string' ? body.guestPointsIdempotencyKey.trim() : '';
  if (!GUEST_POINT_IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new AppError(
      'guestPointsIdempotencyKey must be 8-64 characters of letters, digits, hyphen or underscore',
      400,
      'VALIDATION_ERROR',
    );
  }
  return { idempotencyKey: key };
}

/**
 * The key for the HOST's credit when a points stay is accepted.
 *
 * Derived from the stay rather than supplied by the host's client, and the
 * asymmetry with the guest's key is deliberate. The guest's reservation is one
 * intent among many they may have (they could request three stays in an
 * evening), so only the caller knows which two attempts are the same one. The
 * host's credit is one per stay by definition, so the stay IS the key — and a
 * derived key cannot be forgotten by a client retrying an accept. A caller may
 * still send its own; this is the fallback, not an override.
 *
 * Same shape as `moderation_outbox`'s deterministic id, for the same reason:
 * two concurrent presses converge on one row instead of crediting twice.
 */
function hostCreditKey(exchangeRequestId: string): string {
  return `gp-earn-${exchangeRequestId}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

/**
 * A transition that RELEASES a points reservation, in one transaction.
 *
 * Declining and cancelling are the two ways a stay stops happening before it
 * happened, and both give the guest their points back. The transition and the
 * release are one act: a declined request whose points stayed committed is a
 * trip somebody cannot book because of one that was refused, and nothing would
 * ever notice.
 *
 * Confirming is deliberately NOT here. It settles rather than releases, and it
 * has to happen inside the transaction that locks the two homes and re-checks
 * the calendar — so it is written there, where the lock is, rather than being
 * threaded through this.
 *
 * Returns `undefined` when the transition itself did not match; the caller
 * turns that into the `INVALID_STATE` it always did.
 *
 * ## Cancelling a stay the host already ACCEPTED does not return the points
 *
 * By then the guest's points have settled and the host has been credited for
 * holding the dates. Releasing would hand the points back while the credit
 * stayed, which is the one way this ledger could mint — and reversing the
 * host's credit instead would take back something they earned by keeping their
 * home free.
 *
 * So a late cancellation leaves the ledger alone, and that is a DECISION rather
 * than an oversight: any other answer is a refund policy — a window, a
 * proportion, a penalty — and #518 §7.5 asks for a points system, not for
 * Homiio to invent cancellation terms nobody agreed to. It is recorded in
 * `docs/housing-parity.md` §7 as the open product question it is.
 */
async function transitionAndReleaseGuestPoints(
  db: ReturnType<typeof getDb>,
  request: NonNullable<Awaited<ReturnType<typeof findExchangeRequestById>>>,
  nextStatus: ExchangeStatusValue,
  fromStatuses: readonly ExchangeStatusValue[],
  options: { readonly message?: string },
): Promise<Awaited<ReturnType<typeof transitionExchangeRequest>>> {
  return db.transaction(async (tx) => {
    const updated = await transitionExchangeRequest(
      tx,
      request.id,
      nextStatus,
      fromStatuses,
      options.message === undefined ? {} : { message: options.message },
    );
    if (!updated || !request.usesGuestPoints) return updated;

    const reason =
      nextStatus === ExchangeRequestStatus.DECLINED
        ? ('declined' as const)
        : ('cancelled' as const);
    const released = await releaseStayPoints(tx, { exchangeRequestId: request.id, reason });
    // `already_settled` is the late-cancellation case above, and
    // `no_reservation` cannot happen on a points request — both are left alone
    // rather than failing a decline or a cancellation the person is entitled to
    // make. Refusing to let somebody cancel because a ledger row was not where
    // we expected would be the worse answer by a distance.
    if (!released.ok) {
      logger.info('Exchange transition left guest points untouched', {
        exchangeRequestId: request.id,
        nextStatus,
        outcome: released.reason,
      });
    }

    return updated;
  });
}

// ── Create ──────────────────────────────────────────────────────────────────

export type CreateExchangeRequestInput = Partial<CreateExchangeRequestData>;

export type RequestExchangeOutcome =
  | { readonly status: 'requested'; readonly exchangeRequest: ExchangeDto }
  | ExternalListingOutcome;

/**
 * Propose a swap or a hosted stay against an EXCHANGE listing.
 *
 * An EXTERNAL target listing never gets a request: the outcome is its own link.
 * Offering an external listing IN RETURN is a refusal, not a link — it is the
 * requester's own claim that is wrong.
 */
export async function requestExchange(
  oxyUserId: string,
  body: CreateExchangeRequestInput,
): Promise<RequestExchangeOutcome> {
  const { propertyId, mode, offeredPropertyId, requestedWindow, offeredWindow, message } = body;

  // The `ObjectId.isValid` guards are DELETED rather than widened (`db/ids.ts`):
  // post-cutover every listing id is a uuid v7, which they reject — and the
  // lookups below already answer 404 for an id that names nothing.
  if (mode !== ExchangeMode.SWAP && mode !== ExchangeMode.HOST) {
    throw new AppError('Exchange mode must be "swap" or "host"', 400, 'INVALID_MODE');
  }

  // Both windows are parsed and range-checked BEFORE a transaction opens: none
  // of it reads the database. A window starting exactly now is allowed.
  const requested = parseWindow(requestedWindow);
  if (!requested) throw new AppError('Invalid requested window', 400, 'INVALID_WINDOW');
  const now = new Date();
  if (requested.start.getTime() < now.getTime()) {
    throw new AppError('Requested window must start in the future', 400, 'DATE_IN_PAST');
  }

  // SWAP requires an offered property + offered window; HOST offers nothing at
  // all, which `exchange_requests_host_mode_offers_nothing_check` enforces.
  let offered: ExchangeWindowInput | undefined;
  if (mode === ExchangeMode.SWAP) {
    if (!offeredPropertyId) {
      throw new AppError('A swap requires an offered property', 400, 'OFFERED_PROPERTY_REQUIRED');
    }
    const parsed = parseWindow(offeredWindow);
    if (!parsed) {
      throw new AppError('A swap requires a valid offered window', 400, 'OFFERED_WINDOW_REQUIRED');
    }
    if (parsed.start.getTime() < now.getTime()) {
      throw new AppError('Offered window must start in the future', 400, 'DATE_IN_PAST');
    }
    offered = parsed;
  }

  // Points are validated BEFORE anything is written, so a refusal names the
  // problem rather than rolling back a request the person would see appear and
  // vanish. The COST is derived from the window the server parsed, never from
  // the body.
  const pointsIntent = readGuestPointsIntent(body, mode);
  const pointsCost = pointsIntent ? guestPointsForWindow(requested.start, requested.end) : 0;
  const targetId = String(propertyId);

  /**
   * A swap commits TWO homes, so BOTH are locked and both are decided against
   * inside one transaction. `lockPropertyBookingBases` takes the rows in sorted
   * id order, which is what stops two mirror-image swaps deadlocking.
   */
  const outcome = await getDb().transaction(async (tx) => {
    const ids = [targetId];
    if (offered) ids.push(String(offeredPropertyId));
    const locked = await lockPropertyBookingBases(tx, ids);

    const property = locked.get(targetId);
    if (!property) throw new AppError('Property not found', 404, 'NOT_FOUND');
    if (property.isExternal) return { external: await externalListingOutcome(tx, targetId) };
    if (!hasExchangeOffering(property)) {
      throw new AppError('This property is not open to home exchange', 400, 'NOT_EXCHANGEABLE');
    }
    const listingMode = property.exchangeMode;
    if (!listingMode || !modeAccepts(listingMode, mode)) {
      throw new AppError(
        `This listing does not accept "${mode}" exchanges`,
        400,
        'MODE_NOT_ACCEPTED',
      );
    }

    const hostOxyUserId = property.oxyUserId;
    if (!hostOxyUserId) throw new AppError('Property has no host', 400, 'INVALID_PROPERTY');
    if (hostOxyUserId === oxyUserId) {
      throw new AppError('You cannot request an exchange with your own property', 403, 'FORBIDDEN');
    }

    let resolvedOfferedPropertyId: string | undefined;
    if (offered) {
      const offeredProperty = locked.get(String(offeredPropertyId));
      if (!offeredProperty) throw new AppError('Offered property not found', 404, 'NOT_FOUND');
      if (offeredProperty.oxyUserId !== oxyUserId) {
        throw new AppError('Offered property does not belong to you', 403, 'FORBIDDEN');
      }
      // An EXTERNAL listing is an advertisement Homiio copied from somewhere
      // else: nobody here can promise anybody a night in it.
      if (offeredProperty.isExternal) {
        throw new AppError(
          'Cannot offer an external listing in an exchange',
          400,
          'OFFERED_EXTERNAL_PROPERTY',
        );
      }
      if (!hasExchangeOffering(offeredProperty)) {
        throw new AppError(
          'Offered property is not open to home exchange',
          400,
          'OFFERED_NOT_EXCHANGEABLE',
        );
      }
      resolvedOfferedPropertyId = offeredProperty.id;
    }

    // Is the TARGET dwelling free? Confirmed exchanges, active reservations and
    // the host calendar — one question (`db/availability/occupancy.ts`).
    const targetConflict = await findOccupancyConflict(tx, targetId, requested);
    if (targetConflict) throw occupancyError(targetConflict, 'requested');

    // And the OFFERED home over ITS window — otherwise a requester could promise
    // a home they have already committed elsewhere.
    if (resolvedOfferedPropertyId && offered) {
      const offeredConflict = await findOccupancyConflict(tx, resolvedOfferedPropertyId, offered);
      if (offeredConflict) throw occupancyError(offeredConflict, 'offered');
    }

    const exchangeRequest = await createExchangeRequestRow(tx, {
      propertyId: targetId,
      requesterOxyUserId: oxyUserId,
      hostOxyUserId,
      mode: mode as ExchangeModeValue,
      requestedWindow: requested,
      offeredPropertyId: resolvedOfferedPropertyId,
      offeredWindow: offered,
      message: typeof message === 'string' ? message : undefined,
      usesGuestPoints: pointsIntent !== null,
    });

    if (pointsIntent) {
      // In the SAME transaction that locked the homes: a request that exists
      // with no points reserved is a stay somebody believes they have paid for,
      // and a reservation with no request is points committed to nothing. The
      // refusal THROWS, after the request row exists, so the row rolls back.
      const reservation = await reserveStayPoints(tx, {
        exchangeRequestId: exchangeRequest.id,
        guestOxyUserId: oxyUserId,
        hostOxyUserId,
        points: pointsCost,
        idempotencyKey: pointsIntent.idempotencyKey,
      });
      if (!reservation.ok) {
        throw new AppError(
          `This stay costs ${reservation.required} guest points and you have ${reservation.available} available`,
          409,
          'INSUFFICIENT_GUEST_POINTS',
        );
      }
    }

    return { exchangeRequest };
  });

  if (outcome.external) return outcome.external;

  logger.info('Exchange request created', {
    exchangeRequestId: outcome.exchangeRequest.id,
    propertyId: targetId,
    mode,
    usesGuestPoints: pointsIntent !== null,
    guestPoints: pointsCost,
  });
  return {
    status: 'requested',
    exchangeRequest: serializeExchangeRequest(outcome.exchangeRequest),
  };
}

// ── Reads ───────────────────────────────────────────────────────────────────

export interface ExchangePage {
  readonly page: number;
  readonly limit: number;
}

/** The route's paging: page ≥ 1, 1 ≤ limit ≤ 100, defaulting to 1 and 10. */
export function exchangePage(page: unknown, limit: unknown): ExchangePage {
  return {
    page: Math.max(1, parseInt(String(page ?? 1), 10) || 1),
    limit: Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(String(limit ?? DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE),
    ),
  };
}

/**
 * The account's exchange requests: the ones it made, or with `asHost` the ones
 * against its listings. Both views are scoped by the account in the predicate.
 */
export async function listMyExchangeRequests(
  oxyUserId: string,
  input: ExchangePage & { readonly status?: unknown; readonly asHost: boolean },
): Promise<ExchangePage & { readonly rows: ExchangeDto[]; readonly total: number }> {
  const { page, limit, asHost } = input;
  const result = await listExchangeRequests(
    getDb(),
    {
      requesterOxyUserId: asHost ? undefined : oxyUserId,
      hostOxyUserId: asHost ? oxyUserId : undefined,
      status: isExchangeStatus(input.status) ? input.status : undefined,
    },
    { limit, offset: (page - 1) * limit },
  );
  return { page, limit, total: result.total, rows: result.rows.map(serializeExchangeRequest) };
}

/** One exchange request, to its requester or its host. */
export async function getExchangeRequest(
  oxyUserId: string,
  input: { readonly exchangeRequestId: string },
): Promise<ExchangeDto> {
  const exchangeRequest = await findExchangeRequestById(getDb(), input.exchangeRequestId);
  if (!exchangeRequest) throw new AppError('Exchange request not found', 404, 'NOT_FOUND');
  const isRequester = exchangeRequest.requesterOxyUserId === oxyUserId;
  const isHost = exchangeRequest.hostOxyUserId === oxyUserId;
  if (!isRequester && !isHost) {
    throw new AppError('Not authorized to view this exchange request', 403, 'FORBIDDEN');
  }
  return serializeExchangeRequest(exchangeRequest);
}

// ── Transitions ─────────────────────────────────────────────────────────────

export interface UpdateExchangeRequestInput {
  readonly exchangeRequestId: string;
  readonly status: unknown;
  readonly message?: unknown;
  readonly guestPointsIdempotencyKey?: unknown;
}

export interface ExchangeTransitionOutcome {
  readonly exchangeRequest: ExchangeDto;
  /** A cancel of a request that was already cancelled (its message still applies). */
  readonly alreadyCancelled: boolean;
}

/**
 * Status transition machine (authorized per role):
 *   - Host:      pending   -> confirmed | declined
 *   - Requester: pending   -> cancelled
 *                confirmed -> cancelled
 *   - Either:    confirmed -> completed (only after the requested window ended)
 * Any other transition is rejected as INVALID_STATE. Every transition carries
 * its permitted FROM set into the `UPDATE`'s own predicate.
 */
export async function updateExchangeRequest(
  oxyUserId: string,
  input: UpdateExchangeRequestInput,
): Promise<ExchangeTransitionOutcome> {
  const { exchangeRequestId: id, status: nextStatus } = input;
  const db = getDb();
  const exchangeRequest = await findExchangeRequestById(db, id);
  if (!exchangeRequest) throw new AppError('Exchange request not found', 404, 'NOT_FOUND');

  const isRequester = exchangeRequest.requesterOxyUserId === oxyUserId;
  const isHost = exchangeRequest.hostOxyUserId === oxyUserId;
  if (!isRequester && !isHost) {
    throw new AppError('Not authorized to update this exchange request', 403, 'FORBIDDEN');
  }

  const now = new Date();
  const nextMessage = typeof input.message === 'string' ? input.message : undefined;
  // The key for the host's credit, if this turns out to be an accepted points
  // stay. Resolved before the branches because the confirm path needs it inside
  // a transaction, where minting one would be a decision taken while holding
  // two row locks.
  const suppliedKey =
    typeof input.guestPointsIdempotencyKey === 'string'
      ? input.guestPointsIdempotencyKey.trim()
      : '';
  const creditKey = GUEST_POINT_IDEMPOTENCY_KEY_PATTERN.test(suppliedKey)
    ? suppliedKey
    : hostCreditKey(exchangeRequest.id);
  let updated: Awaited<ReturnType<typeof transitionExchangeRequest>>;
  let fromStatuses: readonly ExchangeStatusValue[];

  if (
    nextStatus === ExchangeRequestStatus.CONFIRMED ||
    nextStatus === ExchangeRequestStatus.DECLINED
  ) {
    if (!isHost) throw new AppError('Only the host can confirm or decline', 403, 'FORBIDDEN');
    if (exchangeRequest.status !== ExchangeRequestStatus.PENDING) {
      throw new AppError(
        'Only pending requests can be confirmed or declined',
        400,
        'INVALID_STATE',
      );
    }
    fromStatuses = [ExchangeRequestStatus.PENDING];
    if (nextStatus === ExchangeRequestStatus.CONFIRMED) {
      /**
       * The confirm happens with both homes locked, and the conflict question
       * is the shared one, so a paid stay or a blocked fortnight that appeared
       * since the request was made stops the confirm exactly as another
       * exchange does.
       */
      updated = await db.transaction(async (tx) => {
        const ids = [exchangeRequest.propertyId];
        if (exchangeRequest.offeredPropertyId) ids.push(exchangeRequest.offeredPropertyId);
        const locked = await lockPropertyBookingBases(tx, ids);

        // Re-validate the listing: it may have dropped the exchange intent or
        // changed/cleared its mode since the request was made.
        const targetProperty = locked.get(exchangeRequest.propertyId);
        if (!targetProperty) throw new AppError('Property no longer exists', 404, 'NOT_FOUND');
        if (!hasExchangeOffering(targetProperty)) {
          throw new AppError(
            'This property is no longer open to home exchange',
            409,
            'NOT_EXCHANGEABLE',
          );
        }
        const listingMode = targetProperty.exchangeMode;
        if (!listingMode || !modeAccepts(listingMode, exchangeRequest.mode)) {
          throw new AppError(
            `This listing no longer accepts "${exchangeRequest.mode}" exchanges`,
            409,
            'MODE_NOT_ACCEPTED',
          );
        }

        // The TARGET home first…
        const targetConflict = await findOccupancyConflict(
          tx,
          exchangeRequest.propertyId,
          { start: exchangeRequest.requestedWindowStart, end: exchangeRequest.requestedWindowEnd },
          { excludeExchangeId: exchangeRequest.id },
        );
        if (targetConflict) throw occupancyError(targetConflict, 'requested');

        // …and, for a SWAP, the OFFERED home, which must still exist, still
        // belong to the requester and still be exchangeable.
        if (exchangeRequest.mode === ExchangeMode.SWAP) {
          if (
            !exchangeRequest.offeredPropertyId ||
            !exchangeRequest.offeredWindowStart ||
            !exchangeRequest.offeredWindowEnd
          ) {
            throw new AppError('Invalid offered window', 400, 'INVALID_WINDOW');
          }
          const offeredProperty = locked.get(exchangeRequest.offeredPropertyId);
          if (!offeredProperty) {
            throw new AppError('The offered home no longer exists', 409, 'OFFERED_NOT_FOUND');
          }
          if (offeredProperty.oxyUserId !== exchangeRequest.requesterOxyUserId) {
            throw new AppError(
              'The offered home no longer belongs to the requester',
              409,
              'OFFERED_NOT_OWNED',
            );
          }
          if (!hasExchangeOffering(offeredProperty)) {
            throw new AppError(
              'The offered home is no longer open to home exchange',
              409,
              'OFFERED_NOT_EXCHANGEABLE',
            );
          }
          const offeredConflict = await findOccupancyConflict(
            tx,
            exchangeRequest.offeredPropertyId,
            { start: exchangeRequest.offeredWindowStart, end: exchangeRequest.offeredWindowEnd },
            { excludeExchangeId: exchangeRequest.id },
          );
          if (offeredConflict) throw occupancyError(offeredConflict, 'offered');
        }

        const confirmed = await transitionExchangeRequest(tx, id, nextStatus, fromStatuses, {
          message: nextMessage,
        });
        if (!confirmed) {
          throw new AppError(
            'Only pending requests can be confirmed or declined',
            400,
            'INVALID_STATE',
          );
        }

        if (exchangeRequest.usesGuestPoints) {
          // The guest's reservation becomes a spend and the host is credited
          // the same number of points — here, inside the transaction that just
          // confirmed the stay, because the two are one fact.
          const settled = await settleStayPoints(tx, {
            exchangeRequestId: id,
            idempotencyKey: creditKey,
          });
          if (!settled.ok) {
            // The reservation was released by the hourly sweep because the
            // dates passed while nobody answered. Thrown so the confirmation
            // above rolls back with it.
            throw new AppError(
              'The guest points for this stay were released when the dates passed, so it can no longer be accepted',
              409,
              'GUEST_POINTS_RESERVATION_LOST',
            );
          }
        }

        return confirmed;
      });
    } else {
      // A decline gives the guest their points back, in the same transaction as
      // the transition.
      updated = await transitionAndReleaseGuestPoints(
        db,
        exchangeRequest,
        nextStatus,
        fromStatuses,
        {
          message: nextMessage,
        },
      );
      if (!updated) {
        throw new AppError(
          'Only pending requests can be confirmed or declined',
          400,
          'INVALID_STATE',
        );
      }
    }
  } else if (nextStatus === ExchangeRequestStatus.CANCELLED) {
    if (!isRequester) throw new AppError('Only the requester can cancel', 403, 'FORBIDDEN');
    if (exchangeRequest.status === ExchangeRequestStatus.CANCELLED) {
      // Already in the state the caller asked for. The message is still
      // applied, so a repeat converges.
      const converged =
        nextMessage === undefined
          ? exchangeRequest
          : ((await setExchangeRequestMessage(db, id, nextMessage)) ?? exchangeRequest);
      return { exchangeRequest: serializeExchangeRequest(converged), alreadyCancelled: true };
    }
    fromStatuses = [ExchangeRequestStatus.PENDING, ExchangeRequestStatus.CONFIRMED];
    updated = await transitionAndReleaseGuestPoints(db, exchangeRequest, nextStatus, fromStatuses, {
      message: nextMessage,
    });
    if (!updated) {
      throw new AppError(
        'Only pending or confirmed requests can be cancelled',
        400,
        'INVALID_STATE',
      );
    }
  } else if (nextStatus === ExchangeRequestStatus.COMPLETED) {
    if (exchangeRequest.status !== ExchangeRequestStatus.CONFIRMED) {
      throw new AppError('Only confirmed exchanges can be completed', 400, 'INVALID_STATE');
    }
    if (exchangeRequest.requestedWindowEnd.getTime() > now.getTime()) {
      throw new AppError(
        'An exchange can only be completed after the stay window has passed',
        400,
        'STAY_NOT_ENDED',
      );
    }
    // A SWAP only completes once BOTH legs have ended.
    if (exchangeRequest.mode === ExchangeMode.SWAP) {
      if (
        !exchangeRequest.offeredWindowEnd ||
        exchangeRequest.offeredWindowEnd.getTime() > now.getTime()
      ) {
        throw new AppError(
          'A swap can only be completed after both stay windows have passed',
          400,
          'STAY_NOT_ENDED',
        );
      }
    }
    fromStatuses = [ExchangeRequestStatus.CONFIRMED];
    updated = await transitionExchangeRequest(db, id, nextStatus, fromStatuses, {
      message: nextMessage,
    });
    if (!updated) {
      throw new AppError('Only confirmed exchanges can be completed', 400, 'INVALID_STATE');
    }
  } else {
    throw new AppError('Unsupported status transition', 400, 'INVALID_STATE');
  }

  logger.info('Exchange request status updated', {
    exchangeRequestId: updated.id,
    nextStatus: updated.status,
    byHost: isHost,
    byRequester: isRequester,
  });
  return { exchangeRequest: serializeExchangeRequest(updated), alreadyCancelled: false };
}

// ── Reviews ─────────────────────────────────────────────────────────────────

export interface WriteExchangeReviewInput {
  readonly exchangeRequestId: string;
  readonly rating: unknown;
  readonly comment?: unknown;
  readonly categories?: unknown;
}

/**
 * Review the OTHER party of a COMPLETED exchange, once. The subject is resolved
 * server-side, so the reviewer can never name it.
 */
export async function writeExchangeReview(
  oxyUserId: string,
  input: WriteExchangeReviewInput,
): Promise<ExchangeDto> {
  const db = getDb();
  const exchangeRequest = await findExchangeRequestById(db, input.exchangeRequestId);
  if (!exchangeRequest) throw new AppError('Exchange request not found', 404, 'NOT_FOUND');

  const isRequester = exchangeRequest.requesterOxyUserId === oxyUserId;
  const isHost = exchangeRequest.hostOxyUserId === oxyUserId;
  if (!isRequester && !isHost) {
    throw new AppError('Not authorized to review this exchange', 403, 'FORBIDDEN');
  }
  if (exchangeRequest.status !== ExchangeRequestStatus.COMPLETED) {
    throw new AppError('You can only review a completed exchange', 400, 'EXCHANGE_NOT_COMPLETED');
  }
  const { rating } = input;
  if (typeof rating !== 'number' || !Number.isFinite(rating)) {
    throw new AppError('A rating is required', 400, 'INVALID_RATING');
  }

  // The reviewer reviews the other party, which is also what makes
  // `exchange_reviews_distinct_parties_check` unreachable through this path.
  const subjectOxyUserId = isRequester
    ? exchangeRequest.hostOxyUserId
    : exchangeRequest.requesterOxyUserId;

  // No "already reviewed?" pre-read: `exchange_reviews_request_reviewer_key` is
  // a real UNIQUE, so the INSERT is the check and the 409 comes from its own
  // violation.
  let review: Awaited<ReturnType<typeof createExchangeReviewRow>>;
  try {
    review = await createExchangeReviewRow(db, {
      exchangeRequestId: exchangeRequest.id,
      reviewerOxyUserId: oxyUserId,
      subjectOxyUserId,
      rating,
      comment: input.comment as string | undefined,
      categories: input.categories as ExchangeReviewCategories | undefined,
    });
  } catch (error) {
    if (error instanceof ExchangeAlreadyReviewedError) {
      throw new AppError('You have already reviewed this exchange', 409, 'ALREADY_REVIEWED');
    }
    throw error;
  }

  logger.info('Exchange review created', {
    exchangeReviewId: review.id,
    exchangeRequestId: exchangeRequest.id,
  });
  return serializeExchangeReview(review);
}

/** Both reviews tied to one exchange, to its requester or its host. */
export async function listExchangeReviews(
  oxyUserId: string,
  input: { readonly exchangeRequestId: string },
): Promise<ExchangeDto[]> {
  const db = getDb();
  const exchangeRequest = await findExchangeRequestById(db, input.exchangeRequestId);
  if (!exchangeRequest) throw new AppError('Exchange request not found', 404, 'NOT_FOUND');
  const isRequester = exchangeRequest.requesterOxyUserId === oxyUserId;
  const isHost = exchangeRequest.hostOxyUserId === oxyUserId;
  if (!isRequester && !isHost) {
    throw new AppError('Not authorized to view these reviews', 403, 'FORBIDDEN');
  }
  const reviews = await listReviewsForExchange(db, exchangeRequest.id);
  return reviews.map(serializeExchangeReview);
}

/**
 * The exchange reviews where one person is the SUBJECT, newest first, with an
 * aggregate. Public to any signed-in person — the `oxyUserId` names whose
 * reviews to read, it is not an authority.
 */
export async function listUserExchangeReviews(
  input: ExchangePage & { readonly subjectOxyUserId: string },
): Promise<
  ExchangePage & {
    readonly rows: ExchangeDto[];
    readonly total: number;
    readonly averageRating: number;
  }
> {
  const { page, limit, subjectOxyUserId } = input;
  if (!subjectOxyUserId) {
    throw new AppError('Oxy user id is required', 400, 'OXY_USER_ID_REQUIRED');
  }
  const result = await listReviewsForSubject(getDb(), subjectOxyUserId, {
    limit,
    offset: (page - 1) * limit,
  });
  return {
    page,
    limit,
    total: result.total,
    averageRating: result.averageRating,
    rows: result.rows.map(serializeExchangeReview),
  };
}

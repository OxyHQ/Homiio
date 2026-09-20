/**
 * What a person still has to turn up for — the one classification the three
 * booking surfaces share (#518 §7.5, #519 §7.5).
 *
 * Homiio records three different commitments against a home, and until now each
 * screen decided for itself which of them counted as "upcoming". Saved had its
 * own copy of the rule; My home had none at all, so a tenant with a confirmed
 * stay next week saw nothing about it on the screen named for their home. This
 * module is the rule, in pure functions over plain rows, so the surfaces agree
 * and a test can ask the question directly instead of through a renderer.
 *
 * ## The three commitments, and why they do not classify alike
 *
 * - A **stay** (`Reservation`) and a **swap** (`ExchangeRequest`) are half-open
 *   civil WINDOWS `[start, end)` stored at midnight UTC. `end` is the checkout
 *   morning, so `now >= end` is already true for the whole of the day somebody
 *   is still packing on. They stay upcoming until the END OF THE CHECKOUT DAY —
 *   {@link CHECKOUT_GRACE_MS}, the one grace in here, and it is a day rather
 *   than a hedged number because it is exactly the day the row describes.
 * - A **viewing** (`ViewingRequest`) is a SHORT window. This file used to say
 *   it was an instant, because there was no honest duration to end it with — a
 *   flat had no declared visit length. #518 §7.5 gave it one: the length is
 *   agreed when the request is made and stored on the row, so a viewing is
 *   upcoming until it has finished rather than until it has started, and the
 *   half hour somebody is in the middle of stays on their own list. There is
 *   still no checkout grace: a visit that ended is over.
 *
 * ## Statuses
 *
 * Two answers, because the surfaces ask different questions. **My home** asks
 * what is COMMITTED — a confirmed stay, an accepted swap, an approved viewing:
 * things with a date the person must not miss. **Saved** is a collection
 * surface and asks what is OPEN, pending requests included, because a request
 * awaiting an answer is part of what somebody is considering. Neither ever
 * counts a cancelled, declined or completed row as upcoming.
 *
 * Nothing here reads the clock: `nowMs` is passed in. A render that called
 * `Date.now()` would not be pure, and a test of it would be a test of the
 * machine it ran on.
 */
import {
  ExchangeRequestStatus,
  ReservationStatus,
  type ExchangeMode,
  type ExchangeRequest,
  type Reservation,
} from '@homiio/shared-types';
// Type-only, so nothing here pulls Bloom into a Node test run.
import type { TripStatus } from '@oxy.so/bloom/booking';

import type { ViewingRequest } from '@/services/viewingService';

/** A stay or swap stays current through the whole of its checkout day. */
export const CHECKOUT_GRACE_MS = 24 * 60 * 60 * 1000;

export type BookingKind = 'stay' | 'swap' | 'viewing';

/** The two statuses a row can carry while it is still ahead of somebody. */
export type OpenBookingStatus = Extract<TripStatus, 'pending' | 'confirmed'>;

/** Everything a booking surface draws, from any of the three sources. */
export interface UpcomingBooking {
  /** Stable across sources: the kind never collides with another kind's id. */
  readonly key: string;
  readonly kind: BookingKind;
  readonly id: string;
  readonly propertyId: string;
  /** ISO. For a viewing this is the scheduled instant. */
  readonly start: string;
  /** ISO, EXCLUSIVE for a window. For a viewing it equals {@link start}. */
  readonly end: string;
  readonly status: OpenBookingStatus;
  /** Swaps only: `swap`, `host` or `both`. */
  readonly mode?: ExchangeMode;
}

/** What each surface counts. */
export const COMMITTED_ONLY: readonly OpenBookingStatus[] = ['confirmed'];
export const OPEN_STATUSES: readonly OpenBookingStatus[] = ['pending', 'confirmed'];

const parse = (iso: string): number => {
  const time = new Date(iso).getTime();
  return Number.isFinite(time) ? time : Number.NaN;
};

/**
 * A stay or swap window is still ahead of somebody while its checkout day has
 * not finished. An unparseable date is NOT upcoming — a row nobody can place on
 * a calendar is not something to promise a person they will not miss.
 */
export function windowIsUpcoming(end: string, nowMs: number): boolean {
  const time = parse(end);
  return Number.isFinite(time) && time + CHECKOUT_GRACE_MS > nowMs;
}

/**
 * A viewing is upcoming until it has finished.
 *
 * It used to be upcoming only until it STARTED, because there was no honest
 * duration to end it with — a flat had no declared visit length. #518 §7.5 gave
 * it one: `durationMinutes` is agreed when the request is made and stored on
 * the row, so a half hour that began ten minutes ago is still the thing the
 * person is doing and disappearing it from their own list is wrong.
 *
 * The duration is defaulted rather than required so a cached row written by an
 * older build still places on the calendar — as a moment, exactly as before —
 * instead of vanishing.
 */
export function viewingIsUpcoming(
  scheduledAt: string,
  nowMs: number,
  durationMinutes = 0,
): boolean {
  const time = parse(scheduledAt);
  if (!Number.isFinite(time)) return false;
  const length = Number.isFinite(durationMinutes) ? Math.max(0, durationMinutes) : 0;
  return time + length * 60_000 >= nowMs;
}

/** `ReservationStatus` narrowed to the two a surface draws. */
export function reservationStatus(status: string): OpenBookingStatus | null {
  if (status === ReservationStatus.CONFIRMED) return 'confirmed';
  if (status === ReservationStatus.PENDING) return 'pending';
  return null;
}

/** `ExchangeRequestStatus` narrowed the same way. */
export function exchangeStatus(status: string): OpenBookingStatus | null {
  if (status === ExchangeRequestStatus.CONFIRMED) return 'confirmed';
  if (status === ExchangeRequestStatus.PENDING) return 'pending';
  return null;
}

/**
 * A viewing's own vocabulary is `approved`, not `confirmed` — the word the
 * server uses, mapped here once rather than at three call sites.
 */
export function viewingStatus(status: string): OpenBookingStatus | null {
  if (status === 'approved') return 'confirmed';
  if (status === 'pending') return 'pending';
  return null;
}

const wanted = (
  status: OpenBookingStatus | null,
  statuses: readonly OpenBookingStatus[],
): status is OpenBookingStatus => status !== null && statuses.includes(status);

/** The rows a booking surface reads. Any of them may still be loading. */
export interface BookingSources {
  readonly reservations?: readonly Reservation[];
  readonly exchanges?: readonly ExchangeRequest[];
  readonly viewings?: readonly ViewingRequest[];
}

export interface UpcomingBookingOptions {
  /** Default {@link OPEN_STATUSES}. */
  readonly statuses?: readonly OpenBookingStatus[];
}

/**
 * Every commitment still ahead of the viewer, soonest first.
 *
 * Sorted by START rather than by kind: somebody scanning this wants to know
 * what happens next, and a viewing on Tuesday matters more than a stay in
 * November whatever its type. Ties break on the key so the order is stable
 * across renders instead of depending on the sort's implementation.
 */
export function upcomingBookings(
  sources: BookingSources,
  nowMs: number,
  options: UpcomingBookingOptions = {},
): UpcomingBooking[] {
  const statuses = options.statuses ?? OPEN_STATUSES;
  const out: UpcomingBooking[] = [];

  for (const row of sources.reservations ?? []) {
    const status = reservationStatus(row.status);
    if (!wanted(status, statuses) || !windowIsUpcoming(row.checkOut, nowMs)) continue;
    out.push({
      key: `stay-${row.id}`,
      kind: 'stay',
      id: row.id,
      propertyId: row.propertyId,
      start: row.checkIn,
      end: row.checkOut,
      status,
    });
  }

  for (const row of sources.exchanges ?? []) {
    const status = exchangeStatus(row.status);
    if (!wanted(status, statuses) || !windowIsUpcoming(row.requestedWindow.end, nowMs)) continue;
    out.push({
      key: `swap-${row.id}`,
      kind: 'swap',
      id: row.id,
      propertyId: row.propertyId,
      start: row.requestedWindow.start,
      end: row.requestedWindow.end,
      status,
      mode: row.mode,
    });
  }

  for (const row of sources.viewings ?? []) {
    const status = viewingStatus(row.status);
    if (!wanted(status, statuses) || !viewingIsUpcoming(row.scheduledAt, nowMs, row.durationMinutes))
      continue;
    const startMs = parse(row.scheduledAt);
    const length = Number.isFinite(row.durationMinutes) ? Math.max(0, row.durationMinutes) : 0;
    out.push({
      key: `viewing-${row.id}`,
      kind: 'viewing',
      id: row.id,
      propertyId: row.propertyId,
      start: row.scheduledAt,
      // A viewing has a declared length now (#518 §7.5), so `end` is a real
      // end rather than a copy of the start.
      end: Number.isFinite(startMs)
        ? new Date(startMs + length * 60_000).toISOString()
        : row.scheduledAt,
      status,
    });
  }

  return out.sort((a, b) => {
    const delta = parse(a.start) - parse(b.start);
    return delta !== 0 ? delta : a.key.localeCompare(b.key);
  });
}

/**
 * ## The host calendar's half
 *
 * A confirmed swap takes a home for its nights exactly as a paid stay does —
 * the server's availability projection says so (`listConfirmedExchangeStays`),
 * and PR #539 made it refuse the overlap. The host calendar built its spans
 * from blocked windows plus reservations only, so a host with an accepted swap
 * saw those nights free on the one surface they plan from.
 *
 * An exchange commits a home in EITHER of two roles, and this mirrors the
 * server's rule rather than restating half of it:
 *
 *  - the home is the TARGET (`propertyId`) — the requested window commits it;
 *  - the home is the one OFFERED in return (`offeredPropertyId`) — the offered
 *    window commits it, when there is one.
 *
 * Which means the host inbox alone is not enough: a swap the viewer PROPOSED,
 * offering this very home, commits it just as much, and that row only appears
 * in the guest-side list. Both lists go in.
 */
export interface ExchangeSpan {
  /** Stable per row AND role, so a dedupe never drops the second window. */
  readonly key: string;
  readonly exchangeId: string;
  readonly start: string;
  /** Exclusive, half-open, as stored. */
  readonly end: string;
  readonly status: OpenBookingStatus;
  /** `false` when this home is the one offered in return. */
  readonly isTarget: boolean;
}

/**
 * The exchange spans committing one property, from both sides of the viewer's
 * exchange lists. Deduped by row and role, because a person can appear in both
 * lists and the same span must not be drawn twice.
 */
export function exchangeSpansForProperty(
  requests: readonly (readonly ExchangeRequest[] | undefined)[],
  propertyId: string,
): ExchangeSpan[] {
  const byKey = new Map<string, ExchangeSpan>();
  for (const list of requests) {
    for (const row of list ?? []) {
      const status = exchangeStatus(row.status);
      if (status === null) continue;
      if (row.propertyId === propertyId) {
        byKey.set(`${row.id}:target`, {
          key: `${row.id}:target`,
          exchangeId: row.id,
          start: row.requestedWindow.start,
          end: row.requestedWindow.end,
          status,
          isTarget: true,
        });
      }
      if (row.offeredPropertyId === propertyId && row.offeredWindow) {
        byKey.set(`${row.id}:offered`, {
          key: `${row.id}:offered`,
          exchangeId: row.id,
          start: row.offeredWindow.start,
          end: row.offeredWindow.end,
          status,
          isTarget: false,
        });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => {
    const delta = parse(a.start) - parse(b.start);
    return delta !== 0 ? delta : a.key.localeCompare(b.key);
  });
}

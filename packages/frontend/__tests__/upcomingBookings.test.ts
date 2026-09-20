/**
 * What counts as a booking somebody still has to turn up for, and which nights
 * a swap takes off a host's calendar (#518 §7.5, #519 §7.5).
 *
 * The three surfaces that draw bookings — My home, Saved and the host calendar
 * — all route through `utils/upcomingBookings.ts`, so this pins the rules
 * directly rather than through a renderer. Jest cannot mount Bloom's heavier
 * parts in this repo, and a snapshot of a card would not have caught any of the
 * four things below anyway:
 *
 *  1. a stay vanishing from the list on the morning somebody checks out;
 *  2. a cancelled or declined row counted as upcoming;
 *  3. a swap the viewer PROPOSED, offering their own home, leaving the host
 *     calendar free on nights that home is committed for — the client half of
 *     the defect PR #539 fixed on the server;
 *  4. a failed fetch rendering as "you have no trips", which is a lie rather
 *     than a missing spinner. That last one is a property of the HOOK's result,
 *     so it is asserted on the shape the surfaces branch on.
 */

import {
  ExchangeMode,
  ExchangeRequestStatus,
  ReservationStatus,
  type ExchangeRequest,
  type Reservation,
} from '@homiio/shared-types';

import {
  CHECKOUT_GRACE_MS,
  COMMITTED_ONLY,
  exchangeSpansForProperty,
  upcomingBookings,
  viewingIsUpcoming,
  windowIsUpcoming,
} from '@/utils/upcomingBookings';
import type { ViewingRequest } from '@/services/viewingService';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-06-10T09:00:00.000Z');
const iso = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString();
/** Midnight UTC, which is how a civil check-in/checkout date is stored. */
const civil = (day: string) => `${day}T00:00:00.000Z`;

function reservation(overrides: Partial<Reservation> = {}): Reservation {
  return {
    id: 'r1',
    propertyId: 'p1',
    checkIn: iso(3),
    checkOut: iso(6),
    status: ReservationStatus.CONFIRMED,
    ...overrides,
  } as Reservation;
}

function exchange(overrides: Partial<ExchangeRequest> = {}): ExchangeRequest {
  return {
    id: 'x1',
    propertyId: 'p2',
    requesterOxyUserId: 'me',
    hostOxyUserId: 'them',
    mode: ExchangeMode.SWAP,
    requestedWindow: { start: iso(10), end: iso(14) },
    usesGuestPoints: false,
    status: ExchangeRequestStatus.CONFIRMED,
    createdAt: iso(-30),
    updatedAt: iso(-30),
    ...overrides,
  } as ExchangeRequest;
}

function viewing(overrides: Partial<ViewingRequest> = {}): ViewingRequest {
  return {
    id: 'v1',
    propertyId: 'p3',
    requesterOxyUserId: 'me',
    ownerOxyUserId: 'them',
    scheduledAt: iso(1),
    date: '2026-06-11',
    time: '09:00',
    status: 'approved',
    createdAt: iso(-1),
    updatedAt: iso(-1),
    ...overrides,
  };
}

describe('windowIsUpcoming — a stay survives its own checkout day', () => {
  it('keeps a stay while the checkout day is still running', () => {
    // Checkout is midnight UTC today: `now >= end` already, and a naive rule
    // would drop the stay off the screen of somebody who is still in the flat.
    expect(windowIsUpcoming(civil('2026-06-10'), NOW)).toBe(true);
    expect(CHECKOUT_GRACE_MS).toBe(DAY);
  });

  it('drops it once that day is over', () => {
    expect(windowIsUpcoming(civil('2026-06-09'), NOW)).toBe(false);
    expect(windowIsUpcoming(iso(-5), NOW)).toBe(false);
  });

  it('keeps every future window', () => {
    expect(windowIsUpcoming(iso(1), NOW)).toBe(true);
    expect(windowIsUpcoming(iso(400), NOW)).toBe(true);
  });

  it('refuses a date nobody can place on a calendar', () => {
    // Not "upcoming by default": an unreadable date must not become a promise
    // that somebody has something coming up.
    expect(windowIsUpcoming('not a date', NOW)).toBe(false);
    expect(windowIsUpcoming('', NOW)).toBe(false);
  });
});

describe('viewingIsUpcoming — a moment, not a window', () => {
  it('has no checkout day to survive', () => {
    expect(viewingIsUpcoming(new Date(NOW + 60_000).toISOString(), NOW)).toBe(true);
    expect(viewingIsUpcoming(new Date(NOW).toISOString(), NOW)).toBe(true);
    // One minute past its start it is not something to not miss any more, and
    // there is no honest visit length to invent.
    expect(viewingIsUpcoming(new Date(NOW - 60_000).toISOString(), NOW)).toBe(false);
  });
});

describe('upcomingBookings — what each surface asks for', () => {
  const sources = {
    reservations: [
      reservation({ id: 'stay-soon', checkIn: iso(2), checkOut: iso(5) }),
      reservation({ id: 'stay-pending', status: ReservationStatus.PENDING, checkIn: iso(20), checkOut: iso(24) }),
      reservation({ id: 'stay-cancelled', status: ReservationStatus.CANCELLED, checkIn: iso(1), checkOut: iso(4) }),
      reservation({ id: 'stay-past', checkIn: iso(-20), checkOut: iso(-15) }),
    ],
    exchanges: [
      exchange({ id: 'swap-confirmed' }),
      exchange({ id: 'swap-pending', status: ExchangeRequestStatus.PENDING, requestedWindow: { start: iso(30), end: iso(34) } }),
      exchange({ id: 'swap-declined', status: ExchangeRequestStatus.DECLINED, requestedWindow: { start: iso(2), end: iso(4) } }),
      exchange({ id: 'swap-completed', status: ExchangeRequestStatus.COMPLETED, requestedWindow: { start: iso(2), end: iso(4) } }),
    ],
    viewings: [
      viewing({ id: 'viewing-approved', scheduledAt: iso(1) }),
      viewing({ id: 'viewing-pending', status: 'pending', scheduledAt: iso(7) }),
      viewing({ id: 'viewing-declined', status: 'declined', scheduledAt: iso(2) }),
      viewing({ id: 'viewing-past', scheduledAt: iso(-2) }),
    ],
  };

  it('My home asks for what is COMMITTED, and gets no open requests', () => {
    const items = upcomingBookings(sources, NOW, { statuses: COMMITTED_ONLY });
    expect(items.map((booking) => booking.id)).toEqual([
      'viewing-approved',
      'stay-soon',
      'swap-confirmed',
    ]);
    expect(items.every((booking) => booking.status === 'confirmed')).toBe(true);
  });

  it('Saved asks for what is OPEN, so pending rows join them', () => {
    const items = upcomingBookings(sources, NOW);
    expect(items.map((booking) => booking.id)).toEqual([
      'viewing-approved',
      'stay-soon',
      'viewing-pending',
      'swap-confirmed',
      'stay-pending',
      'swap-pending',
    ]);
  });

  it('never counts a cancelled, declined or completed row', () => {
    const ids = upcomingBookings(sources, NOW).map((booking) => booking.id);
    expect(ids).not.toContain('stay-cancelled');
    expect(ids).not.toContain('swap-declined');
    expect(ids).not.toContain('swap-completed');
    expect(ids).not.toContain('viewing-declined');
  });

  it('never counts a row that is already behind the viewer', () => {
    const ids = upcomingBookings(sources, NOW).map((booking) => booking.id);
    expect(ids).not.toContain('stay-past');
    expect(ids).not.toContain('viewing-past');
  });

  it('sorts by when it happens, not by what kind it is', () => {
    const starts = upcomingBookings(sources, NOW).map((booking) => Date.parse(booking.start));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('carries the swap mode and each row a route can be built from', () => {
    const swap = upcomingBookings(sources, NOW).find((booking) => booking.kind === 'swap');
    expect(swap).toMatchObject({ mode: ExchangeMode.SWAP, propertyId: 'p2', key: 'swap-swap-confirmed' });
  });

  it('asks for nothing it was not given', () => {
    // A surface that does not fetch viewings must not be handed invented ones.
    expect(upcomingBookings({ reservations: sources.reservations }, NOW).every(
      (booking) => booking.kind === 'stay',
    )).toBe(true);
    expect(upcomingBookings({}, NOW)).toEqual([]);
  });
});

describe('exchangeSpansForProperty — which nights a swap takes off a host calendar', () => {
  const HOME = 'my-home';

  it('takes the requested window when the home is the one being visited', () => {
    const spans = exchangeSpansForProperty(
      [[exchange({ id: 'a', propertyId: HOME, requestedWindow: { start: iso(2), end: iso(5) } })]],
      HOME,
    );
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ exchangeId: 'a', isTarget: true, status: 'confirmed' });
  });

  it('takes the OFFERED window when the home is the one given in return', () => {
    // The row the host inbox never shows: a swap the viewer proposed. It
    // commits this home exactly as much, which is what the server's own
    // `listConfirmedExchangeStays` says.
    const spans = exchangeSpansForProperty(
      [
        undefined,
        [
          exchange({
            id: 'b',
            propertyId: 'somebody-elses',
            offeredPropertyId: HOME,
            offeredWindow: { start: iso(8), end: iso(11) },
          }),
        ],
      ],
      HOME,
    );
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ exchangeId: 'b', isTarget: false, start: iso(8), end: iso(11) });
  });

  it('ignores an offered property with no offered window', () => {
    const spans = exchangeSpansForProperty(
      [[exchange({ id: 'c', propertyId: 'other', offeredPropertyId: HOME, offeredWindow: undefined })]],
      HOME,
    );
    expect(spans).toEqual([]);
  });

  it('draws a span once even when the row arrives in both lists', () => {
    const row = exchange({ id: 'd', propertyId: HOME });
    expect(exchangeSpansForProperty([[row], [row]], HOME)).toHaveLength(1);
  });

  it('ignores another home entirely', () => {
    expect(exchangeSpansForProperty([[exchange({ id: 'e', propertyId: 'elsewhere' })]], HOME)).toEqual([]);
  });

  it('keeps pending apart from confirmed, and drops what no longer blocks', () => {
    const spans = exchangeSpansForProperty(
      [
        [
          exchange({ id: 'f', propertyId: HOME, status: ExchangeRequestStatus.PENDING }),
          exchange({ id: 'g', propertyId: HOME, status: ExchangeRequestStatus.CANCELLED }),
          exchange({ id: 'h', propertyId: HOME, status: ExchangeRequestStatus.DECLINED }),
        ],
      ],
      HOME,
    );
    expect(spans.map((span) => [span.exchangeId, span.status])).toEqual([['f', 'pending']]);
  });

  it('keeps PAST spans, because a calendar is also read backwards', () => {
    // Unlike the trip list: a host scrolling to last month must still see who
    // was in the home. Only `upcomingBookings` filters on the clock.
    const spans = exchangeSpansForProperty(
      [[exchange({ id: 'i', propertyId: HOME, requestedWindow: { start: iso(-40), end: iso(-35) } })]],
      HOME,
    );
    expect(spans).toHaveLength(1);
  });
});

/**
 * The guest-points arithmetic both sides share, and the key the client mints
 * (#518 §7.5, #519 §7.5).
 *
 * The server has its own copy of the available balance, in SQL, and the backend
 * integration suite asserts the two agree on a ledger containing every state.
 * What this file pins is the shared function itself — the one a screen renders
 * from — against the four ways it could be wrong: counting a reservation as
 * spendable, counting a release as a credit, inventing a balance for somebody
 * who has never moved, and charging by guests rather than by nights.
 */

import {
  guestPointStanding,
  guestPointsForWindow,
  type GuestPointMovement,
} from '@homiio/shared-types';

import { guestPointsIdempotencyKeyFor } from '@/services/guestPointsService';

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.parse('2026-06-01T00:00:00.000Z');

function movement(overrides: Partial<GuestPointMovement>): GuestPointMovement {
  return {
    id: overrides.id ?? 'm1',
    accountOxyUserId: 'me',
    counterpartyOxyUserId: 'them',
    exchangeRequestId: overrides.exchangeRequestId ?? 'x1',
    direction: overrides.direction ?? 'earn',
    state: overrides.state ?? 'settled',
    points: overrides.points ?? 1,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  } as GuestPointMovement;
}

describe('guestPointsForWindow — one point per night', () => {
  it('counts nights on a half-open window', () => {
    expect(
      guestPointsForWindow(new Date(BASE), new Date(BASE + 3 * DAY)),
    ).toBe(3);
    expect(guestPointsForWindow(new Date(BASE), new Date(BASE + DAY))).toBe(1);
    // Seven nights, not eight: the window is `[start, end)`, matching the
    // calendar's own bounds. An inclusive count would charge a night nobody
    // slept.
    expect(guestPointsForWindow(new Date(BASE), new Date(BASE + 7 * DAY))).toBe(7);
  });

  it('never charges zero for a real stay', () => {
    // A few hours over a whole number of days still rounds UP. A free night is
    // as wrong as an invented one, and the ledger's own `points > 0` CHECK
    // would refuse the row rather than grant it.
    expect(guestPointsForWindow(new Date(BASE), new Date(BASE + DAY + 3600_000))).toBe(2);
    expect(guestPointsForWindow(new Date(BASE), new Date(BASE + 60_000))).toBe(1);
  });

  it('answers zero for a window that is not one', () => {
    expect(guestPointsForWindow(new Date(BASE), new Date(BASE))).toBe(0);
    expect(guestPointsForWindow(new Date(BASE + DAY), new Date(BASE))).toBe(0);
    expect(guestPointsForWindow('not a date', new Date(BASE))).toBe(0);
  });

  it('takes no guest count at all', () => {
    // Stated as a test because it is the product decision, not an omission:
    // two people staying one night is one night of hosting. The signature has
    // nowhere to put a head count, which is what makes it unable to drift.
    expect(guestPointsForWindow.length).toBe(2);
  });
});

describe('guestPointStanding — available is not balance', () => {
  it('a new member has nothing, and says so', () => {
    expect(guestPointStanding([])).toEqual({
      earned: 0,
      spent: 0,
      reserved: 0,
      balance: 0,
      available: 0,
      neverMoved: true,
    });
  });

  it('a reserved point is neither spent nor spendable', () => {
    const standing = guestPointStanding([
      movement({ id: 'a', direction: 'earn', state: 'settled', points: 5 }),
      movement({ id: 'b', direction: 'spend', state: 'reserved', points: 2 }),
    ]);

    expect(standing.balance).toBe(5);
    expect(standing.spent).toBe(0);
    expect(standing.reserved).toBe(2);
    // The assertion this whole contract exists for. A version that ignored
    // reservations answers 5 here and lets somebody double-spend.
    expect(standing.available).toBe(3);
  });

  it('a released reservation is counted nowhere', () => {
    const standing = guestPointStanding([
      movement({ id: 'a', direction: 'earn', state: 'settled', points: 3 }),
      movement({
        id: 'b',
        direction: 'spend',
        state: 'released',
        points: 2,
        releaseReason: 'declined',
      }),
    ]);

    expect(standing).toMatchObject({ earned: 3, spent: 0, reserved: 0, available: 3 });
    // And it is history rather than absence: the row was there to be counted,
    // and the standing still reports the account as having moved.
    expect(standing.neverMoved).toBe(false);
  });

  it('a member who has hosted and stayed in equal measure is not a new member', () => {
    const standing = guestPointStanding([
      movement({ id: 'a', direction: 'earn', state: 'settled', points: 3 }),
      movement({ id: 'b', direction: 'spend', state: 'settled', points: 3 }),
    ]);

    expect(standing).toMatchObject({ earned: 3, spent: 3, balance: 0, available: 0 });
    // The distinction the surface needs: zero because they used it, not zero
    // because they have never started. The two deserve different sentences.
    expect(standing.neverMoved).toBe(false);
  });
});

describe('the reservation key', () => {
  it('is the same for the same intent and different for a different one', () => {
    const a = guestPointsIdempotencyKeyFor('prop-1', '2026-06-01T10:00:00.000Z', '2026-06-04T10:00:00.000Z');
    // The same stay, asked for a second later. A key that carried the clock
    // would make this a different intent, which is the property an idempotency
    // key exists to destroy.
    const b = guestPointsIdempotencyKeyFor('prop-1', '2026-06-01T10:00:41.000Z', '2026-06-04T09:00:00.000Z');
    expect(a).toBe(b);

    expect(a).not.toBe(
      guestPointsIdempotencyKeyFor('prop-2', '2026-06-01T10:00:00.000Z', '2026-06-04T10:00:00.000Z'),
    );
    expect(a).not.toBe(
      guestPointsIdempotencyKeyFor('prop-1', '2026-06-02T10:00:00.000Z', '2026-06-04T10:00:00.000Z'),
    );
  });

  it('fits the shape the server accepts', () => {
    const key = guestPointsIdempotencyKeyFor(
      '01a0bcee-aeb1-7c72-8333-461947bf17e1',
      '2026-06-01T10:00:00.000Z',
      '2026-06-04T10:00:00.000Z',
    );
    expect(key).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });
});

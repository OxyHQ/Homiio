/**
 * The network rung's own rules: the startup budget, and what a destination card
 * commits.
 *
 * Both are pure functions for the same reason the ladder is — the budget is a
 * timing rule, and a timing rule asserted with a fake clock is the kind of test
 * that passes for the wrong reason. Expressed as "given these four facts, what
 * does the rung say?", it is an ordinary assertion.
 */

import { approximateStateOf, APPROXIMATE_BUDGET_MS } from '@/hooks/useApproximateLocation';
import { destinationSelection } from '@/components/home/HomeDiscoveryBoard';
import type { ApproximateLocation, City } from '@homiio/shared-types';

const RESOLVED: ApproximateLocation = {
  status: 'resolved',
  source: 'ip',
  granularity: 'city',
  selection: {
    kind: 'place',
    source: { kind: 'homiio', entity: 'city', id: 'city-bucharest' },
    placeType: 'city',
    label: { primary: 'Bucharest', kind: 'place' },
    admin: { countryCode: 'RO', cityName: 'Bucharest' },
    precision: 'centroid',
    center: { longitude: 26.1025, latitude: 44.4268 },
  },
  admin: { countryCode: 'RO', cityName: 'Bucharest' },
  resolvedAt: '2026-09-19T10:00:00.000Z',
  expiresAt: '2026-09-19T10:30:00.000Z',
};

const UNAVAILABLE: ApproximateLocation = {
  status: 'unavailable',
  source: 'ip',
  reason: 'no_match',
  resolvedAt: '2026-09-19T10:00:00.000Z',
};

describe('the startup budget', () => {
  it('is the 1.5 seconds the issues propose', () => {
    // Pinned rather than described: the number is a product decision (#518
    // §3.3) and a silent change to it changes what a cold start looks like.
    expect(APPROXIMATE_BUDGET_MS).toBe(1_500);
  });

  it('reports resolving while the request is in flight and the budget holds', () => {
    expect(
      approximateStateOf({ enabled: true, isPending: true, elapsedBudget: false, data: undefined }),
    ).toEqual({ status: 'resolving' });
  });

  it('gives up WAITING at the deadline, so discovery appears', () => {
    expect(
      approximateStateOf({ enabled: true, isPending: true, elapsedBudget: true, data: undefined }),
    ).toEqual({ status: 'unavailable' });
  });

  it('still uses an answer that lands after the deadline', () => {
    // The deadline stops the app waiting; it does not cancel the request. A
    // late answer is applied — subject to the ladder's commit rule, which is
    // what stops it from moving somebody who has started exploring.
    expect(
      approximateStateOf({ enabled: true, isPending: false, elapsedBudget: true, data: RESOLVED }),
    ).toEqual({
      status: 'resolved',
      selection: RESOLVED.status === 'resolved' ? RESOLVED.selection : undefined,
      granularity: 'city',
    });
  });

  it('is idle when the rung is not needed at all', () => {
    // An area is already in force. Asking where a connection is, for somebody
    // who has told us where they are looking, is a request whose answer the
    // ladder would discard.
    expect(
      approximateStateOf({ enabled: false, isPending: true, elapsedBudget: false, data: RESOLVED }),
    ).toEqual({ status: 'idle' });
  });

  it('maps every server-side failure onto one unavailable state', () => {
    expect(
      approximateStateOf({ enabled: true, isPending: false, elapsedBudget: false, data: UNAVAILABLE }),
    ).toEqual({ status: 'unavailable' });
  });
});

describe('a destination card commits a real, queryable place', () => {
  const city = (overrides: Partial<City> = {}): City =>
    ({
      id: 'city-barcelona',
      name: 'Barcelona',
      slug: 'barcelona',
      countryId: { id: 'es', code: 'es', name: 'Spain', currency: 'EUR', isActive: true } as never,
      regionId: { id: 'ct', name: 'Catalonia', countryId: 'es', isActive: true } as never,
      coordinates: { lat: 41.3874, lng: 2.1686 },
      currency: 'EUR',
      isActive: true,
      propertiesCount: 42,
      lastUpdated: '2026-09-19T10:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    }) as City;

  it('identifies the city by its Homiio id, so the loc token resolves', () => {
    const selection = destinationSelection(city());
    expect(selection.kind).toBe('place');
    if (selection.kind !== 'place') return;
    expect(selection.source).toEqual({ kind: 'homiio', entity: 'city', id: 'city-barcelona' });
    expect(selection.placeType).toBe('city');
    expect(selection.admin.countryCode).toBe('ES');
  });

  it('carries the city centre as a CENTROID, never as anybody’s position', () => {
    const selection = destinationSelection(city());
    if (selection.kind !== 'place') throw new Error('expected a place');
    expect(selection.precision).toBe('centroid');
    if (selection.precision === 'area') return;
    expect(selection.center).toEqual({ longitude: 2.1686, latitude: 41.3874 });
  });

  it('does NOT invent a centre for a city that has none', () => {
    // The `(0, 0)` bug ADR 0002's `PlaceGeometry` exists to make
    // unrepresentable: a point in the Gulf of Guinea that no null check trips.
    const selection = destinationSelection(city({ coordinates: undefined }));
    if (selection.kind !== 'place') throw new Error('expected a place');
    expect(selection.precision).toBe('area');
    expect((selection as { center?: unknown }).center).toBeUndefined();
  });

  it('does not invent a country code when the country is not populated', () => {
    const selection = destinationSelection(city({ countryId: 'es-id' }));
    if (selection.kind !== 'place') return;
    expect(selection.admin.countryCode).toBe('');
  });
});

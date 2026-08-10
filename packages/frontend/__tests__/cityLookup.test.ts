/**
 * `cityService.lookupCity` — the client half of #295.
 *
 * The backend contract is covered against a real Postgres in
 * `packages/backend/__tests__/integration/cityPlaceLookup.test.ts`. What is
 * testable only here is the CLIENT's handling of the three outcomes, and one of
 * them is a 404 the HTTP layer throws rather than returns — the single place a
 * "not found" could quietly become a network error, or a network error could
 * quietly become "not found".
 *
 * Every assertion is on what the caller RECEIVES, not on the request having been
 * made: an ambiguous lookup that returned a place would satisfy a test that only
 * checked "we called the API".
 */

import { ApiError } from '@/utils/api';
import { cityService } from '@/services/cityService';

/**
 * `mock`-prefixed because `jest.mock` is hoisted above the imports and its
 * factory may only close over names that start that way.
 */
const mockGet = jest.fn();

jest.mock('@/utils/api', () => {
  // Written with explicit assignment rather than TypeScript parameter
  // properties: the latter compile to references babel's hoisting guard reads as
  // out-of-scope variables, and the suite then fails to load at all.
  class MockApiError extends Error {
    status?: number;
    response?: unknown;
    constructor(message: string, status?: number, response?: unknown) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.response = response;
    }
  }
  return {
    __esModule: true,
    ApiError: MockApiError,
    default: { get: (...args: unknown[]) => mockGet(...args) },
  };
});

const barcelonaEs = {
  id: 'city-es',
  source: { kind: 'homiio', entity: 'city', id: 'city-es' },
  placeType: 'city',
  label: { primary: 'Barcelona', secondary: 'Catalonia, Spain', kind: 'place' },
  admin: { countryCode: 'ES', regionName: 'Catalonia', cityName: 'Barcelona' },
  countryId: 'ctry-es',
  regionId: 'rg-cat',
  slug: 'barcelona',
  qualifiedSlug: 'barcelona-catalonia-es',
  center: { longitude: 2.1734, latitude: 41.3851 },
  precision: 'centroid',
  propertiesCount: 500,
  matchedOn: 'name',
};

const barcelonaVe = {
  ...barcelonaEs,
  id: 'city-ve',
  source: { kind: 'homiio', entity: 'city', id: 'city-ve' },
  label: { primary: 'Barcelona', secondary: 'Anzoátegui, Venezuela', kind: 'place' },
  admin: { countryCode: 'VE', regionName: 'Anzoátegui', cityName: 'Barcelona' },
  countryId: 'ctry-ve',
  regionId: 'rg-anz',
  qualifiedSlug: 'barcelona-anzoategui-ve',
  propertiesCount: 1,
};

beforeEach(() => {
  mockGet.mockReset();
});

describe('cityService.lookupCity', () => {
  it('passes an ambiguous result through with BOTH candidates and no place', async () => {
    mockGet.mockResolvedValue({
      data: { status: 'ambiguous', code: 'AMBIGUOUS_LOCATION', candidates: [barcelonaEs, barcelonaVe] },
    });

    const result = await cityService.lookupCity('barcelona');

    expect(result.status).toBe('ambiguous');
    // The negative half. A client that "helpfully" unwrapped the first candidate
    // would still satisfy `status === 'ambiguous'` if it left the field behind,
    // and would then be the very bug #295 removes from the server.
    expect(result).not.toHaveProperty('place');
    if (result.status !== 'ambiguous') throw new Error('unreachable');
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(['city-es', 'city-ve']);
  });

  it('maps a 404 to `not_found` rather than throwing', async () => {
    mockGet.mockRejectedValue(new ApiError('City not found', 404));

    await expect(cityService.lookupCity('atlantis')).resolves.toEqual({ status: 'not_found' });
  });

  it('still THROWS on a transport failure, so "no such city" and "the request failed" stay different answers', async () => {
    mockGet.mockRejectedValue(new ApiError('Network request failed'));

    await expect(cityService.lookupCity('barcelona')).rejects.toThrow('Network request failed');

    mockGet.mockRejectedValue(new ApiError('Server error', 500));
    await expect(cityService.lookupCity('barcelona')).rejects.toThrow('Server error');
  });

  it('sends every discriminator it is given, and nothing it is not', async () => {
    mockGet.mockResolvedValue({ data: { status: 'resolved', place: barcelonaVe } });

    await cityService.lookupCity('barcelona', {
      countryCode: 'VE',
      near: { longitude: -64.7, latitude: 10.1 },
      bounds: { west: 170, south: -20, east: -170, north: -16 },
    });

    const url = mockGet.mock.calls[0][0] as string;
    expect(url).toContain('q=barcelona');
    expect(url).toContain('countryCode=VE');
    // Order-preserving `lng,lat` and `west,south,east,north` — the encoding the
    // backend parses. `west > east` survives untouched, because normalising it
    // would invert an antimeridian box into its complement (ADR §9.3).
    expect(decodeURIComponent(url)).toContain('near=-64.7,10.1');
    expect(decodeURIComponent(url)).toContain('bounds=170,-20,-170,-16');
    // Nothing was defaulted in. `getCityByLocation` used to send `country=USA`
    // whenever a caller omitted it, which is how a lookup for a Spanish city
    // could 404 or land on a third one entirely.
    expect(url).not.toContain('country=');
    expect(url).not.toContain('regionId=');
  });

  it('has no API that picks a city for the caller', () => {
    // `getCityBySlug` is gone, with its fourteen-city map and its `data[0]`.
    // Asserted rather than assumed, because a re-added convenience wrapper is
    // exactly how the behaviour comes back.
    expect(cityService).not.toHaveProperty('getCityBySlug');
    expect(cityService).not.toHaveProperty('getCityByLocation');
  });
});

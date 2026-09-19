/**
 * `GET /api/geo/approximate-location`, against a real Postgres/PostGIS.
 *
 * The city match is SQL (`ST_DistanceSphere` over `cities`) and the resolution
 * goes through the geo gateway's own joins, so a unit test with a mocked
 * database would assert the shape of the mock. These run against the throwaway
 * database each worker owns.
 *
 * The GeoIP database itself is faked, deliberately: the `.mmdb` file is an
 * operator-provisioned artefact and the code under test is everything that
 * happens once a record exists. Both epics say exactly this — "El proveedor
 * puede simularse; la semántica geográfica y las transacciones importantes
 * deben comprobarse con PostgreSQL/PostGIS real."
 */

import { eq } from 'drizzle-orm';

import { resetGeoTables, seedGeoChain } from '../helpers/postgresGeoFixtures';
import { getDb } from '../../db/postgres';
import { regions } from '../../db/schema';
import { resolveApproximateLocation } from '../../services/geoip/resolve';
import { resetApproximateLocationCache } from '../../services/geoip/resolve';
import { resetGeoIpProvider, setGeoIpProvider } from '../../services/geoip/registry';
import type { GeoIpLookupOutcome, GeoIpRecord } from '../../services/geoip/types';

/** A provider that answers whatever the test installed, and records the address. */
function fakeProvider(outcome: GeoIpLookupOutcome) {
  const seen: string[] = [];
  setGeoIpProvider({
    id: 'fake',
    lookup: async (address: string) => {
      seen.push(address);
      return outcome;
    },
  });
  return seen;
}

const found = (record: GeoIpRecord): GeoIpLookupOutcome => ({ status: 'found', record });

/** A request as Express would present it once `trust proxy` has done its work. */
const from = (ip: string) => ({ ip });

beforeEach(async () => {
  await resetGeoTables();
  resetApproximateLocationCache();
  resetGeoIpProvider();
});

afterEach(() => {
  resetGeoIpProvider();
  resetApproximateLocationCache();
});

describe('resolving a city', () => {
  it('matches a Homiio city by name within the reported country', async () => {
    const chain = await seedGeoChain({
      countryCode: 'ES',
      countryName: 'Spain',
      regionName: 'Catalonia',
      cityName: 'Barcelona',
      latitude: 41.3874,
      longitude: 2.1686,
    });
    fakeProvider(
      found({
        countryCode: 'ES',
        regionCode: 'CT',
        cityName: 'Barcelona',
        latitude: 41.39,
        longitude: 2.17,
        accuracyRadiusKm: 20,
      }),
    );

    const result = await resolveApproximateLocation(from('203.0.113.5'), 'en');

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    expect(result.source).toBe('ip');
    expect(result.granularity).toBe('city');
    expect(result.accuracyRadiusKm).toBe(20);
    expect(result.admin).toMatchObject({ countryCode: 'ES', cityName: 'Barcelona' });
    expect(result.selection.kind).toBe('place');
    if (result.selection.kind !== 'place') return;
    // Homiio-owned, so the `loc` token it serialises to is one the geo gateway
    // can resolve. A provider's own id would serialise to a token naming a
    // provider the registry has never heard of.
    expect(result.selection.source).toEqual({ kind: 'homiio', entity: 'city', id: chain.cityId });
    expect(result.selection.placeType).toBe('city');
  });

  it('never claims exact precision: an inferred city is a centroid', async () => {
    await seedGeoChain({ cityName: 'Barcelona', latitude: 41.3874, longitude: 2.1686 });
    fakeProvider(found({ countryCode: 'ES', cityName: 'Barcelona', latitude: 41.39, longitude: 2.17 }));

    const result = await resolveApproximateLocation(from('203.0.113.5'), 'en');

    if (result.status !== 'resolved') throw new Error('expected a resolved answer');
    // ADR 0002 §8.1 reserves `exact`/`approximate` for a point a device
    // produced. An IP is not a position, so neither may appear here — and
    // `current_location` must be unreachable entirely.
    expect(result.selection.kind).not.toBe('current_location');
    // `multi_area` is the one kind with no `precision` at all, and it is not
    // reachable from this resolver — narrowing says so rather than asserting it.
    if (result.selection.kind === 'multi_area') throw new Error('unreachable from an IP lookup');
    expect(['centroid', 'area']).toContain(result.selection.precision);
  });

  it('matches the nearest city when the provider names one Homiio spells differently', async () => {
    // Provider says "Barcelone"; Homiio has "Barcelona" three kilometres away.
    await seedGeoChain({ cityName: 'Barcelona', latitude: 41.3874, longitude: 2.1686 });
    fakeProvider(
      found({ countryCode: 'ES', cityName: 'Barcelone', latitude: 41.40, longitude: 2.18 }),
    );

    const result = await resolveApproximateLocation(from('203.0.113.5'), 'en');

    if (result.status !== 'resolved') throw new Error('expected a resolved answer');
    expect(result.granularity).toBe('city');
  });

  it('does NOT snap to a nearby city when the provider named none', async () => {
    // A coordinate with no city name is a region-level answer at best. Snapping
    // to whatever is closest is the "no seleccionar silenciosamente una ciudad"
    // both epics forbid.
    await seedGeoChain({
      countryCode: 'ES',
      regionName: 'Catalonia',
      cityName: 'Barcelona',
      latitude: 41.3874,
      longitude: 2.1686,
    });
    fakeProvider(
      found({
        countryCode: 'ES',
        regionCode: 'CT',
        regionName: 'Catalonia',
        latitude: 41.39,
        longitude: 2.17,
      }),
    );

    const result = await resolveApproximateLocation(from('203.0.113.5'), 'en');

    if (result.status !== 'resolved') throw new Error('expected a resolved answer');
    expect(result.granularity).toBe('region');
    expect(result.admin.cityName).toBeUndefined();
  });

  it('does not cross a border to find a homonym', async () => {
    // There is a Barcelona in Spain and one in Anzoátegui, Venezuela. The
    // country constraint makes the homonym unreachable rather than unlikely.
    await seedGeoChain({
      countryCode: 'ES',
      countryName: 'Spain',
      regionName: 'Catalonia',
      cityName: 'Barcelona',
      latitude: 41.3874,
      longitude: 2.1686,
    });
    fakeProvider(found({ countryCode: 'VE', cityName: 'Barcelona', latitude: 10.13, longitude: -64.68 }));

    const result = await resolveApproximateLocation(from('203.0.113.5'), 'en');

    // Venezuela is not in the fixture at all, so there is no honest answer.
    expect(result).toMatchObject({ status: 'unavailable', reason: 'no_homiio_place' });
  });
});

describe('widening honestly', () => {
  it('falls back to the region when the city is unknown to Homiio', async () => {
    const chain = await seedGeoChain({
      countryCode: 'ES',
      regionName: 'Catalonia',
      cityName: 'Barcelona',
      latitude: 41.3874,
      longitude: 2.1686,
    });
    // A town 300 km away that Homiio does not have, with no coordinate to snap.
    fakeProvider(found({ countryCode: 'ES', regionName: 'Catalonia', cityName: 'Tremp' }));

    const result = await resolveApproximateLocation(from('203.0.113.5'), 'en');

    if (result.status !== 'resolved') throw new Error('expected a resolved answer');
    expect(result.granularity).toBe('region');
    if (result.selection.kind !== 'place') throw new Error('expected a place');
    expect(result.selection.source).toEqual({
      kind: 'homiio',
      entity: 'region',
      id: chain.regionId,
    });
  });

  it('falls back to the country when the region is unknown to Homiio', async () => {
    const chain = await seedGeoChain({
      countryCode: 'ES',
      regionName: 'Catalonia',
      cityName: 'Barcelona',
      latitude: 41.3874,
      longitude: 2.1686,
    });
    fakeProvider(found({ countryCode: 'ES', regionCode: 'GA', cityName: 'Ourense' }));

    const result = await resolveApproximateLocation(from('203.0.113.5'), 'en');

    if (result.status !== 'resolved') throw new Error('expected a resolved answer');
    expect(result.granularity).toBe('country');
    if (result.selection.kind !== 'place') throw new Error('expected a place');
    expect(result.selection.source).toEqual({
      kind: 'homiio',
      entity: 'country',
      id: chain.countryId,
    });
    // An accuracy radius belongs to a city answer. Attaching the provider's
    // 20 km to "Spain" would be a confidence claim about the wrong thing.
    expect(result.accuracyRadiusKm).toBeUndefined();
  });

  it('matches a region by its qualified ISO-3166-2 code as well as the bare one', async () => {
    // MaxMind publishes `CT`; an importer may have stored `ES-CT`. Both must
    // match, or every Spanish visitor silently descends to "Spain".
    //
    // The city carries coordinates because a REGION's geometry is derived from
    // the extent of its cities (`gateway.ts#cityExtent`) — a region whose cities
    // have none is honestly unframeable and resolves to nothing, which is a
    // different, already-covered behaviour.
    const chain = await seedGeoChain({
      countryCode: 'ES',
      regionName: 'Catalonia',
      cityName: 'Barcelona',
      latitude: 41.3874,
      longitude: 2.1686,
    });
    await getDb().update(regions).set({ code: 'ES-CT' }).where(eq(regions.id, chain.regionId));

    fakeProvider(found({ countryCode: 'ES', regionCode: 'CT', cityName: 'Tremp' }));
    const result = await resolveApproximateLocation(from('203.0.113.5'), 'en');

    if (result.status !== 'resolved') throw new Error('expected a resolved answer');
    expect(result.granularity).toBe('region');
  });
});

describe('unavailable answers keep their reasons apart', () => {
  it('refuses a private address without asking the provider', async () => {
    const seen = fakeProvider(found({ countryCode: 'ES' }));

    const result = await resolveApproximateLocation(from('10.0.3.14'), 'en');

    expect(result).toMatchObject({ status: 'unavailable', reason: 'private_address' });
    expect(seen).toEqual([]);
  });

  it('reports a missing database as not_configured, not as an error', async () => {
    fakeProvider({ status: 'not_configured' });
    const result = await resolveApproximateLocation(from('203.0.113.5'), 'en');
    expect(result).toMatchObject({ status: 'unavailable', reason: 'not_configured' });
  });

  it('distinguishes a provider gap from a Homiio coverage gap', async () => {
    fakeProvider({ status: 'not_found' });
    expect(await resolveApproximateLocation(from('203.0.113.5'), 'en')).toMatchObject({
      reason: 'no_match',
    });

    resetApproximateLocationCache();
    fakeProvider(found({ countryCode: 'ZZ', cityName: 'Nowhere' }));
    expect(await resolveApproximateLocation(from('198.51.100.9'), 'en')).toMatchObject({
      reason: 'no_homiio_place',
    });
  });

  it('never caches a provider error, so one blip is not half an hour of nothing', async () => {
    fakeProvider({ status: 'error' });
    const first = await resolveApproximateLocation(from('203.0.113.5'), 'en');
    expect(first).toMatchObject({ status: 'unavailable', reason: 'provider_error' });

    await seedGeoChain({ countryCode: 'ES', cityName: 'Barcelona', latitude: 41.3874, longitude: 2.1686 });
    fakeProvider(found({ countryCode: 'ES', cityName: 'Barcelona', latitude: 41.39, longitude: 2.17 }));
    const second = await resolveApproximateLocation(from('203.0.113.5'), 'en');
    expect(second.status).toBe('resolved');
  });
});

describe('the cache is per address and expires', () => {
  it('serves a second request for the same address without asking again', async () => {
    await seedGeoChain({ countryCode: 'ES', cityName: 'Barcelona', latitude: 41.3874, longitude: 2.1686 });
    const seen = fakeProvider(
      found({ countryCode: 'ES', cityName: 'Barcelona', latitude: 41.39, longitude: 2.17 }),
    );

    await resolveApproximateLocation(from('203.0.113.5'), 'en');
    await resolveApproximateLocation(from('203.0.113.5'), 'en');

    expect(seen).toHaveLength(1);
  });

  it('does not serve one visitor the answer computed for another', async () => {
    await seedGeoChain({ countryCode: 'ES', cityName: 'Barcelona', latitude: 41.3874, longitude: 2.1686 });
    const seen = fakeProvider(
      found({ countryCode: 'ES', cityName: 'Barcelona', latitude: 41.39, longitude: 2.17 }),
    );

    await resolveApproximateLocation(from('203.0.113.5'), 'en');
    await resolveApproximateLocation(from('198.51.100.9'), 'en');

    expect(seen).toEqual(['203.0.113.5', '198.51.100.9']);
  });

  it('stamps an expiry the client can honour', async () => {
    await seedGeoChain({ countryCode: 'ES', cityName: 'Barcelona', latitude: 41.3874, longitude: 2.1686 });
    fakeProvider(found({ countryCode: 'ES', cityName: 'Barcelona', latitude: 41.39, longitude: 2.17 }));

    const result = await resolveApproximateLocation(from('203.0.113.5'), 'en');

    if (result.status !== 'resolved') throw new Error('expected a resolved answer');
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(
      new Date(result.resolvedAt).getTime(),
    );
  });
});

describe('the answer carries no address and no provider payload', () => {
  it('serialises without the requester’s address anywhere in it', async () => {
    await seedGeoChain({ countryCode: 'ES', cityName: 'Barcelona', latitude: 41.3874, longitude: 2.1686 });
    fakeProvider(found({ countryCode: 'ES', cityName: 'Barcelona', latitude: 41.39, longitude: 2.17 }));

    const result = await resolveApproximateLocation(from('203.0.113.5'), 'en');

    expect(JSON.stringify(result)).not.toContain('203.0.113.5');
  });
});

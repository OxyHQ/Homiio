/**
 * `geoQueryService` — the id-versus-name resolution.
 *
 * This is the file where the `isValidObjectId` DISCRIMINATOR used to live. The
 * cases that matter are not "does a name resolve" (it always did) but the two
 * the shape test got wrong or would get wrong:
 *
 *  - a uuid v7 id must resolve AS AN ID, not fall through to a name lookup and
 *    quietly return "unknown place, no results";
 *  - a value that is neither must resolve to `null` rather than to something.
 *
 * The uuid case is the one with no coverage before, because no id of that shape
 * existed yet. It exists the day the cutover lands.
 */

import { getDb } from '../../db/postgres';
import { cities, regions } from '../../db/schema';
import { resolveCityId, resolveRegionId, resolveGeoFilterAddressIds } from '../../services/geoQueryService';
import { resetGeoTables, seedAddress, seedGeoChain, seedNeighborhood } from '../helpers/postgresGeoFixtures';

/** A real uuid v7, the shape `generatedId()` mints for every post-cutover row. */
const UUID_V7 = '01997f2c-6b40-7000-8000-0000000000ab';

beforeEach(async () => {
  await resetGeoTables();
});


describe('resolveCityId', () => {
  it('resolves a 24-hex id', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona' });
    expect(await resolveCityId(chain.cityId)).toBe(chain.cityId);
  });

  it('resolves a uuid v7 id — the shape the deleted ObjectId guard rejected', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona' });
    await getDb().insert(cities).values({
      id: UUID_V7,
      countryId: chain.countryId,
      regionId: chain.regionId,
      name: 'Girona',
    });

    // Under the old shape test this fell through to a NAME lookup, matched no
    // city called "01997f2c-…", and the caller read "unknown city → no results".
    expect(await resolveCityId(UUID_V7)).toBe(UUID_V7);
  });

  it('resolves a name case-insensitively', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona' });
    expect(await resolveCityId('barcelona')).toBe(chain.cityId);
    expect(await resolveCityId('  BARCELONA  ')).toBe(chain.cityId);
  });

  it('lets an id WIN over a name that happens to equal it', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona' });
    // A city literally named after another city's id. Contrived, and exactly the
    // ambiguity the old shape test resolved by accident and this resolves on
    // purpose.
    await getDb().insert(cities).values({
      countryId: chain.countryId,
      regionId: chain.regionId,
      name: chain.cityId,
    });

    expect(await resolveCityId(chain.cityId)).toBe(chain.cityId);
  });

  it('returns null for a value that is neither an id nor a name', async () => {
    await seedGeoChain({ cityName: 'Barcelona' });
    expect(await resolveCityId('Atlantis')).toBeNull();
    expect(await resolveCityId('   ')).toBeNull();
  });
});

describe('resolveRegionId', () => {
  it('resolves by id and by case-insensitive name', async () => {
    const chain = await seedGeoChain({ regionName: 'Catalonia' });
    expect(await resolveRegionId(chain.regionId)).toBe(chain.regionId);
    expect(await resolveRegionId('CATALONIA')).toBe(chain.regionId);
    expect(await resolveRegionId('Nowhere')).toBeNull();
  });

  it('resolves a uuid v7 region id as an id', async () => {
    const chain = await seedGeoChain({ regionName: 'Catalonia' });
    await getDb().insert(regions).values({ id: UUID_V7, countryId: chain.countryId, name: 'Aragon' });
    expect(await resolveRegionId(UUID_V7)).toBe(UUID_V7);
  });
});

describe('resolveGeoFilterAddressIds', () => {
  it('narrows to the addresses in a city', async () => {
    const barcelona = await seedGeoChain({ cityName: 'Barcelona' });
    const madrid = await seedGeoChain({
      countryCode: 'PT',
      countryName: 'Portugal',
      regionName: 'Lisbon',
      cityName: 'Lisbon',
    });
    const inBarcelona = await seedAddress({ chain: barcelona });
    await seedAddress({ chain: madrid });

    expect(await resolveGeoFilterAddressIds({ city: 'Barcelona' })).toEqual([inBarcelona]);
  });

  it('returns null — not an empty list — when the place itself is unknown', async () => {
    await seedGeoChain({ cityName: 'Barcelona' });
    // The distinction is load-bearing: `null` means "no address CAN match" and
    // the caller short-circuits; `[]` would mean "no geo constraint".
    expect(await resolveGeoFilterAddressIds({ city: 'Atlantis' })).toBeNull();
  });

  it('returns an empty list when the place exists but holds no addresses', async () => {
    await seedGeoChain({ cityName: 'Barcelona' });
    expect(await resolveGeoFilterAddressIds({ city: 'Barcelona' })).toEqual([]);
  });

  it('intersects every provided constraint', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona' });
    const gracia = await seedNeighborhood({ cityId: chain.cityId, name: 'Gràcia' });
    const inGracia = await seedAddress({ chain, neighborhoodId: gracia });
    await seedAddress({ chain });

    expect(
      await resolveGeoFilterAddressIds({ city: 'Barcelona', neighborhood: 'gràcia', countryCode: 'es' }),
    ).toEqual([inGracia]);
  });

  it('returns null when no constraint at all was supplied', async () => {
    expect(await resolveGeoFilterAddressIds({})).toBeNull();
  });
});

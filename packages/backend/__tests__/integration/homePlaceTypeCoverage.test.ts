/**
 * EVERY place type a `loc` token can name reaches a decided outcome (#353).
 *
 * ## Why this gate exists: the same bug, three times in production
 *
 * `PlaceType` is a six-value union. Home's scope resolver hand-listed three of
 * them and refused the rest, and each unhandled member surfaced as its own
 * production 400 — `city.osm.…` (the source was wrong), then
 * `district.osm.R3765380` (the TYPE was wrong), with `country` and `postcode`
 * sitting there waiting to be the fourth and fifth. The picker can produce every
 * one of them.
 *
 * A hand-list cannot fail when the union grows. That is the whole defect, and no
 * amount of care fixes it: whoever adds a seventh member has no reason to look
 * at a set literal in a controller. So the case list here is **derived from
 * `PLACE_TYPES`**, the array `parseLocationToken` itself uses to decide which
 * tokens are even parseable — a new member has to appear there before a token
 * naming it can exist, which is what makes this test grow with the union instead
 * of alongside it.
 *
 * ## What "decided" means
 *
 * `resolved` or `unresolved` — a scope, or an honest "we could not place that",
 * which the client renders as the picker. **Not** a 400: a type Homiio cannot
 * narrow by id is not a type Home cannot answer, because bounds are a complete
 * scope on their own. A 400 survives only for a scope that is meaningless by
 * design (`multi.`), and that is asserted separately in `homeSections.test.ts`.
 *
 * The provider is a registered FAKE, the same seam `geoGateway.test.ts` uses, so
 * the request goes through the real registry, cache and normaliser.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { OfferingType, PLACE_TYPES, PropertyStatus, PropertyType } from '@homiio/shared-types';

import { getHomeSections } from '../../controllers/home/homeSectionsController';
import { errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';
import { resetGeoCache } from '../../services/geocoding/cache';
import { registerProvider, resetProviderRegistry } from '../../services/geocoding/registry';
import type { ProviderPlace } from '../../services/geocoding/types';
import {
  resetGeoTables,
  seedAddress,
  seedGeoChain,
  seedProperty,
} from '../helpers/postgresGeoFixtures';

const PROVIDER_ID = 'fakeosm';
const BARCELONA = { longitude: 2.1686, latitude: 41.3874 };

/**
 * The six `PlaceType` members, plus `address`.
 *
 * Stated because the counts differ and a reader will notice: `PLACE_TYPES` is
 * the token vocabulary (`GeoPlaceType`), which is `PlaceType` plus the one value
 * that becomes an `address_candidate` rather than a `place`. All seven are
 * reachable in a token, so all seven are covered here; the floor below pins both
 * numbers so neither can drift silently.
 */
const EXPECTED_TOKEN_TYPES = 7;
const EXPECTED_PLACE_TYPES = 6;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(serializeWireIds);
  app.get('/home/sections', getHomeSections);
  app.use(errorHandler);
  return app;
}

const app = buildApp();

/** A provider that can answer for ANY type, so a refusal cannot be blamed on it. */
function installFake(): void {
  registerProvider({
    id: PROVIDER_ID,
    attribution: { text: '© Fake contributors', url: 'https://example.invalid/copyright' },
    autocomplete: async () => [],
    resolve: async (input) => providerPlace(input.ref),
    reverse: async () => providerPlace('R1'),
    health: async () => ({ providerId: PROVIDER_ID, healthy: true }),
  });
}

/**
 * A place with BOTH a centre and bounds.
 *
 * Deliberately generous: the question this file asks is "does every type reach a
 * decision", so the geocoder must never be the reason one does not. A fixture
 * that withheld geometry would make a refusal look like a coverage gap when it
 * was a fixture gap.
 */
function providerPlace(ref: string): ProviderPlace {
  return {
    providerId: PROVIDER_ID,
    ref,
    name: 'Eixample',
    displayName: 'Eixample, Barcelona, Catalunya, España',
    address: { city: 'Barcelona', region: 'Catalunya', country: 'España', countryCode: 'ES' },
    center: BARCELONA,
    bounds: { west: 2.05, south: 41.31, east: 2.23, north: 41.47 },
    rawAddressType: 'suburb',
  };
}

interface HomePayload {
  location: { status: string; key?: string };
  sections: { id: string; items: { title?: string }[] }[];
}

beforeEach(async () => {
  resetProviderRegistry();
  resetGeoCache();
  installFake();
  await resetGeoTables();
});

afterEach(() => {
  resetProviderRegistry();
  resetGeoCache();
});

describe('every place type a token can name reaches a decision', () => {
  it('derives its cases from the parser vocabulary, and sees them all', () => {
    // The vacuity floor. A broken import or an emptied array would make every
    // per-type assertion below pass by never running, which is exactly what a
    // clean result looks like.
    expect(PLACE_TYPES).toHaveLength(EXPECTED_TOKEN_TYPES);
    expect(PLACE_TYPES.filter((type) => type !== 'address')).toHaveLength(EXPECTED_PLACE_TYPES);
  });

  it('answers 200 with a decided location for EVERY type, and 400 for none', async () => {
    // Seeded so the database is not empty: a global answer would be visibly
    // non-empty, which is what makes "decided" distinguishable from "widened".
    const chain = await seedGeoChain({
      cityName: 'Barcelona',
      regionName: 'Catalonia',
      countryCode: 'ES',
      ...BARCELONA,
    });
    const addressId = await seedAddress({ chain, street: 'Carrer de Mallorca', ...BARCELONA });
    await seedProperty({
      addressId,
      overrides: {
        title: 'Barcelona home',
        type: PropertyType.APARTMENT,
        status: PropertyStatus.PUBLISHED,
        availabilityIsAvailable: true,
        offerings: [OfferingType.LONG_TERM_RENT],
        longTermRentMonthlyAmount: 1200,
      },
    });

    const refused: string[] = [];
    const undecided: string[] = [];
    let checked = 0;

    for (const placeType of PLACE_TYPES) {
      const response = await request(app)
        .get('/home/sections')
        .query({
          loc: `${placeType}.${PROVIDER_ID}.R100`,
          offering: OfferingType.LONG_TERM_RENT,
        });

      if (response.status !== 200) {
        // Reported with the status and code, so whoever hits this gate does not
        // have to reproduce it to find out which type broke.
        refused.push(`${placeType} → ${response.status} ${response.body?.error ?? ''}`.trim());
        checked += 1;
        continue;
      }
      const payload = response.body.data as HomePayload;
      if (payload.location.status !== 'resolved' && payload.location.status !== 'unresolved') {
        undecided.push(`${placeType} → location.status=${payload.location.status}`);
      }
      checked += 1;
    }

    // NAMED, not counted: a bare count tells the next person a number and makes
    // them go looking for which member it was.
    expect(refused).toEqual([]);
    expect(undecided).toEqual([]);
    // The second floor, on the loop rather than on the array: a `continue` added
    // above, or a generator that stopped early, would otherwise pass silently.
    expect(checked).toBe(EXPECTED_TOKEN_TYPES);
  });

  it('scopes a COUNTRY by its code, never by its bounds', async () => {
    // The type that must NOT take the bounds rung. A country's extent is most of
    // the planet for exactly the countries people search, so framing one by its
    // box is a global feed under a country's name. Two countries are seeded so
    // "scoped by code" is distinguishable from "answered everything".
    const spain = await seedGeoChain({
      cityName: 'Barcelona',
      regionName: 'Catalonia',
      countryCode: 'ES',
      ...BARCELONA,
    });
    const portugal = await seedGeoChain({
      cityName: 'Lisbon',
      regionName: 'Lisboa',
      countryCode: 'PT',
      longitude: -9.1393,
      latitude: 38.7223,
    });
    for (const [chain, title, point, countryCode] of [
      [spain, 'Spanish home', BARCELONA, 'ES'],
      [portugal, 'Portuguese home', { longitude: -9.1393, latitude: 38.7223 }, 'PT'],
    ] as const) {
      // `countryCode` is passed EXPLICITLY, and it is the whole assertion.
      // `seedAddress` defaults it to `'ES'` regardless of the chain's country
      // row, so omitting it stamps a Portuguese address as Spanish and the
      // country scope then matches both — a fixture in which the predicate under
      // test cannot fail. Caught by this test failing on its first run.
      const addressId = await seedAddress({ chain, street: `${title} street`, countryCode, ...point });
      await seedProperty({
        addressId,
        overrides: {
          title,
          status: PropertyStatus.PUBLISHED,
          availabilityIsAvailable: true,
          offerings: [OfferingType.LONG_TERM_RENT],
          longTermRentMonthlyAmount: 1000,
        },
      });
    }

    const response = await request(app)
      .get('/home/sections')
      .query({ loc: `country.${PROVIDER_ID}.R1311`, offering: OfferingType.LONG_TERM_RENT })
      .expect(200);

    const payload = response.body.data as HomePayload;
    const titles = payload.sections.flatMap((section) => section.items.map((item) => item.title));

    expect(payload.location.status).toBe('resolved');
    expect(titles).toContain('Spanish home');
    // The discriminator. Lisbon is INSIDE the fake's Barcelona-shaped bounds only
    // if bounds were used — they are not, and it is in another country, so the
    // country-code scope excludes it either way. What this really pins is that a
    // country resolves to a country scope at all rather than to everything.
    expect(titles).not.toContain('Portuguese home');
  });
});

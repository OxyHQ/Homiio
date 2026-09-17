/**
 * `amenities` means ALL of them, on every catalogue feed, in every spelling a
 * client sends a list in.
 *
 * The rooms list (`components/RoomList.tsx` → `GET /properties?type=room`) and
 * `GET /rooms` read `amenities` as ANY, and the list feed read a repeated key
 * through `getQueryString`, which keeps only its first value. Search already
 * required all of them. Each case here runs one discriminating trio: a room with
 * both amenities, one with only the first, one with only the second — so ANY
 * returns three, first-value-only returns two, and only ALL returns one.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { OfferingType, PropertyStatus, PropertyType } from '@homiio/shared-types';

import roomController from '../../controllers/roomController';
import { getProperties } from '../../controllers/property/list';
import { searchProperties } from '../../controllers/property/search';
import { errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';
import { resetGeoTables, seedAddress, seedGeoChain, seedProperty } from '../helpers/postgresGeoFixtures';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(serializeWireIds);
  app.get('/properties/search', searchProperties);
  app.get('/properties', getProperties);
  app.get('/rooms', (req, res, next) => roomController.getRooms(req, res, next));
  app.use(errorHandler);
  return app;
}

describe('amenities filter: all must match', () => {
  let both: string;

  beforeEach(async () => {
    await resetGeoTables();
    const chain = await seedGeoChain({ cityName: 'Valencia', regionName: 'Valencian Community', countryCode: 'ES-AM' });
    const seedRoom = async (amenities: string[]): Promise<string> =>
      seedProperty({
        addressId: await seedAddress({ chain }),
        overrides: {
          status: PropertyStatus.PUBLISHED,
          type: PropertyType.ROOM,
          availabilityIsAvailable: true,
          offerings: [OfferingType.LONG_TERM_RENT],
          longTermRentMonthlyAmount: 600,
          longTermRentCurrency: 'EUR',
          amenities,
        },
      });
    both = await seedRoom(['wifi', 'parking']);
    await seedRoom(['wifi']);
    await seedRoom(['parking']);
  });

  const spellings: Array<[string, string]> = [
    ['comma-joined (what the linked client sends for an array)', 'amenities=wifi,parking'],
    ['a repeated key', 'amenities=wifi&amenities=parking'],
    ['bracketed', 'amenities[]=wifi&amenities[]=parking'],
    ['mixed case', 'amenities=WiFi,Parking'],
  ];

  const ids = (body: { data: Array<{ id: string }> }): string[] => body.data.map((row) => row.id);

  it.each(spellings)('the rooms list feed (GET /properties?type=room), %s', async (_label, qs) => {
    const res = await request(buildApp()).get(`/properties?type=room&${qs}`);
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([both]);
  });

  it.each(spellings)('GET /rooms, %s', async (_label, qs) => {
    const res = await request(buildApp()).get(`/rooms?${qs}`);
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([both]);
  });

  it.each(spellings)('property search, %s', async (_label, qs) => {
    const res = await request(buildApp()).get(`/properties/search?propertyType=room&${qs}`);
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([both]);
  });

  it('a single amenity still matches every listing carrying it', async () => {
    // The negative control: "all of one" is "any of one", and a filter that
    // required an exact set would return only the single-amenity room here.
    const res = await request(buildApp()).get('/properties?type=room&amenities=wifi');
    expect(res.body.data).toHaveLength(2);
  });
});

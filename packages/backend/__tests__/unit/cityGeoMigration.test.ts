/**
 * City geo migration — Madrid upsert / re-ingest against legacy index.
 */

import type { Types } from 'mongoose';
import { resolveGeo } from '../../services/geoResolutionService';
import { ensureCityGeoIndexes } from '../../services/cityGeoMigration';

const { City, Country, Region } = require('../../models');

const MADRID_COORDS: [number, number] = [-3.7038, 40.4168];

async function seedSpainHierarchy(): Promise<{ countryId: Types.ObjectId; regionId: Types.ObjectId }> {
  const country = await Country.findOneAndUpdate(
    { code: 'ES' },
    { $setOnInsert: { code: 'ES', name: 'Spain', currency: 'EUR', isActive: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  const region = await Region.findOneAndUpdate(
    { countryId: country._id, name: 'Community of Madrid' },
    { $setOnInsert: { countryId: country._id, name: 'Community of Madrid', isActive: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return { countryId: country._id, regionId: region._id };
}

async function insertLegacyOrphanMadrid(): Promise<void> {
  await City.collection.insertOne({
    name: 'Madrid',
    state: null,
    country: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await City.collection.createIndex(
    { name: 1, state: 1, country: 1 },
    { unique: true, name: 'name_1_state_1_country_1' },
  );
}

describe('cityGeoMigration', () => {
  it('drops the legacy index and allows Madrid relational upsert + re-ingest', async () => {
    await insertLegacyOrphanMadrid();
    const { countryId, regionId } = await seedSpainHierarchy();

    const indexesBefore = await City.collection.indexes();
    expect(indexesBefore.some((idx) => idx.name === 'name_1_state_1_country_1')).toBe(true);

    await ensureCityGeoIndexes();

    const indexesAfter = await City.collection.indexes();
    expect(indexesAfter.some((idx) => idx.name === 'name_1_state_1_country_1')).toBe(false);
    expect(indexesAfter.some((idx) => idx.key.regionId === 1 && idx.key.name === 1)).toBe(true);

    const first = await resolveGeo({
      coordinates: MADRID_COORDS,
      names: {
        city: 'Madrid',
        state: 'Community of Madrid',
        country: 'Spain',
        countryCode: 'ES',
      },
    });

    expect(String(first.countryId)).toBe(String(countryId));
    expect(String(first.regionId)).toBe(String(regionId));
    expect(first.countryCode).toBe('ES');

    const city = await City.findById(first.cityId).lean();
    expect(city?.name).toBe('Madrid');
    expect(String(city?.regionId)).toBe(String(regionId));
    expect(String(city?.countryId)).toBe(String(countryId));
    expect(city?.state).toBeUndefined();
    expect(city?.country).toBeUndefined();

    const second = await resolveGeo({
      coordinates: MADRID_COORDS,
      names: {
        city: 'Madrid',
        state: 'Community of Madrid',
        country: 'Spain',
        countryCode: 'ES',
      },
    });

    expect(String(second.cityId)).toBe(String(first.cityId));

    const madridCount = await City.countDocuments({ name: 'Madrid' });
    expect(madridCount).toBe(1);
  });

  it('backfills relational ids on legacy text rows instead of duplicating', async () => {
    await City.collection.insertOne({
      name: 'Barcelona',
      state: 'Catalonia',
      country: 'Spain',
      coordinates: { lat: 41.3851, lng: 2.1734 },
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await ensureCityGeoIndexes();

    const resolved = await resolveGeo({
      coordinates: [2.1734, 41.3851],
      names: {
        city: 'Barcelona',
        state: 'Catalonia',
        country: 'Spain',
        countryCode: 'ES',
      },
    });

    const city = await City.findById(resolved.cityId).lean();
    expect(city?.name).toBe('Barcelona');
    expect(city?.regionId).toBeTruthy();
    expect(city?.countryId).toBeTruthy();
    expect(city?.state).toBeUndefined();
    expect(city?.country).toBeUndefined();

    expect(await City.countDocuments({ name: 'Barcelona' })).toBe(1);
  });
});

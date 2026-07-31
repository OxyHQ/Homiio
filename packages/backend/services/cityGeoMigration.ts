/**
 * City geo migration — retires the legacy free-text `state`/`country` City schema.
 *
 * Production still carries a unique index on `(name, state, country)` from the
 * pre-relational model. `geoResolutionService.upsertCity` keys on `(regionId,
 * name)` and never sets `state`/`country`, so Mongo treats those fields as null
 * and the legacy index rejects a second "Madrid" even when the new relational
 * row belongs to a different region.
 *
 * This module is idempotent and safe to run on every API/worker boot:
 *   1. Drop legacy indexes that reference `state` or `country`
 *   2. Backfill `countryId`/`regionId` on orphan city rows
 *   3. Remove orphan duplicates and unset legacy text fields
 *   4. `syncIndexes()` so `{ regionId, name }` is the sole uniqueness guard
 */

import type { Types } from 'mongoose';
import { logger } from '../middlewares/logging';
import { countryNameToCode, countryCodeToName, defaultCurrencyForCountry } from '../utils/countryData';
import { Address, City, Country, Region } from '../models';

const LEGACY_CITY_TEXT_FIELDS = ['state', 'country', 'popularNeighborhoods'] as const;



function indexUsesLegacyGeoFields(key: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(key, 'state')
    || Object.prototype.hasOwnProperty.call(key, 'country');
}

async function dropLegacyCityIndexes(): Promise<string[]> {
  const dropped: string[] = [];
  const indexes = await City.collection.indexes();
  for (const index of indexes) {
    if (!index.name || index.name === '_id_') continue;
    if (!indexUsesLegacyGeoFields(index.key)) continue;
    await City.collection.dropIndex(index.name).catch(() => undefined);
    dropped.push(index.name);
  }
  return dropped;
}

async function upsertCountryId(code: string, name: string): Promise<Types.ObjectId> {
  const doc = await Country.findOneAndUpdate(
    { code },
    { $setOnInsert: { code, name, currency: defaultCurrencyForCountry(code), isActive: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return doc._id;
}

async function upsertRegionId(countryId: Types.ObjectId, name: string): Promise<Types.ObjectId> {
  const doc = await Region.findOneAndUpdate(
    { countryId, name },
    { $setOnInsert: { countryId, name, isActive: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return doc._id;
}

function resolveCountryFromLegacyText(countryText: string | null | undefined): { code: string; name: string } | null {
  if (!countryText?.trim()) return null;
  const trimmed = countryText.trim();
  const fromName = countryNameToCode(trimmed);
  if (fromName) {
    return { code: fromName, name: countryCodeToName(fromName) ?? trimmed };
  }
  const upper = trimmed.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) {
    return { code: upper, name: countryCodeToName(upper) ?? trimmed };
  }
  return null;
}

async function countAddressRefs(cityId: Types.ObjectId): Promise<number> {
  return Address.countDocuments({ cityId });
}

async function reassignAddressCityRefs(fromId: Types.ObjectId, toId: Types.ObjectId): Promise<void> {
  await Address.updateMany({ cityId: fromId }, { $set: { cityId: toId } });
}

async function deleteCityIfUnused(cityId: Types.ObjectId): Promise<boolean> {
  const refs = await countAddressRefs(cityId);
  if (refs > 0) return false;
  await City.deleteOne({ _id: cityId });
  return true;
}

/**
 * Backfill relational ids on cities that still only have legacy text geo fields.
 */
async function migrateOrphanCities(): Promise<{ patched: number; deleted: number; merged: number }> {
  const orphans = await City.find({
    $or: [
      { countryId: { $exists: false } },
      { countryId: null },
      { regionId: { $exists: false } },
      { regionId: null },
    ],
  }).lean();

  let patched = 0;
  let deleted = 0;
  let merged = 0;

  for (const orphan of orphans) {
    const name = orphan.name?.trim();
    if (!name) {
      if (await deleteCityIfUnused(orphan._id)) deleted += 1;
      continue;
    }

    // `country` and `state` are the pre-migration text fields this function
    // exists to retire — they are not on `ICity`, so they arrive as `unknown`.
    // Reading them as strings-or-nothing is the honest shape.
    const legacyCountry = typeof orphan.country === 'string' ? orphan.country : undefined;
    const countryResolved = resolveCountryFromLegacyText(legacyCountry);
    const regionName = typeof orphan.state === 'string' ? orphan.state.trim() : undefined;

    if (countryResolved && regionName) {
      const countryId = await upsertCountryId(countryResolved.code, countryResolved.name);
      const regionId = await upsertRegionId(countryId, regionName);

      const existing = await City.find({
        regionId,
        name,
        _id: { $ne: orphan._id },
      }).lean();
      const keeper = existing[0];

      if (keeper) {
        await reassignAddressCityRefs(orphan._id, keeper._id);
        if (await deleteCityIfUnused(orphan._id)) {
          deleted += 1;
          merged += 1;
        }
        continue;
      }

      await City.collection.updateOne(
        { _id: orphan._id },
        {
          $set: { countryId, regionId, isActive: true },
          $unset: Object.fromEntries(LEGACY_CITY_TEXT_FIELDS.map((field) => [field, ''])),
        },
      );
      patched += 1;
      continue;
    }

    // No usable legacy text — drop unused orphan rows so upsert can create the
    // relational city without a `(name, null, null)` collision on the old index.
    if (await deleteCityIfUnused(orphan._id)) deleted += 1;
  }

  return { patched, deleted, merged };
}

async function unsetLegacyCityTextFields(): Promise<number> {
  const result = await City.collection.updateMany(
    {
      $or: LEGACY_CITY_TEXT_FIELDS.map((field) => ({ [field]: { $exists: true } })),
    },
    { $unset: Object.fromEntries(LEGACY_CITY_TEXT_FIELDS.map((field) => [field, ''])) },
  );
  return result.modifiedCount;
}

/**
 * Drop legacy City indexes, heal orphan rows, and sync the relational schema
 * indexes. Idempotent — no-ops once production is clean.
 */
export async function ensureCityGeoIndexes(): Promise<void> {

  const dropped = await dropLegacyCityIndexes();
  const orphanStats = await migrateOrphanCities();
  const unsetCount = await unsetLegacyCityTextFields();

  await City.syncIndexes();

  if (dropped.length > 0 || orphanStats.patched > 0 || orphanStats.deleted > 0 || orphanStats.merged > 0 || unsetCount > 0) {
    logger.info('City geo migration applied', {
      droppedIndexes: dropped,
      ...orphanStats,
      unsetLegacyFields: unsetCount,
    });
  }
}

export default { ensureCityGeoIndexes };

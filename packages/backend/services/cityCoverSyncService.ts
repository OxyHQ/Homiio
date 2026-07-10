/**
 * Assigns city cover photos by linking an existing listing Image id — no
 * re-upload, no external APIs, no manual seed.
 */

import { Types } from 'mongoose';
import { City, Property, Address } from '../models';
import { isPlausibleCityName } from '../utils/plausibleCityName';
import { Logger } from '../utils/logger';

const logger = new Logger('CityCoverSyncService');

function resolvePrimaryImageId(
  images: Array<{ imageId?: Types.ObjectId | null; isPrimary?: boolean }> | undefined,
): Types.ObjectId | null {
  if (!images?.length) {
    return null;
  }
  const primary = images.find((img) => img.isPrimary && img.imageId);
  if (primary?.imageId) {
    return primary.imageId;
  }
  const first = images.find((img) => img.imageId);
  return first?.imageId ?? null;
}

/** Link a listing Image id as this city's cover when none is set yet. */
export async function ensureCover(cityId: Types.ObjectId | string): Promise<void> {
  try {
    const city = await City.findById(cityId).select('name coverImageId imageIds').lean();
    if (!city) {
      return;
    }
    if (city.coverImageId) {
      return;
    }
    if (!isPlausibleCityName(city.name)) {
      return;
    }

    const addresses = await Address.find({ cityId: city._id }).select('_id').lean();
    const addressIds = addresses.map((addr) => addr._id);
    if (addressIds.length === 0) {
      return;
    }

    const baseQuery = {
      addressId: { $in: addressIds },
      status: 'published',
      'images.imageId': { $exists: true, $ne: null },
    };

    let property = await Property.findOne({ ...baseQuery, 'images.isPrimary': true })
      .select('images')
      .lean();
    if (!property) {
      property = await Property.findOne(baseQuery).select('images').lean();
    }

    const imageId = resolvePrimaryImageId(property?.images);
    if (!imageId) {
      return;
    }

    const update: Record<string, unknown> = { coverImageId: imageId };
    if (!city.imageIds?.length) {
      update.imageIds = [imageId];
    }

    await City.updateOne({ _id: city._id }, { $set: update });
    logger.info('Linked city cover from listing image', {
      cityId: String(city._id),
      imageId: String(imageId),
    });
  } catch (error) {
    logger.error('Failed to ensure city cover', error);
  }
}

/** Backfill covers for active cities that have listings but no cover yet. */
export async function syncMissingCovers(options: { limit?: number } = {}): Promise<number> {
  const limit = options.limit ?? 50;
  const cities = await City.find({
    isActive: true,
    propertiesCount: { $gt: 0 },
    $or: [{ coverImageId: { $exists: false } }, { coverImageId: null }],
  })
    .select('_id')
    .limit(limit)
    .lean();

  for (const city of cities) {
    await ensureCover(city._id);
  }

  return cities.length;
}

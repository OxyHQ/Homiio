/**
 * Price ethics scoring service.
 *
 * Single backend authority for computing and persisting `Property.priceEthics`
 * after create, update, and external ingest. Best-effort — never fails writes.
 */

import { OfferingType } from '@homiio/shared-types';
import type { PropertyPriceEthics } from '@homiio/shared-types';
import {
  validateEthicalPricing,
  type EthicalPricingCharacteristics,
} from '@homiio/shared-types';
import { Property } from '../models';
import type { IProperty } from '../models/Property';
import { logger } from '../middlewares/logging';
import { getErrorMessage } from '../utils/errors';
import {
  computeMarketVerdictForProperty,
  resolvePriceBasis,
  type PopulatedGeoAddress,
} from './areaPriceComparison';

const FAIRNESS_BASE = 50;
const FAIRNESS_GOOD_DEAL = 30;
const FAIRNESS_BELOW_AVERAGE = 20;
const FAIRNESS_AVERAGE = 10;
const FAIRNESS_WITHIN_ETHICAL = 20;
const FAIRNESS_ABOVE_ETHICAL = -25;

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}

function computeFairnessScore(
  withinEthical: boolean | undefined,
  marketVerdict: PropertyPriceEthics['marketVerdict'],
  hasMarketData: boolean,
): number {
  let score = FAIRNESS_BASE;

  if (hasMarketData && marketVerdict) {
    switch (marketVerdict) {
      case 'good_deal':
        score += FAIRNESS_GOOD_DEAL;
        break;
      case 'below_average':
        score += FAIRNESS_BELOW_AVERAGE;
        break;
      case 'average':
        score += FAIRNESS_AVERAGE;
        break;
      case 'above_average':
        break;
    }
  }

  if (withinEthical === true) score += FAIRNESS_WITHIN_ETHICAL;
  if (withinEthical === false) score += FAIRNESS_ABOVE_ETHICAL;

  return clampScore(score);
}

function computeIsFairPrice(
  isExternal: boolean,
  withinEthical: boolean | undefined,
  marketVerdict: PropertyPriceEthics['marketVerdict'],
  hasMarketData: boolean,
): boolean {
  if (isExternal) {
    return hasMarketData && marketVerdict !== undefined && marketVerdict !== 'above_average';
  }

  if (withinEthical === false) return false;

  if (hasMarketData && marketVerdict) {
    return withinEthical === true && marketVerdict !== 'above_average';
  }

  return withinEthical === true;
}

function buildEthicalPricingInput(property: IProperty): EthicalPricingCharacteristics | null {
  const monthly = property.longTermRent?.monthlyAmount;
  if (typeof monthly !== 'number' || monthly <= 0) return null;
  if (!property.offerings?.includes(OfferingType.LONG_TERM_RENT)) return null;

  const populated = property as unknown as { address?: PopulatedGeoAddress; addressId?: PopulatedGeoAddress };
  const address = populated.address ?? populated.addressId;

  return {
    type: property.type,
    housingType: property.housingType,
    bedrooms: property.bedrooms ?? 0,
    bathrooms: property.bathrooms ?? 1,
    squareFootage: property.squareFootage ?? 0,
    amenities: property.amenities ?? [],
    location: {
      city: address?.cityName ?? '',
      state: address?.regionName ?? '',
    },
    floor: property.floor,
    hasElevator: property.hasElevator,
    parkingSpaces: property.parkingSpaces,
    yearBuilt: property.yearBuilt,
    furnishedStatus:
      property.furnishedStatus === 'not_specified' ? undefined : property.furnishedStatus,
    utilitiesIncluded: property.utilitiesIncluded,
    petFriendly: property.petFriendly,
    hasBalcony: property.hasBalcony,
    hasGarden: property.hasGarden,
    proximityToTransport: property.proximityToTransport,
    proximityToSchools: property.proximityToSchools,
    proximityToShopping: property.proximityToShopping,
  };
}

export async function computePriceEthics(property: IProperty): Promise<PropertyPriceEthics | null> {
  if (!resolvePriceBasis(property)) return null;

  const isExternal = property.isExternal === true;
  let ethicalSuggested: number | undefined;
  let ethicalMax: number | undefined;
  let withinEthical: boolean | undefined;

  if (!isExternal) {
    const ethicalInput = buildEthicalPricingInput(property);
    const monthly = property.longTermRent?.monthlyAmount;
    if (ethicalInput && typeof monthly === 'number' && monthly > 0) {
      const recommendation = validateEthicalPricing(monthly, ethicalInput);
      ethicalSuggested = recommendation.suggestedRent;
      ethicalMax = recommendation.maxRent;
      withinEthical = recommendation.isWithinEthicalRange;
    }
  }

  const market = await computeMarketVerdictForProperty(property);
  const hasMarketData = market?.hasMarketData === true;
  const marketVerdict = hasMarketData ? market?.marketVerdict : undefined;
  const percentDiffFromAvg = hasMarketData ? market?.percentDiffFromAvg : undefined;

  const isFairPrice = computeIsFairPrice(isExternal, withinEthical, marketVerdict, hasMarketData);
  const fairnessScore = computeFairnessScore(withinEthical, marketVerdict, hasMarketData);

  return {
    ethicalSuggested,
    ethicalMax,
    withinEthical,
    marketVerdict,
    percentDiffFromAvg,
    isFairPrice,
    fairnessScore,
    scoredAt: new Date().toISOString(),
  };
}

export async function scoreAndPersistProperty(propertyId: string): Promise<void> {
  const property = await Property.findById(propertyId)
    .populate({
      path: 'addressId',
      populate: [
        { path: 'cityId', select: 'name' },
        { path: 'neighborhoodId', select: 'name' },
      ],
    });

  if (!property) {
    logger.warn('Price ethics scoring skipped — property not found', { propertyId });
    return;
  }

  const priceEthics = await computePriceEthics(property);
  if (!priceEthics) {
    logger.warn('Price ethics scoring produced no result', { propertyId });
    return;
  }

  await Property.updateOne({ _id: propertyId }, { $set: { priceEthics } });
}

/** Fire-and-forget hook for write paths — never throws to callers. */
export function schedulePriceEthicsScore(propertyId: string): void {
  void scoreAndPersistProperty(propertyId).catch((error: unknown) => {
    logger.error('Price ethics scoring failed', {
      propertyId,
      error: getErrorMessage(error),
    });
  });
}

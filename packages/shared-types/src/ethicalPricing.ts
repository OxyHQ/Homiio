/**
 * Ethical pricing calculator shared by Homiio frontend and backend.
 * Ensures fair and non-speculative rental prices based on property characteristics.
 */

import { HousingType, PropertyType } from './common';

export interface EthicalPricingCharacteristics {
  type: PropertyType;
  housingType?: HousingType;
  bedrooms: number;
  bathrooms: number;
  squareFootage: number;
  amenities: string[];
  location: {
    city: string;
    state: string;
  };
  floor?: number;
  hasElevator?: boolean;
  parkingSpaces?: number;
  yearBuilt?: number;
  furnishedStatus?: 'furnished' | 'unfurnished' | 'partially_furnished';
  utilitiesIncluded?: boolean;
  petFriendly?: boolean;
  hasBalcony?: boolean;
  hasGarden?: boolean;
  proximityToTransport?: boolean;
  proximityToSchools?: boolean;
  proximityToShopping?: boolean;
}

export interface PricingRecommendation {
  suggestedRent: number;
  minRent: number;
  maxRent: number;
  isWithinEthicalRange: boolean;
  reasoning: string[];
  warnings: string[];
  breakdown: {
    basePrice: number;
    locationAdjustment: number;
    sizeAdjustment: number;
    roomAdjustment: number;
    amenityAdjustment: number;
    qualityAdjustment: number;
    utilityAdjustment: number;
  };
}

const BASE_PRICES_PER_SQFT: Record<PropertyType, number> = {
  [PropertyType.APARTMENT]: 1.2,
  [PropertyType.HOUSE]: 1.0,
  [PropertyType.STUDIO]: 1.5,
  [PropertyType.ROOM]: 2.0,
  [PropertyType.COUCHSURFING]: 0.0,
  [PropertyType.ROOMMATES]: 1.8,
  [PropertyType.COLIVING]: 1.6,
  [PropertyType.HOSTEL]: 0.8,
  [PropertyType.GUESTHOUSE]: 1.4,
  [PropertyType.CAMPSITE]: 0.3,
  [PropertyType.BOAT]: 1.7,
  [PropertyType.TREEHOUSE]: 1.9,
  [PropertyType.YURT]: 0.6,
  [PropertyType.OTHER]: 1.0,
};

const HOUSING_TYPE_MULTIPLIERS: Record<HousingType, number> = {
  [HousingType.PRIVATE]: 1.0,
  [HousingType.PUBLIC]: 0.8,
};

const LOCATION_MULTIPLIERS: Record<string, number> = {
  'New York': 2.5,
  'San Francisco': 2.3,
  'Los Angeles': 2.0,
  Boston: 1.8,
  Seattle: 1.7,
  Washington: 1.6,
  Chicago: 1.5,
  Denver: 1.4,
  Austin: 1.3,
  Portland: 1.3,
  Atlanta: 1.2,
  Dallas: 1.1,
  Houston: 1.0,
  Phoenix: 1.0,
  'Las Vegas': 1.0,
  Orlando: 1.0,
  Tampa: 1.0,
  Miami: 1.2,
  default: 1.0,
};

const AMENITY_VALUES: Record<string, number> = {
  wifi: 30,
  parking: 50,
  gym: 40,
  pool: 60,
  laundry: 25,
  dishwasher: 20,
  air_conditioning: 35,
  heating: 30,
  balcony: 25,
  garden: 20,
};

const ADDITIONAL_AMENITY_VALUES: Record<string, number> = {
  elevator: 15,
  furnished: 100,
  pet_friendly: 20,
  utilities_included: 80,
  proximity_transport: 25,
  proximity_schools: 15,
  proximity_shopping: 10,
  parking_spaces: 30,
  modern_appliances: 35,
  hardwood_floors: 20,
  walk_in_closet: 15,
  fireplace: 25,
  central_air: 40,
  in_unit_washer: 30,
  rooftop_access: 35,
  storage_unit: 20,
  bike_storage: 10,
  package_reception: 5,
};

const BEDROOM_ADJUSTMENTS: Record<number, number> = {
  0: 0.8,
  1: 1.0,
  2: 1.3,
  3: 1.6,
  4: 1.9,
  5: 2.2,
  6: 2.5,
  7: 2.8,
  8: 3.1,
};

const BATHROOM_ADJUSTMENTS: Record<number, number> = {
  1: 1.0,
  1.5: 1.1,
  2: 1.15,
  2.5: 1.2,
  3: 1.25,
  3.5: 1.3,
  4: 1.35,
  4.5: 1.4,
  5: 1.45,
};

const SIZE_EFFICIENCY_ADJUSTMENTS: Record<number, number> = {
  200: 1.2,
  400: 1.1,
  600: 1.05,
  800: 1.0,
  1000: 0.98,
  1200: 0.95,
  1500: 0.92,
  2000: 0.9,
};

const QUALITY_ADJUSTMENTS: Record<number, number> = {
  2020: 1.15,
  2015: 1.1,
  2010: 1.05,
  2005: 1.0,
  2000: 0.95,
  1995: 0.9,
  1990: 0.85,
  1985: 0.8,
  1980: 0.75,
};

const FLOOR_ADJUSTMENTS: Record<number, number> = {
  1: 0.95,
  2: 1.0,
  3: 1.02,
  4: 1.05,
  5: 1.08,
  6: 1.1,
  7: 1.12,
  8: 1.15,
  9: 1.18,
  10: 1.2,
};

export function calculateEthicalRent(property: EthicalPricingCharacteristics): PricingRecommendation {
  const warnings: string[] = [];
  const reasoning: string[] = [];

  const locationMultiplier =
    LOCATION_MULTIPLIERS[property.location.city] ??
    LOCATION_MULTIPLIERS[property.location.state] ??
    LOCATION_MULTIPLIERS.default;

  let basePrice = 0;

  if (property.type === PropertyType.ROOM) {
    basePrice = 800;
    reasoning.push('Base room price: $800');
  } else {
    const basePricePerSqft = BASE_PRICES_PER_SQFT[property.type] ?? BASE_PRICES_PER_SQFT[PropertyType.OTHER];
    basePrice = property.squareFootage * basePricePerSqft;
    reasoning.push(
      `${property.type} base price: $${basePricePerSqft}/sqft × ${property.squareFootage}sqft = $${basePrice.toFixed(0)}`,
    );
  }

  const locationAdjustedPrice = basePrice * locationMultiplier;
  reasoning.push(`Location adjustment (${locationMultiplier}x): $${locationAdjustedPrice.toFixed(0)}`);

  const bedroomAdjustment = BEDROOM_ADJUSTMENTS[property.bedrooms] ?? 1.0;
  const bedroomAdjustedPrice = locationAdjustedPrice * bedroomAdjustment;
  reasoning.push(`Bedroom adjustment (${bedroomAdjustment}x): $${bedroomAdjustedPrice.toFixed(0)}`);

  const bathroomAdjustment = BATHROOM_ADJUSTMENTS[property.bathrooms] ?? 1.0;
  const bathroomAdjustedPrice = bedroomAdjustedPrice * bathroomAdjustment;
  reasoning.push(`Bathroom adjustment (${bathroomAdjustment}x): $${bathroomAdjustedPrice.toFixed(0)}`);

  let sizeEfficiencyAdjustment = 1.0;
  for (const [size, adjustment] of Object.entries(SIZE_EFFICIENCY_ADJUSTMENTS)) {
    if (property.squareFootage <= Number(size)) {
      sizeEfficiencyAdjustment = adjustment;
      break;
    }
  }
  const sizeAdjustedPrice = bathroomAdjustedPrice * sizeEfficiencyAdjustment;
  reasoning.push(`Size efficiency adjustment (${sizeEfficiencyAdjustment}x): $${sizeAdjustedPrice.toFixed(0)}`);

  let qualityAdjustment = 1.0;
  if (property.yearBuilt) {
    for (const [year, adjustment] of Object.entries(QUALITY_ADJUSTMENTS)) {
      if (property.yearBuilt >= Number(year)) {
        qualityAdjustment = adjustment;
        break;
      }
    }
  }
  const qualityAdjustedPrice = sizeAdjustedPrice * qualityAdjustment;
  if (property.yearBuilt) {
    reasoning.push(
      `Quality adjustment (${qualityAdjustment}x, built ${property.yearBuilt}): $${qualityAdjustedPrice.toFixed(0)}`,
    );
  }

  let floorAdjustment = 1.0;
  if (property.floor && property.floor > 0) {
    for (const [floor, adjustment] of Object.entries(FLOOR_ADJUSTMENTS)) {
      if (property.floor <= Number(floor)) {
        floorAdjustment = adjustment;
        break;
      }
    }
  }
  const floorAdjustedPrice = qualityAdjustedPrice * floorAdjustment;
  if (property.floor && property.floor > 0) {
    reasoning.push(`Floor adjustment (${floorAdjustment}x, floor ${property.floor}): $${floorAdjustedPrice.toFixed(0)}`);
  }

  let amenityValue = 0;
  const amenityBreakdown: string[] = [];

  property.amenities.forEach((amenity) => {
    const value = AMENITY_VALUES[amenity];
    if (value) {
      amenityValue += value;
      amenityBreakdown.push(`${amenity}: +$${value}`);
    }
  });

  if (property.hasElevator) {
    amenityValue += ADDITIONAL_AMENITY_VALUES.elevator;
    amenityBreakdown.push(`elevator: +$${ADDITIONAL_AMENITY_VALUES.elevator}`);
  }
  if (property.furnishedStatus === 'furnished') {
    amenityValue += ADDITIONAL_AMENITY_VALUES.furnished;
    amenityBreakdown.push(`furnished: +$${ADDITIONAL_AMENITY_VALUES.furnished}`);
  }
  if (property.petFriendly) {
    amenityValue += ADDITIONAL_AMENITY_VALUES.pet_friendly;
    amenityBreakdown.push(`pet friendly: +$${ADDITIONAL_AMENITY_VALUES.pet_friendly}`);
  }
  if (property.utilitiesIncluded) {
    amenityValue += ADDITIONAL_AMENITY_VALUES.utilities_included;
    amenityBreakdown.push(`utilities included: +$${ADDITIONAL_AMENITY_VALUES.utilities_included}`);
  }
  if (property.proximityToTransport) {
    amenityValue += ADDITIONAL_AMENITY_VALUES.proximity_transport;
    amenityBreakdown.push(`near transport: +$${ADDITIONAL_AMENITY_VALUES.proximity_transport}`);
  }
  if (property.proximityToSchools) {
    amenityValue += ADDITIONAL_AMENITY_VALUES.proximity_schools;
    amenityBreakdown.push(`near schools: +$${ADDITIONAL_AMENITY_VALUES.proximity_schools}`);
  }
  if (property.proximityToShopping) {
    amenityValue += ADDITIONAL_AMENITY_VALUES.proximity_shopping;
    amenityBreakdown.push(`near shopping: +$${ADDITIONAL_AMENITY_VALUES.proximity_shopping}`);
  }
  if (property.parkingSpaces && property.parkingSpaces > 1) {
    const additionalSpaces = property.parkingSpaces - 1;
    const parkingValue = additionalSpaces * ADDITIONAL_AMENITY_VALUES.parking_spaces;
    amenityValue += parkingValue;
    amenityBreakdown.push(`additional parking (${additionalSpaces}): +$${parkingValue}`);
  }

  const housingTypeMultiplier = HOUSING_TYPE_MULTIPLIERS[property.housingType ?? HousingType.PRIVATE];
  const housingTypeAdjustedPrice = (floorAdjustedPrice + amenityValue) * housingTypeMultiplier;
  const suggestedRent = Math.round(housingTypeAdjustedPrice);

  if (amenityValue > 0) {
    reasoning.push(`Amenities added: +$${amenityValue} (${amenityBreakdown.join(', ')})`);
  }
  if (property.housingType === HousingType.PUBLIC) {
    reasoning.push(`Public housing discount (${housingTypeMultiplier}x): $${housingTypeAdjustedPrice.toFixed(0)}`);
  }
  reasoning.push(`Final suggested rent: $${suggestedRent}`);

  const minRent = Math.round(suggestedRent * 0.85);
  const maxRent = Math.round(suggestedRent * 1.15);

  if (property.squareFootage < 200 && property.type !== PropertyType.ROOM) {
    warnings.push('Very small property - consider if this is suitable for rental');
  }
  if (property.bedrooms > 5) {
    warnings.push('Large property - ensure pricing reflects actual market value');
  }
  if (locationMultiplier > 2.0) {
    warnings.push('High-cost area - ensure pricing is justified by location benefits');
  }
  if (property.yearBuilt && property.yearBuilt < 1980) {
    warnings.push('Very old property - consider renovation costs and maintenance');
  }
  if (property.floor && property.floor > 10) {
    warnings.push('Very high floor - ensure elevator access and emergency procedures');
  }
  if (amenityValue > suggestedRent * 0.3) {
    warnings.push('High amenity value - ensure amenities justify the premium');
  }

  return {
    suggestedRent,
    minRent,
    maxRent,
    isWithinEthicalRange: true,
    reasoning,
    warnings,
    breakdown: {
      basePrice: Math.round(basePrice),
      locationAdjustment: Math.round(locationAdjustedPrice - basePrice),
      sizeAdjustment: Math.round(sizeAdjustedPrice - bathroomAdjustedPrice),
      roomAdjustment: Math.round(bedroomAdjustedPrice - locationAdjustedPrice),
      amenityAdjustment: amenityValue,
      qualityAdjustment: Math.round(qualityAdjustedPrice - sizeAdjustedPrice),
      utilityAdjustment: Math.round(floorAdjustedPrice - qualityAdjustedPrice),
    },
  };
}

export function validateEthicalPricing(
  proposedRent: number,
  property: EthicalPricingCharacteristics,
): PricingRecommendation {
  const recommendation = calculateEthicalRent(property);
  const isWithinRange = proposedRent <= recommendation.maxRent;
  const warnings = [...recommendation.warnings];

  if (proposedRent > recommendation.maxRent) {
    warnings.push(`Rent exceeds ethical maximum ($${recommendation.maxRent}) - may be speculative`);
  }

  return {
    ...recommendation,
    isWithinEthicalRange: isWithinRange,
    warnings,
  };
}

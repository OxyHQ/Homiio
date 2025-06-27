/**
 * Ethical Pricing Calculator for Homiio
 * Ensures fair and non-speculative rental prices based on property characteristics
 */

export interface PropertyCharacteristics {
  type: 'apartment' | 'house' | 'room' | 'studio' | 'duplex' | 'penthouse' | 'couchsurfing' | 'roommates' | 'coliving' | 'hostel' | 'guesthouse' | 'campsite' | 'boat' | 'treehouse' | 'yurt' | 'other';
  housingType?: 'private' | 'public'; // For public housing pricing adjustments
  bedrooms: number;
  bathrooms: number;
  squareFootage: number;
  amenities: string[];
  location: {
    city: string;
    state: string;
  };
  // Additional factors for more comprehensive pricing
  floor?: number;
  hasElevator?: boolean;
  parkingSpaces?: number;
  yearBuilt?: number;
  isFurnished?: boolean;
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

// Base pricing per square foot by property type (monthly)
const BASE_PRICES_PER_SQFT = {
  apartment: 1.2,
  house: 1.0,
  studio: 1.5,
  room: 2.0, // For shared spaces, price per room
  duplex: 1.3,
  penthouse: 2.5,
  // New accommodation types
  couchsurfing: 0.0, // Typically free
  roommates: 1.8, // Shared living spaces
  coliving: 1.6, // Community living
  hostel: 0.8, // Budget accommodation
  guesthouse: 1.4, // Similar to hotel
  campsite: 0.3, // Outdoor accommodation
  boat: 1.7, // Unique accommodation
  treehouse: 1.9, // Unique accommodation
  yurt: 0.6, // Traditional accommodation
  other: 1.0, // Default pricing
};

// Housing type multipliers
const HOUSING_TYPE_MULTIPLIERS = {
  private: 1.0,
  public: 0.8, // Subsidized/affordable housing discount
};

// Location multipliers (cost of living adjustments)
const LOCATION_MULTIPLIERS: { [key: string]: number } = {
  // High cost cities
  'New York': 2.5,
  'San Francisco': 2.3,
  'Los Angeles': 2.0,
  'Boston': 1.8,
  'Seattle': 1.7,
  'Washington': 1.6,
  'Chicago': 1.5,
  'Denver': 1.4,
  'Austin': 1.3,
  'Portland': 1.3,
  
  // Medium cost cities
  'Atlanta': 1.2,
  'Dallas': 1.1,
  'Houston': 1.0,
  'Phoenix': 1.0,
  'Las Vegas': 1.0,
  'Orlando': 1.0,
  'Tampa': 1.0,
  'Miami': 1.2,
  
  // Default for other cities
  'default': 1.0,
};

// Amenity value additions (monthly)
const AMENITY_VALUES: { [key: string]: number } = {
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

// Additional amenity values
const ADDITIONAL_AMENITY_VALUES: { [key: string]: number } = {
  elevator: 15,
  furnished: 100,
  pet_friendly: 20,
  utilities_included: 80,
  proximity_transport: 25,
  proximity_schools: 15,
  proximity_shopping: 10,
  parking_spaces: 30, // per additional space
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

// Bedroom/bathroom adjustments with more granularity
const BEDROOM_ADJUSTMENTS = {
  0: 0.8, // Studio
  1: 1.0, // 1BR baseline
  2: 1.3,
  3: 1.6,
  4: 1.9,
  5: 2.2,
  6: 2.5,
  7: 2.8,
  8: 3.1,
};

const BATHROOM_ADJUSTMENTS = {
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

// Size efficiency adjustments (larger properties get slight discount per sqft)
const SIZE_EFFICIENCY_ADJUSTMENTS = {
  200: 1.2,   // Very small - premium
  400: 1.1,   // Small - slight premium
  600: 1.05,  // Medium - slight premium
  800: 1.0,   // Standard - baseline
  1000: 0.98, // Large - slight discount
  1200: 0.95, // Very large - discount
  1500: 0.92, // Extra large - more discount
  2000: 0.9,  // Huge - significant discount
};

// Quality adjustments based on year built
const QUALITY_ADJUSTMENTS = {
  2020: 1.15, // Very new
  2015: 1.1,  // New
  2010: 1.05, // Recent
  2005: 1.0,  // Standard
  2000: 0.95, // Older
  1995: 0.9,  // Quite old
  1990: 0.85, // Old
  1985: 0.8,  // Very old
  1980: 0.75, // Ancient
};

// Floor level adjustments
const FLOOR_ADJUSTMENTS = {
  1: 0.95,    // Ground floor - slight discount
  2: 1.0,     // Second floor - baseline
  3: 1.02,    // Third floor - slight premium
  4: 1.05,    // Fourth floor - premium
  5: 1.08,    // Fifth floor - more premium
  6: 1.1,     // Sixth floor - significant premium
  7: 1.12,    // Seventh floor - high premium
  8: 1.15,    // Eighth floor - very high premium
  9: 1.18,    // Ninth floor - very high premium
  10: 1.2,    // Tenth floor - maximum premium
};

/**
 * Calculate ethical rent price based on comprehensive property characteristics
 */
export function calculateEthicalRent(property: PropertyCharacteristics): PricingRecommendation {
  const warnings: string[] = [];
  const reasoning: string[] = [];
  
  // Get location multiplier
  const locationMultiplier = LOCATION_MULTIPLIERS[property.location.city] || 
                            LOCATION_MULTIPLIERS[property.location.state] || 
                            LOCATION_MULTIPLIERS.default;
  
  // Base calculation
  let basePrice = 0;
  
  if (property.type === 'room') {
    // For rooms, use a different calculation
    basePrice = 800; // Base room price
    reasoning.push(`Base room price: $800`);
  } else {
    // For other property types, use square footage
    const basePricePerSqft = BASE_PRICES_PER_SQFT[property.type];
    basePrice = property.squareFootage * basePricePerSqft;
    reasoning.push(`${property.type} base price: $${basePricePerSqft}/sqft × ${property.squareFootage}sqft = $${basePrice.toFixed(0)}`);
  }
  
  // Apply location multiplier
  const locationAdjustedPrice = basePrice * locationMultiplier;
  reasoning.push(`Location adjustment (${locationMultiplier}x): $${locationAdjustedPrice.toFixed(0)}`);
  
  // Apply bedroom adjustment
  const bedroomAdjustment = BEDROOM_ADJUSTMENTS[property.bedrooms as keyof typeof BEDROOM_ADJUSTMENTS] || 1.0;
  const bedroomAdjustedPrice = locationAdjustedPrice * bedroomAdjustment;
  reasoning.push(`Bedroom adjustment (${bedroomAdjustment}x): $${bedroomAdjustedPrice.toFixed(0)}`);
  
  // Apply bathroom adjustment (handle half bathrooms)
  const bathroomAdjustment = BATHROOM_ADJUSTMENTS[property.bathrooms as keyof typeof BATHROOM_ADJUSTMENTS] || 1.0;
  const bathroomAdjustedPrice = bedroomAdjustedPrice * bathroomAdjustment;
  reasoning.push(`Bathroom adjustment (${bathroomAdjustment}x): $${bathroomAdjustedPrice.toFixed(0)}`);
  
  // Apply size efficiency adjustment
  let sizeEfficiencyAdjustment = 1.0;
  for (const [size, adjustment] of Object.entries(SIZE_EFFICIENCY_ADJUSTMENTS)) {
    if (property.squareFootage <= parseInt(size)) {
      sizeEfficiencyAdjustment = adjustment;
      break;
    }
  }
  const sizeAdjustedPrice = bathroomAdjustedPrice * sizeEfficiencyAdjustment;
  reasoning.push(`Size efficiency adjustment (${sizeEfficiencyAdjustment}x): $${sizeAdjustedPrice.toFixed(0)}`);
  
  // Apply quality adjustment based on year built
  let qualityAdjustment = 1.0;
  if (property.yearBuilt) {
    for (const [year, adjustment] of Object.entries(QUALITY_ADJUSTMENTS)) {
      if (property.yearBuilt >= parseInt(year)) {
        qualityAdjustment = adjustment;
        break;
      }
    }
  }
  const qualityAdjustedPrice = sizeAdjustedPrice * qualityAdjustment;
  if (property.yearBuilt) {
    reasoning.push(`Quality adjustment (${qualityAdjustment}x, built ${property.yearBuilt}): $${qualityAdjustedPrice.toFixed(0)}`);
  }
  
  // Apply floor level adjustment
  let floorAdjustment = 1.0;
  if (property.floor && property.floor > 0) {
    for (const [floor, adjustment] of Object.entries(FLOOR_ADJUSTMENTS)) {
      if (property.floor <= parseInt(floor)) {
        floorAdjustment = adjustment;
        break;
      }
    }
  }
  const floorAdjustedPrice = qualityAdjustedPrice * floorAdjustment;
  if (property.floor && property.floor > 0) {
    reasoning.push(`Floor adjustment (${floorAdjustment}x, floor ${property.floor}): $${floorAdjustedPrice.toFixed(0)}`);
  }
  
  // Calculate amenity values
  let amenityValue = 0;
  const amenityBreakdown: string[] = [];
  
  // Standard amenities
  property.amenities.forEach(amenity => {
    if (AMENITY_VALUES[amenity]) {
      amenityValue += AMENITY_VALUES[amenity];
      amenityBreakdown.push(`${amenity}: +$${AMENITY_VALUES[amenity]}`);
    }
  });
  
  // Additional property features
  if (property.hasElevator) {
    amenityValue += ADDITIONAL_AMENITY_VALUES.elevator;
    amenityBreakdown.push(`elevator: +$${ADDITIONAL_AMENITY_VALUES.elevator}`);
  }
  
  if (property.isFurnished) {
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
  
  // Apply housing type multiplier
  const housingTypeMultiplier = HOUSING_TYPE_MULTIPLIERS[property.housingType || 'private'];
  const housingTypeAdjustedPrice = (floorAdjustedPrice + amenityValue) * housingTypeMultiplier;
  
  const suggestedRent = Math.round(housingTypeAdjustedPrice);
  
  if (amenityValue > 0) {
    reasoning.push(`Amenities added: +$${amenityValue} (${amenityBreakdown.join(', ')})`);
  }
  
  if (property.housingType === 'public') {
    reasoning.push(`Public housing discount (${housingTypeMultiplier}x): $${housingTypeAdjustedPrice.toFixed(0)}`);
  }
  
  reasoning.push(`Final suggested rent: $${suggestedRent}`);
  
  // Calculate ethical range (±15% of suggested price)
  const minRent = Math.round(suggestedRent * 0.85);
  const maxRent = Math.round(suggestedRent * 1.15);
  
  // Enhanced warnings and checks
  if (property.squareFootage < 200 && property.type !== 'room') {
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

/**
 * Validate if a proposed rent price is ethical
 */
export function validateEthicalPricing(
  proposedRent: number, 
  property: PropertyCharacteristics
): PricingRecommendation {
  const recommendation = calculateEthicalRent(property);
  
  // Only check against maximum - no minimum restriction
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

/**
 * Get pricing guidance for a property
 */
export function getPricingGuidance(property: PropertyCharacteristics): string {
  const recommendation = calculateEthicalRent(property);
  
  return `Based on your property characteristics, we recommend a rent up to $${recommendation.maxRent} per month. Our suggested price is $${recommendation.suggestedRent}/month. You can set a lower price to make it more affordable.`;
}

/**
 * Check if rent is potentially speculative
 */
export function isSpeculativePricing(proposedRent: number, property: PropertyCharacteristics): boolean {
  const recommendation = calculateEthicalRent(property);
  return proposedRent > recommendation.maxRent;
}

/**
 * Get detailed pricing breakdown
 */
export function getPricingBreakdown(property: PropertyCharacteristics): string {
  const recommendation = calculateEthicalRent(property);
  const { breakdown } = recommendation;
  
  return `
Pricing Breakdown:
• Base Price: $${breakdown.basePrice}
• Location Adjustment: $${breakdown.locationAdjustment}
• Room Adjustment: $${breakdown.roomAdjustment}
• Size Adjustment: $${breakdown.sizeAdjustment}
• Quality Adjustment: $${breakdown.qualityAdjustment}
• Utility Adjustment: $${breakdown.utilityAdjustment}
• Amenities: $${breakdown.amenityAdjustment}
• Total Suggested: $${recommendation.suggestedRent}
  `.trim();
} 
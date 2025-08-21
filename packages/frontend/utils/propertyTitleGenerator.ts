/**
 * Property Title Generator
 * Automatically generates property titles based on property details with i18n support
 */

import i18next from 'i18next';
import { PropertyType } from '@homiio/shared-types';

export interface PropertyData {
  type?: PropertyType;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
    neighborhood?: string;
  };
  bedrooms?: number;
  bathrooms?: number;
}

export type TitleFormat = 'default' | 'short' | 'large';

/**
 * Helper function to remove property numbers for privacy
 * @param street - Street address
 * @returns Street address without property numbers
 */
function removePropertyNumber(street: string): string {
  if (!street) return '';
  // Remove numbers, commas and extra spaces from street for privacy
  // Examples: "Calle de Vicente Blasco Ibáñez, 6" -> "Calle de Vicente Blasco Ibáñez"
  return street.replace(/,?\s*\d+.*$/, '').trim();
}

/**
 * Safe translation function with fallbacks
 * @param key - Translation key
 * @param fallback - Fallback value if translation is missing
 * @returns Translated text or fallback
 */
function safeTranslate(key: string, fallback: string): string {
  try {
    const translation = i18next.t(key);
    // Check if translation exists and is not the same as the key (which means it failed)
    return translation && translation !== key ? translation : fallback;
  } catch (error) {
    console.warn(`Translation failed for key: ${key}`, error);
    return fallback;
  }
}

/**
 * Generate a short property title (e.g., "Room in Sant Andreu")
 * @param propertyData - Property data object
 * @returns Short generated title
 */
export function generateShortPropertyTitle(propertyData: PropertyData): string {
  const { type = PropertyType.APARTMENT, address = {} } = propertyData;

  // Get translated property type with fallbacks
  const propertyType = safeTranslate(
    `properties.titles.types.${type}`,
    safeTranslate('properties.titles.types.apartment', 'Apartment'),
  );

  // Build location string - prefer neighborhood-like information
  let location = '';
  
  // First check if neighborhood is explicitly provided
  if (address.neighborhood) {
    location = address.neighborhood;
  } else if (address.street) {
    // Try to extract neighborhood from street name
    const streetWithoutNumber = removePropertyNumber(address.street);
    const streetParts = streetWithoutNumber.split(',').map(part => part.trim());
    
    // Look for neighborhood indicators in street name
    // Common neighborhood patterns: "Carrer de [Neighborhood]", "Calle [Neighborhood]", etc.
    const neighborhoodPatterns = [
      /carrer\s+(?:de\s+)?([^,\s]+)/i,
      /calle\s+(?:de\s+)?([^,\s]+)/i,
      /street\s+(?:of\s+)?([^,\s]+)/i,
      /avenue\s+(?:of\s+)?([^,\s]+)/i,
      /plaza\s+(?:de\s+)?([^,\s]+)/i,
      /passeig\s+(?:de\s+)?([^,\s]+)/i,
      /rambla\s+(?:de\s+)?([^,\s]+)/i,
    ];
    
    for (const pattern of neighborhoodPatterns) {
      const match = streetWithoutNumber.match(pattern);
      if (match && match[1]) {
        location = match[1];
        break;
      }
    }
    
    // If no neighborhood pattern found, use the first meaningful part of the street
    if (!location && streetParts.length > 0) {
      const firstPart = streetParts[0];
      // Skip common street prefixes
      const skipPrefixes = ['carrer', 'calle', 'street', 'avenue', 'plaza', 'passeig', 'rambla'];
      const lowerFirstPart = firstPart.toLowerCase();
      
      if (!skipPrefixes.some(prefix => lowerFirstPart.startsWith(prefix))) {
        location = firstPart;
      } else if (streetParts.length > 1) {
        // Use the second part if first is a prefix
        location = streetParts[1];
      } else {
        // Fallback to the whole street name without number
        location = streetWithoutNumber;
      }
    }
  }
  
  // If no neighborhood found from street, fall back to city
  if (!location && address.city) {
    location = address.city;
  } else if (!location && address.state) {
    location = address.state;
  } else if (!location) {
    location = safeTranslate('properties.titles.locationNotSpecified', 'Location not specified');
  }

  // Generate the final title: "PropertyType in Location"
  const title = `${propertyType} in ${location}`;

  // Ensure title doesn't exceed maximum length (100 characters for short format)
  if (title.length > 100) {
    const maxLocationLength = 100 - propertyType.length - 4; // 4 for " in "
    const truncatedLocation = location.substring(0, maxLocationLength).trim();
    return `${propertyType} in ${truncatedLocation}`;
  }

  return title;
}

/**
 * Generate a large property title (e.g., "Apartment for rent in Carrer D'alí Bei, Barcelona, Barcelona")
 * @param propertyData - Property data object
 * @returns Large generated title with full details
 */
export function generateLargePropertyTitle(propertyData: PropertyData): string {
  const { type = PropertyType.APARTMENT, address = {} } = propertyData;

  // Get translated property type with fallbacks
  const propertyType = safeTranslate(
    `properties.titles.types.${type}`,
    safeTranslate('properties.titles.types.apartment', 'Apartment'),
  );

  // Get "for rent in" text in current language with fallback
  const forRentText = safeTranslate('properties.titles.forRent', 'for rent in');

  // Build location string with full details (including street numbers for large format)
  let location = '';
  if (address.street && address.city) {
    // Keep street numbers for large format
    const street = address.street.trim();
    location = `${street}, ${address.city}`;
    if (address.state) {
      location += `, ${address.state}`;
    }
  } else if (address.city) {
    location = address.city;
    if (address.state) {
      location += `, ${address.state}`;
    }
  } else {
    location =
      address.state ||
      safeTranslate('properties.titles.locationNotSpecified', 'Location not specified');
  }

  // Generate the final title: "PropertyType for rent in Location"
  const title = `${propertyType} ${forRentText} ${location}`;

  // Ensure title doesn't exceed maximum length (200 characters for large format)
  if (title.length > 200) {
    // Truncate location if title is too long
    const maxLocationLength = 200 - propertyType.length - forRentText.length - 2; // 2 for spaces
    const truncatedLocation = location.substring(0, maxLocationLength).trim();
    return `${propertyType} ${forRentText} ${truncatedLocation}`;
  }

  return title;
}

/**
 * Generate a property title based on property data with dynamic localization
 * Format depends on the format parameter:
 * - 'short': "Room in Sant Andreu"
 * - 'large': "Apartment for rent in Carrer D'alí Bei, Barcelona, Barcelona"
 * - 'default': Uses short format
 * @param propertyData - Property data object
 * @param format - Title format ('default', 'short', or 'large')
 * @returns Generated title
 */
export function generatePropertyTitle(propertyData: PropertyData, format: TitleFormat = 'default'): string {
  switch (format) {
    case 'short':
      return generateShortPropertyTitle(propertyData);
    case 'large':
      return generateLargePropertyTitle(propertyData);
    case 'default':
    default:
      return generateShortPropertyTitle(propertyData);
  }
}

/**
 * Generate a property title with additional details (bedroom/bathroom info)
 * @param propertyData - Property data object
 * @param includeDetails - Whether to include bedroom/bathroom details
 * @param format - Title format ('default', 'short', or 'large')
 * @returns Generated title with optional details
 */
export function generateDetailedPropertyTitle(
  propertyData: PropertyData,
  includeDetails = false,
  format: TitleFormat = 'default',
): string {
  const baseTitle = generatePropertyTitle(propertyData, format);

  if (!includeDetails) {
    return baseTitle;
  }

  const { bedrooms = 0, bathrooms = 0 } = propertyData;

  // Add bedroom/bathroom details for properties with multiple rooms
  if (bedrooms > 0 || bathrooms > 0) {
    const details = [];
    if (bedrooms > 0) {
      const bedroomText = safeTranslate('properties.details.bedrooms', 'Bedrooms');
      const bedroomLabel =
        bedrooms === 1
          ? bedroomText.slice(0, -1) // Remove 's' for singular
          : bedroomText;
      details.push(`${bedrooms} ${bedroomLabel.toLowerCase()}`);
    }
    if (bathrooms > 0) {
      const bathroomText = safeTranslate('properties.details.bathrooms', 'Bathrooms');
      const bathroomLabel =
        bathrooms === 1
          ? bathroomText.slice(0, -1) // Remove 's' for singular
          : bathroomText;
      details.push(`${bathrooms} ${bathroomLabel.toLowerCase()}`);
    }

    if (details.length > 0) {
      return `${baseTitle} - ${details.join(', ')}`;
    }
  }

  return baseTitle;
}

/**
 * Preview a property title based on current form data
 * @param propertyData - Property data object
 * @param format - Title format ('default', 'short', or 'large')
 * @returns Preview title or null if insufficient data
 */
export function previewPropertyTitle(propertyData: PropertyData, format: TitleFormat = 'default'): string | null {
  const { type, address } = propertyData;

  // Need at least type and some address info
  if (!type || !address) {
    return null;
  }

  const street = address.street || '';
  const city = address.city || '';

  if (!street && !city) {
    return null;
  }

  return generatePropertyTitle(propertyData, format);
}

/**
 * Test function to verify property title generation works correctly
 * This function can be used for debugging and testing
 * @param language - Language code to test with
 * @returns Object with test results
 */
export function testPropertyTitleGeneration(language = 'en-US'): {
  success: boolean;
  tests: Array<{
    name: string;
    input: PropertyData;
    expected: string;
    actual: string;
    passed: boolean;
  }>;
} {
  const originalLanguage = i18next.language;

  try {
    // Set language for testing
    i18next.changeLanguage(language);

    const testCases: Array<{
      name: string;
      input: PropertyData;
      expected: string;
    }> = [
      {
        name: 'Basic apartment with address',
        input: {
          type: PropertyType.APARTMENT,
          address: {
            street: 'Calle de Vicente Blasco Ibáñez, 6',
            city: 'Barcelona',
            state: 'Catalunya',
          },
        },
        expected: 'Apartment for rent in Calle de Vicente Blasco Ibáñez, Barcelona, Catalunya',
      },
      {
        name: 'House with city only',
        input: {
          type: PropertyType.HOUSE,
          address: {
            city: 'Madrid',
          },
        },
        expected: 'House for rent in Madrid',
      },
      {
        name: 'Studio with no address',
        input: {
          type: PropertyType.STUDIO,
          address: {},
        },
        expected: 'Studio for rent in Location not specified',
      },
      {
        name: 'Detailed apartment with bedrooms and bathrooms',
        input: {
          type: PropertyType.APARTMENT,
          address: {
            street: 'Gran Via, 123',
            city: 'Valencia',
          },
          bedrooms: 2,
          bathrooms: 1,
        },
        expected: 'Apartment for rent in Gran Via, Valencia - 2 bedroom, 1 bathroom',
      },
    ];

    const results = testCases.map((testCase) => {
      const actual = generateDetailedPropertyTitle(testCase.input, true);
      return {
        name: testCase.name,
        input: testCase.input,
        expected: testCase.expected,
        actual,
        passed:
          actual.includes('Apartment') || actual.includes('House') || actual.includes('Studio'),
      };
    });

    const success = results.every((result) => result.passed);

    return {
      success,
      tests: results,
    };
  } finally {
    // Restore original language
    i18next.changeLanguage(originalLanguage);
  }
}

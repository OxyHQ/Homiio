/**
 * Property Title Generator
 * Automatically generates property titles based on property details with i18n support
 */

import i18next from 'i18next';

export interface PropertyData {
  type?: 'apartment' | 'house' | 'room' | 'studio' | 'duplex' | 'penthouse';
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
  };
  bedrooms?: number;
  bathrooms?: number;
}

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
 * Generate a property title based on property data with dynamic localization
 * Format: "{PropertyType} for rent in {Street}, {City}, {State}"
 * @param propertyData - Property data object
 * @returns Generated title with privacy protection
 */
export function generatePropertyTitle(propertyData: PropertyData): string {
  const {
    type = 'apartment',
    address = {},
  } = propertyData;

  // Get current language from i18next
  const currentLanguage = i18next.language || 'en';

  // Get translated property type with fallbacks
  const propertyType = safeTranslate(
    `properties.titles.types.${type}`, 
    safeTranslate('properties.titles.types.apartment', 'Apartment')
  );
  
  // Get "for rent in" text in current language with fallback
  const forRentText = safeTranslate('properties.titles.forRent', 'for rent in');

  // Build location string (without property numbers for privacy)
  let location = '';
  if (address.street && address.city) {
    const streetWithoutNumber = removePropertyNumber(address.street);
    location = `${streetWithoutNumber}, ${address.city}`;
    if (address.state) {
      location += `, ${address.state}`;
    }
  } else if (address.city) {
    location = address.city;
    if (address.state) {
      location += `, ${address.state}`;
    }
  } else {
    location = address.state || safeTranslate('properties.titles.locationNotSpecified', 'Location not specified');
  }

  // Generate the final title: "PropertyType for rent in Location"
  const title = `${propertyType} ${forRentText} ${location}`;

  // Ensure title doesn't exceed maximum length (200 characters)
  if (title.length > 200) {
    // Truncate location if title is too long
    const maxLocationLength = 200 - propertyType.length - forRentText.length - 2; // 2 for spaces
    const truncatedLocation = location.substring(0, maxLocationLength).trim();
    return `${propertyType} ${forRentText} ${truncatedLocation}`;
  }

  return title;
}

/**
 * Generate a property title with additional details (bedroom/bathroom info)
 * @param propertyData - Property data object
 * @param includeDetails - Whether to include bedroom/bathroom details
 * @returns Generated title with optional details
 */
export function generateDetailedPropertyTitle(
  propertyData: PropertyData, 
  includeDetails = false
): string {
  const baseTitle = generatePropertyTitle(propertyData);
  
  if (!includeDetails) {
    return baseTitle;
  }

  const { bedrooms = 0, bathrooms = 0 } = propertyData;
  
  // Add bedroom/bathroom details for properties with multiple rooms
  if (bedrooms > 0 || bathrooms > 0) {
    const details = [];
    if (bedrooms > 0) {
      const bedroomText = safeTranslate('properties.details.bedrooms', 'Bedrooms');
      const bedroomLabel = bedrooms === 1 ? 
        bedroomText.slice(0, -1) : // Remove 's' for singular
        bedroomText;
      details.push(`${bedrooms} ${bedroomLabel.toLowerCase()}`);
    }
    if (bathrooms > 0) {
      const bathroomText = safeTranslate('properties.details.bathrooms', 'Bathrooms');
      const bathroomLabel = bathrooms === 1 ? 
        bathroomText.slice(0, -1) : // Remove 's' for singular  
        bathroomText;
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
 * @returns Preview title or null if insufficient data
 */
export function previewPropertyTitle(propertyData: PropertyData): string | null {
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
  
  return generatePropertyTitle(propertyData);
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
          type: 'apartment' as const,
          address: {
            street: 'Calle de Vicente Blasco Ibáñez, 6',
            city: 'Barcelona',
            state: 'Catalunya'
          }
        },
        expected: 'Apartment for rent in Calle de Vicente Blasco Ibáñez, Barcelona, Catalunya'
      },
      {
        name: 'House with city only',
        input: {
          type: 'house' as const,
          address: {
            city: 'Madrid'
          }
        },
        expected: 'House for rent in Madrid'
      },
      {
        name: 'Studio with no address',
        input: {
          type: 'studio' as const,
          address: {}
        },
        expected: 'Studio for rent in Location not specified'
      },
      {
        name: 'Detailed apartment with bedrooms and bathrooms',
        input: {
          type: 'apartment' as const,
          address: {
            street: 'Gran Via, 123',
            city: 'Valencia'
          },
          bedrooms: 2,
          bathrooms: 1
        },
        expected: 'Apartment for rent in Gran Via, Valencia - 2 bedroom, 1 bathroom'
      }
    ];
    
    const results = testCases.map(testCase => {
      const actual = generateDetailedPropertyTitle(testCase.input, true);
      return {
        name: testCase.name,
        input: testCase.input,
        expected: testCase.expected,
        actual,
        passed: actual.includes('Apartment') || actual.includes('House') || actual.includes('Studio')
      };
    });
    
    const success = results.every(result => result.passed);
    
    return {
      success,
      tests: results
    };
    
  } finally {
    // Restore original language
    i18next.changeLanguage(originalLanguage);
  }
} 
/**
 * Property Title Generator
 * Automatically generates property titles based on property details with i18n support.
 * The pure location/composition logic lives in `@homiio/shared-types`; this module
 * layers i18next translations on top.
 */

import i18next from 'i18next';
import {
  PropertyType,
  buildLargeTitleLocation,
  buildTitleDetails,
  composeTitle,
  removePropertyNumber,
  resolveShortTitleLocation,
  SHORT_TITLE_MAX_LENGTH,
  LARGE_TITLE_MAX_LENGTH,
} from '@homiio/shared-types';

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

function translatedPropertyType(type: PropertyType): string {
  return safeTranslate(
    `properties.titles.types.${type}`,
    safeTranslate('properties.titles.types.apartment', 'Apartment'),
  );
}

function locationNotSpecified(): string {
  return safeTranslate('properties.titles.locationNotSpecified', 'Location not specified');
}

/**
 * Generate a short property title (e.g., "Room in Sant Andreu")
 * @param propertyData - Property data object
 * @returns Short generated title
 */
export function generateShortPropertyTitle(propertyData: PropertyData): string {
  const { type = PropertyType.APARTMENT, address = {} } = propertyData;

  const propertyType = translatedPropertyType(type);

  const location = resolveShortTitleLocation(
    {
      neighborhood: address.neighborhood,
      streetWithoutNumber: removePropertyNumber(address.street || ''),
      city: address.city,
      state: address.state,
    },
    locationNotSpecified(),
  );

  return composeTitle(`${propertyType} in`, location, SHORT_TITLE_MAX_LENGTH);
}

/**
 * Generate a large property title (e.g., "Apartment for rent in Carrer D'alí Bei, Barcelona, Barcelona")
 * @param propertyData - Property data object
 * @returns Large generated title with full details
 */
export function generateLargePropertyTitle(propertyData: PropertyData): string {
  const { type = PropertyType.APARTMENT, address = {} } = propertyData;

  const propertyType = translatedPropertyType(type);

  // Get "for rent in" text in current language with fallback
  const forRentText = safeTranslate('properties.titles.forRent', 'for rent in');

  const location = buildLargeTitleLocation(
    {
      street: address.street,
      city: address.city,
      state: address.state,
    },
    locationNotSpecified(),
  );

  return composeTitle(`${propertyType} ${forRentText}`, location, LARGE_TITLE_MAX_LENGTH);
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

  const formatBedrooms = (count: number): string => {
    const bedroomText = safeTranslate('properties.details.bedrooms', 'Bedrooms');
    const bedroomLabel = count === 1 ? bedroomText.slice(0, -1) : bedroomText;
    return `${count} ${bedroomLabel.toLowerCase()}`;
  };
  const formatBathrooms = (count: number): string => {
    const bathroomText = safeTranslate('properties.details.bathrooms', 'Bathrooms');
    const bathroomLabel = count === 1 ? bathroomText.slice(0, -1) : bathroomText;
    return `${count} ${bathroomLabel.toLowerCase()}`;
  };

  const details = buildTitleDetails(bedrooms, bathrooms, formatBedrooms, formatBathrooms);

  return details ? `${baseTitle} - ${details}` : baseTitle;
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

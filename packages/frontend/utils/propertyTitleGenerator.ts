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

  // Get translated property type
  const propertyType = i18next.t(`properties.titles.types.${type}`) || i18next.t(`properties.titles.types.apartment`);
  
  // Get "for rent in" text in current language
  const forRentText = i18next.t('properties.titles.forRent');

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
    location = address.state || i18next.t('properties.titles.locationNotSpecified');
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
      const bedroomText = bedrooms === 1 ? 
        i18next.t('properties.details.bedrooms').slice(0, -1) : // Remove 's' for singular
        i18next.t('properties.details.bedrooms');
      details.push(`${bedrooms} ${bedroomText.toLowerCase()}`);
    }
    if (bathrooms > 0) {
      const bathroomText = bathrooms === 1 ? 
        i18next.t('properties.details.bathrooms').slice(0, -1) : // Remove 's' for singular  
        i18next.t('properties.details.bathrooms');
      details.push(`${bathrooms} ${bathroomText.toLowerCase()}`);
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
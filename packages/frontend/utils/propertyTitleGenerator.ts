/**
 * Property Title Generator
 * Automatically generates property titles based on property details
 */

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
 * Generate a property title based on property data
 * @param propertyData - Property data object
 * @returns Generated title
 */
export function generatePropertyTitle(propertyData: PropertyData): string {
  const {
    type = 'apartment',
    address = {},
    bedrooms = 0,
    bathrooms = 0
  } = propertyData;

  // Extract address components
  const street = address.street || '';
  const city = address.city || '';
  const state = address.state || '';
  const zipCode = address.zipCode || '';

  // Clean and format street address
  let streetAddress = street.trim();
  
  // Extract street number if present
  const streetNumberMatch = streetAddress.match(/(\d+)/);
  const streetNumber = streetNumberMatch ? streetNumberMatch[1] : '';
  
  // Remove street number from street name for cleaner formatting
  if (streetNumber) {
    streetAddress = streetAddress.replace(/\d+/, '').trim();
  }

  // Determine property type label
  let typeLabel = '';
  switch (type.toLowerCase()) {
    case 'room':
      typeLabel = 'Room for rent';
      break;
    case 'studio':
      typeLabel = 'Studio flat for rent';
      break;
    case 'apartment':
      typeLabel = bedrooms > 1 ? 'Apartment for rent' : 'Studio for rent';
      break;
    case 'house':
      typeLabel = bedrooms > 1 ? 'House for rent' : 'Cottage for rent';
      break;
    case 'duplex':
      typeLabel = 'Duplex for rent';
      break;
    case 'penthouse':
      typeLabel = 'Penthouse for rent';
      break;
    default:
      typeLabel = 'Property for rent';
  }

  // Build location string
  let location = '';
  
  // If we have a street name, use it
  if (streetAddress) {
    location = streetAddress;
    if (streetNumber) {
      location += `, ${streetNumber}`;
    }
  } else if (city) {
    // Fallback to city if no street
    location = city;
  } else {
    // Final fallback
    location = 'Location TBD';
  }

  // Add city if different from street location
  if (city && city.toLowerCase() !== location.toLowerCase()) {
    location += `, ${city}`;
  }

  // Add state if available and different from city
  if (state && state.toLowerCase() !== city.toLowerCase()) {
    location += `, ${state}`;
  }

  // Generate the final title
  const title = `${typeLabel} in ${location}`;

  // Ensure title doesn't exceed maximum length (200 characters)
  if (title.length > 200) {
    // Truncate location if title is too long
    const maxLocationLength = 200 - typeLabel.length - 4; // 4 for " in "
    const truncatedLocation = location.substring(0, maxLocationLength);
    return `${typeLabel} in ${truncatedLocation}`;
  }

  return title;
}

/**
 * Generate a property title with additional details
 * @param propertyData - Property data object
 * @param includeDetails - Whether to include bedroom/bathroom details
 * @returns Generated title
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
  
  // Add bedroom/bathroom details for multi-bedroom properties
  if (bedrooms > 1) {
    const details = [];
    if (bedrooms > 0) {
      details.push(`${bedrooms} bed${bedrooms > 1 ? 's' : ''}`);
    }
    if (bathrooms > 0) {
      details.push(`${bathrooms} bath${bathrooms > 1 ? 's' : ''}`);
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
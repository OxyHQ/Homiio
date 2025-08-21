/**
 * Property Title Generator
 * Automatically generates property titles based on property details
 */

/**
 * Generate a property title based on property data
 * @param {Object} propertyData - Property data object
 * @param {string} format - Title format ('default', 'short', or 'large')
 * @returns {string} Generated title
 */
function generatePropertyTitle(propertyData, format = 'default') {
  const {
    type = 'apartment',
    address = {},
    bedrooms = 0,
    bathrooms = 0
  } = propertyData;

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
 * Generate a short property title (e.g., "Room in Sant Andreu")
 * @param {Object} propertyData - Property data object
 * @returns {string} Short generated title
 */
function generateShortPropertyTitle(propertyData) {
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
      typeLabel = 'Room';
      break;
    case 'studio':
      typeLabel = 'Studio';
      break;
    case 'apartment':
      typeLabel = bedrooms > 1 ? 'Apartment' : 'Studio';
      break;
    case 'house':
      typeLabel = bedrooms > 1 ? 'House' : 'Cottage';
      break;
    case 'duplex':
      typeLabel = 'Duplex';
      break;
    case 'penthouse':
      typeLabel = 'Penthouse';
      break;
    default:
      typeLabel = 'Property';
  }

  // Build location string - prefer neighborhood-like information
  let location = '';
  
  // First check if neighborhood is explicitly provided
  if (address.neighborhood) {
    location = address.neighborhood;
  } else if (streetAddress) {
    // Try to extract neighborhood from street name
    const streetParts = streetAddress.split(',').map(part => part.trim());
    
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
      const match = streetAddress.match(pattern);
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
        location = streetAddress;
      }
    }
  }
  
  // If no neighborhood found from street, fall back to city
  if (!location && city) {
    location = city;
  } else if (!location && state) {
    location = state;
  } else if (!location) {
    location = 'Location TBD';
  }

  // Generate the final title: "PropertyType in Location"
  const title = `${typeLabel} in ${location}`;

  // Ensure title doesn't exceed maximum length (100 characters for short format)
  if (title.length > 100) {
    const maxLocationLength = 100 - typeLabel.length - 4; // 4 for " in "
    const truncatedLocation = location.substring(0, maxLocationLength);
    return `${typeLabel} in ${truncatedLocation}`;
  }

  return title;
}

/**
 * Generate a large property title (e.g., "Apartment for rent in Carrer D'alí Bei, Barcelona, Barcelona")
 * @param {Object} propertyData - Property data object
 * @returns {string} Large generated title with full details
 */
function generateLargePropertyTitle(propertyData) {
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

  // Clean and format street address
  let streetAddress = street.trim();

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

  // Build location string with full details (including street numbers for large format)
  let location = '';
  
  // For large format, we can include neighborhood in the full address
  if (streetAddress && city) {
    // Keep street numbers for large format
    location = `${streetAddress}, ${city}`;
    if (state) {
      location += `, ${state}`;
    }
  } else if (city) {
    location = city;
    if (state) {
      location += `, ${state}`;
    }
  } else {
    location = state || 'Location TBD';
  }

  // Generate the final title: "PropertyType for rent in Location"
  const title = `${typeLabel} in ${location}`;

  // Ensure title doesn't exceed maximum length (200 characters for large format)
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
 * @param {Object} propertyData - Property data object
 * @param {boolean} includeDetails - Whether to include bedroom/bathroom details
 * @param {string} format - Title format ('default', 'short', or 'large')
 * @returns {string} Generated title
 */
function generateDetailedPropertyTitle(propertyData, includeDetails = false, format = 'default') {
  const baseTitle = generatePropertyTitle(propertyData, format);
  
  if (!includeDetails) {
    return baseTitle;
  }

  const { bedrooms = 0, bathrooms = 0 } = propertyData;
  
  // Add bedroom/bathroom details for multi-bedroom properties
  if (bedrooms > 0 || bathrooms > 0) {
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

module.exports = {
  generatePropertyTitle,
  generateDetailedPropertyTitle,
  generateShortPropertyTitle,
  generateLargePropertyTitle
}; 
import { generatePropertyTitle, TitleFormat } from './propertyTitleGenerator';
import { Property, PropertyImage } from '@homiio/shared-types';
import propertyPlaceholder from '@/assets/images/property_placeholder.jpg';

/**
 * Get the title for a property, generating it dynamically if needed
 * @param property - Property object
 * @param format - Title format ('default', 'short', or 'large')
 * @returns The property title
 */
export function getPropertyTitle(property: Property, format: TitleFormat = 'default'): string {
  return generatePropertyTitle({
    type: property.type,
    address: {
      ...property.address,
      // Use neighborhood field from address if available
      neighborhood: property.address.neighborhood,
    },
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
  }, format);
}

/**
 * Get a display-friendly property title for UI components
 * @param property - Property object
 * @returns The property title for display
 */
export function getDisplayPropertyTitle(property: Property): string {
  return getPropertyTitle(property, 'short');
}

/**
 * Get a detailed property title for property detail pages
 * @param property - Property object
 * @returns The detailed property title
 */
export function getDetailedPropertyTitle(property: Property): string {
  return getPropertyTitle(property, 'large');
}

/**
 * Get the image source for a property, falling back to placeholder if no image is available
 * This function can be used directly in Image source prop
 * @param property - Property object or images array (string[] or PropertyImage[])
 * @returns The property image source (string URL or imported image)
 */
export function getPropertyImageSource(
  property: Property | string[] | PropertyImage[] | undefined,
): any {
  if (!property) {
    return propertyPlaceholder;
  }

  // If property is an array of images
  if (Array.isArray(property)) {
    if (property.length === 0) {
      return propertyPlaceholder;
    }

    const firstImage = property[0];
    // Handle PropertyImage objects
    if (typeof firstImage === 'object' && firstImage !== null && 'url' in firstImage) {
      return { uri: (firstImage as PropertyImage).url };
    }
    // Handle string URLs
    if (typeof firstImage === 'string') {
      return { uri: firstImage };
    }

    return propertyPlaceholder;
  }

  // If property is a Property object
  if (property.images && property.images.length > 0) {
    const firstImage = property.images[0];
    // Handle PropertyImage objects
    if (typeof firstImage === 'object' && firstImage !== null && 'url' in firstImage) {
      return { uri: (firstImage as PropertyImage).url };
    }
    // Handle string URLs
    if (typeof firstImage === 'string') {
      return { uri: firstImage };
    }
  }

  return propertyPlaceholder;
}

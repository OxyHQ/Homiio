import { generatePropertyTitle } from './propertyTitleGenerator';
import { Property } from '@homiio/shared-types';
import propertyPlaceholder from '@/assets/images/property_placeholder.jpg';

/**
 * Get the title for a property, generating it dynamically if needed
 * @param property - Property object
 * @returns The property title
 */
export function getPropertyTitle(property: Property): string {
  return generatePropertyTitle({
    type: property.type,
    address: property.address,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms
  });
}

/**
 * Get a display-friendly property title for UI components
 * @param property - Property object
 * @returns The property title for display
 */
export function getPropertyDisplayTitle(property: Property): string {
  return getPropertyTitle(property);
}

/**
 * Get the image source for a property, falling back to placeholder if no image is available
 * This function can be used directly in Image source prop
 * @param property - Property object or images array
 * @returns The property image source (string URL or imported image)
 */
export function getPropertyImageSource(property: Property | string[] | undefined): any {
  if (!property) {
    return propertyPlaceholder;
  }
  
  // If property is an array of images
  if (Array.isArray(property)) {
    return property[0] ? { uri: property[0] } : propertyPlaceholder;
  }
  
  // If property is a Property object
  if (property.images && property.images.length > 0) {
    return { uri: property.images[0] };
  }
  
  return propertyPlaceholder;
} 
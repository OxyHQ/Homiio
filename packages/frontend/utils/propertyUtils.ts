import { generatePropertyTitle } from './propertyTitleGenerator';
import { Property } from '@/services/propertyService';

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
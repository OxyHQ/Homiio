/**
 * Property Title Generator
 * Automatically generates property titles based on property details with i18n support.
 * The pure location/composition logic lives in `@homiio/shared-types`; this module
 * layers i18next translations on top.
 */

import i18next from 'i18next';
import { PropertyType } from '@homiio/shared-types/common';
import {
  buildLargeTitleLocation,
  composeTitle,
  removePropertyNumber,
  resolveShortTitleLocation,
  SHORT_TITLE_MAX_LENGTH,
  LARGE_TITLE_MAX_LENGTH,
} from '@homiio/shared-types/utils/propertyTitle';

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

function translate(key: string): string {
  return i18next.t(key);
}

function translatedPropertyType(type: PropertyType): string {
  return translate(`properties.titles.types.${type}`);
}

function locationNotSpecified(): string {
  return translate('properties.titles.locationNotSpecified');
}

/**
 * Generate a short property title (e.g., "Room in Sant Andreu")
 * @param propertyData - Property data object
 * @returns Short generated title
 */
function generateShortPropertyTitle(propertyData: PropertyData): string {
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
function generateLargePropertyTitle(propertyData: PropertyData): string {
  const { type = PropertyType.APARTMENT, address = {} } = propertyData;

  const propertyType = translatedPropertyType(type);

  const forRentText = translate('properties.titles.forRent');

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
export function generatePropertyTitle(
  propertyData: PropertyData,
  format: TitleFormat = 'default',
): string {
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

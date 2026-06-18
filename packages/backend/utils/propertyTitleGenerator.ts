/**
 * Property Title Generator (backend, plain-English)
 *
 * Thin wrapper over the dependency-free core in `@homiio/shared-types`. The
 * backend has no i18n, so it supplies plain-English type labels and detail
 * wording and reuses the shared location/composition logic.
 */

import {
  buildLargeTitleLocation,
  buildTitleDetails,
  composeTitle,
  removePropertyNumber,
  resolveShortTitleLocation,
  SHORT_TITLE_MAX_LENGTH,
  LARGE_TITLE_MAX_LENGTH,
  type PropertyTitleFormat,
} from '@homiio/shared-types';

interface BackendPropertyAddress {
  street?: string;
}

interface BackendGeo {
  city?: string;
  region?: string;
  neighborhood?: string;
}

interface BackendPropertyData {
  type?: string;
  address?: BackendPropertyAddress;
  bedrooms?: number;
  bathrooms?: number;
  geo?: BackendGeo | null;
}

const FALLBACK_LOCATION = 'Location TBD';

function shortTypeLabel(type: string, bedrooms: number): string {
  switch (type.toLowerCase()) {
    case 'room':
      return 'Room';
    case 'studio':
      return 'Studio';
    case 'apartment':
      return bedrooms > 1 ? 'Apartment' : 'Studio';
    case 'house':
      return bedrooms > 1 ? 'House' : 'Cottage';
    case 'duplex':
      return 'Duplex';
    case 'penthouse':
      return 'Penthouse';
    default:
      return 'Property';
  }
}

function largeTypeLabel(type: string, bedrooms: number): string {
  switch (type.toLowerCase()) {
    case 'room':
      return 'Room for rent';
    case 'studio':
      return 'Studio flat for rent';
    case 'apartment':
      return bedrooms > 1 ? 'Apartment for rent' : 'Studio for rent';
    case 'house':
      return bedrooms > 1 ? 'House for rent' : 'Cottage for rent';
    case 'duplex':
      return 'Duplex for rent';
    case 'penthouse':
      return 'Penthouse for rent';
    default:
      return 'Property for rent';
  }
}

function generateShortPropertyTitle(propertyData: BackendPropertyData): string {
  const { type = 'apartment', address = {}, bedrooms = 0, geo = null } = propertyData;

  const street = (address.street || '').trim();
  const city = (geo && geo.city) || '';
  const state = (geo && geo.region) || '';
  const neighborhood = (geo && geo.neighborhood) || '';

  const streetWithoutNumber = street.replace(/\d+/, '').trim();

  const typeLabel = shortTypeLabel(type, bedrooms);
  const location = resolveShortTitleLocation(
    { neighborhood, streetWithoutNumber, city, state },
    FALLBACK_LOCATION,
  );

  return composeTitle(`${typeLabel} in`, location, SHORT_TITLE_MAX_LENGTH);
}

function generateLargePropertyTitle(propertyData: BackendPropertyData): string {
  const { type = 'apartment', address = {}, bedrooms = 0, geo = null } = propertyData;

  const street = (address.street || '').trim();
  const city = (geo && geo.city) || '';
  const state = (geo && geo.region) || '';

  const typeLabel = largeTypeLabel(type, bedrooms);
  const location = buildLargeTitleLocation({ street, city, state }, FALLBACK_LOCATION);

  return composeTitle(`${typeLabel} in`, location, LARGE_TITLE_MAX_LENGTH);
}

function generatePropertyTitle(
  propertyData: BackendPropertyData,
  format: PropertyTitleFormat = 'default',
): string {
  switch (format) {
    case 'large':
      return generateLargePropertyTitle(propertyData);
    case 'short':
    case 'default':
    default:
      return generateShortPropertyTitle(propertyData);
  }
}

function generateDetailedPropertyTitle(
  propertyData: BackendPropertyData,
  includeDetails = false,
  format: PropertyTitleFormat = 'default',
): string {
  const baseTitle = generatePropertyTitle(propertyData, format);
  if (!includeDetails) return baseTitle;

  const { bedrooms = 0, bathrooms = 0 } = propertyData;
  const details = buildTitleDetails(
    bedrooms,
    bathrooms,
    (count) => `${count} bed${count > 1 ? 's' : ''}`,
    (count) => `${count} bath${count > 1 ? 's' : ''}`,
  );

  return details ? `${baseTitle} - ${details}` : baseTitle;
}

export {
  generatePropertyTitle,
  generateDetailedPropertyTitle,
  generateShortPropertyTitle,
  generateLargePropertyTitle,
};

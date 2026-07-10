/**
 * Realtor.ca API helpers — form-encoded POST to `api2.realtor.ca`.
 */

import { REALTOR_CA_API_BASE } from './fixtures';

export type RealtorCaTransaction = 'rent' | 'sale';

export interface RealtorCaBBox {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

export function realtorCaSearchUrl(): string {
  return `${REALTOR_CA_API_BASE}/Listing.svc/PropertySearch_Post`;
}

export function realtorCaDetailUrl(referenceNumber: string): string {
  const params = new URLSearchParams({
    ReferenceNumber: referenceNumber,
    ApplicationId: '1',
    CultureId: '1',
  });
  return `${REALTOR_CA_API_BASE}/Listing.svc/PropertyDetails?${params.toString()}`;
}

export function realtorCaSourceUrl(id: string, addressText: string): string {
  const slug = addressText
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `https://www.realtor.ca/real-estate/${id}/${slug}`;
}

export function buildRealtorCaSearchBody(
  bbox: RealtorCaBBox,
  transaction: RealtorCaTransaction,
  page: number,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set('ZoomLevel', '11');
  params.set('LatitudeMax', String(bbox.latMax));
  params.set('LatitudeMin', String(bbox.latMin));
  params.set('LongitudeMax', String(bbox.lngMax));
  params.set('LongitudeMin', String(bbox.lngMin));
  params.set('Sort', '6-D');
  params.set('PropertyTypeGroupID', '1');
  params.set('TransactionTypeId', transaction === 'rent' ? '3' : '2');
  params.set('PropertySearchTypeId', '0');
  params.set('Currency', 'CAD');
  params.set('IncludeHiddenListings', 'false');
  params.set('RecordsPerPage', '50');
  params.set('CurrentPage', String(page));
  params.set('ApplicationId', '1');
  params.set('CultureId', '1');
  return params;
}

export function isRealtorCaApiChallenge(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed.length < 2) return true;
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) return true;
  if (/incapsula|access denied|pardon our interruption|_Incapsula_Resource/i.test(trimmed)) {
    return true;
  }
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null && !('Results' in parsed) && !('Id' in parsed)) {
        return true;
      }
    } catch {
      return true;
    }
  }
  return false;
}

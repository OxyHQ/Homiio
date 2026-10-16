/**
 * Listing tools → `domain/listings.ts` and `domain/places.ts`.
 *
 * The public reads run with the effective account as the VIEWER, exactly as the
 * optional Oxy auth sets `req.user` on the route, so the person's own listing
 * comes at owner precision and anyone else's at its published one (ADR 0003).
 * `getListing` does not record a view: an agent reading a listing is not the
 * person opening it.
 */

import {
  findNearbyListings,
  getListing,
  type ListingQuery,
  reportListing,
  searchListings,
} from '../../domain/listings';
import { resolveCity } from '../../domain/places';
import { asQuery, type HomiioToolHandlers, optionalString, requiredString } from './context';

/** The route's JSON body minus its envelope (`success`, `message`, `meta`). */
export function withoutEnvelope(body: Record<string, unknown>): Record<string, unknown> {
  const { success: _success, message: _message, meta: _meta, ...rest } = body;
  return rest;
}

export const LISTING_HANDLERS: HomiioToolHandlers = {
  async searchListings(input) {
    return withoutEnvelope(await searchListings(asQuery(input) as ListingQuery));
  },

  async findNearbyListings(input) {
    return withoutEnvelope(await findNearbyListings(asQuery(input) as ListingQuery));
  },

  async getListing(input, { accountId }) {
    const { listing } = await getListing(accountId, requiredString(input, 'propertyId'), {
      recordView: false,
    });
    return { data: listing };
  },

  async resolvePlace(input) {
    const resolution = await resolveCity(
      requiredString(input, 'city').trim(),
      optionalString(input, 'state')?.trim() || undefined,
    );
    if (resolution.status === 'resolved') {
      return { status: 'resolved', place: resolution.place, location: resolution.selection };
    }
    if (resolution.reason === 'ambiguous') {
      return { status: 'ambiguous', candidates: resolution.candidates };
    }
    return { status: 'not_found' };
  },

  async reportListing(input, { accountId }) {
    const outcome = await reportListing(accountId, requiredString(input, 'propertyId'), {
      reason: input.reason,
      details: input.details,
      contactEmail: input.contactEmail,
    });
    return { data: outcome.report, alreadyReported: outcome.status === 'existing' };
  },
};

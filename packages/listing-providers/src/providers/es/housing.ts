/**
 * Housing-only guards for general classifieds portals.
 *
 * Re-exports the shared chokepoint in {@link ../../classifieds} so existing
 * ES/FR/IT imports keep resolving.
 */

export {
  NonHousingListingError,
  isHousingCategory,
  isHousingCategoryUrl,
  assertHousingListing,
  type HousingSignalInput,
} from '../../classifieds';

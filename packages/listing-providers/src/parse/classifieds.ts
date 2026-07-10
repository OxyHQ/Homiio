/**
 * Re-export the shared classifieds chokepoint.
 *
 * Prefer importing from `../../classifieds` (package root). This path exists so
 * `parse/*` consumers stay consistent with other parse helpers.
 */

export {
  NonHousingListingError,
  isHousingCategory,
  isHousingCategoryUrl,
  assertHousingListing,
  type HousingSignalInput,
} from '../classifieds';

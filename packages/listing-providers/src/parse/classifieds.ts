/**
 * Re-export the shared classifieds chokepoint for `parse/*` consumers.
 */

export {
  NonHousingListingError,
  isHousingCategory,
  isHousingCategoryUrl,
  assertHousingListing,
  type HousingSignalInput,
} from '../classifieds';

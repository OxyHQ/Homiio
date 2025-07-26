import { useRecentlyViewedStore } from '@/store/recentlyViewedStore';
import type { Property } from '@homiio/shared-types';

/**
 * Add a property to the recently viewed list
 * This function can be called from anywhere in the app
 * @param property - The property to add
 */
export function addToRecentlyViewed(property: Property) {
  useRecentlyViewedStore.getState().addPropertyToRecentlyViewed(property);
}

/**
 * Remove a property from the recently viewed list
 * @param propertyId - The ID of the property to remove
 */
export function removeFromRecentlyViewed(propertyId: string) {
  useRecentlyViewedStore.getState().removePropertyFromRecentlyViewed(propertyId);
}

/**
 * Clear all recently viewed properties
 */
export function clearRecentlyViewedProperties() {
  useRecentlyViewedStore.getState().clearRecentlyViewed();
}

/**
 * Check if a property is in the recently viewed list
 * @param propertyId - The ID of the property to check
 * @returns True if the property is in the recently viewed list
 */
export function isInRecentlyViewed(propertyId: string): boolean {
  const state = useRecentlyViewedStore.getState();
  return state.properties.some((p: Property) => (p._id || p.id || '') === propertyId);
}

/**
 * Get the recently viewed properties from the store
 * @returns Array of recently viewed properties
 */
export function getRecentlyViewedProperties(): Property[] {
  const state = useRecentlyViewedStore.getState();
  return state.properties;
} 
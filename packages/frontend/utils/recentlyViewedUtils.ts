import { store } from '@/store/store';
import { addPropertyToRecentlyViewed, removePropertyFromRecentlyViewed, clearRecentlyViewed } from '@/store/reducers/recentlyViewedReducer';
import type { Property } from '@/services/propertyService';

/**
 * Add a property to the recently viewed list
 * This function can be called from anywhere in the app
 * @param property - The property to add
 */
export function addToRecentlyViewed(property: Property) {
  store.dispatch(addPropertyToRecentlyViewed(property));
}

/**
 * Remove a property from the recently viewed list
 * @param propertyId - The ID of the property to remove
 */
export function removeFromRecentlyViewed(propertyId: string) {
  store.dispatch(removePropertyFromRecentlyViewed(propertyId));
}

/**
 * Clear all recently viewed properties
 */
export function clearRecentlyViewedProperties() {
  store.dispatch(clearRecentlyViewed());
}

/**
 * Check if a property is in the recently viewed list
 * @param propertyId - The ID of the property to check
 * @returns True if the property is in the recently viewed list
 */
export function isInRecentlyViewed(propertyId: string): boolean {
  const state = store.getState();
  return state.recentlyViewed.properties.some(p => (p._id || p.id) === propertyId);
}

/**
 * Get the recently viewed properties from the store
 * @returns Array of recently viewed properties
 */
export function getRecentlyViewedProperties(): Property[] {
  const state = store.getState();
  return state.recentlyViewed.properties;
} 
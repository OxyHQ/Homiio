import { useRecentlyViewedStore } from '@/store/recentlyViewedStore';
import type { Property } from '@homiio/shared-types';
import { RecentlyViewedType } from '@homiio/shared-types';

/**
 * Add a property to the recently viewed list
 * This function can be called from anywhere in the app
 * @param property - The property to add
 */
export function addToRecentlyViewed(property: Property) {
  const propertyId = property._id || property.id;
  if (propertyId) {
    useRecentlyViewedStore.getState().addItem(propertyId, RecentlyViewedType.PROPERTY, property);
  }
}

/**
 * Remove a property from the recently viewed list
 * @param propertyId - The ID of the property to remove
 */
export function removeFromRecentlyViewed(propertyId: string) {
  useRecentlyViewedStore.getState().removeItem(propertyId);
}

/**
 * Clear all recently viewed properties
 */
export function clearRecentlyViewedProperties() {
  useRecentlyViewedStore.getState().clearAll();
}

/**
 * Check if a property is in the recently viewed list
 * @param propertyId - The ID of the property to check
 * @returns True if the property is in the recently viewed list
 */
export function isInRecentlyViewed(propertyId: string): boolean {
  const state = useRecentlyViewedStore.getState();
  return state.items.some((item) => item.id === propertyId && item.type === RecentlyViewedType.PROPERTY);
}

/**
 * Get the recently viewed properties from the store
 * @returns Array of recently viewed properties
 */
export function getRecentlyViewedProperties(): Property[] {
  const state = useRecentlyViewedStore.getState();
  return state.getRecentProperties();
}

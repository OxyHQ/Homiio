import { useRecentlyViewedStore } from '@/store/recentlyViewedStore';
import { useEffect } from 'react';
import { useOxy } from '@oxyhq/services';
import type { Property } from '@homiio/shared-types';

export function useRecentlyViewed() {
    const { 
        items,
        addItem,
        removeItem,
        clearAll,
        getRecentProperties
    } = useRecentlyViewedStore();
    const { oxyServices, activeSessionId } = useOxy();

    // Debug logging
    console.log('useRecentlyViewed Hook Debug:', {
        oxyServices: !!oxyServices,
        activeSessionId: !!activeSessionId,
        propertiesCount: getRecentProperties().length,
    });

    const properties = getRecentProperties();

    const refetch = () => {
        // Not implemented in Zustand store - would need to fetch from API
        console.log('useRecentlyViewed: Refetch not implemented in Zustand store');
    };

    const clear = () => {
        console.log('useRecentlyViewed: Clearing recently viewed properties');
        clearAll();
    };

    const addProperty = (property: Property) => {
        const propertyId = property._id || property.id;
        console.log('useRecentlyViewed: Adding property to recently viewed:', propertyId);
        if (propertyId) {
            addItem(propertyId, 'property', property);
        }
    };

    const removeProperty = (propertyId: string) => {
        console.log('useRecentlyViewed: Removing property from recently viewed:', propertyId);
        removeItem(propertyId);
    };

    return {
        properties,
        isLoading: false, // Not implemented in Zustand store
        error: null, // Not implemented in Zustand store
        refetch,
        clear,
        addProperty,
        removeProperty,
    };
} 
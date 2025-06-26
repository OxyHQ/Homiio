import { useSelector, useDispatch } from 'react-redux';
import { useEffect } from 'react';
import { 
  fetchRecentlyViewedProperties, 
  clearRecentlyViewedProperties,
  addPropertyToRecentlyViewed, 
  removePropertyFromRecentlyViewed 
} from '@/store/reducers/recentlyViewedReducer';
import { useOxy } from '@oxyhq/services';
import type { RootState, AppDispatch } from '@/store/store';
import type { Property } from '@/services/propertyService';

export function useRecentlyViewed() {
    const dispatch = useDispatch<AppDispatch>();
    const { oxyServices, activeSessionId } = useOxy();
    
    const { properties, isLoading, error } = useSelector((state: RootState) => state.recentlyViewed);

    // Debug logging
    console.log('useRecentlyViewed Hook Debug:', {
        oxyServices: !!oxyServices,
        activeSessionId: !!activeSessionId,
        propertiesCount: properties?.length || 0,
        isLoading,
        error: error || null
    });

    // Fetch recently viewed properties when hook is used and user is authenticated
    useEffect(() => {
        if (oxyServices && activeSessionId) {
            console.log('useRecentlyViewed: Fetching recently viewed properties');
            dispatch(fetchRecentlyViewedProperties({ oxyServices, activeSessionId }));
        } else {
            console.log('useRecentlyViewed: Not fetching - missing oxyServices or activeSessionId');
        }
    }, [dispatch, oxyServices, activeSessionId]);

    const refetch = () => {
        if (oxyServices && activeSessionId) {
            console.log('useRecentlyViewed: Refetching recently viewed properties');
            dispatch(fetchRecentlyViewedProperties({ oxyServices, activeSessionId }));
        }
    };

    const clear = () => {
        if (oxyServices && activeSessionId) {
            console.log('useRecentlyViewed: Clearing recently viewed properties');
            dispatch(clearRecentlyViewedProperties({ oxyServices, activeSessionId }));
        } else {
            console.log('useRecentlyViewed: Cannot clear - missing authentication');
        }
    };

    const addProperty = (property: Property) => {
        console.log('useRecentlyViewed: Adding property to recently viewed:', property._id || property.id);
        dispatch(addPropertyToRecentlyViewed(property));
    };

    const removeProperty = (propertyId: string) => {
        console.log('useRecentlyViewed: Removing property from recently viewed:', propertyId);
        dispatch(removePropertyFromRecentlyViewed(propertyId));
    };

    return {
        properties,
        isLoading,
        error,
        refetch,
        clear,
        addProperty,
        removeProperty,
    };
} 
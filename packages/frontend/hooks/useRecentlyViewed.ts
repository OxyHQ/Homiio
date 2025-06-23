import { useSelector, useDispatch } from 'react-redux';
import { useEffect } from 'react';
import { fetchRecentlyViewedProperties, clearRecentlyViewed, addPropertyToRecentlyViewed, removePropertyFromRecentlyViewed } from '@/store/reducers/recentlyViewedReducer';
import { useOxy } from '@oxyhq/services';
import type { RootState, AppDispatch } from '@/store/store';
import type { Property } from '@/services/propertyService';

export function useRecentlyViewed() {
    const dispatch = useDispatch<AppDispatch>();
    const { oxyServices, activeSessionId } = useOxy();
    
    const { properties, isLoading, error } = useSelector((state: RootState) => state.recentlyViewed);

    // Fetch recently viewed properties when hook is used and user is authenticated
    useEffect(() => {
        if (oxyServices && activeSessionId) {
            dispatch(fetchRecentlyViewedProperties({ oxyServices, activeSessionId }));
        }
    }, [dispatch, oxyServices, activeSessionId]);

    const refetch = () => {
        if (oxyServices && activeSessionId) {
            dispatch(fetchRecentlyViewedProperties({ oxyServices, activeSessionId }));
        }
    };

    const clear = () => {
        dispatch(clearRecentlyViewed());
    };

    const addProperty = (property: Property) => {
        dispatch(addPropertyToRecentlyViewed(property));
    };

    const removeProperty = (propertyId: string) => {
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
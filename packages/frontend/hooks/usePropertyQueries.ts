import { useCallback } from 'react';
import { usePropertyStore, usePropertySelectors } from '@/store/propertyStore';
import { propertyService } from '@/services/propertyService';
import type { PropertyAreaInsights, PropertyNearbyServices } from '@homiio/shared-types';
import { toast } from '@oxy.so/bloom/toast';
import i18next from 'i18next';
import { useQuery } from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services';

/** Area-scale lookups (price insights, nearby services) are comparatively
 *  expensive to compute server-side and change slowly (they aggregate a whole
 *  neighborhood / query OpenStreetMap), so we keep them fresh far longer than
 *  the per-property detail query. Shared by `useAreaInsights` +
 *  `useNearbyServices`. */
const AREA_INSIGHTS_STALE_TIME = 1000 * 60 * 5;
const AREA_INSIGHTS_GC_TIME = 1000 * 60 * 30;

/**
 * One property, straight from React Query.
 *
 * Read-only, so there is no Zustand copy: it used to mirror every fetch into
 * `propertyStore.currentProperty` from an effect and fall back to that copy,
 * which made a card still loading property B show whichever property was
 * fetched LAST anywhere in the app. The cache is keyed by id, so nothing else
 * is needed.
 */
export const useProperty = (id: string) => {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['property', id],
    queryFn: async () => propertyService.getPropertyById(id),
    enabled: Boolean(id),
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
  });

  return {
    property: data ?? null,
    loading: isLoading,
    error: error instanceof Error ? error.message : null,
    loadProperty: refetch,
  };
};

/** A property's stats, straight from React Query (keyed by id; no store copy). */
export const usePropertyStats = (id: string) => {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['propertyStats', id],
    queryFn: async () => propertyService.getPropertyStats(id),
    enabled: Boolean(id),
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
  });

  return {
    stats: data ?? null,
    loading: isLoading,
    error: error instanceof Error ? error.message : null,
    loadStats: refetch,
  };
};

/**
 * Area price-insights for a property (price-transparency block on the detail
 * screen). Read-only, so it lives entirely in React Query — no Zustand sync.
 * Fails soft: callers hide the section on `error` and render a graceful empty
 * state when `sampleSize === 0`.
 */
export const useAreaInsights = (propertyId: string) => {
  const { data, isLoading, error, refetch } = useQuery<PropertyAreaInsights>({
    queryKey: ['areaInsights', propertyId],
    queryFn: async () => propertyService.getAreaInsights(propertyId),
    enabled: Boolean(propertyId),
    staleTime: AREA_INSIGHTS_STALE_TIME,
    gcTime: AREA_INSIGHTS_GC_TIME,
  });

  return {
    insights: data ?? null,
    loading: isLoading,
    error: error instanceof Error ? error.message : null,
    refetch,
  };
};

/**
 * Everyday services near a property ("What's nearby" block on the detail
 * screen). Read-only, so it lives entirely in React Query — no Zustand sync.
 * Fails soft: the section hides itself on `error` and treats a `partial`
 * all-absent payload as "unknown" rather than "nothing nearby".
 */
export const useNearbyServices = (propertyId: string) => {
  const { data, isLoading, error, refetch } = useQuery<PropertyNearbyServices>({
    queryKey: ['nearbyServices', propertyId],
    queryFn: async () => propertyService.getNearbyServices(propertyId),
    enabled: Boolean(propertyId),
    staleTime: AREA_INSIGHTS_STALE_TIME,
    gcTime: AREA_INSIGHTS_GC_TIME,
  });

  return {
    nearbyServices: data ?? null,
    loading: isLoading,
    error: error instanceof Error ? error.message : null,
    refetch,
  };
};

export const useDeleteProperty = () => {
  const { loading, error } = usePropertySelectors();
  const { setLoading, setError } = usePropertyStore();

  const deletePropertyHandler = useCallback(
    async (id: string) => {
      try {
        setLoading('delete', true);
        setError(null);

        // Use propertyService instead of propertyApi
        await propertyService.deleteProperty(id);

        toast.success(i18next.t('property.toast.deleteSuccess'));
      } catch (error: any) {
        const errorMessage =
          error instanceof Error ? error.message : i18next.t('property.toast.deleteFailed');
        setError(errorMessage);
        toast.error(errorMessage);
        throw error;
      } finally {
        setLoading('delete', false);
      }
    },
    [setLoading, setError],
  );

  return {
    deleteProperty: deletePropertyHandler,
    loading: loading.delete,
    error,
  };
};

// Hook for the authenticated user's owned properties (session oxyUserId)
export const useUserProperties = () => {
  const { oxyServices, activeSessionId } = useOxy();
  const isAuthed = Boolean(oxyServices && activeSessionId);

  const query = useQuery({
    queryKey: ['my-properties'],
    queryFn: () => propertyService.getMyProperties(),
    enabled: isAuthed,
    staleTime: 1000 * 60,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
};

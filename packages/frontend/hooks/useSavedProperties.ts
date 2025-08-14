import { useCallback } from 'react';
import { useSavedPropertiesStore } from '@/store/savedPropertiesStore';
import { Property } from '@homiio/shared-types';
import { useOxy } from '@oxyhq/services';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

export const useSavedProperties = () => {
  const { properties, isLoading, error } = useSavedPropertiesStore();
  const { setProperties, setLoading, setError, addProperty, removeProperty } =
    useSavedPropertiesStore();
  const { oxyServices, activeSessionId } = useOxy();
  const queryClient = useQueryClient();

  const loadSavedProperties = useCallback(async () => {
    if (!oxyServices || !activeSessionId) return;

    try {
      setLoading(true);
      setError(null);

      const savedPropertyService = await import('@/services/savedPropertyService');
      const response = await queryClient.fetchQuery({
        queryKey: ['savedProperties'],
        queryFn: async () =>
          savedPropertyService.default.getSavedProperties(oxyServices, activeSessionId),
        staleTime: 1000 * 30,
        gcTime: 1000 * 60 * 10,
      });

      setProperties(response.properties || []);
    } catch (error: any) {
      setError(error.message || 'Failed to load saved properties');
      toast.error('Failed to load saved properties');
    } finally {
      setLoading(false);
    }
  }, [setProperties, setLoading, setError, oxyServices, activeSessionId, queryClient]);

  const saveProperty = useCallback(
    async (property: Property) => {
      if (!oxyServices || !activeSessionId) return;

      try {
        setLoading(true);
        setError(null);

        const savedPropertyService = await import('@/services/savedPropertyService');
        await savedPropertyService.default.saveProperty(
          property._id,
          undefined,
          oxyServices,
          activeSessionId,
        );

        addProperty(property);
        toast.success('Property saved successfully');
        await queryClient.invalidateQueries({ queryKey: ['savedProperties'] });
      } catch (error: any) {
        setError(error.message || 'Failed to save property');
        toast.error('Failed to save property');
      } finally {
        setLoading(false);
      }
    },
    [addProperty, setLoading, setError, oxyServices, activeSessionId, queryClient],
  );

  const unsaveProperty = useCallback(
    async (propertyId: string) => {
      if (!oxyServices || !activeSessionId) return;

      try {
        setLoading(true);
        setError(null);

        const savedPropertyService = await import('@/services/savedPropertyService');
        await savedPropertyService.default.unsaveProperty(propertyId, oxyServices, activeSessionId);

        removeProperty(propertyId);
        toast.success('Property removed from saved list');
        await queryClient.invalidateQueries({ queryKey: ['savedProperties'] });
      } catch (error: any) {
        setError(error.message || 'Failed to remove property');
        toast.error('Failed to remove property');
      } finally {
        setLoading(false);
      }
    },
    [removeProperty, setLoading, setError, oxyServices, activeSessionId, queryClient],
  );

  const isPropertySaved = useCallback(
    (propertyId: string) => {
      return properties.some(
        (property) => property._id === propertyId || property.id === propertyId,
      );
    },
    [properties],
  );

  return {
    savedProperties: properties,
    isLoading,
    error,
    loadSavedProperties,
    saveProperty,
    unsaveProperty,
    isPropertySaved,
  };
};

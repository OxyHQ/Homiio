/**
 * OxyServices-based Property Hooks
 * 
 * This file provides React Query hooks that use OxyServices for authentication
 * instead of the refresh token approach. These hooks should be used for property
 * operations to avoid the "No refresh token available" error.
 * 
 * Usage:
 * ```typescript
 * import { useOxyCreateProperty } from '@/hooks/useOxyPropertyQueries';
 * import { useOxy } from '@oxyhq/services';
 * 
 * const { oxyServices, activeSessionId } = useOxy();
 * const createPropertyMutation = useOxyCreateProperty(oxyServices, activeSessionId);
 * 
 * // Create property
 * createPropertyMutation.mutate(propertyData);
 * ```
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { OxyServices } from '@oxyhq/services';
import { oxyPropertyService } from '@/services/oxyPropertyService';
import { CreatePropertyData, Property } from '@/services/propertyService';
import { toast } from 'sonner';
import { propertyKeys } from './usePropertyQueries';

/**
 * Hook for creating properties using OxyServices authentication
 * 
 * This replaces useCreateProperty for authenticated property creation
 * and should be used to avoid refresh token issues.
 */
export function useOxyCreateProperty(
  oxyServices?: OxyServices,
  activeSessionId?: string
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreatePropertyData) => {
      if (!oxyServices || !activeSessionId) {
        throw new Error('Authentication required. Please sign in with OxyServices.');
      }
      return oxyPropertyService.createProperty(data, oxyServices, activeSessionId);
    },
    onSuccess: () => {
      // Invalidate properties list to refresh the cache
      queryClient.invalidateQueries({ queryKey: propertyKeys.lists() });
      toast.success('Property created successfully');
    },
    onError: (error: any) => {
      console.error('Property creation failed:', error);
      toast.error(error.message || 'Failed to create property');
    },
  });
}

/**
 * Hook for updating properties using OxyServices authentication
 */
export function useOxyUpdateProperty(
  oxyServices?: OxyServices,
  activeSessionId?: string
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CreatePropertyData> }) => {
      if (!oxyServices || !activeSessionId) {
        throw new Error('Authentication required. Please sign in with OxyServices.');
      }
      return oxyPropertyService.updateProperty(id, data, oxyServices, activeSessionId);
    },
    onSuccess: (data: Property, variables: { id: string; data: Partial<CreatePropertyData> }) => {
      queryClient.invalidateQueries({ queryKey: propertyKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: propertyKeys.lists() });
      toast.success('Property updated successfully');
    },
    onError: (error: any) => {
      console.error('Property update failed:', error);
      toast.error(error.message || 'Failed to update property');
    },
  });
}

/**
 * Hook for deleting properties using OxyServices authentication
 */
export function useOxyDeleteProperty(
  oxyServices?: OxyServices,
  activeSessionId?: string
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!oxyServices || !activeSessionId) {
        throw new Error('Authentication required. Please sign in with OxyServices.');
      }
      return oxyPropertyService.deleteProperty(id, oxyServices, activeSessionId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: propertyKeys.lists() });
      toast.success('Property deleted successfully');
    },
    onError: (error: any) => {
      console.error('Property deletion failed:', error);
      toast.error(error.message || 'Failed to delete property');
    },
  });
}
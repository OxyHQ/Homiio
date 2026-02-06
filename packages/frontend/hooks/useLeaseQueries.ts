import { useCallback, useState, useEffect } from 'react';
import { useLeaseStore, useLeaseSelectors } from '@/store/leaseStore';
import { useOxy } from '@oxyhq/services';
import { toast } from 'sonner';
import { leaseService, Lease, LeaseFilters } from '@/services/leaseService';

// Lease Zustand Hook
export const useUserLeases = () => {
  const { leases, isLoading, error } = useLeaseSelectors();
  const { setLeases, setLoading, setError } = useLeaseStore();
  const { oxyServices, activeSessionId } = useOxy();

  const fetchLeases = useCallback(
    async (filters?: LeaseFilters) => {
      if (!oxyServices || !activeSessionId) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await leaseService.getLeases(filters, oxyServices, activeSessionId);

        setLeases(response.leases || []);
      } catch (error: any) {
        setError(error.message || 'Failed to fetch leases');
      } finally {
        setLoading(false);
      }
    },
    [oxyServices, activeSessionId, setLeases, setLoading, setError],
  );

  // Load leases on mount
  useEffect(() => {
    fetchLeases();
  }, [fetchLeases]);

  return {
    data: {
      leases,
    },
    isLoading,
    error,
    refetch: () => fetchLeases(),
  };
};

// Hook to check if user has rental properties
export const useHasRentalProperties = () => {
  const { data, isLoading } = useUserLeases();

  return {
    hasRentalProperties: data?.leases && data.leases.length > 0,
    isLoading,
  };
};

import { useCallback, useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '@/store/store';
import { useOxy } from '@oxyhq/services';
import { toast } from 'sonner';
import { leaseService, Lease, LeaseFilters } from '@/services/leaseService';

// Lease Redux Hook
export const useUserLeases = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();
  
  const [leases, setLeases] = useState<Lease[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLeases = useCallback(async (filters?: LeaseFilters) => {
    if (!oxyServices || !activeSessionId) {
      console.log('OxyServices not available - cannot fetch leases');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await leaseService.getLeases(filters, oxyServices, activeSessionId);
      
      setLeases(response.leases || []);
      console.log('Successfully fetched user leases');
    } catch (error: any) {
      console.error('Error fetching leases:', error);
      setError(error.message || 'Failed to fetch leases');
    } finally {
      setIsLoading(false);
    }
  }, [oxyServices, activeSessionId]);

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
import { useCallback } from 'react';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '@/store/store';
import { leaseService } from '@/services/leaseService';
import { useOxy } from '@oxyhq/services';
import { useActiveProfile } from '@/hooks/useProfileQueries';
import { toast } from 'sonner';
import type { Lease } from '@/services/leaseService';

export const leaseKeys = {
  all: () => ['leases'] as const,
  lists: () => [...leaseKeys.all(), 'list'] as const,
  list: (filters: any) => [...leaseKeys.lists(), filters] as const,
  details: () => [...leaseKeys.all(), 'detail'] as const,
  detail: (id: string) => [...leaseKeys.details(), id] as const,
  userLeases: () => ['leases', 'user'] as const,
  activeLeases: () => ['leases', 'active'] as const,
  pendingLeases: () => ['leases', 'pending'] as const,
  profileLeases: (profileId: string) => ['leases', 'profile', profileId] as const,
};

// Hook to get user leases
export function useUserLeases() {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();
  const { data: activeProfile } = useActiveProfile();
  
  const fetchUserLeases = useCallback(async () => {
    if (!oxyServices || !activeSessionId || !activeProfile) {
      return { leases: [], total: 0, page: 1, totalPages: 1 };
    }

    try {
      console.log('Fetching user leases with OxyServices authentication');
      const response = await leaseService.getLeases({}, oxyServices, activeSessionId);
      console.log(`Successfully fetched ${response.leases.length} user leases`);
      return response;
    } catch (error) {
      console.error('Error fetching user leases:', error);
      return { leases: [], total: 0, page: 1, totalPages: 1 };
    }
  }, [oxyServices, activeSessionId, activeProfile]);

  return {
    data: { leases: [], total: 0, page: 1, totalPages: 1 },
    isLoading: false,
    error: null,
    refetch: fetchUserLeases,
  };
}

// Hook to get active leases
export function useActiveLeases() {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();
  const { data: activeProfile } = useActiveProfile();
  
  const fetchActiveLeases = useCallback(async () => {
    if (!oxyServices || !activeSessionId || !activeProfile) {
      return [];
    }

    try {
      console.log('Fetching active leases with OxyServices authentication');
      const leases = await leaseService.getActiveLeases(oxyServices, activeSessionId);
      console.log(`Successfully fetched ${leases.length} active leases`);
      return leases;
    } catch (error) {
      console.error('Error fetching active leases:', error);
      return [];
    }
  }, [oxyServices, activeSessionId, activeProfile]);

  return {
    data: [],
    isLoading: false,
    error: null,
    refetch: fetchActiveLeases,
  };
}

// Hook to get pending leases
export function usePendingLeases() {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();
  const { data: activeProfile } = useActiveProfile();
  
  const fetchPendingLeases = useCallback(async () => {
    if (!oxyServices || !activeSessionId || !activeProfile) {
      return [];
    }

    try {
      console.log('Fetching pending leases with OxyServices authentication');
      const leases = await leaseService.getPendingSignatureLeases(oxyServices, activeSessionId);
      console.log(`Successfully fetched ${leases.length} pending leases`);
      return leases;
    } catch (error) {
      console.error('Error fetching pending leases:', error);
      return [];
    }
  }, [oxyServices, activeSessionId, activeProfile]);

  return {
    data: [],
    isLoading: false,
    error: null,
    refetch: fetchPendingLeases,
  };
}

// Hook to get lease by ID
export function useLeaseById(leaseId: string | undefined | null) {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();
  
  const fetchLease = useCallback(async () => {
    if (!leaseId || !oxyServices || !activeSessionId) {
      return null;
    }

    try {
      console.log(`Fetching lease ${leaseId} with OxyServices authentication`);
      const lease = await leaseService.getLease(leaseId, oxyServices, activeSessionId);
      console.log('Successfully fetched lease:', lease);
      return lease;
    } catch (error) {
      console.error('Error fetching lease:', error);
      return null;
    }
  }, [leaseId, oxyServices, activeSessionId]);

  return {
    data: null,
    isLoading: false,
    error: null,
    refetch: fetchLease,
  };
}

// Hook to create a lease
export function useCreateLease() {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();

  const createLease = useCallback(async (leaseData: any) => {
    if (!oxyServices || !activeSessionId) {
      throw new Error('OxyServices not available');
    }

    try {
      console.log('Creating lease with OxyServices authentication');
      const lease = await leaseService.createLease(leaseData, oxyServices, activeSessionId);
      console.log('Successfully created lease:', lease);
      
      toast.success('Lease created successfully!');
      return lease;
    } catch (error: any) {
      console.error('Error creating lease:', error);
      toast.error('Failed to create lease', {
        description: error.message || 'Please try again.',
      });
      throw error;
    }
  }, [oxyServices, activeSessionId]);

  return {
    createLease,
    isLoading: false,
  };
}

// Hook to update a lease
export function useUpdateLease() {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();

  const updateLease = useCallback(async ({ leaseId, updateData }: { leaseId: string; updateData: any }) => {
    if (!oxyServices || !activeSessionId) {
      throw new Error('OxyServices not available');
    }

    try {
      console.log(`Updating lease ${leaseId} with OxyServices authentication`);
      const lease = await leaseService.updateLease(leaseId, updateData, oxyServices, activeSessionId);
      console.log('Successfully updated lease:', lease);
      
      toast.success('Lease updated successfully!');
      return lease;
    } catch (error: any) {
      console.error('Error updating lease:', error);
      toast.error('Failed to update lease', {
        description: error.message || 'Please try again.',
      });
      throw error;
    }
  }, [oxyServices, activeSessionId]);

  return {
    updateLease,
    isLoading: false,
  };
}

// Hook to delete a lease
export function useDeleteLease() {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();

  const deleteLease = useCallback(async (leaseId: string) => {
    if (!oxyServices || !activeSessionId) {
      throw new Error('OxyServices not available');
    }

    try {
      console.log(`Deleting lease ${leaseId} with OxyServices authentication`);
      await leaseService.deleteLease(leaseId, oxyServices, activeSessionId);
      console.log(`Successfully deleted lease ${leaseId}`);
      
      toast.success('Lease deleted successfully!');
    } catch (error: any) {
      console.error('Error deleting lease:', error);
      toast.error('Failed to delete lease', {
        description: error.message || 'Please try again.',
      });
      throw error;
    }
  }, [oxyServices, activeSessionId]);

  return {
    deleteLease,
    isLoading: false,
  };
}

// Hook to sign a lease
export function useSignLease() {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();

  const signLease = useCallback(async (leaseId: string, signature: string, acceptTerms: boolean) => {
    if (!oxyServices || !activeSessionId) {
      throw new Error('OxyServices not available');
    }

    try {
      console.log(`Signing lease ${leaseId} with OxyServices authentication`);
      const lease = await leaseService.signLease(leaseId, signature, acceptTerms, oxyServices, activeSessionId);
      console.log(`Successfully signed lease ${leaseId}`);
      
      toast.success('Lease signed successfully!');
      return lease;
    } catch (error: any) {
      console.error('Error signing lease:', error);
      toast.error('Failed to sign lease', {
        description: error.message || 'Please try again.',
      });
      throw error;
    }
  }, [oxyServices, activeSessionId]);

  return {
    signLease,
    isLoading: false,
  };
} 
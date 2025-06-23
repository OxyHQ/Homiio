import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

// Hook to get user's leases based on current profile
export function useUserLeases(filters?: any) {
  const { oxyServices, activeSessionId } = useOxy();
  const { data: activeProfile, isLoading: profileLoading } = useActiveProfile();
  
  return useQuery<{ leases: Lease[]; total: number; page: number; totalPages: number }>({
    queryKey: leaseKeys.list({ ...filters, profileId: activeProfile?.id }),
    queryFn: async () => {
      if (!oxyServices || !activeSessionId || !activeProfile?.id) {
        console.log('OxyServices or active profile not available - returning empty leases');
        return { leases: [], total: 0, page: 1, totalPages: 1 };
      }

      try {
        console.log(`Fetching user leases for profile ${activeProfile.id} with OxyServices authentication`);
        const response = await leaseService.getLeases({ ...filters, profileId: activeProfile.id });
        console.log(`Successfully fetched ${response.leases.length} leases for profile ${activeProfile.id}`);
        return response;
      } catch (error) {
        console.error('Error fetching user leases:', error);
        return { leases: [], total: 0, page: 1, totalPages: 1 };
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!(oxyServices && activeSessionId && activeProfile?.id && !profileLoading),
  });
}

// Hook to get active leases based on current profile
export function useActiveLeases() {
  const { oxyServices, activeSessionId } = useOxy();
  const { data: activeProfile, isLoading: profileLoading } = useActiveProfile();
  
  return useQuery<Lease[]>({
    queryKey: leaseKeys.activeLeases(),
    queryFn: async () => {
      if (!oxyServices || !activeSessionId || !activeProfile?.id) {
        console.log('OxyServices or active profile not available - returning empty active leases');
        return [];
      }

      try {
        console.log(`Fetching active leases for profile ${activeProfile.id} with OxyServices authentication`);
        const leases = await leaseService.getActiveLeases();
        // Filter leases by current profile (as tenant or landlord)
        const profileLeases = leases.filter(lease => 
          lease.tenantId === activeProfile.id || lease.landlordId === activeProfile.id
        );
        console.log(`Successfully fetched ${profileLeases.length} active leases for profile ${activeProfile.id}`);
        return profileLeases;
      } catch (error) {
        console.error('Error fetching active leases:', error);
        return [];
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!(oxyServices && activeSessionId && activeProfile?.id && !profileLoading),
  });
}

// Hook to get pending signature leases based on current profile
export function usePendingSignatureLeases() {
  const { oxyServices, activeSessionId } = useOxy();
  const { data: activeProfile, isLoading: profileLoading } = useActiveProfile();
  
  return useQuery<Lease[]>({
    queryKey: leaseKeys.pendingLeases(),
    queryFn: async () => {
      if (!oxyServices || !activeSessionId || !activeProfile?.id) {
        console.log('OxyServices or active profile not available - returning empty pending leases');
        return [];
      }

      try {
        console.log(`Fetching pending signature leases for profile ${activeProfile.id} with OxyServices authentication`);
        const leases = await leaseService.getPendingSignatureLeases();
        // Filter leases by current profile (as tenant or landlord)
        const profileLeases = leases.filter(lease => 
          lease.tenantId === activeProfile.id || lease.landlordId === activeProfile.id
        );
        console.log(`Successfully fetched ${profileLeases.length} pending signature leases for profile ${activeProfile.id}`);
        return profileLeases;
      } catch (error) {
        console.error('Error fetching pending signature leases:', error);
        return [];
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!(oxyServices && activeSessionId && activeProfile?.id && !profileLoading),
  });
}

// Hook to check if user has any rental properties (as tenant or landlord) based on current profile
export function useHasRentalProperties() {
  const { data: activeLeases, isLoading: activeLoading } = useActiveLeases();
  const { data: pendingLeases, isLoading: pendingLoading } = usePendingSignatureLeases();
  const { data: activeProfile, isLoading: profileLoading } = useActiveProfile();
  
  const hasActiveLeases = activeLeases && activeLeases.length > 0;
  const hasPendingLeases = pendingLeases && pendingLeases.length > 0;
  const hasAnyLeases = hasActiveLeases || hasPendingLeases;
  
  return {
    hasRentalProperties: hasAnyLeases,
    hasActiveLeases,
    hasPendingLeases,
    activeLeasesCount: activeLeases?.length || 0,
    pendingLeasesCount: pendingLeases?.length || 0,
    isLoading: activeLoading || pendingLoading || profileLoading,
    activeProfileId: activeProfile?.id,
  };
}

// Hook to get a specific lease
export function useLease(leaseId: string) {
  const { oxyServices, activeSessionId } = useOxy();
  
  return useQuery<Lease>({
    queryKey: leaseKeys.detail(leaseId),
    queryFn: async () => {
      if (!oxyServices || !activeSessionId) {
        throw new Error('OxyServices not available');
      }

      try {
        console.log(`Fetching lease ${leaseId} with OxyServices authentication`);
        const lease = await leaseService.getLease(leaseId);
        console.log(`Successfully fetched lease ${leaseId}`);
        return lease;
      } catch (error) {
        console.error(`Error fetching lease ${leaseId}:`, error);
        throw error;
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!(oxyServices && activeSessionId && leaseId),
  });
}

// Hook to create a new lease
export function useCreateLease() {
  const queryClient = useQueryClient();
  const { oxyServices, activeSessionId } = useOxy();
  const { data: activeProfile } = useActiveProfile();

  return useMutation({
    mutationFn: async (leaseData: any) => {
      if (!oxyServices || !activeSessionId || !activeProfile?.id) {
        throw new Error('OxyServices or active profile not available');
      }

      try {
        console.log(`Creating new lease for profile ${activeProfile.id} with OxyServices authentication`);
        // Ensure the lease is associated with the current profile
        const leaseWithProfile = {
          ...leaseData,
          profileId: activeProfile.id,
        };
        const lease = await leaseService.createLease(leaseWithProfile);
        console.log('Successfully created lease:', lease);
        return lease;
      } catch (error) {
        console.error('Error creating lease:', error);
        throw error;
      }
    },
    onSuccess: () => {
      // Invalidate all lease queries to refresh the data
      queryClient.invalidateQueries({ queryKey: leaseKeys.all() });
      toast.success('Lease created successfully!');
    },
    onError: (error: any) => {
      console.error('Create lease mutation error:', error);
      toast.error('Failed to create lease', {
        description: error.message || 'Please try again.',
      });
    },
  });
}

// Hook to update a lease
export function useUpdateLease() {
  const queryClient = useQueryClient();
  const { oxyServices, activeSessionId } = useOxy();

  return useMutation({
    mutationFn: async ({ leaseId, data }: { leaseId: string; data: any }) => {
      if (!oxyServices || !activeSessionId) {
        throw new Error('OxyServices not available');
      }

      try {
        console.log(`Updating lease ${leaseId} with OxyServices authentication`);
        const lease = await leaseService.updateLease(leaseId, data);
        console.log(`Successfully updated lease ${leaseId}`);
        return lease;
      } catch (error) {
        console.error(`Error updating lease ${leaseId}:`, error);
        throw error;
      }
    },
    onSuccess: (data, variables) => {
      // Invalidate specific lease and all lease lists
      queryClient.invalidateQueries({ queryKey: leaseKeys.detail(variables.leaseId) });
      queryClient.invalidateQueries({ queryKey: leaseKeys.lists() });
      toast.success('Lease updated successfully!');
    },
    onError: (error: any) => {
      console.error('Update lease mutation error:', error);
      toast.error('Failed to update lease', {
        description: error.message || 'Please try again.',
      });
    },
  });
}

// Hook to delete a lease
export function useDeleteLease() {
  const queryClient = useQueryClient();
  const { oxyServices, activeSessionId } = useOxy();

  return useMutation({
    mutationFn: async (leaseId: string) => {
      if (!oxyServices || !activeSessionId) {
        throw new Error('OxyServices not available');
      }

      try {
        console.log(`Deleting lease ${leaseId} with OxyServices authentication`);
        await leaseService.deleteLease(leaseId);
        console.log(`Successfully deleted lease ${leaseId}`);
      } catch (error) {
        console.error(`Error deleting lease ${leaseId}:`, error);
        throw error;
      }
    },
    onSuccess: () => {
      // Invalidate all lease queries to refresh the data
      queryClient.invalidateQueries({ queryKey: leaseKeys.all() });
      toast.success('Lease deleted successfully!');
    },
    onError: (error: any) => {
      console.error('Delete lease mutation error:', error);
      toast.error('Failed to delete lease', {
        description: error.message || 'Please try again.',
      });
    },
  });
} 
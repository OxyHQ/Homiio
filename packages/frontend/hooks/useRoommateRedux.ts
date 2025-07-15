import { useRoommateStore } from '@/store/roommateStore';
import { roommateService, type RoommateFilters, type RoommatePreferences } from '@/services/roommateService';
import { useOxy } from '@oxyhq/services';

export const useRoommateRedux = () => {
  const { 
    roommates: profiles,
    filters,
    isLoading,
    error,
    setRoommates,
    setFilters,
    clearFilters,
    setLoading,
    setError,
    clearError
  } = useRoommateStore();
  const { oxyServices, activeSessionId } = useOxy();

  return {
    // State
    profiles,
    myPreferences: null, // Not implemented in Zustand store yet
    hasRoommateMatching: false, // Not implemented in Zustand store yet
    isLoading,
    error,
    filters,
    total: profiles.length, // Not implemented in Zustand store yet
    page: 1, // Not implemented in Zustand store yet
    totalPages: 1, // Not implemented in Zustand store yet

    // Actions
    fetchProfiles: async (filters?: RoommateFilters) => {
      if (!oxyServices || !activeSessionId) {
        console.warn('Missing authentication for roommate API calls');
        return;
      }
      try {
        setLoading(true);
        setError(null);
        const response = await roommateService.getRoommateProfiles(filters, oxyServices, activeSessionId);
        setRoommates(response.profiles || []);
      } catch (error: any) {
        setError(error.message || 'Failed to fetch roommate profiles');
      } finally {
        setLoading(false);
      }
    },
    fetchPreferences: async () => {
      if (!oxyServices || !activeSessionId) {
        console.warn('Missing authentication for roommate API calls');
        return;
      }
      // Not implemented in Zustand store yet
      console.warn('fetchPreferences not implemented in Zustand store');
    },
    checkStatus: async () => {
      if (!oxyServices || !activeSessionId) {
        console.warn('Missing authentication for roommate API calls');
        return;
      }
      // Not implemented in Zustand store yet
      console.warn('checkStatus not implemented in Zustand store');
    },
    updatePreferences: async (preferences: RoommatePreferences) => {
      if (!oxyServices || !activeSessionId) {
        console.warn('Missing authentication for roommate API calls');
        return;
      }
      // Not implemented in Zustand store yet
      console.warn('updatePreferences not implemented in Zustand store');
    },
    toggleMatching: async (enabled: boolean) => {
      if (!oxyServices || !activeSessionId) {
        console.warn('Missing authentication for roommate API calls');
        return;
      }
      try {
        await roommateService.toggleRoommateMatching(enabled, oxyServices, activeSessionId);
      } catch (error: any) {
        setError(error.message || 'Failed to toggle roommate matching');
      }
    },
    sendRequest: async (profileId: string, message?: string) => {
      if (!oxyServices || !activeSessionId) {
        console.warn('Missing authentication for roommate API calls');
        return;
      }
      try {
        await roommateService.sendRoommateRequest(profileId, message, oxyServices, activeSessionId);
      } catch (error: any) {
        setError(error.message || 'Failed to send roommate request');
      }
    },
    setFilters: (filters: Partial<RoommateFilters>) => setFilters(filters as any),
    clearFilters: () => clearFilters(),
    setError: (error: string | null) => setError(error),
    clearError: () => clearError(),
    setHasRoommateMatching: (enabled: boolean) => {
      // Not implemented in Zustand store yet
      console.warn('setHasRoommateMatching not implemented in Zustand store');
    },
  };
}; 
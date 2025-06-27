import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '@/store/store';
import { roommateService, type RoommateFilters, type RoommatePreferences } from '@/services/roommateService';
import { useOxy } from '@oxyhq/services';
import {
  fetchRoommateProfiles,
  fetchMyRoommatePreferences,
  updateRoommatePreferences,
  toggleRoommateMatching,
  sendRoommateRequest,
  checkRoommateMatchingStatus,
  setFilters,
  clearFilters,
  setError,
  clearError,
  setHasRoommateMatching,
} from '@/store/reducers/roommateReducer';

export const useRoommateRedux = () => {
  const dispatch = useDispatch<AppDispatch>();
  const roommateState = useSelector((state: RootState) => state.roommate);
  const { oxyServices, activeSessionId } = useOxy();

  return {
    // State
    profiles: roommateState.profiles,
    myPreferences: roommateState.myPreferences,
    hasRoommateMatching: roommateState.hasRoommateMatching,
    isLoading: roommateState.isLoading,
    error: roommateState.error,
    filters: roommateState.filters,
    total: roommateState.total,
    page: roommateState.page,
    totalPages: roommateState.totalPages,

    // Actions
    fetchProfiles: (filters?: RoommateFilters) => {
      if (!oxyServices || !activeSessionId) {
        console.warn('Missing authentication for roommate API calls');
        return;
      }
      dispatch(fetchRoommateProfiles({ filters, oxyServices, activeSessionId }));
    },
    fetchPreferences: () => {
      if (!oxyServices || !activeSessionId) {
        console.warn('Missing authentication for roommate API calls');
        return;
      }
      dispatch(fetchMyRoommatePreferences({ oxyServices, activeSessionId }));
    },
    checkStatus: () => {
      if (!oxyServices || !activeSessionId) {
        console.warn('Missing authentication for roommate API calls');
        return;
      }
      dispatch(checkRoommateMatchingStatus({ oxyServices, activeSessionId }));
    },
    updatePreferences: (preferences: RoommatePreferences) => {
      if (!oxyServices || !activeSessionId) {
        console.warn('Missing authentication for roommate API calls');
        return;
      }
      dispatch(updateRoommatePreferences({ preferences, oxyServices, activeSessionId }));
    },
    toggleMatching: (enabled: boolean) => {
      if (!oxyServices || !activeSessionId) {
        console.warn('Missing authentication for roommate API calls');
        return;
      }
      dispatch(toggleRoommateMatching({ enabled, oxyServices, activeSessionId }));
    },
    sendRequest: (profileId: string, message?: string) => {
      if (!oxyServices || !activeSessionId) {
        console.warn('Missing authentication for roommate API calls');
        return;
      }
      dispatch(sendRoommateRequest({ profileId, message, oxyServices, activeSessionId }));
    },
    setFilters: (filters: Partial<RoommateFilters>) => dispatch(setFilters(filters)),
    clearFilters: () => dispatch(clearFilters()),
    setError: (error: string | null) => dispatch(setError(error)),
    clearError: () => dispatch(clearError()),
    setHasRoommateMatching: (enabled: boolean) => dispatch(setHasRoommateMatching(enabled)),
  };
}; 
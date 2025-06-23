import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useOxy } from '@oxyhq/services';
import { 
  fetchTrustScore, 
  updateTrustScore, 
  recalculateTrustScore,
  clearTrustScore,
  setProfileId,
  selectPersonalTrustScore,
  selectAgencyVerification,
  selectTrustScoreLoading,
  selectTrustScoreError,
  selectProfileType,
  selectProfileId,
  selectTrustScoreData
} from '@/store/reducers/trustScoreReducer';
import type { AppDispatch, RootState } from '@/store/store';

export const useTrustScore = (profileId?: string) => {
  const dispatch = useDispatch<AppDispatch>();
  const { oxyServices, activeSessionId } = useOxy();

  // Selectors
  const personalTrustScore = useSelector(selectPersonalTrustScore);
  const agencyVerification = useSelector(selectAgencyVerification);
  const loading = useSelector(selectTrustScoreLoading);
  const error = useSelector(selectTrustScoreError);
  const profileType = useSelector(selectProfileType);
  const currentProfileId = useSelector(selectProfileId);
  const trustScoreData = useSelector(selectTrustScoreData);

  // Set profile ID if provided
  const setCurrentProfileId = useCallback((id: string) => {
    dispatch(setProfileId(id));
  }, [dispatch]);

  // Fetch trust score for a specific profile
  const fetchTrustScoreData = useCallback(async (targetProfileId?: string) => {
    const profileToFetch = targetProfileId || profileId || currentProfileId;
    
    if (!profileToFetch || !oxyServices || !activeSessionId) {
      console.warn('Missing required parameters for fetching trust score:', { profileToFetch, oxyServices: !!oxyServices, activeSessionId });
      return;
    }

    try {
      await dispatch(fetchTrustScore({ 
        profileId: profileToFetch, 
        oxyServices, 
        activeSessionId 
      })).unwrap();
    } catch (error) {
      console.error('Error fetching trust score:', error);
    }
  }, [dispatch, profileId, currentProfileId, oxyServices, activeSessionId]);

  // Update trust score for a specific profile
  const updateTrustScoreData = useCallback(async (factor: string, value: number, targetProfileId?: string) => {
    const profileToUpdate = targetProfileId || profileId || currentProfileId;
    
    if (!profileToUpdate || !oxyServices || !activeSessionId) {
      console.warn('Missing required parameters for updating trust score:', { profileToUpdate, oxyServices: !!oxyServices, activeSessionId });
      return;
    }

    try {
      await dispatch(updateTrustScore({ 
        profileId: profileToUpdate,
        factor, 
        value, 
        oxyServices, 
        activeSessionId 
      })).unwrap();
    } catch (error) {
      console.error('Error updating trust score:', error);
    }
  }, [dispatch, profileId, currentProfileId, oxyServices, activeSessionId]);

  // Recalculate trust score for a specific profile
  const recalculateTrustScoreData = useCallback(async (targetProfileId?: string) => {
    const profileToRecalculate = targetProfileId || profileId || currentProfileId;
    
    if (!profileToRecalculate || !oxyServices || !activeSessionId) {
      console.warn('Missing required parameters for recalculating trust score:', { profileToRecalculate, oxyServices: !!oxyServices, activeSessionId });
      return;
    }

    try {
      await dispatch(recalculateTrustScore({ 
        profileId: profileToRecalculate,
        oxyServices, 
        activeSessionId 
      })).unwrap();
    } catch (error) {
      console.error('Error recalculating trust score:', error);
    }
  }, [dispatch, profileId, currentProfileId, oxyServices, activeSessionId]);

  // Clear trust score data
  const clearTrustScoreData = useCallback(() => {
    dispatch(clearTrustScore());
  }, [dispatch]);

  return {
    // State
    personalTrustScore,
    agencyVerification,
    loading,
    error,
    profileType,
    currentProfileId,
    trustScoreData,
    
    // Actions
    setCurrentProfileId,
    fetchTrustScoreData,
    updateTrustScoreData,
    recalculateTrustScoreData,
    clearTrustScoreData,
  };
}; 
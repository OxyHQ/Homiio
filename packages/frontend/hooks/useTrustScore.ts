import { useCallback } from 'react';
import { useTrustScoreStore } from '@/store/trustScoreStore';
import { useOxy } from '@oxyhq/services';

export const useTrustScore = (profileId?: string) => {
  const { 
    score,
    factors,
    history,
    isLoading, 
    error,
    setScore,
    setFactors,
    setHistory,
    setLoading,
    setError,
    clearError
  } = useTrustScoreStore();
  const { oxyServices, activeSessionId } = useOxy();

  // Fetch trust score for a specific profile
  const fetchTrustScoreData = useCallback(async (targetProfileId?: string) => {
    const profileToFetch = targetProfileId || profileId;
    
    if (!profileToFetch || !oxyServices || !activeSessionId) {
      console.warn('Missing required parameters for fetching trust score:', { profileToFetch, oxyServices: !!oxyServices, activeSessionId });
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      // Import the API function
      const { userApi } = await import('@/utils/api');
      const response = await userApi.getTrustScore(profileToFetch, oxyServices, activeSessionId);
      
      // Update store with response data
      if (response.data) {
        setScore(response.data.score || 0);
        setFactors(response.data.factors || []);
        setHistory(response.data.history || []);
      }
    } catch (error: any) {
      console.error('Error fetching trust score:', error);
      setError(error.message || 'Failed to fetch trust score');
    } finally {
      setLoading(false);
    }
  }, [profileId, oxyServices, activeSessionId, setLoading, setError, setScore, setFactors, setHistory]);

  // Update trust score for a specific profile
  const updateTrustScoreData = useCallback(async (factor: string, value: number, targetProfileId?: string) => {
    const profileToUpdate = targetProfileId || profileId;
    
    if (!profileToUpdate || !oxyServices || !activeSessionId) {
      console.warn('Missing required parameters for updating trust score:', { profileToUpdate, oxyServices: !!oxyServices, activeSessionId });
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      // Import the API function
      const { userApi } = await import('@/utils/api');
      const response = await userApi.updateTrustScore(profileToUpdate, factor, value, oxyServices, activeSessionId);
      
      // Update store with response data
      if (response.data) {
        setScore(response.data.score || 0);
        setFactors(response.data.factors || []);
        setHistory(response.data.history || []);
      }
    } catch (error: any) {
      console.error('Error updating trust score:', error);
      setError(error.message || 'Failed to update trust score');
    } finally {
      setLoading(false);
    }
  }, [profileId, oxyServices, activeSessionId, setLoading, setError, setScore, setFactors, setHistory]);

  // Recalculate trust score for a specific profile
  const recalculateTrustScoreData = useCallback(async (targetProfileId?: string) => {
    const profileToRecalculate = targetProfileId || profileId;
    
    if (!profileToRecalculate || !oxyServices || !activeSessionId) {
      console.warn('Missing required parameters for recalculating trust score:', { profileToRecalculate, oxyServices: !!oxyServices, activeSessionId });
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      // Import the API function
      const { userApi } = await import('@/utils/api');
      const response = await userApi.recalculateTrustScore(profileToRecalculate, oxyServices, activeSessionId);
      
      // Update store with response data
      if (response.data) {
        setScore(response.data.score || 0);
        setFactors(response.data.factors || []);
        setHistory(response.data.history || []);
      }
    } catch (error: any) {
      console.error('Error recalculating trust score:', error);
      setError(error.message || 'Failed to recalculate trust score');
    } finally {
      setLoading(false);
    }
  }, [profileId, oxyServices, activeSessionId, setLoading, setError, setScore, setFactors, setHistory]);

  // Clear trust score data
  const clearTrustScoreData = useCallback(() => {
    setScore(0);
    setFactors([]);
    setHistory([]);
    setError(null);
  }, [setScore, setFactors, setHistory, setError]);

  return {
    // State
    score,
    factors,
    history,
    loading: isLoading,
    error,
    
    // Actions
    fetchTrustScoreData,
    updateTrustScoreData,
    recalculateTrustScoreData,
    clearTrustScoreData,
  };
}; 
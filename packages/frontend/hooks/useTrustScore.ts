import { useCallback, useState } from 'react';
import { useTrustScoreStore } from '@/store/trustScoreStore';
import profileService from '@/services/profileService';

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
    clearError,
  } = useTrustScoreStore();

  // Local state for current profile ID
  const [currentProfileId, setCurrentProfileId] = useState<string | undefined>(profileId);
  const [profileType, setProfileType] = useState<
    'personal' | 'agency' | 'business' | 'cooperative'
  >('personal');

  // Fetch trust score for a specific profile
  const fetchTrustScoreData = useCallback(
    async (targetProfileId?: string) => {
      const profileToFetch = targetProfileId || currentProfileId || profileId;

      if (!profileToFetch) {
        console.warn('Missing required parameters for fetching trust score:', {
          profileToFetch,
        });
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const profile = await profileService.getProfileById(
          profileToFetch,
        );

        // Update store with response data
        if (profile && profile.personalProfile?.trustScore) {
          const trustScore = profile.personalProfile.trustScore;
          setScore(trustScore.score || 0);

          // Transform factors to match the store interface
          const transformedFactors = (trustScore.factors || []).map((factor, index) => ({
            id: `${factor.type}-${index}`,
            name: factor.type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
            score: factor.value,
            weight: 1,
            description: `Trust factor: ${factor.type}`,
          }));

          setFactors(transformedFactors);
          setHistory([]); // History not available in current structure

          // Set profile type
          setProfileType(profile.profileType);
        } else {
          // No trust score data available
          setScore(0);
          setFactors([]);
          setHistory([]);
          setProfileType(profile?.profileType || 'personal');
        }
      } catch (error: any) {
        setError(error.message || 'Failed to fetch trust score');
      } finally {
        setLoading(false);
      }
    },
    [
      currentProfileId,
      profileId,
      setLoading,
      setError,
      setScore,
      setFactors,
      setHistory,
    ],
  );

  // Update trust score for a specific profile
  const updateTrustScoreData = useCallback(
    async (factor: string, value: number, targetProfileId?: string) => {
      const profileToUpdate = targetProfileId || currentProfileId || profileId;

      if (!profileToUpdate) {
        console.warn('Missing required parameters for updating trust score:', {
          profileToUpdate,
        });
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const profile = await profileService.updateTrustScore(
          profileToUpdate,
          factor,
          value
        );

        // Update store with response data
        if (profile && profile.personalProfile?.trustScore) {
          const trustScore = profile.personalProfile.trustScore;
          setScore(trustScore.score || 0);

          // Transform factors to match the store interface
          const transformedFactors = (trustScore.factors || []).map((factor, index) => ({
            id: `${factor.type}-${index}`,
            name: factor.type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
            score: factor.value,
            weight: 1,
            description: `Trust factor: ${factor.type}`,
          }));

          setFactors(transformedFactors);
          setHistory([]); // History not available in current structure
        }
      } catch (error: any) {
        setError(error.message || 'Failed to update trust score');
      } finally {
        setLoading(false);
      }
    },
    [
      currentProfileId,
      profileId,
      setLoading,
      setError,
      setScore,
      setFactors,
      setHistory,
    ],
  );

  // Recalculate trust score for a specific profile
  const recalculateTrustScoreData = useCallback(
    async (targetProfileId?: string) => {
      const profileToRecalculate = targetProfileId || currentProfileId || profileId;

      if (!profileToRecalculate) {
        console.warn('Missing required parameters for recalculating trust score:', {
          profileToRecalculate,
        });
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const response = await profileService.recalculatePrimaryTrustScore();

        // Update store with response data
        if (response && response.profile && response.profile.personalProfile?.trustScore) {
          const trustScore = response.profile.personalProfile.trustScore;
          setScore(trustScore.score || 0);

          // Transform factors to match the store interface
          const transformedFactors = (trustScore.factors || []).map((factor, index) => ({
            id: `${factor.type}-${index}`,
            name: factor.type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
            score: factor.value,
            weight: 1,
            description: `Trust factor: ${factor.type}`,
          }));

          setFactors(transformedFactors);
          setHistory([]); // History not available in current structure
        }
      } catch (error: any) {
        setError(error.message || 'Failed to recalculate trust score');
      } finally {
        setLoading(false);
      }
    },
    [
      currentProfileId,
      profileId,
      setLoading,
      setError,
      setScore,
      setFactors,
      setHistory,
    ],
  );

  // Clear trust score data
  const clearTrustScoreData = useCallback(() => {
    setScore(0);
    setFactors([]);
    setHistory([]);
    setError(null);
  }, [setScore, setFactors, setHistory, setError]);

  // Create trust score data object for components
  const trustScoreData = {
    score,
    factors: factors.map((factor) => ({
      type: factor.name.toLowerCase().replace(/\s+/g, '_'),
      value: factor.score,
      maxValue: 100,
      label: factor.name,
    })),
    history,
    type: profileType,
    color: score >= 80 ? '#4CAF50' : score >= 60 ? '#FF9800' : '#F44336',
    level: score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Fair' : 'Poor',
  };

  return {
    // State
    trustScoreData,
    score,
    factors,
    history,
    loading: isLoading,
    error,
    profileType,
    currentProfileId,

    // Actions
    setCurrentProfileId,
    fetchTrustScoreData,
    updateTrustScoreData,
    recalculateTrustScoreData,
    clearTrustScoreData,
  };
};

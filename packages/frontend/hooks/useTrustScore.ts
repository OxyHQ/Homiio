import { useCallback, useState } from 'react';
import { useTrustScoreStore } from '@/store/trustScoreStore';
import profileService from '@/services/profileService';
import { colors } from '@/styles/colors';

type TrustLevelKey = 'excellent' | 'good' | 'average' | 'fair' | 'needsImprovement';

function trustLevelKey(score: number): TrustLevelKey {
  if (score >= 90) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'average';
  if (score >= 30) return 'fair';
  return 'needsImprovement';
}

type TrustScoreFactor = {
  id: string;
  type: string;
  score: number;
  weight: number;
};

function mapTrustFactors(factors: Array<{ type: string; value: number }>): TrustScoreFactor[] {
  return factors.map((factor, index) => ({
    id: `${factor.type}-${index}`,
    type: factor.type,
    score: factor.value,
    weight: 1,
  }));
}

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
  } = useTrustScoreStore();

  const [currentProfileId, setCurrentProfileId] = useState<string | undefined>(profileId);
  const [profileType, setProfileType] = useState<
    'personal' | 'agency' | 'business' | 'cooperative'
  >('personal');

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

        const profile = await profileService.getProfileById(profileToFetch);

        if (profile && profile.personalProfile?.trustScore) {
          const trustScore = profile.personalProfile.trustScore;
          setScore(trustScore.score || 0);
          setFactors(mapTrustFactors(trustScore.factors || []));
          setHistory([]);
          setProfileType(profile.profileType);
        } else {
          setScore(0);
          setFactors([]);
          setHistory([]);
          setProfileType(profile?.profileType || 'personal');
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to fetch trust score';
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [currentProfileId, profileId, setLoading, setError, setScore, setFactors, setHistory],
  );

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

        const profile = await profileService.updateTrustScore(profileToUpdate, factor, value);

        if (profile && profile.personalProfile?.trustScore) {
          const trustScore = profile.personalProfile.trustScore;
          setScore(trustScore.score || 0);
          setFactors(mapTrustFactors(trustScore.factors || []));
          setHistory([]);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to update trust score';
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [currentProfileId, profileId, setLoading, setError, setScore, setFactors, setHistory],
  );

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

        if (response && response.profile && response.profile.personalProfile?.trustScore) {
          const trustScore = response.profile.personalProfile.trustScore;
          setScore(trustScore.score || 0);
          setFactors(mapTrustFactors(trustScore.factors || []));
          setHistory([]);
        }
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Failed to recalculate trust score';
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [currentProfileId, profileId, setLoading, setError, setScore, setFactors, setHistory],
  );

  const clearTrustScoreData = useCallback(() => {
    setScore(0);
    setFactors([]);
    setHistory([]);
    setError(null);
  }, [setScore, setFactors, setHistory, setError]);

  const trustScoreData = {
    score,
    factors: factors.map((factor) => ({
      type: factor.type,
      value: factor.score,
      maxValue: 100,
    })),
    history,
    type: profileType,
    color: score >= 80 ? colors.success : score >= 60 ? colors.warning : colors.danger,
    levelKey: trustLevelKey(score),
  };

  return {
    trustScoreData,
    score,
    factors,
    history,
    loading: isLoading,
    error,
    profileType,
    currentProfileId,
    setCurrentProfileId,
    fetchTrustScoreData,
    updateTrustScoreData,
    recalculateTrustScoreData,
    clearTrustScoreData,
  };
};

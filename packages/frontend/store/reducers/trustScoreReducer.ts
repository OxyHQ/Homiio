import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import profileService from '@/services/profileService';
import type { RootState } from '../store';

// Types
export interface TrustScoreFactor {
  type: string;
  value: number;
  maxValue?: number;
  label?: string;
  updatedAt?: string;
}

export interface TrustScore {
  score: number;
  factors: TrustScoreFactor[];
  totalScore?: number;
  maxScore?: number;
  lastCalculated?: string;
}

export interface AgencyVerification {
  businessLicense?: boolean;
  insurance?: boolean;
  bonding?: boolean;
  backgroundCheck?: boolean;
}

export interface TrustScoreState {
  // Profile ID for the current trust score
  profileId: string | null;
  
  // Personal trust score
  personalTrustScore: TrustScore | null;
  personalLoading: boolean;
  personalError: string | null;
  
  // Agency verification
  agencyVerification: AgencyVerification | null;
  agencyLoading: boolean;
  agencyError: string | null;
  
  // Profile type
  profileType: 'personal' | 'agency' | null;
}

const initialState: TrustScoreState = {
  profileId: null,
  personalTrustScore: null,
  personalLoading: false,
  personalError: null,
  agencyVerification: null,
  agencyLoading: false,
  agencyError: null,
  profileType: null,
};

// Async thunks
export const fetchTrustScore = createAsyncThunk(
  'trustScore/fetchTrustScore',
  async ({ profileId, oxyServices, activeSessionId }: { profileId: string; oxyServices: any; activeSessionId: string }) => {
    const response = await profileService.getProfileById(profileId, oxyServices, activeSessionId);
    return response;
  }
);

export const updateTrustScore = createAsyncThunk(
  'trustScore/updateTrustScore',
  async ({ 
    profileId,
    factor, 
    value, 
    oxyServices, 
    activeSessionId 
  }: { 
    profileId: string;
    factor: string; 
    value: number; 
    oxyServices: any; 
    activeSessionId: string; 
  }) => {
    const response = await profileService.updateTrustScore(profileId, factor, value, oxyServices, activeSessionId);
    return response;
  }
);

export const recalculateTrustScore = createAsyncThunk(
  'trustScore/recalculateTrustScore',
  async ({ profileId, oxyServices, activeSessionId }: { profileId: string; oxyServices: any; activeSessionId: string }) => {
    // For now, we'll use the primary profile method since there's no profile-specific recalculate endpoint
    const response = await profileService.recalculatePrimaryTrustScore(oxyServices, activeSessionId);
    return response;
  }
);

// Slice
const trustScoreSlice = createSlice({
  name: 'trustScore',
  initialState,
  reducers: {
    clearTrustScore: (state) => {
      state.profileId = null;
      state.personalTrustScore = null;
      state.agencyVerification = null;
      state.profileType = null;
      state.personalError = null;
      state.agencyError = null;
    },
    setProfileType: (state, action: PayloadAction<'personal' | 'agency'>) => {
      state.profileType = action.payload;
    },
    setProfileId: (state, action: PayloadAction<string>) => {
      state.profileId = action.payload;
    },
  },
  extraReducers: (builder) => {
    // Fetch trust score
    builder
      .addCase(fetchTrustScore.pending, (state) => {
        state.personalLoading = true;
        state.personalError = null;
      })
      .addCase(fetchTrustScore.fulfilled, (state, action) => {
        state.personalLoading = false;
        const profile = action.payload;
        
        // Store the profile ID
        state.profileId = profile.id || profile._id || null;
        
        if (profile?.profileType === 'personal' && profile.personalProfile?.trustScore) {
          state.personalTrustScore = profile.personalProfile.trustScore;
          state.profileType = 'personal';
        } else if (profile?.profileType === 'agency' && profile.agencyProfile?.verification) {
          state.agencyVerification = profile.agencyProfile.verification;
          state.profileType = 'agency';
        }
      })
      .addCase(fetchTrustScore.rejected, (state, action) => {
        state.personalLoading = false;
        state.personalError = action.error.message || 'Failed to fetch trust score';
      });

    // Update trust score
    builder
      .addCase(updateTrustScore.pending, (state) => {
        state.personalLoading = true;
        state.personalError = null;
      })
      .addCase(updateTrustScore.fulfilled, (state, action) => {
        state.personalLoading = false;
        const profile = action.payload;
        if (profile.personalProfile?.trustScore) {
          state.personalTrustScore = profile.personalProfile.trustScore;
        }
      })
      .addCase(updateTrustScore.rejected, (state, action) => {
        state.personalLoading = false;
        state.personalError = action.error.message || 'Failed to update trust score';
      });

    // Recalculate trust score
    builder
      .addCase(recalculateTrustScore.pending, (state) => {
        state.personalLoading = true;
        state.personalError = null;
      })
      .addCase(recalculateTrustScore.fulfilled, (state, action) => {
        state.personalLoading = false;
        const { profile } = action.payload;
        if (profile.personalProfile?.trustScore) {
          state.personalTrustScore = profile.personalProfile.trustScore;
        }
      })
      .addCase(recalculateTrustScore.rejected, (state, action) => {
        state.personalLoading = false;
        state.personalError = action.error.message || 'Failed to recalculate trust score';
      });
  },
});

// Actions
export const { clearTrustScore, setProfileType, setProfileId } = trustScoreSlice.actions;

// Selectors
export const selectPersonalTrustScore = (state: RootState) => state.trustScore.personalTrustScore;
export const selectAgencyVerification = (state: RootState) => state.trustScore.agencyVerification;
export const selectTrustScoreLoading = (state: RootState) => state.trustScore.personalLoading;
export const selectTrustScoreError = (state: RootState) => state.trustScore.personalError;
export const selectProfileType = (state: RootState) => state.trustScore.profileType;
export const selectProfileId = (state: RootState) => state.trustScore.profileId;

// Helper selectors
export const selectTrustScoreData = (state: RootState) => {
  const { personalTrustScore, agencyVerification, profileType } = state.trustScore;
  
  if (profileType === 'personal' && personalTrustScore) {
    const getTrustLevel = (score: number) => {
      if (score >= 90) return 'Excellent';
      if (score >= 70) return 'Good';
      if (score >= 50) return 'Average';
      if (score >= 30) return 'Fair';
      return 'Needs Improvement';
    };

    const getTrustColor = (score: number) => {
      if (score >= 90) return '#4CAF50';
      if (score >= 70) return '#8BC34A';
      if (score >= 50) return '#FFC107';
      if (score >= 30) return '#FF9800';
      return '#F44336';
    };

    return {
      type: 'personal' as const,
      score: personalTrustScore.score,
      level: getTrustLevel(personalTrustScore.score),
      color: getTrustColor(personalTrustScore.score),
      factors: personalTrustScore.factors?.slice(0, 2) || []
    };
  }
  
  if (profileType === 'agency' && agencyVerification) {
    const verificationCount = Object.values(agencyVerification).filter(Boolean).length;
    const totalVerifications = 4;
    const verificationPercentage = (verificationCount / totalVerifications) * 100;

    const getVerificationLevel = (percentage: number) => {
      if (percentage >= 100) return 'Fully Verified';
      if (percentage >= 75) return 'Mostly Verified';
      if (percentage >= 50) return 'Partially Verified';
      if (percentage >= 25) return 'Minimally Verified';
      return 'Not Verified';
    };

    const getVerificationColor = (percentage: number) => {
      if (percentage >= 100) return '#4CAF50';
      if (percentage >= 75) return '#8BC34A';
      if (percentage >= 50) return '#FFC107';
      if (percentage >= 25) return '#FF9800';
      return '#F44336';
    };

    return {
      type: 'agency' as const,
      percentage: verificationPercentage,
      level: getVerificationLevel(verificationPercentage),
      color: getVerificationColor(verificationPercentage),
      verificationCount,
      totalVerifications,
      verifications: agencyVerification
    };
  }
  
  return null;
};

export default trustScoreSlice.reducer; 
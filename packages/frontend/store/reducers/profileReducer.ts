import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import profileService, { Profile } from '@/services/profileService';
import { OxyServices } from '@oxyhq/services';

interface ProfileState {
  primaryProfile: Profile | null;
  allProfiles: Profile[];
  isLoading: boolean;
  error: string | null;
  landlordProfile: Profile | null;
  landlordProfileLoading: boolean;
  landlordProfileError: string | null;
}

const initialState: ProfileState = {
  primaryProfile: null,
  allProfiles: [],
  isLoading: false,
  error: null,
  landlordProfile: null,
  landlordProfileLoading: false,
  landlordProfileError: null,
};

export const fetchPrimaryProfile = createAsyncThunk(
  'profile/fetchPrimaryProfile',
  async (
    { oxyServices, activeSessionId }: { oxyServices?: OxyServices; activeSessionId?: string },
  ) => {
    const profile = await profileService.getOrCreatePrimaryProfile(oxyServices, activeSessionId);
    return profile;
  },
);

export const fetchUserProfiles = createAsyncThunk(
  'profile/fetchUserProfiles',
  async (
    { oxyServices, activeSessionId }: { oxyServices?: OxyServices; activeSessionId?: string },
  ) => {
    const profiles = await profileService.getUserProfiles(oxyServices, activeSessionId);
    return profiles;
  },
);

export const fetchLandlordProfileById = createAsyncThunk(
  'profile/fetchLandlordProfileById',
  async (
    { profileId, oxyServices, activeSessionId }: { profileId: string, oxyServices?: OxyServices; activeSessionId?: string },
  ) => {
    const profile = await profileService.getProfileById(profileId, oxyServices, activeSessionId);
    return profile;
  },
);

export const createProfile = createAsyncThunk(
  'profile/createProfile',
  async (
    { profileData, oxyServices, activeSessionId }: { 
      profileData: any; 
      oxyServices?: OxyServices; 
      activeSessionId?: string; 
    },
  ) => {
    // Check if trying to create a personal profile
    if (profileData.profileType === 'personal') {
      throw new Error('Personal profiles cannot be created manually. They are created automatically when you first access the system.');
    }
    
    const profile = await profileService.createProfile(profileData, oxyServices, activeSessionId);
    return profile;
  },
);

export const updateProfile = createAsyncThunk(
  'profile/updateProfile',
  async (
    { profileId, updateData, oxyServices, activeSessionId }: { 
      profileId: string; 
      updateData: any; 
      oxyServices?: OxyServices; 
      activeSessionId?: string; 
    },
  ) => {
    const profile = await profileService.updateProfile(profileId, updateData, oxyServices, activeSessionId);
    return profile;
  },
);

export const deleteProfile = createAsyncThunk(
  'profile/deleteProfile',
  async (
    { profileId, oxyServices, activeSessionId }: { 
      profileId: string; 
      oxyServices?: OxyServices; 
      activeSessionId?: string; 
    },
  ) => {
    await profileService.deleteProfile(profileId, oxyServices, activeSessionId);
    return profileId; // Return the deleted profile ID
  },
);

export const activateProfile = createAsyncThunk(
  'profile/activateProfile',
  async (
    { profileId, oxyServices, activeSessionId }: { 
      profileId: string; 
      oxyServices?: OxyServices; 
      activeSessionId?: string; 
    },
  ) => {
    const profile = await profileService.updateProfile(profileId, { isActive: true }, oxyServices, activeSessionId);
    return profile;
  },
);

const profileSlice = createSlice({
  name: 'profile',
  initialState,
  reducers: {
    setPrimaryProfile(state, action: PayloadAction<Profile | null>) {
      state.primaryProfile = action.payload;
    },
    setAllProfiles(state, action: PayloadAction<Profile[]>) {
      state.allProfiles = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchPrimaryProfile.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchPrimaryProfile.fulfilled, (state, action) => {
        state.isLoading = false;
        state.primaryProfile = action.payload;
      })
      .addCase(fetchPrimaryProfile.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to fetch primary profile';
      })
      .addCase(fetchUserProfiles.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchUserProfiles.fulfilled, (state, action) => {
        state.isLoading = false;
        state.allProfiles = action.payload;
      })
      .addCase(fetchUserProfiles.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to fetch profiles';
      })
      .addCase(fetchLandlordProfileById.pending, (state) => {
        state.landlordProfileLoading = true;
        state.landlordProfileError = null;
        state.landlordProfile = null;
      })
      .addCase(fetchLandlordProfileById.fulfilled, (state, action) => {
        state.landlordProfileLoading = false;
        state.landlordProfile = action.payload;
      })
      .addCase(fetchLandlordProfileById.rejected, (state, action) => {
        state.landlordProfileLoading = false;
        state.landlordProfileError = action.error.message || 'Failed to fetch landlord profile';
        state.landlordProfile = null;
      })
      // Create profile
      .addCase(createProfile.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(createProfile.fulfilled, (state, action) => {
        state.isLoading = false;
        // Add the new profile to allProfiles
        state.allProfiles.push(action.payload);
        // If this is the first profile, set it as primary
        if (state.allProfiles.length === 1) {
          state.primaryProfile = action.payload;
        }
      })
      .addCase(createProfile.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to create profile';
      })
      // Update profile
      .addCase(updateProfile.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(updateProfile.fulfilled, (state, action) => {
        state.isLoading = false;
        const updatedProfile = action.payload;
        
        // Update in allProfiles
        const index = state.allProfiles.findIndex(p => p.id === updatedProfile.id || p._id === updatedProfile._id);
        if (index !== -1) {
          state.allProfiles[index] = updatedProfile;
        }
        
        // Update primary profile if it's the same
        if (state.primaryProfile && (state.primaryProfile.id === updatedProfile.id || state.primaryProfile._id === updatedProfile._id)) {
          state.primaryProfile = updatedProfile;
        }
      })
      .addCase(updateProfile.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to update profile';
      })
      // Delete profile
      .addCase(deleteProfile.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(deleteProfile.fulfilled, (state, action) => {
        state.isLoading = false;
        const deletedProfileId = action.payload;
        
        // Remove from allProfiles
        state.allProfiles = state.allProfiles.filter(p => (p.id !== deletedProfileId && p._id !== deletedProfileId));
        
        // If primary profile was deleted, set the first remaining profile as primary
        if (state.primaryProfile && (state.primaryProfile.id === deletedProfileId || state.primaryProfile._id === deletedProfileId)) {
          state.primaryProfile = state.allProfiles.length > 0 ? state.allProfiles[0] : null;
        }
      })
      .addCase(deleteProfile.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to delete profile';
      })
      // Activate profile
      .addCase(activateProfile.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(activateProfile.fulfilled, (state, action) => {
        state.isLoading = false;
        const activatedProfile = action.payload;
        
        // Update all profiles to set isActive correctly
        state.allProfiles = state.allProfiles.map(profile => ({
          ...profile,
          isActive: (profile.id === activatedProfile.id || profile._id === activatedProfile._id)
        }));
        
        // Update primary profile if it's the same
        if (state.primaryProfile && (state.primaryProfile.id === activatedProfile.id || state.primaryProfile._id === activatedProfile._id)) {
          state.primaryProfile = activatedProfile;
        }
      })
      .addCase(activateProfile.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to activate profile';
      });
  },
});

export const { setPrimaryProfile, setAllProfiles } = profileSlice.actions;

export default profileSlice.reducer;

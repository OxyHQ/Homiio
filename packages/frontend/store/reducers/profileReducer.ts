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
      });
  },
});

export const { setPrimaryProfile, setAllProfiles } = profileSlice.actions;

export default profileSlice.reducer;

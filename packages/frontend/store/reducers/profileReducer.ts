import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import profileService, { Profile } from '@/services/profileService';
import { OxyServices } from '@oxyhq/services';

interface ProfileState {
  primaryProfile: Profile | null;
  allProfiles: Profile[];
  isLoading: boolean;
  error: string | null;
}

const initialState: ProfileState = {
  primaryProfile: null,
  allProfiles: [],
  isLoading: false,
  error: null,
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
      });
  },
});

export const { setPrimaryProfile, setAllProfiles } = profileSlice.actions;

export default profileSlice.reducer;

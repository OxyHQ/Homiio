import { create } from 'zustand';
import profileService from '@/services/profileService';
import type { Profile, UpdateProfileData } from '@homiio/shared-types';

interface ProfileState {
  profile: Profile | null;
  isLoading: boolean;
  error: string | null;
  landlordProfile: Profile | null;
  landlordProfileLoading: boolean;
  landlordProfileError: string | null;

  setProfile: (profile: Profile | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setLandlordProfile: (profile: Profile | null) => void;
  setLandlordProfileLoading: (loading: boolean) => void;
  setLandlordProfileError: (error: string | null) => void;
  reset: () => void;

  fetchProfile: () => Promise<Profile | null>;
  /** @deprecated Use fetchProfile */
  fetchPrimaryProfile: () => Promise<Profile | null>;
  fetchLandlordProfileById: (profileId: string) => Promise<Profile | null>;
  updateProfile: (profileId: string, profileData: UpdateProfileData) => Promise<Profile>;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profile: null,
  isLoading: false,
  error: null,
  landlordProfile: null,
  landlordProfileLoading: false,
  landlordProfileError: null,

  setProfile: (profile) => set({ profile }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  setLandlordProfile: (profile) => set({ landlordProfile: profile }),
  setLandlordProfileLoading: (loading) => set({ landlordProfileLoading: loading }),
  setLandlordProfileError: (error) => set({ landlordProfileError: error }),

  reset: () =>
    set({
      profile: null,
      isLoading: false,
      error: null,
      landlordProfile: null,
      landlordProfileLoading: false,
      landlordProfileError: null,
    }),

  fetchProfile: async () => {
    try {
      set({ isLoading: true, error: null });
      const profile = await profileService.getOrCreateProfile();
      set({ profile, isLoading: false });
      return profile;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch profile';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  fetchPrimaryProfile: async (): Promise<Profile | null> => {
    return useProfileStore.getState().fetchProfile();
  },

  fetchLandlordProfileById: async (profileId: string) => {
    try {
      set({ landlordProfileLoading: true, landlordProfileError: null, landlordProfile: null });
      const profile = await profileService.getPublicProfileById(profileId);
      set({ landlordProfile: profile, landlordProfileLoading: false });
      return profile;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch landlord profile';
      set({
        landlordProfileError: errorMessage,
        landlordProfileLoading: false,
        landlordProfile: null,
      });
      throw error;
    }
  },

  updateProfile: async (profileId: string, updateData: UpdateProfileData) => {
    try {
      set({ isLoading: true, error: null });
      const updatedProfile = await profileService.updateProfile(profileId, updateData);
      const { profile } = get();
      if (profile && (profile.id === updatedProfile.id || profile._id === updatedProfile._id)) {
        set({ profile: updatedProfile, isLoading: false });
      } else {
        set({ isLoading: false });
      }
      return updatedProfile;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update profile';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },
}));

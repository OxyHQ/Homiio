import { create } from 'zustand';
import profileService from '@/services/profileService';
import { Profile, UpdateProfileData } from '@homiio/shared-types';

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

  fetchProfile: () => Promise<Profile | null>;
  fetchLandlordProfileByOxyUserId: (oxyUserId: string) => Promise<Profile | null>;
  updateProfile: (updateData: UpdateProfileData) => Promise<Profile>;
}

export const useProfileStore = create<ProfileState>((set) => ({
  profile: null,
  isLoading: false,
  error: null,
  landlordProfile: null,
  landlordProfileLoading: false,
  landlordProfileError: null,

  setProfile: (profile) => set({ profile }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setLandlordProfile: (landlordProfile) => set({ landlordProfile }),
  setLandlordProfileLoading: (landlordProfileLoading) => set({ landlordProfileLoading }),
  setLandlordProfileError: (landlordProfileError) => set({ landlordProfileError }),

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

  fetchLandlordProfileByOxyUserId: async (oxyUserId: string) => {
    try {
      set({ landlordProfileLoading: true, landlordProfileError: null, landlordProfile: null });
      const profile = await profileService.getProfileByOxyUserId(oxyUserId);
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

  updateProfile: async (updateData) => {
    try {
      set({ isLoading: true, error: null });
      const updatedProfile = await profileService.updateMyProfile(updateData);
      set({ profile: updatedProfile, isLoading: false });
      return updatedProfile;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update profile';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },
}));

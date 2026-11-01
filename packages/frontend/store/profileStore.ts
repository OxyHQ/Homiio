import { create } from 'zustand';
import profileService from '@/services/profileService';
import type { Profile } from '@homiio/shared-types';

interface ProfileState {
  profile: Profile | null;
  isLoading: boolean;
  error: string | null;
  landlordProfile: Profile | null;
  landlordProfileLoading: boolean;
  landlordProfileError: string | null;

  fetchProfile: () => Promise<Profile | null>;
  fetchLandlordProfileByOxyUserId: (oxyUserId: string) => Promise<Profile | null>;
}

export const useProfileStore = create<ProfileState>((set) => ({
  profile: null,
  isLoading: false,
  error: null,
  landlordProfile: null,
  landlordProfileLoading: false,
  landlordProfileError: null,

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
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to fetch landlord profile';
      set({
        landlordProfileError: errorMessage,
        landlordProfileLoading: false,
        landlordProfile: null,
      });
      throw error;
    }
  },
}));

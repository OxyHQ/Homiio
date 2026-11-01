import { create } from 'zustand';
import profileService from '@/services/profileService';
import type { Profile, UpdateProfileData } from '@homiio/shared-types';
import {
  ProfileOwnerChangedError,
  ProfileRequestSupersededError,
  type ProfileOwner,
} from '@/hooks/useProfileOwner';

function assertCurrent(owner: ProfileOwner): void {
  if (!owner.isCurrent()) throw new ProfileOwnerChangedError();
}

function assertProfileSubject(profile: Profile | null, owner: ProfileOwner): void {
  if (profile && profile.oxyUserId !== owner.userId) throw new ProfileOwnerChangedError();
}

interface ProfileState {
  profile: Profile | null;
  profileBinding: { userId: string; sessionId: string } | null;
  profileUpdatedAt: number;
  profileRequest: { owner: ProfileOwner } | null;
  latestProfileRequest: { owner: ProfileOwner } | null;
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

  fetchProfile: (owner: ProfileOwner) => Promise<Profile | null>;
  fetchLandlordProfileByOxyUserId: (oxyUserId: string) => Promise<Profile | null>;
  updateProfile: (updateData: UpdateProfileData, owner: ProfileOwner) => Promise<Profile>;
  releaseProfileOwner: (owner: ProfileOwner) => void;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profile: null,
  profileBinding: null,
  profileUpdatedAt: 0,
  profileRequest: null,
  latestProfileRequest: null,
  isLoading: false,
  error: null,
  landlordProfile: null,
  landlordProfileLoading: false,
  landlordProfileError: null,

  setProfile: (profile) => set({ profile, profileBinding: null, profileUpdatedAt: 0 }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setLandlordProfile: (landlordProfile) => set({ landlordProfile }),
  setLandlordProfileLoading: (landlordProfileLoading) => set({ landlordProfileLoading }),
  setLandlordProfileError: (landlordProfileError) => set({ landlordProfileError }),

  fetchProfile: async (owner) => {
    assertCurrent(owner);
    const request = { owner };
    try {
      set({ isLoading: true, error: null, profileRequest: request, latestProfileRequest: request });
      const profile = await profileService.getOrCreateProfile();
      assertCurrent(owner);
      assertProfileSubject(profile, owner);
      if (get().latestProfileRequest !== request) throw new ProfileRequestSupersededError();
      set((state) => ({
        profile,
        profileBinding: { userId: owner.userId, sessionId: owner.sessionId },
        profileUpdatedAt: Date.now(),
        ...(state.profileRequest === request ? { isLoading: false, profileRequest: null } : {}),
      }));
      if (get().latestProfileRequest !== request) throw new ProfileRequestSupersededError();
      return profile;
    } catch (error: unknown) {
      if (!owner.isCurrent()) throw new ProfileOwnerChangedError();
      if (get().latestProfileRequest !== request) throw new ProfileRequestSupersededError();
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch profile';
      set((state) =>
        state.profileRequest === request
          ? { error: errorMessage, isLoading: false, profileRequest: null }
          : {},
      );
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

  updateProfile: async (updateData, owner) => {
    assertCurrent(owner);
    const request = { owner };
    try {
      set({ isLoading: true, error: null, profileRequest: request, latestProfileRequest: request });
      const updatedProfile = await profileService.updateMyProfile(updateData);
      assertCurrent(owner);
      assertProfileSubject(updatedProfile, owner);
      if (get().latestProfileRequest !== request) throw new ProfileRequestSupersededError();
      set((state) => ({
        profile: updatedProfile,
        profileBinding: { userId: owner.userId, sessionId: owner.sessionId },
        profileUpdatedAt: Date.now(),
        ...(state.profileRequest === request ? { isLoading: false, profileRequest: null } : {}),
      }));
      if (get().latestProfileRequest !== request) throw new ProfileRequestSupersededError();
      return updatedProfile;
    } catch (error: unknown) {
      if (!owner.isCurrent()) throw new ProfileOwnerChangedError();
      if (get().latestProfileRequest !== request) throw new ProfileRequestSupersededError();
      const errorMessage = error instanceof Error ? error.message : 'Failed to update profile';
      set((state) =>
        state.profileRequest === request
          ? { error: errorMessage, isLoading: false, profileRequest: null }
          : {},
      );
      throw error;
    }
  },
  releaseProfileOwner: (owner) =>
    set((state) => ({
      ...(state.profileRequest?.owner === owner ? { isLoading: false, profileRequest: null } : {}),
      ...(state.latestProfileRequest?.owner === owner ? { latestProfileRequest: null } : {}),
    })),
}));

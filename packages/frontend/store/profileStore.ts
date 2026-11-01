import { create } from 'zustand';
import profileService from '@/services/profileService';
import type { Profile } from '@homiio/shared-types';
import { ProfileOwnerChangedError, type ProfileOwner } from '@/hooks/useProfileOwner';

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
  isLoading: boolean;
  error: string | null;
  landlordProfile: Profile | null;
  landlordProfileLoading: boolean;
  landlordProfileError: string | null;

  fetchProfile: (owner: ProfileOwner) => Promise<Profile | null>;
  fetchLandlordProfileByOxyUserId: (oxyUserId: string) => Promise<Profile | null>;
  releaseProfileOwner: (owner: ProfileOwner) => void;
}

export const useProfileStore = create<ProfileState>((set) => ({
  profile: null,
  profileBinding: null,
  profileUpdatedAt: 0,
  profileRequest: null,
  isLoading: false,
  error: null,
  landlordProfile: null,
  landlordProfileLoading: false,
  landlordProfileError: null,

  fetchProfile: async (owner) => {
    assertCurrent(owner);
    const request = { owner };
    try {
      set({ isLoading: true, error: null, profileRequest: request });
      const profile = await profileService.getOrCreateProfile();
      assertCurrent(owner);
      assertProfileSubject(profile, owner);
      set((state) => ({
        profile,
        profileBinding: { userId: owner.userId, sessionId: owner.sessionId },
        profileUpdatedAt: Date.now(),
        ...(state.profileRequest === request ? { isLoading: false, profileRequest: null } : {}),
      }));
      return profile;
    } catch (error: unknown) {
      if (!owner.isCurrent()) throw new ProfileOwnerChangedError();
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

  releaseProfileOwner: (owner) =>
    set((state) =>
      state.profileRequest?.owner === owner ? { isLoading: false, profileRequest: null } : {},
    ),
}));

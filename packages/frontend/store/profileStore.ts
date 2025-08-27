import { create } from 'zustand';
import profileService from '@/services/profileService';
import { Profile, UpdateProfileData, ProfileType } from '@homiio/shared-types';

interface ProfileState {
  // State
  primaryProfile: Profile | null;
  allProfiles: Profile[];
  isLoading: boolean;
  error: string | null;
  landlordProfile: Profile | null;
  landlordProfileLoading: boolean;
  landlordProfileError: string | null;

  // Actions
  setPrimaryProfile: (profile: Profile | null) => void;
  setAllProfiles: (profiles: Profile[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setLandlordProfile: (profile: Profile | null) => void;
  setLandlordProfileLoading: (loading: boolean) => void;
  setLandlordProfileError: (error: string | null) => void;

    // Async Actions
  fetchPrimaryProfile: () => Promise<Profile | null>;
  fetchUserProfiles: () => Promise<Profile[]>;
  fetchLandlordProfile: (profileId: string) => Promise<Profile | null>;
  createProfile: (profileData: {
    profileType: ProfileType;
    personalProfile?: any;
    businessProfile?: any;
  }) => Promise<Profile>;
  updatePrimaryProfile: (
    profileData: UpdateProfileData,
  ) => Promise<Profile>;
  deleteProfile: (profileId: string) => Promise<void>;
  fetchPublicLandlordProfile: (profileId: string) => Promise<Profile | null>;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  // Initial state
  primaryProfile: null,
  allProfiles: [],
  isLoading: false,
  error: null,
  landlordProfile: null,
  landlordProfileLoading: false,
  landlordProfileError: null,

  // Synchronous actions
  setPrimaryProfile: (profile) => set({ primaryProfile: profile }),
  setAllProfiles: (profiles) => set({ allProfiles: profiles }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  setLandlordProfile: (profile) => set({ landlordProfile: profile }),
  setLandlordProfileLoading: (loading) => set({ landlordProfileLoading: loading }),
  setLandlordProfileError: (error) => set({ landlordProfileError: error }),

  // Async actions
  fetchPrimaryProfile: async (oxyServices, activeSessionId) => {
    try {
      set({ isLoading: true, error: null });
      const profile = await profileService.getOrCreatePrimaryProfile(oxyServices, activeSessionId);
      set({ primaryProfile: profile, isLoading: false });
      return profile;
    } catch (error: any) {
      const errorMessage = error.message || 'Failed to fetch primary profile';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  fetchUserProfiles: async (oxyServices, activeSessionId) => {
    try {
      set({ isLoading: true, error: null });
      const profiles = await profileService.getUserProfiles(oxyServices, activeSessionId);
      set({ allProfiles: profiles, isLoading: false });
      return profiles;
    } catch (error: any) {
      const errorMessage = error.message || 'Failed to fetch profiles';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  fetchLandlordProfileById: async (profileId, oxyServices, activeSessionId) => {
    try {
      set({ landlordProfileLoading: true, landlordProfileError: null, landlordProfile: null });
      const profile = await profileService.getProfileById(profileId, oxyServices, activeSessionId);
      set({ landlordProfile: profile, landlordProfileLoading: false });
      return profile;
    } catch (error: any) {
      const errorMessage = error.message || 'Failed to fetch landlord profile';
      set({
        landlordProfileError: errorMessage,
        landlordProfileLoading: false,
        landlordProfile: null,
      });
      throw error;
    }
  },

  createProfile: async (profileData, oxyServices, activeSessionId) => {
    try {
      // Check if trying to create a personal profile
      if (profileData.profileType === ProfileType.PERSONAL) {
        throw new Error(
          'Personal profiles cannot be created manually. They are created automatically when you first access the system.',
        );
      }

      set({ isLoading: true, error: null });
      const profile = await profileService.createProfile(profileData, oxyServices, activeSessionId);

      // Update state
      const { allProfiles } = get();
      const newAllProfiles = [...allProfiles, profile];
      set({
        allProfiles: newAllProfiles,
        isLoading: false,
        // If this is the first profile, set it as primary
        primaryProfile: allProfiles.length === 0 ? profile : get().primaryProfile,
      });

      return profile;
    } catch (error: any) {
      const errorMessage = error.message || 'Failed to create profile';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  updateProfile: async (profileId, updateData, oxyServices, activeSessionId) => {
    try {
      set({ isLoading: true, error: null });
      const updatedProfile = await profileService.updateProfile(
        profileId,
        updateData,
        oxyServices,
        activeSessionId,
      );

      // Update state
      const { allProfiles, primaryProfile } = get();

      // Update in allProfiles
      const updatedAllProfiles = allProfiles.map((profile) =>
        profile.id === updatedProfile.id || profile._id === updatedProfile._id
          ? updatedProfile
          : profile,
      );

      // Update primary profile if it's the same
      const newPrimaryProfile =
        primaryProfile &&
        (primaryProfile.id === updatedProfile.id || primaryProfile._id === updatedProfile._id)
          ? updatedProfile
          : primaryProfile;

      set({
        allProfiles: updatedAllProfiles,
        primaryProfile: newPrimaryProfile,
        isLoading: false,
      });

      return updatedProfile;
    } catch (error: any) {
      const errorMessage = error.message || 'Failed to update profile';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  deleteProfile: async (profileId, oxyServices, activeSessionId) => {
    try {
      set({ isLoading: true, error: null });
      await profileService.deleteProfile(profileId, oxyServices, activeSessionId);

      // Update state
      const { allProfiles, primaryProfile } = get();

      // Remove from allProfiles
      const updatedAllProfiles = allProfiles.filter(
        (profile) => !(profile.id === profileId || profile._id === profileId),
      );

      // If primary profile was deleted, set the first remaining profile as primary
      let newPrimaryProfile = primaryProfile;
      if (primaryProfile && (primaryProfile.id === profileId || primaryProfile._id === profileId)) {
        newPrimaryProfile = updatedAllProfiles.length > 0 ? updatedAllProfiles[0] : null;
      }

      set({
        allProfiles: updatedAllProfiles,
        primaryProfile: newPrimaryProfile,
        isLoading: false,
      });
    } catch (error: any) {
      const errorMessage = error.message || 'Failed to delete profile';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  activateProfile: async (profileId, oxyServices, activeSessionId) => {
    try {
      set({ isLoading: true, error: null });

      // Use the new activateProfile method in the service
      const activatedProfile = await profileService.activateProfile(
        profileId,
        oxyServices,
        activeSessionId,
      );

      // Update state
      const { allProfiles } = get();

      // Update all profiles to set isActive correctly
      const updatedAllProfiles = allProfiles.map((profile) => ({
        ...profile,
        isActive: profile.id === activatedProfile.id || profile._id === activatedProfile._id,
      }));

      set({
        allProfiles: updatedAllProfiles,
        primaryProfile: activatedProfile,
        isLoading: false,
      });

      return activatedProfile;
    } catch (error: any) {
      const errorMessage = error.message || 'Failed to activate profile';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },
}));

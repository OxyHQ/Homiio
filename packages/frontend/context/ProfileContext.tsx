import React, { createContext, useContext, useEffect, useMemo, useCallback } from 'react';
import { useOxy } from '@oxyhq/services';
import { useProfileStore } from '@/store/profileStore';
// Recently viewed is now handled by React Query hooks
import type { Profile } from '@/services/profileService';

interface ProfileContextType {
  primaryProfile: Profile | null;
  allProfiles: Profile[];
  isLoading: boolean;
  error: string | null;
  hasPrimaryProfile: boolean;
  refetch: () => void;
  // Profile type specific helpers
  personalProfile: Profile | null;
  agencyProfiles: Profile[];
  businessProfiles: Profile[];
  ownedAgencyProfiles: Profile[];
  // Profile checks
  isPersonalProfile: boolean;
  hasPersonalProfile: boolean;
  canAccessRoommates: boolean;
  // New utility methods
  refresh: () => Promise<void>;
  activateProfile: (profileId: string) => Promise<Profile>;
  isInitialized: boolean;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { oxyServices, activeSessionId, isAuthenticated } = useOxy();
  const {
    primaryProfile,
    allProfiles,
    isLoading,
    error,
    setPrimaryProfile,
    setAllProfiles,
    setError,
    activateProfile: storeActivateProfile,
  } = useProfileStore();

  // Track initialization state
  const [isInitialized, setIsInitialized] = React.useState(false);

  // Memoize load profiles function with better error handling
  const loadProfiles = useCallback(async () => {
    try {
      console.log('ProfileContext: Loading profiles for authenticated user');
      
      // Load both primary profile and all profiles concurrently
      const [primaryProfileResult, userProfilesResult] = await Promise.allSettled([
        useProfileStore.getState().fetchPrimaryProfile(),
        useProfileStore.getState().fetchUserProfiles(),
      ]);

      // Handle primary profile result
      if (primaryProfileResult.status === 'rejected') {
        console.error('ProfileContext: Failed to fetch primary profile:', primaryProfileResult.reason);
      }

      // Handle user profiles result
      if (userProfilesResult.status === 'rejected') {
        console.error('ProfileContext: Failed to fetch user profiles:', userProfilesResult.reason);
      }

      // Mark as initialized even if some calls failed
      setIsInitialized(true);
      
      console.log('ProfileContext: Profiles loaded successfully');
    } catch (err: any) {
      console.error('ProfileContext: Error loading profiles:', err);
      setError(err.message || 'Failed to load profiles');
      setIsInitialized(true); // Still mark as initialized to prevent infinite loading
    }
  }, [setError]);

  // Refresh function for manual refresh
  const refresh = useCallback(async () => {
    setIsInitialized(false);
    await loadProfiles();
  }, [loadProfiles]);

  // Authentication effect with improved logic
  useEffect(() => {
    let mounted = true;

    if (isAuthenticated && oxyServices && activeSessionId) {
      console.log('ProfileContext: User authenticated, loading profiles...');
      loadProfiles().catch(error => {
        if (mounted) {
          console.error('ProfileContext: Failed to load profiles:', error);
        }
      });
    } else if (!isAuthenticated) {
      console.log('ProfileContext: User not authenticated, clearing profiles');
      setPrimaryProfile(null);
      setAllProfiles([]);
      setIsInitialized(false);
    }

    return () => {
      mounted = false;
    };
  }, [isAuthenticated, oxyServices, activeSessionId, loadProfiles, setPrimaryProfile, setAllProfiles]);

  // Memoize profile helpers
  const personalProfile = useMemo(
    () => allProfiles.find((profile) => profile.profileType === 'personal') || null,
    [allProfiles],
  );

  const agencyProfiles = useMemo(
    () => allProfiles.filter((profile) => profile.profileType === 'agency'),
    [allProfiles],
  );

  const businessProfiles = useMemo(
    () => allProfiles.filter((profile) => profile.profileType === 'business'),
    [allProfiles],
  );

  const ownedAgencyProfiles = useMemo(() => {
    if (!activeSessionId) return [];

    return allProfiles.filter(
      (profile) =>
        profile.profileType === 'agency' &&
        (profile as any).ownerId === activeSessionId,
    );
  }, [allProfiles, activeSessionId]);

  // Memoize profile checks
  const isPersonalProfile = useMemo(
    () => primaryProfile?.profileType === 'personal',
    [primaryProfile?.profileType],
  );

  const hasPersonalProfile = useMemo(
    () => personalProfile !== null,
    [personalProfile],
  );

  const hasPrimaryProfile = useMemo(
    () => primaryProfile !== null,
    [primaryProfile],
  );

  const canAccessRoommates = useMemo(
    () => hasPersonalProfile && isPersonalProfile,
    [hasPersonalProfile, isPersonalProfile],
  );

  // Wrap the store's activateProfile method
  const activateProfile = useCallback(async (profileId: string) => {
    try {
      const activatedProfile = await storeActivateProfile(profileId);
      // The store handles state updates, we just return the result
      return activatedProfile;
    } catch (error) {
      console.error('ProfileContext: Profile activation failed:', error);
      throw error;
    }
  }, [storeActivateProfile]);

  // Memoize refetch function
  const refetch = useCallback(() => {
    if (isAuthenticated && oxyServices && activeSessionId) {
      loadProfiles().catch(error => {
        console.error('ProfileContext: Refetch failed:', error);
      });
    }
  }, [isAuthenticated, oxyServices, activeSessionId, loadProfiles]);

  // Memoize context value
  const contextValue = useMemo(
    () => ({
      primaryProfile,
      allProfiles,
      isLoading,
      error,
      hasPrimaryProfile,
      refetch,
      personalProfile,
      agencyProfiles,
      businessProfiles,
      ownedAgencyProfiles,
      isPersonalProfile,
      hasPersonalProfile,
      canAccessRoommates,
      refresh,
      activateProfile,
      isInitialized,
    }),
    [
      primaryProfile,
      allProfiles,
      isLoading,
      error,
      hasPrimaryProfile,
      refetch,
      personalProfile,
      agencyProfiles,
      businessProfiles,
      ownedAgencyProfiles,
      isPersonalProfile,
      hasPersonalProfile,
      canAccessRoommates,
      refresh,
      activateProfile,
      isInitialized,
    ],
  );

  return (
    <ProfileContext.Provider value={contextValue}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const context = useContext(ProfileContext);
  if (context === undefined) {
    throw new Error('useProfile must be used within a ProfileProvider');
  }
  return context;
}

// Legacy hooks for backward compatibility
export function usePersonalProfile() {
  const { personalProfile } = useProfile();
  return personalProfile;
}

export function useAgencyProfiles() {
  const { agencyProfiles } = useProfile();
  return agencyProfiles;
}

export function useBusinessProfiles() {
  const { businessProfiles } = useProfile();
  return businessProfiles;
}

export function useOwnedAgencyProfiles() {
  const { ownedAgencyProfiles } = useProfile();
  return ownedAgencyProfiles;
}

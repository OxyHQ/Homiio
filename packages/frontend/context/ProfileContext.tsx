import React, { createContext, useContext, useEffect, useMemo, useCallback } from 'react';
import { useOxy } from '@oxyhq/services';
import { useProfileStore } from '@/store/profileStore';
// Recently viewed is now handled by React Query hooks
import type { Profile } from '@/services/profileService';

interface ProfileContextType {
  primaryProfile: Profile | null;
  allProfiles: Profile[];
  isLoading: boolean;
  error: Error | null;
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
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { oxyServices, activeSessionId } = useOxy();
  const {
    primaryProfile,
    allProfiles,
    isLoading,
    error,
    setPrimaryProfile,
    setAllProfiles,
    setError,
  } = useProfileStore();

  // Memoize load profiles function
  const loadProfiles = useCallback(async () => {
    try {
      console.log('ProfileContext: Loading profiles for authenticated user');
      await useProfileStore
        .getState()
        .fetchPrimaryProfile(oxyServices, activeSessionId || undefined);
      await useProfileStore
        .getState()
        .fetchUserProfiles(oxyServices, activeSessionId || undefined);
      console.log('ProfileContext: Profiles loaded successfully');
    } catch (err: any) {
      console.error('ProfileContext: Error loading profiles:', err);
      setError(err.message || 'Failed to load profiles');
    }
  }, [oxyServices, activeSessionId, setError]);

  // Recently viewed is now handled by React Query hooks automatically

  useEffect(() => {
    if (oxyServices && activeSessionId) {
      console.log('ProfileContext: User authenticated, loading profiles...');
      loadProfiles();
    } else {
      console.log('ProfileContext: User not authenticated, clearing profiles');
      setPrimaryProfile(null);
      setAllProfiles([]);
    }
  }, [oxyServices, activeSessionId, setPrimaryProfile, setAllProfiles, loadProfiles]);

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
    if (!oxyServices || !activeSessionId) return [];

    return allProfiles.filter(
      (profile) =>
        profile.profileType === 'agency' &&
        profile.ownerId === activeSessionId,
    );
  }, [allProfiles, oxyServices, activeSessionId]);

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

  // Memoize refetch function
  const refetch = useCallback(() => {
    if (oxyServices && activeSessionId) {
      loadProfiles();
    }
  }, [oxyServices, activeSessionId, loadProfiles]);

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

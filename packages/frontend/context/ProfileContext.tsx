import React, { createContext, useContext, useEffect } from 'react';
import { useOxy } from '@oxyhq/services';
import { useProfileStore } from '@/store/profileStore';
import { useRecentlyViewedStore } from '@/store/recentlyViewedStore';
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

  useEffect(() => {
    const loadProfiles = async () => {
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
    };

    const loadRecentlyViewed = async () => {
      try {
        console.log('ProfileContext: Loading recently viewed for authenticated user');
        if (activeSessionId) {
          await useRecentlyViewedStore.getState().loadFromDatabase(oxyServices, activeSessionId);
          console.log('ProfileContext: Recently viewed loaded successfully');
        }
      } catch (err: any) {
        console.error('ProfileContext: Error loading recently viewed:', err);
        // Don't set profile error for recently viewed errors
      }
    };

    if (oxyServices && activeSessionId) {
      console.log('ProfileContext: User authenticated, loading profiles and recently viewed...');
      loadProfiles();
      loadRecentlyViewed();
    } else {
      console.log('ProfileContext: User not authenticated, clearing profiles and recently viewed');
      setPrimaryProfile(null);
      setAllProfiles([]);
      useRecentlyViewedStore.getState().clearAll();
    }
  }, [oxyServices, activeSessionId, setPrimaryProfile, setAllProfiles, setError]);

  // Memoized profile helpers
  const personalProfile = React.useMemo(
    () => allProfiles.find((profile) => profile.profileType === 'personal') || null,
    [allProfiles],
  );

  const agencyProfiles = React.useMemo(
    () => allProfiles.filter((profile) => profile.profileType === 'agency'),
    [allProfiles],
  );

  const businessProfiles = React.useMemo(
    () => allProfiles.filter((profile) => profile.profileType === 'business'),
    [allProfiles],
  );

  const ownedAgencyProfiles = React.useMemo(() => {
    if (!oxyServices || !activeSessionId) return [];

    return allProfiles.filter(
      (profile) =>
        profile.profileType === 'agency' &&
        profile.agencyProfile?.members.some(
          (member) =>
            member.oxyUserId === activeSessionId && ['owner', 'admin'].includes(member.role),
        ),
    );
  }, [allProfiles, oxyServices, activeSessionId]);

  // Profile state checks
  const hasPrimaryProfile = !!primaryProfile;
  const hasPersonalProfile = !!personalProfile;
  const isPersonalProfile = primaryProfile?.profileType === 'personal';
  const canAccessRoommates = isPersonalProfile && hasPersonalProfile;

  const refetch = () => {
    if (oxyServices && activeSessionId) {
      useProfileStore.getState().fetchPrimaryProfile(oxyServices, activeSessionId || undefined);
      useProfileStore.getState().fetchUserProfiles(oxyServices, activeSessionId || undefined);
    }
  };

  const value: ProfileContextType = {
    primaryProfile,
    allProfiles,
    isLoading,
    error: error as Error | null,
    hasPrimaryProfile,
    refetch,
    personalProfile,
    agencyProfiles,
    businessProfiles,
    ownedAgencyProfiles,
    isPersonalProfile,
    hasPersonalProfile,
    canAccessRoommates,
  };

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
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

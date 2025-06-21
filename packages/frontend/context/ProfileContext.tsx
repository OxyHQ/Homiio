import React, { createContext, useContext, useEffect, useState } from 'react';
import { useOxy } from '@oxyhq/services';
import { usePrimaryProfile, useUserProfiles } from '@/hooks/useProfileQueries';
import type { Profile } from '@/services/profileService';

interface ProfileContextType {
    primaryProfile: Profile | null;
    allProfiles: Profile[];
    isLoading: boolean;
    error: Error | null;
    hasPrimaryProfile: boolean;
    refetch: () => void;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
    const { oxyServices, activeSessionId } = useOxy();
    const [primaryProfile, setPrimaryProfile] = useState<Profile | null>(null);
    const [allProfiles, setAllProfiles] = useState<Profile[]>([]);

    // Get primary profile
    const {
        data: primaryProfileData,
        isLoading: isPrimaryLoading,
        error: primaryError,
        refetch: refetchPrimary
    } = usePrimaryProfile();

    // Get all user profiles
    const {
        data: allProfilesData,
        isLoading: isAllProfilesLoading,
        error: allProfilesError,
        refetch: refetchAllProfiles
    } = useUserProfiles();

    // Update state when data changes
    useEffect(() => {
        setPrimaryProfile(primaryProfileData ?? null);
    }, [primaryProfileData]);

    useEffect(() => {
        if (allProfilesData) {
            setAllProfiles(allProfilesData);
        }
    }, [allProfilesData]);

    // Reset state when user logs out
    useEffect(() => {
        if (!oxyServices || !activeSessionId) {
            setPrimaryProfile(null);
            setAllProfiles([]);
        }
    }, [oxyServices, activeSessionId]);

    const isLoading = isPrimaryLoading || isAllProfilesLoading;
    const error = primaryError || allProfilesError;
    const hasPrimaryProfile = !!primaryProfile;

    const refetch = () => {
        refetchPrimary();
        refetchAllProfiles();
    };

    const value: ProfileContextType = {
        primaryProfile,
        allProfiles,
        isLoading,
        error,
        hasPrimaryProfile,
        refetch,
    };

    return (
        <ProfileContext.Provider value={value}>
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

// Hook to get personal profile specifically
export function usePersonalProfile() {
    const { allProfiles } = useProfile();
    return allProfiles.find(profile => profile.profileType === 'personal') || null;
}

// Hook to get roommate profile specifically
export function useRoommateProfile() {
    const { allProfiles } = useProfile();
    return allProfiles.find(profile => profile.profileType === 'roommate') || null;
}

// Hook to get agency profiles specifically
export function useAgencyProfiles() {
    const { allProfiles } = useProfile();
    return allProfiles.filter(profile => profile.profileType === 'agency');
}

// Hook to get business profiles specifically
export function useBusinessProfiles() {
    const { allProfiles } = useProfile();
    return allProfiles.filter(profile => profile.profileType === 'business');
}

// Hook to get owned agency profiles
export function useOwnedAgencyProfiles() {
    const { allProfiles } = useProfile();
    const { oxyServices, activeSessionId } = useOxy();

    if (!oxyServices || !activeSessionId) {
        return [];
    }

    return allProfiles.filter(profile =>
        profile.profileType === 'agency' &&
        profile.agencyProfile?.members.some(member =>
            member.oxyUserId === activeSessionId &&
            ['owner', 'admin'].includes(member.role)
        )
    );
} 
import React, { createContext, useContext, useEffect } from 'react';
import { useOxy } from '@oxyhq/services';
import { useProfileStore } from '@/store/profileStore';
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
    const {
        primaryProfile,
        allProfiles,
        isLoading,
        error,
        setPrimaryProfile,
        setAllProfiles,
        setError
    } = useProfileStore();

    useEffect(() => {
        const loadProfiles = async () => {
            try {
                await useProfileStore.getState().fetchPrimaryProfile(oxyServices, activeSessionId);
                await useProfileStore.getState().fetchUserProfiles(oxyServices, activeSessionId);
            } catch (err: any) {
                setError(err.message || 'Failed to load profiles');
            }
        };

        if (oxyServices && activeSessionId) {
            loadProfiles();
        } else {
            setPrimaryProfile(null);
            setAllProfiles([]);
        }
    }, [oxyServices, activeSessionId, setPrimaryProfile, setAllProfiles, setError]);

    const hasPrimaryProfile = !!primaryProfile;

    const refetch = () => {
        if (oxyServices && activeSessionId) {
            useProfileStore.getState().fetchPrimaryProfile(oxyServices, activeSessionId);
            useProfileStore.getState().fetchUserProfiles(oxyServices, activeSessionId);
        }
    };

    const value: ProfileContextType = {
        primaryProfile,
        allProfiles,
        isLoading,
        error: error as Error | null,
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

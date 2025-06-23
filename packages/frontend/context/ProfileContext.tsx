import React, { createContext, useContext, useEffect } from 'react';
import { useOxy } from '@oxyhq/services';
import { useDispatch, useSelector } from 'react-redux';
import type { Profile } from '@/services/profileService';
import {
    fetchPrimaryProfile,
    fetchUserProfiles,
    setPrimaryProfile as setPrimaryProfileAction,
    setAllProfiles as setAllProfilesAction,
} from '@/store/reducers/profileReducer';
import type { RootState, AppDispatch } from '@/store/store';

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
    const dispatch = useDispatch<AppDispatch>();

    const primaryProfile = useSelector((state: RootState) => state.profile.primaryProfile);
    const allProfiles = useSelector((state: RootState) => state.profile.allProfiles);
    const isLoading = useSelector((state: RootState) => state.profile.isLoading);
    const error = useSelector((state: RootState) => state.profile.error) as Error | null;

    useEffect(() => {
        if (oxyServices && activeSessionId) {
            dispatch(fetchPrimaryProfile({ oxyServices, activeSessionId }));
            dispatch(fetchUserProfiles({ oxyServices, activeSessionId }));
        } else {
            dispatch(setPrimaryProfileAction(null));
            dispatch(setAllProfilesAction([]));
        }
    }, [oxyServices, activeSessionId, dispatch]);

    const hasPrimaryProfile = !!primaryProfile;

    const refetch = () => {
        if (oxyServices && activeSessionId) {
            dispatch(fetchPrimaryProfile({ oxyServices, activeSessionId }));
            dispatch(fetchUserProfiles({ oxyServices, activeSessionId }));
        }
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

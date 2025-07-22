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
    createProfileIfMissing: () => Promise<void>;
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
        const loadProfiles = async (retryCount = 0) => {
            const maxRetries = 3;
            const retryDelay = 1000; // 1 second
            
            try {
                console.log(`[ProfileProvider] Loading profiles attempt ${retryCount + 1}/${maxRetries + 1}`, {
                    hasOxyServices: !!oxyServices,
                    hasActiveSessionId: !!activeSessionId,
                    activeSessionId: activeSessionId || 'none'
                });
                
                // First try to get the primary profile (this should auto-create if needed)
                const profile = await useProfileStore.getState().fetchPrimaryProfile(oxyServices, activeSessionId);
                console.log(`[ProfileProvider] Successfully fetched primary profile:`, {
                    profileId: profile?.id || profile?._id,
                    profileType: profile?.profileType,
                    hasProfile: !!profile
                });
                
                // Then get all profiles for the user
                await useProfileStore.getState().fetchUserProfiles(oxyServices, activeSessionId);
                console.log(`[ProfileProvider] Successfully fetched all profiles`);
                
            } catch (err: any) {
                console.error(`[ProfileProvider] Error loading profiles (attempt ${retryCount + 1}):`, err);
                
                // For specific errors, retry with exponential backoff
                if (retryCount < maxRetries && shouldRetryError(err)) {
                    console.log(`[ProfileProvider] Retrying in ${retryDelay * (retryCount + 1)}ms...`);
                    setTimeout(() => {
                        loadProfiles(retryCount + 1);
                    }, retryDelay * (retryCount + 1));
                } else {
                    const errorMessage = err.message || 'Failed to load profiles';
                    console.error(`[ProfileProvider] Final error after ${retryCount + 1} attempts:`, errorMessage);
                    setError(errorMessage);
                }
            }
        };

        const shouldRetryError = (error: any): boolean => {
            // Retry for network errors, server errors, or profile creation failures
            if (error.status >= 500) return true; // Server errors
            if (error.code === 'NETWORK_ERROR') return true;
            if (error.code === 'DATABASE_ERROR') return true;
            if (error.message?.includes('Network Error')) return true;
            if (error.message?.includes('Connection failed')) return true;
            return false;
        };

        if (oxyServices && activeSessionId) {
            console.log(`[ProfileProvider] Authentication detected, loading profiles...`);
            // Clear any previous errors before loading
            setError(null);
            loadProfiles();
        } else {
            console.log(`[ProfileProvider] No authentication, clearing profiles`, {
                hasOxyServices: !!oxyServices,
                hasActiveSessionId: !!activeSessionId
            });
            setPrimaryProfile(null);
            setAllProfiles([]);
            setError(null);
        }
    }, [oxyServices, activeSessionId, setPrimaryProfile, setAllProfiles, setError]);

    const hasPrimaryProfile = !!primaryProfile;

    const refetch = () => {
        console.log(`[ProfileProvider] Manual refetch requested`);
        if (oxyServices && activeSessionId) {
            useProfileStore.getState().fetchPrimaryProfile(oxyServices, activeSessionId);
            useProfileStore.getState().fetchUserProfiles(oxyServices, activeSessionId);
        }
    };

    // Manual profile creation function for edge cases
    const createProfileIfMissing = async () => {
        console.log(`[ProfileProvider] Manual profile creation requested`);
        if (oxyServices && activeSessionId && !primaryProfile) {
            try {
                await useProfileStore.getState().fetchPrimaryProfile(oxyServices, activeSessionId);
            } catch (error) {
                console.error(`[ProfileProvider] Manual profile creation failed:`, error);
                throw error;
            }
        }
    };

    const value: ProfileContextType = {
        primaryProfile,
        allProfiles,
        isLoading,
        error: error as Error | null,
        hasPrimaryProfile,
        refetch,
        createProfileIfMissing,
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

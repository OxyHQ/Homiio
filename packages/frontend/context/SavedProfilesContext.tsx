import React, { createContext, useContext, useState, useCallback } from 'react';
import { useOxy } from '@oxyhq/services';
import { api } from '@/utils/api';

type SavedProfilesContextType = {
    isSaving: boolean;
    savedProfileIds: Set<string>;
    isProfileSaved: (profileId: string) => boolean;
    saveProfile: (profileId: string) => Promise<void>;
    unsaveProfile: (profileId: string) => Promise<void>;
    refresh: () => Promise<void>;
};

const SavedProfilesContext = createContext<SavedProfilesContextType | undefined>(undefined);

export function SavedProfilesProvider({ children }: { children: React.ReactNode }) {
    const { oxyServices, activeSessionId } = useOxy();
    const [isSaving, setIsSaving] = useState(false);
    const [savedProfileIds, setSavedProfileIds] = useState<Set<string>>(new Set());

    const load = useCallback(async () => {
        if (!oxyServices || !activeSessionId) {
            setSavedProfileIds(new Set());
            return;
        }
        try {
            const res = await api.get('/api/profiles/me/saved-profiles', { oxyServices, activeSessionId });
            const profiles = res.data?.data || res.data || [];
            const ids = new Set<string>(profiles.map((p: any) => String(p._id)));
            setSavedProfileIds(ids);
        } catch (e) {
            // ignore
        }
    }, [oxyServices, activeSessionId]);

    React.useEffect(() => {
        load();
    }, [load]);

    const isProfileSaved = useCallback((profileId: string) => savedProfileIds.has(profileId), [savedProfileIds]);

    const saveProfile = useCallback(async (profileId: string) => {
        if (!oxyServices || !activeSessionId) throw new Error('Auth required');
        setIsSaving(true);
        try {
            await api.post('/api/profiles/me/save-profile', { profileId }, { oxyServices, activeSessionId });
            setSavedProfileIds(prev => new Set(prev).add(profileId));
        } finally {
            setIsSaving(false);
        }
    }, [oxyServices, activeSessionId]);

    const unsaveProfile = useCallback(async (profileId: string) => {
        if (!oxyServices || !activeSessionId) throw new Error('Auth required');
        setIsSaving(true);
        try {
            await api.delete(`/api/profiles/me/saved-profiles/${profileId}`, { oxyServices, activeSessionId });
            setSavedProfileIds(prev => {
                const next = new Set(prev);
                next.delete(profileId);
                return next;
            });
        } finally {
            setIsSaving(false);
        }
    }, [oxyServices, activeSessionId]);

    return (
        <SavedProfilesContext.Provider value={{ isSaving, savedProfileIds, isProfileSaved, saveProfile, unsaveProfile, refresh: load }}>
            {children}
        </SavedProfilesContext.Provider>
    );
}

export function useSavedProfiles() {
    const ctx = useContext(SavedProfilesContext);
    if (!ctx) throw new Error('useSavedProfiles must be used within SavedProfilesProvider');
    return ctx;
}


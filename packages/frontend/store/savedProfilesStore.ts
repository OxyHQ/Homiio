import { create } from 'zustand';
import { useOxy } from '@oxyhq/services';
import { api } from '@/utils/api';

type SavedProfilesState = {
  savedProfileIds: string[];
  isSaving: boolean;
  setSavedProfileIds: (ids: string[]) => void;
  addSavedProfileId: (id: string) => void;
  removeSavedProfileId: (id: string) => void;
  setIsSaving: (saving: boolean) => void;
};

export const useSavedProfilesStore = create<SavedProfilesState>()((set) => ({
  savedProfileIds: [],
  isSaving: false,
  setSavedProfileIds: (ids) => set({ savedProfileIds: ids }),
  addSavedProfileId: (id) => set((state) => ({
    savedProfileIds: state.savedProfileIds.includes(id)
      ? state.savedProfileIds
      : [...state.savedProfileIds, id],
  })),
  removeSavedProfileId: (id) => set((state) => ({
    savedProfileIds: state.savedProfileIds.filter((x) => x !== id),
  })),
  setIsSaving: (isSaving) => set({ isSaving }),
}));

export function useSavedProfiles() {
  const { oxyServices, activeSessionId } = useOxy();
  const savedProfileIds = useSavedProfilesStore((s) => s.savedProfileIds);
  const isSaving = useSavedProfilesStore((s) => s.isSaving);
  const setSavedProfileIds = useSavedProfilesStore((s) => s.setSavedProfileIds);
  const addSavedProfileId = useSavedProfilesStore((s) => s.addSavedProfileId);
  const removeSavedProfileId = useSavedProfilesStore((s) => s.removeSavedProfileId);
  const setIsSaving = useSavedProfilesStore((s) => s.setIsSaving);

  const isProfileSaved = (profileId: string) => savedProfileIds.includes(profileId);

  const refresh = async () => {
    if (!oxyServices || !activeSessionId) return;
    const res = await api.get('/api/profiles/me/saved-profiles', { oxyServices, activeSessionId });
    const profiles = res.data?.data || res.data || [];
    const ids = profiles.map((p: any) => String(p._id));
    setSavedProfileIds(ids);
  };

  const saveProfile = async (profileId: string) => {
    if (!oxyServices || !activeSessionId) throw new Error('Auth required');
    setIsSaving(true);
    try {
      addSavedProfileId(profileId);
      await api.post('/api/profiles/me/save-profile', { profileId }, { oxyServices, activeSessionId });
    } catch (e) {
      removeSavedProfileId(profileId);
      throw e;
    } finally {
      setIsSaving(false);
    }
  };

  const unsaveProfile = async (profileId: string) => {
    if (!oxyServices || !activeSessionId) throw new Error('Auth required');
    setIsSaving(true);
    try {
      removeSavedProfileId(profileId);
      await api.delete(`/api/profiles/me/saved-profiles/${profileId}`, { oxyServices, activeSessionId });
    } catch (e) {
      addSavedProfileId(profileId);
      throw e;
    } finally {
      setIsSaving(false);
    }
  };

  return { isSaving, savedProfileIds, isProfileSaved, saveProfile, unsaveProfile, refresh };
}


import { create } from 'zustand';
import { useOxy } from '@oxyhq/services';
import { api } from '@/utils/api';

type SavedProfilesState = {
  savedOxyUserIds: string[];
  isSaving: boolean;
  setSavedOxyUserIds: (ids: string[]) => void;
  addSavedOxyUserId: (id: string) => void;
  removeSavedOxyUserId: (id: string) => void;
  setIsSaving: (saving: boolean) => void;
};

export const useSavedProfilesStore = create<SavedProfilesState>()((set) => ({
  savedOxyUserIds: [],
  isSaving: false,
  setSavedOxyUserIds: (ids) => set({ savedOxyUserIds: ids }),
  addSavedOxyUserId: (id) =>
    set((state) => ({
      savedOxyUserIds: state.savedOxyUserIds.includes(id)
        ? state.savedOxyUserIds
        : [...state.savedOxyUserIds, id],
    })),
  removeSavedOxyUserId: (id) =>
    set((state) => ({
      savedOxyUserIds: state.savedOxyUserIds.filter((x) => x !== id),
    })),
  setIsSaving: (isSaving) => set({ isSaving }),
}));

export function useSavedProfiles() {
  const { oxyServices, activeSessionId } = useOxy();
  const savedOxyUserIds = useSavedProfilesStore((s) => s.savedOxyUserIds);
  const isSaving = useSavedProfilesStore((s) => s.isSaving);
  const setSavedOxyUserIds = useSavedProfilesStore((s) => s.setSavedOxyUserIds);
  const addSavedOxyUserId = useSavedProfilesStore((s) => s.addSavedOxyUserId);
  const removeSavedOxyUserId = useSavedProfilesStore((s) => s.removeSavedOxyUserId);
  const setIsSaving = useSavedProfilesStore((s) => s.setIsSaving);

  const isProfileSaved = (oxyUserId: string) => savedOxyUserIds.includes(oxyUserId);

  const refresh = async () => {
    if (!oxyServices || !activeSessionId) return;
    const res = await api.get('/api/profiles/me/saved-profiles');
    const profiles = res.data?.data || res.data || [];
    const ids = profiles.map((p: { oxyUserId?: string }) => String(p.oxyUserId)).filter(Boolean);
    setSavedOxyUserIds(ids);
  };

  const saveProfile = async (oxyUserId: string) => {
    if (!oxyServices || !activeSessionId) throw new Error('Auth required');
    setIsSaving(true);
    try {
      addSavedOxyUserId(oxyUserId);
      await api.post('/api/profiles/me/save-profile', { oxyUserId });
    } catch (e) {
      removeSavedOxyUserId(oxyUserId);
      throw e;
    } finally {
      setIsSaving(false);
    }
  };

  const unsaveProfile = async (oxyUserId: string) => {
    if (!oxyServices || !activeSessionId) throw new Error('Auth required');
    setIsSaving(true);
    try {
      removeSavedOxyUserId(oxyUserId);
      await api.delete(`/api/profiles/me/saved-profiles/${oxyUserId}`);
    } catch (e) {
      addSavedOxyUserId(oxyUserId);
      throw e;
    } finally {
      setIsSaving(false);
    }
  };

  return { isSaving, savedOxyUserIds, isProfileSaved, saveProfile, unsaveProfile, refresh };
}

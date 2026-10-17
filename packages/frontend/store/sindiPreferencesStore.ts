import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The person's Sindi preferences on this device (Settings → Sindi), persisted
 * like the rest of the app's UI preferences (`store/uiStore.ts`).
 *
 * `tips` decides whether an empty conversation with Sindi offers its starters
 * (the agent's own, from Alia) over the composer, on the panel and the
 * full-screen chat.
 */
interface SindiPreferencesState {
  tips: boolean;
  setTips: (tips: boolean) => void;
  /** Back to the defaults. */
  reset: () => void;
}

const DEFAULTS = { tips: true } as const;

export const useSindiPreferences = create<SindiPreferencesState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setTips: (tips) => set({ tips }),
      reset: () => set({ ...DEFAULTS }),
    }),
    {
      name: '@homiio/sindi-preferences',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ tips: state.tips }),
    },
  ),
);

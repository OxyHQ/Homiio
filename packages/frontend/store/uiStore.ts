import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Cross-cutting UI state (sidebar layout, in-app overlays). Persisted across
 * sessions so the user's chosen sidebar layout is restored on next launch.
 */
interface UIState {
  /** Whether the desktop sidebar is collapsed to the icon-only rail. */
  sidebarCollapsed: boolean;
  /** Whether the "Recent Properties" section is expanded. */
  recentPropertiesOpen: boolean;
  /** Whether the "Saved Folders" section is expanded. */
  savedFoldersOpen: boolean;

  toggleSidebarCollapsed: () => void;
  setSidebarCollapsed: (value: boolean) => void;
  setRecentPropertiesOpen: (value: boolean) => void;
  setSavedFoldersOpen: (value: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      recentPropertiesOpen: true,
      savedFoldersOpen: true,
      toggleSidebarCollapsed: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (value) => set({ sidebarCollapsed: value }),
      setRecentPropertiesOpen: (value) => set({ recentPropertiesOpen: value }),
      setSavedFoldersOpen: (value) => set({ savedFoldersOpen: value }),
    }),
    {
      name: '@homiio/ui-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        recentPropertiesOpen: state.recentPropertiesOpen,
        savedFoldersOpen: state.savedFoldersOpen,
      }),
    },
  ),
);

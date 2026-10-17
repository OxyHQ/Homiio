import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Cross-cutting UI state (sidebar layout, in-app overlays).
 *
 * The persisted slice (sidebar collapse) restores the user's chosen desktop
 * layout on next launch. The
 * mobile drawer open-state is deliberately transient — an overlay drawer
 * should never re-open itself after a reload — so it is excluded from
 * persistence via `partialize`.
 */
interface UIState {
  /** Whether the desktop sidebar is collapsed to the icon-only rail. */
  sidebarCollapsed: boolean;
  /**
   * Whether `AppShell`'s navigation drawer is open (it drives the shell's
   * controlled `drawerOpen`). Only meaningful below Bloom's `lg`, where the
   * sidebar is a drawer; the shell ignores it while the rail sits in flow.
   */
  mobileDrawerOpen: boolean;

  toggleSidebarCollapsed: () => void;
  setSidebarCollapsed: (value: boolean) => void;
  openMobileDrawer: () => void;
  closeMobileDrawer: () => void;
  toggleMobileDrawer: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileDrawerOpen: false,
      toggleSidebarCollapsed: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (value) => set({ sidebarCollapsed: value }),
      openMobileDrawer: () => set({ mobileDrawerOpen: true }),
      closeMobileDrawer: () => set({ mobileDrawerOpen: false }),
      toggleMobileDrawer: () => set((state) => ({ mobileDrawerOpen: !state.mobileDrawerOpen })),
    }),
    {
      name: '@homiio/ui-store',
      storage: createJSONStorage(() => AsyncStorage),
      // Version 1 dropped the Sindi panel's open-state: Sindi is the SDK's sheet.
      version: 1,
      migrate: (persisted) => ({
        sidebarCollapsed: Boolean((persisted as { sidebarCollapsed?: unknown })?.sidebarCollapsed),
      }),
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed }),
    },
  ),
);

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Cross-cutting UI state (sidebar layout, in-app overlays).
 *
 * The persisted slice (sidebar collapse + the Sindi panel
 * open-state) restores the user's chosen desktop layout on next launch. The
 * mobile drawer open-state is deliberately transient — an overlay drawer
 * should never re-open itself after a reload — so it is excluded from
 * persistence via `partialize`.
 */
interface UIState {
  /** Whether the desktop sidebar is collapsed to the icon-only rail. */
  sidebarCollapsed: boolean;
  /**
   * Whether the navigation drawer is open as an overlay on small (mobile)
   * screens, where the persistent sidebar is hidden in favor of the bottom
   * bar. Always closed on large screens (the sidebar is always visible there).
   */
  mobileDrawerOpen: boolean;
  /**
   * Whether the docked Sindi AI chat panel is open. It sits inline between the
   * SideBar and the main content on wide screens and pushes the content (not an
   * overlay). A desktop-layout preference like `sidebarCollapsed`, so it is
   * persisted and restores on reload. Self-gated to wide screens by the panel.
   */
  sindiPanelOpen: boolean;

  toggleSidebarCollapsed: () => void;
  setSidebarCollapsed: (value: boolean) => void;
  openMobileDrawer: () => void;
  closeMobileDrawer: () => void;
  toggleMobileDrawer: () => void;
  openSindiPanel: () => void;
  closeSindiPanel: () => void;
  toggleSindiPanel: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileDrawerOpen: false,
      sindiPanelOpen: false,
      toggleSidebarCollapsed: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (value) => set({ sidebarCollapsed: value }),
      openMobileDrawer: () => set({ mobileDrawerOpen: true }),
      closeMobileDrawer: () => set({ mobileDrawerOpen: false }),
      toggleMobileDrawer: () =>
        set((state) => ({ mobileDrawerOpen: !state.mobileDrawerOpen })),
      openSindiPanel: () => set({ sindiPanelOpen: true }),
      closeSindiPanel: () => set({ sindiPanelOpen: false }),
      toggleSindiPanel: () =>
        set((state) => ({ sindiPanelOpen: !state.sindiPanelOpen })),
    }),
    {
      name: '@homiio/ui-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        sindiPanelOpen: state.sindiPanelOpen,
      }),
    },
  ),
);

import React from 'react';
import {
  View,
  Pressable,
  Platform,
  Linking,
  StyleSheet,
  useWindowDimensions,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  SlideInLeft,
  SlideOutLeft,
} from 'react-native-reanimated';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Portal } from '@oxy.so/bloom/portal';
import {
  Sidebar,
  type SidebarIcon,
  type SidebarMode,
  type SidebarNavItem,
  type SidebarTree,
  type SidebarTreeFolder,
  type SidebarTreeItem,
} from '@oxy.so/bloom/sidebar';
import {
  RiArrowLeftRightLine,
  RiBookmarkLine,
  RiCalendarLine,
  RiCalendarScheduleLine,
  RiFilePaper2Line,
  RiFileTextLine,
  RiGroupLine,
  RiHomeLine,
  RiHotelBedLine,
  RiKey2Line,
  RiLightbulbLine,
  RiMegaphoneLine,
  RiSearchLine,
  RiShieldLine,
  RiStarLine,
  RiUserLine,
} from '@oxy.so/bloom/icons';
import { openAccountDialog, useOxy, ProfileButton } from '@oxy.so/services';

import { useRentalMode } from '@/context/RentalModeContext';
import { useProfile } from '@/context/ProfileContext';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import { useHostStatus } from '@/hooks/useHostStatus';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';
import { useUIStore } from '@/store/uiStore';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';
import { getPropertyTitle } from '@/utils/propertyUtils';
import { SindiIcon } from '@/assets/icons';
import type { BrowseMode } from '@/components/search/types';

import { SIDEBAR_EXPANDED_WIDTH, SIDEBAR_GUTTER, SIDEBAR_MASK_CLEARANCE } from './dimensions';

/**
 * Sliver of viewport kept to the right of the mobile overlay drawer so the
 * panel never spans the full width on the narrowest phones and the underlying
 * screen always peeks through behind the dimming scrim.
 */
const MOBILE_DRAWER_EDGE_GAP = 56;

/**
 * Dimming scrim painted over the whole viewport behind the mobile overlay
 * drawer. Matches the `overlayColor` of the inbox app's `front`-type drawer.
 */
const MOBILE_DRAWER_SCRIM = 'rgba(0, 0, 0, 0.3)';

/** Slide / fade duration (ms) for the mobile overlay drawer. */
const MOBILE_DRAWER_DURATION = 250;

/** Pressable that participates in Reanimated entering/exiting transitions. */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const TERMS_URL = 'https://oxy.so/company/transparency/policies/terms-of-service';
const PRIVACY_URL = 'https://oxy.so/company/transparency/policies/privacy';

/** Most saved folders / recently viewed properties the tree lists. */
const MAX_FOLDERS = 5;
const MAX_RECENT = 10;

/** Sindi's brand glyph (`size` / `color`) as a Bloom icon (`width` / `fill`). */
const SindiSidebarIcon: SidebarIcon = ({ width, height, fill }) => (
  <SindiIcon size={width ?? height ?? 20} color={fill} />
);

/**
 * The browse modes, in display order. The `⌥⌃` + digit hint Bloom shows on
 * hover is bound below in {@link useModeShortcuts}; the digit is the row's
 * 1-based position, so the hint and the binding cannot drift apart.
 */
const MODE_ROWS: readonly { mode: BrowseMode; icon: SidebarIcon; labelKey: string }[] = [
  { mode: 'long_term', icon: RiHomeLine, labelKey: 'sidebar.mode.longTerm' },
  { mode: 'vacation', icon: RiCalendarLine, labelKey: 'sidebar.mode.vacation' },
  { mode: 'buy', icon: RiKey2Line, labelKey: 'sidebar.mode.buy' },
  { mode: 'exchange', icon: RiArrowLeftRightLine, labelKey: 'sidebar.mode.exchange' },
];

const isBrowseMode = (key: string): key is BrowseMode =>
  MODE_ROWS.some((row) => row.mode === key);

const isSameDay = (a: Date, b: Date): boolean =>
  a.getDate() === b.getDate() &&
  a.getMonth() === b.getMonth() &&
  a.getFullYear() === b.getFullYear();

/** Today / Yesterday / Earlier, as the recently-viewed row's meta chip. */
const dayBucket = (
  timestamp: number,
  labels: { today: string; yesterday: string; earlier: string },
): string => {
  const date = new Date(timestamp);
  const now = new Date();
  if (isSameDay(date, now)) return labels.today;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return isSameDay(date, yesterday) ? labels.yesterday : labels.earlier;
};

/**
 * Web-only `⌥⌃1..4` (Alt+Ctrl+digit) browse-mode shortcuts. Bloom only renders
 * the hint; binding the keys is the app's job.
 */
function useModeShortcuts(setBrowseMode: (mode: BrowseMode) => void) {
  React.useEffect(() => {
    if (Platform.OS !== 'web') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only Alt+Ctrl chords; let Cmd-based combos (e.g. macOS) fall through.
      if (!e.altKey || !e.ctrlKey || e.metaKey) return;

      // Never hijack a digit the user is typing into a field.
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) {
        return;
      }

      // `code` (physical key) is layout-stable while Alt is held; `key` can
      // mutate to an alternate glyph under Alt on macOS.
      const index = MODE_ROWS.findIndex((_, i) => e.code === `Digit${i + 1}`);
      if (index === -1) return;

      e.preventDefault();
      setBrowseMode(MODE_ROWS[index].mode);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setBrowseMode]);
}

/**
 * Web pins the column to the viewport (the document is the scroll owner);
 * native fills the row it sits in.
 */
const pinnedColumnStyle: ViewStyle =
  Platform.OS === 'web'
    ? ({
        position: 'sticky',
        top: 0,
        alignSelf: 'flex-start',
        height: '100vh',
        maxHeight: '100vh',
      } as unknown as ViewStyle)
    : { height: '100%' };

const styles = StyleSheet.create({
  column: {
    flexShrink: 0,
    flexDirection: 'column',
    padding: SIDEBAR_GUTTER,
    paddingRight: SIDEBAR_GUTTER + SIDEBAR_MASK_CLEARANCE,
    gap: SIDEBAR_GUTTER,
  },
  // Bloom's panel defaults to `height: '100%'`; in the column it shares the
  // height with the account button below it.
  panel: {
    height: undefined,
    flex: 1,
    minHeight: 0,
  },
});

/**
 * Homiio's navigation sidebar: Bloom `Sidebar` (panel variant) plus the Oxy
 * `ProfileButton` beneath it.
 *
 * - Wide screens (>= 500): an inline column, collapsible to Bloom's icon rail;
 *   the collapse choice persists in `uiStore`.
 * - Below that the native bottom tabs own navigation and the sidebar becomes
 *   an on-demand slide-in overlay drawer (`mobileDrawerOpen`), rendered through
 *   Bloom's root Portal so it covers the whole viewport. It stays mounted on
 *   native phones for that reason.
 */
export function SideBar() {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const isMobile = !useIsScreenNotMobile();

  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useUIStore((s) => s.setSidebarCollapsed);
  const mobileDrawerOpen = useUIStore((s) => s.mobileDrawerOpen);
  const closeMobileDrawer = useUIStore((s) => s.closeMobileDrawer);
  const sindiPanelOpen = useUIStore((s) => s.sindiPanelOpen);
  const toggleSindiPanel = useUIStore((s) => s.toggleSindiPanel);

  const { mode, browseMode, setBrowseMode } = useRentalMode();
  const { canAccessRoommates } = useProfile();
  const { isHost } = useHostStatus();
  const { isAuthenticated } = useOxy();

  const { folders } = useSavedPropertiesContext();
  const { properties: recentProperties } = useRecentlyViewed();

  useModeShortcuts(setBrowseMode);

  /* --------------------------------------------------------------
     Handlers
     -------------------------------------------------------------- */
  const handleNavigate = React.useCallback(
    (route: string) => {
      // Dismiss the mobile overlay drawer on any navigation so the
      // destination screen isn't hidden behind it. No-op on wide screens.
      closeMobileDrawer();
      if (pathname !== route) router.push(route);
    },
    [pathname, router, closeMobileDrawer],
  );

  // Sindi is a docked panel on wide screens (toggle inline, no navigation) but
  // the panel is wide-only, so from the mobile drawer Sindi keeps navigating to
  // the full-screen `/sindi` route (closing the drawer first).
  const handleSindi = React.useCallback(() => {
    if (!isMobile) {
      toggleSindiPanel();
      return;
    }
    handleNavigate('/sindi');
  }, [isMobile, toggleSindiPanel, handleNavigate]);

  const handleSettings = React.useCallback(() => handleNavigate('/settings'), [handleNavigate]);
  const handleProfile = React.useCallback(() => handleNavigate('/profile'), [handleNavigate]);
  const handleSignIn = React.useCallback(() => openAccountDialog(), []);

  /* --------------------------------------------------------------
     Navigation rows — mode-aware and role-gated
     -------------------------------------------------------------- */
  const items = React.useMemo<SidebarNavItem[]>(() => {
    const entries: SidebarNavItem[] = [
      { key: 'home', label: t('sidebar.navigation.home'), icon: RiHomeLine, href: '/' },
      { key: 'search', label: t('sidebar.navigation.explore'), icon: RiSearchLine, href: '/explore' },
    ];

    // Mode-dependent secondary nav: Applications for long-term tenants,
    // Stays for vacation bookings. Both require auth.
    if (isAuthenticated) {
      entries.push(
        mode === 'long_term'
          ? {
              key: 'applications',
              label: t('sidebar.navigation.applications'),
              icon: RiFileTextLine,
              href: '/applications',
            }
          : { key: 'stays', label: t('sidebar.navigation.stays'), icon: RiHotelBedLine, href: '/stays' },
      );
    }

    entries.push(
      { key: 'profile', label: t('sidebar.navigation.profile'), icon: RiUserLine, href: '/profile' },
      { key: 'tips', label: t('sidebar.navigation.tips'), icon: RiLightbulbLine, href: '/tips' },
      { key: 'evictions', label: t('sidebar.navigation.evictions'), icon: RiMegaphoneLine, href: '/evictions' },
      // Reviews explore — public (address reputation).
      { key: 'reviews', label: t('sidebar.navigation.reviews'), icon: RiStarLine, href: '/reviews' },
    );

    if (canAccessRoommates) {
      entries.push({ key: 'roommates', label: t('sidebar.navigation.roommates'), icon: RiGroupLine, href: '/roommates' });
    }

    if (isHost) {
      entries.push({
        key: 'host-calendar',
        label: t('sidebar.navigation.hostCalendar'),
        icon: RiCalendarScheduleLine,
        href: '/host/calendar',
      });
    }

    entries.push(
      { key: 'saved', label: t('sidebar.navigation.saved'), icon: RiBookmarkLine, href: '/saved' },
      // An action row: a docked panel on wide screens, a route from the drawer.
      { key: 'sindi', label: t('sidebar.navigation.sindi'), icon: SindiSidebarIcon, onPress: handleSindi },
    );

    return entries;
  }, [t, isAuthenticated, mode, canAccessRoommates, isHost, handleSindi]);

  // The legal links were a web-only footer; they are external, so they are
  // action rows rather than `href` rows.
  const secondaryItems = React.useMemo<SidebarNavItem[]>(
    () =>
      Platform.OS === 'web'
        ? [
            {
              key: 'privacy',
              label: t('sidebar.menu.privacy'),
              icon: RiShieldLine,
              onPress: () => void Linking.openURL(PRIVACY_URL),
            },
            {
              key: 'terms',
              label: t('sidebar.menu.terms'),
              icon: RiFilePaper2Line,
              onPress: () => void Linking.openURL(TERMS_URL),
            },
          ]
        : [],
    [t],
  );

  const selected = React.useMemo(() => {
    const exact = items.find((item) => item.href === pathname);
    if (exact) return exact.key;
    if (pathname.startsWith('/saved')) return 'saved';
    // Bloom highlights a single row: a route match wins, otherwise the Sindi
    // row reflects the open docked panel.
    return sindiPanelOpen ? 'sindi' : undefined;
  }, [items, pathname, sindiPanelOpen]);

  const modes = React.useMemo<SidebarMode[]>(
    () =>
      MODE_ROWS.map((row, index) => ({
        key: row.mode,
        label: t(row.labelKey),
        icon: row.icon,
        shortcut: `⌥⌃${index + 1}`,
      })),
    [t],
  );

  const handleModeChange = React.useCallback(
    (key: string) => {
      if (isBrowseMode(key)) setBrowseMode(key);
    },
    [setBrowseMode],
  );

  /* --------------------------------------------------------------
     Tree — saved folders and recently viewed, one folder each
     -------------------------------------------------------------- */
  const tree = React.useMemo<SidebarTree | undefined>(() => {
    const safeFolders = Array.isArray(folders) ? folders : [];
    const folderItems: SidebarTreeItem[] = safeFolders
      .filter((folder) => !folder.isDefault && (folder.propertyCount ?? 0) > 0)
      .slice(0, MAX_FOLDERS)
      .map((folder) => ({
        key: `folder:${folder.id}`,
        label: folder.name,
        meta: String(folder.propertyCount ?? 0),
        href: `/saved/${folder.id}`,
      }));

    const labels = {
      today: t('sidebar.recent.today'),
      yesterday: t('sidebar.recent.yesterday'),
      earlier: t('sidebar.recent.earlier'),
    };
    const recent: { id: string; title: string; timestamp: number }[] = [];
    for (const property of recentProperties ?? []) {
      if (!property?.id) continue;
      const stamp = property.updatedAt ?? property.createdAt;
      // Properties with no timestamp sort first (treated as the most recent);
      // MAX_SAFE_INTEGER keeps this pure during render, unlike `Date.now()`.
      const timestamp = stamp ? new Date(stamp).getTime() : Number.MAX_SAFE_INTEGER;
      recent.push({ id: property.id, title: getPropertyTitle(property, 'short'), timestamp });
    }
    const recentItems: SidebarTreeItem[] = recent
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, MAX_RECENT)
      .map((entry) => ({
        key: `recent:${entry.id}`,
        label: entry.title,
        meta:
          entry.timestamp === Number.MAX_SAFE_INTEGER
            ? labels.today
            : dayBucket(entry.timestamp, labels),
        href: `/properties/${entry.id}`,
      }));

    const treeFolders: SidebarTreeFolder[] = [];
    if (folderItems.length > 0) {
      treeFolders.push({
        key: 'saved-folders',
        label: t('sidebar.savedProperties.title'),
        items: folderItems,
        defaultOpen: true,
      });
    }
    if (recentItems.length > 0) {
      treeFolders.push({
        key: 'recently-viewed',
        label: t('sidebar.recent.title'),
        items: recentItems,
        defaultOpen: true,
      });
    }
    return treeFolders.length > 0
      ? { label: t('profile.sections.activity'), folders: treeFolders }
      : undefined;
  }, [folders, recentProperties, t]);

  const selectedTreeItem = React.useMemo(() => {
    const folder = pathname.match(/^\/saved\/([^/]+)/);
    if (folder) return `folder:${folder[1]}`;
    const property = pathname.match(/^\/properties\/([^/]+)/);
    return property ? `recent:${property[1]}` : undefined;
  }, [pathname]);

  const handleNavItem = React.useCallback(
    (item: SidebarNavItem | SidebarTreeItem) => {
      if (item.href) handleNavigate(item.href);
    },
    [handleNavigate],
  );

  const renderColumn = (options: { mobile: boolean; collapsed: boolean }) => (
    <>
      <Sidebar
        variant="panel"
        items={items}
        secondaryItems={secondaryItems}
        selected={selected}
        onNavigate={handleNavItem}
        modes={modes}
        mode={browseMode}
        onModeChange={handleModeChange}
        tree={tree}
        selectedTreeItem={selectedTreeItem}
        onTreeItemPress={handleNavItem}
        collapsed={options.collapsed}
        onCollapsedChange={setSidebarCollapsed}
        mobile={options.mobile}
        onClose={closeMobileDrawer}
        fluid={options.mobile}
        showThemeToggle={false}
        showSearch={false}
        style={styles.panel}
      />
      <View style={options.collapsed ? { alignItems: 'center' } : undefined}>
        <ProfileButton
          expanded={!options.collapsed}
          onNavigateManage={handleSettings}
          onNavigateProfile={handleProfile}
          onAddAccount={handleSignIn}
        />
      </View>
    </>
  );

  /* ==============================================================
     MOBILE OVERLAY DRAWER (small screens)
     The panel slides in from the left over the current screen with a
     full-viewport dimming scrim behind it as a tap-to-dismiss target.
     ============================================================== */
  if (isMobile) {
    // No ContentPanel mask beside the drawer, so no mask clearance either.
    const drawerWidth = Math.min(
      SIDEBAR_EXPANDED_WIDTH - SIDEBAR_MASK_CLEARANCE,
      width - MOBILE_DRAWER_EDGE_GAP,
    );
    const slideIn = SlideInLeft.duration(MOBILE_DRAWER_DURATION).easing(Easing.out(Easing.cubic));
    const slideOut = SlideOutLeft.duration(MOBILE_DRAWER_DURATION).easing(Easing.in(Easing.cubic));

    // The Portal host stays mounted while on mobile so Reanimated can play the
    // exit when `mobileDrawerOpen` flips to false. The full-screen wrapper is
    // `pointerEvents:'none'` so WHEN CLOSED it passes every touch through (the
    // RN-only `'box-none'` is invalid CSS — RN-Web drops it and freezes the
    // mobile-web screen); the scrim + drawer re-enable themselves with 'auto'.
    return (
      <Portal>
        <View className="flex-row" style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
          {mobileDrawerOpen && (
            <>
              <AnimatedPressable
                entering={FadeIn.duration(MOBILE_DRAWER_DURATION)}
                exiting={FadeOut.duration(MOBILE_DRAWER_DURATION)}
                accessibilityRole="button"
                accessibilityLabel={t('sidebar.close')}
                onPress={closeMobileDrawer}
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: MOBILE_DRAWER_SCRIM, pointerEvents: 'auto' },
                ]}
              />
              <Animated.View
                entering={slideIn}
                exiting={slideOut}
                className="h-full bg-background"
                style={[
                  styles.column,
                  {
                    width: drawerWidth,
                    paddingRight: SIDEBAR_GUTTER,
                    paddingTop: SIDEBAR_GUTTER + insets.top,
                    paddingBottom: SIDEBAR_GUTTER + insets.bottom,
                    pointerEvents: 'auto',
                  },
                ]}
              >
                {renderColumn({ mobile: true, collapsed: false })}
              </Animated.View>
            </>
          )}
        </View>
      </Portal>
    );
  }

  return (
    <View
      style={[
        styles.column,
        pinnedColumnStyle,
        Platform.OS !== 'web' && { paddingTop: SIDEBAR_GUTTER + insets.top, paddingBottom: SIDEBAR_GUTTER + insets.bottom },
      ]}
    >
      {renderColumn({ mobile: false, collapsed: sidebarCollapsed })}
    </View>
  );
}

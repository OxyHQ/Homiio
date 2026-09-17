import React from 'react';
import { Platform, Linking } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type {
  SidebarIcon,
  SidebarMode,
  SidebarNavItem,
  SidebarProps,
  SidebarTeam,
  SidebarTree,
  SidebarTreeFolder,
  SidebarTreeItem,
} from '@oxy.so/bloom/sidebar';
import {
  RiAccountCircleLine,
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
  RiLoginBoxLine,
  RiMegaphoneLine,
  RiSearchLine,
  RiSettings3Line,
  RiShieldLine,
  RiStarLine,
  RiUserLine,
} from '@oxy.so/bloom/icons';
import { getAccountDisplayName, getAccountFallbackHandle } from '@oxy.so/core';
import { openAccountDialog, useAuth, useOxy } from '@oxy.so/services';

import { LogoIcon } from '@/assets/logo';
import { useRentalMode } from '@/context/RentalModeContext';
import { useProfile } from '@/context/ProfileContext';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import { useHostStatus } from '@/hooks/useHostStatus';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';
import { useColors } from '@/hooks/useThemeColor';
import { useUIStore } from '@/store/uiStore';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';
import { getPropertyTitle } from '@/utils/propertyUtils';
import { SindiIcon } from '@/assets/icons';
import type { BrowseMode } from '@/components/search/types';

/** What `AppShell` takes as `sidebar`: the drawer-only props are the shell's. */
export type HomiioSidebarProps = Omit<SidebarProps, 'mobile' | 'onClose' | 'flat'>;

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
 * Homiio's navigation sidebar, as the PROPS for Bloom's `Sidebar`. It renders
 * nothing: `app/_layout.tsx` hands the result to `AppShell`, which owns the
 * frame — the rail in flow from `lg`, the overlay drawer below it — so there is
 * one sidebar mount and one drawer, not a copy per breakpoint.
 *
 * Call it ONCE per app (it binds the `⌥⌃1..4` mode shortcuts). The collapse
 * choice persists in `uiStore`.
 *
 * The Oxy account lives in the `team` card at the foot of the rail (signed in)
 * or a "Sign in" row (signed out): Bloom's `Sidebar` has no slot for an
 * arbitrary `ProfileButton`, and the card's menu reaches the same Oxy account
 * dialog.
 */
export function useHomiioSidebarProps(): HomiioSidebarProps {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const { t } = useTranslation();
  const colors = useColors();

  const isMobile = !useIsScreenNotMobile();

  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useUIStore((s) => s.setSidebarCollapsed);
  const closeMobileDrawer = useUIStore((s) => s.closeMobileDrawer);
  const sindiPanelOpen = useUIStore((s) => s.sindiPanelOpen);
  const toggleSindiPanel = useUIStore((s) => s.toggleSindiPanel);

  const { mode, browseMode, setBrowseMode } = useRentalMode();
  const { canAccessRoommates } = useProfile();
  const { isHost } = useHostStatus();
  const { user, isAuthenticated, isAuthResolved, signIn } = useAuth();
  const { oxyServices } = useOxy();

  const { folders } = useSavedPropertiesContext();
  const { properties: recentProperties } = useRecentlyViewed();

  useModeShortcuts(setBrowseMode);

  /* --------------------------------------------------------------
     Handlers
     -------------------------------------------------------------- */
  const handleNavigate = React.useCallback(
    (route: string) => {
      // Dismiss the drawer on any navigation so the destination screen isn't
      // hidden behind it. A no-op while the rail sits in flow.
      closeMobileDrawer();
      if (pathname !== route) router.push(route);
    },
    [pathname, router, closeMobileDrawer],
  );

  // Sindi is a docked panel on wide screens (toggle inline, no navigation) but
  // the panel is wide-only, so on a phone Sindi keeps navigating to the
  // full-screen `/sindi` route (closing the drawer first).
  const handleSindi = React.useCallback(() => {
    if (!isMobile) {
      toggleSindiPanel();
      return;
    }
    handleNavigate('/sindi');
  }, [isMobile, toggleSindiPanel, handleNavigate]);

  const handleSettings = React.useCallback(() => handleNavigate('/settings'), [handleNavigate]);
  const handleProfile = React.useCallback(() => handleNavigate('/profile'), [handleNavigate]);
  const handleSignIn = React.useCallback(() => void signIn(), [signIn]);

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

  // Signed out, the account is a "Sign in" row above the legal links; signed
  // in it is the `team` card below. Nothing while auth is still resolving, so
  // a returning user never sees "Sign in" flash first.
  const secondaryItems = React.useMemo<SidebarNavItem[]>(() => {
    const entries: SidebarNavItem[] = [];
    if (isAuthResolved && !isAuthenticated) {
      entries.push({
        key: 'sign-in',
        label: t('sidebar.actions.signIn'),
        icon: RiLoginBoxLine,
        onPress: handleSignIn,
      });
    }
    // The legal links were a web-only footer; they are external, so they are
    // action rows rather than `href` rows.
    if (Platform.OS === 'web') {
      entries.push(
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
      );
    }
    return entries;
  }, [t, isAuthResolved, isAuthenticated, handleSignIn]);

  // The signed-in account: identity on the card, and a menu that reaches the
  // Oxy account dialog (switch, add, sign out) plus Homiio's own pages.
  const team = React.useMemo<SidebarTeam | undefined>(() => {
    if (!isAuthenticated || !user) return undefined;
    const name = getAccountDisplayName(user);
    const handle = getAccountFallbackHandle(user);
    const avatarUrl = user.avatar ? oxyServices.getFileDownloadUrl(user.avatar, 'thumb') : undefined;
    return {
      name,
      email: handle ? `@${handle}` : undefined,
      avatar: avatarUrl ? { source: avatarUrl } : { initials: name.charAt(0).toUpperCase() },
      groups: [
        {
          id: 'account',
          items: [
            { key: 'profile', label: t('sidebar.navigation.profile'), icon: RiUserLine, onPress: handleProfile },
            { key: 'settings', label: t('sidebar.navigation.settings'), icon: RiSettings3Line, onPress: handleSettings },
            {
              key: 'account',
              label: t('sidebar.menu.account'),
              icon: RiAccountCircleLine,
              onPress: () => openAccountDialog('accounts'),
            },
          ],
        },
      ],
    };
  }, [isAuthenticated, user, oxyServices, t, handleProfile, handleSettings]);

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

  const logo = React.useMemo<HomiioSidebarProps['logo']>(
    () => ({
      icon: <LogoIcon size={26} color={colors.primary} />,
      wordmark: 'Homiio',
      href: '/',
      onPress: () => handleNavigate('/'),
      accessibilityLabel: 'Homiio',
    }),
    [colors.primary, handleNavigate],
  );

  return {
    variant: 'panel',
    logo,
    items,
    secondaryItems,
    selected,
    onNavigate: handleNavItem,
    modes,
    mode: browseMode,
    onModeChange: handleModeChange,
    tree,
    selectedTreeItem,
    onTreeItemPress: handleNavItem,
    team,
    collapsed: sidebarCollapsed,
    onCollapsedChange: setSidebarCollapsed,
    showThemeToggle: false,
    showSearch: false,
  };
}

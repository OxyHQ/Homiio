import React from 'react';
import {
  View,
  Pressable,
  Platform,
  Linking,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  SlideInLeft,
  SlideOutLeft,
} from 'react-native-reanimated';
import { useRouter, usePathname } from 'expo-router';
import { Portal } from '@oxyhq/bloom/portal';
import { useTranslation } from 'react-i18next';
import {
  Home,
  Search,
  FileText,
  BedDouble,
  User,
  Lightbulb,
  Users,
  CalendarClock,
  Bookmark,
  ChevronsLeft,
  ChevronsRight,
  ChevronRight,
  X,
  PlusCircle,
  UserCircle,
  Mail,
  Settings,
  ShieldCheck,
  LogOut,
  LogIn,
  UserPlus,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Text } from '@oxyhq/bloom/typography';
import { Button } from '@oxyhq/bloom/button';
import { Avatar } from '@oxyhq/bloom/avatar';
import { showSignInModal, useOxy } from '@oxyhq/services';
import {
  Menu,
  MenuTrigger,
  MenuOptions,
  MenuOption,
  renderers,
} from 'react-native-popup-menu';

import { colors } from '@/styles/colors';
import { useRentalMode } from '@/context/RentalModeContext';
import { useProfile } from '@/context/ProfileContext';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import { useHostStatus } from '@/hooks/useHostStatus';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';
import { useUIStore } from '@/store/uiStore';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';
import { webAlert } from '@/utils/api';
import { getPropertyTitle } from '@/utils/propertyUtils';
import { LogoIcon } from '@/assets/logo';

import { BaseSidebar } from './BaseSidebar';
import { NavItem } from './NavItem';
import { ModeToggle } from './ModeToggle';
import { SectionHeader } from './SectionHeader';
import { DateSeparator } from './DateSeparator';
import { RecentPropertyItem } from './RecentPropertyItem';
import { FolderRow } from './FolderSection';

/** Width breakpoint above which the user is allowed to collapse the sidebar. */
const LARGE_SCREEN_MIN_WIDTH = 768;

/** Width of the collapsed icon-only rail. */
const COLLAPSED_WIDTH = 48;

/** Width of the expanded sidebar. */
const EXPANDED_WIDTH = 240;

/**
 * Hairline styles for the sidebar's chrome border and inner dividers. Bloom's
 * `--border`/`--muted` CSS variables only resolve to the themed hairline on
 * web; on native the `border-border` / `bg-border` color classes don't pick up
 * the runtime variable reliably and a `borderWidth: 1` renders as a full
 * device-pixel rule that reads as a hard black line. Using an explicit Bloom
 * token (`colors.border`) at `StyleSheet.hairlineWidth` matches the subtle,
 * flat hairline the rest of the app draws (see the ~15 `borderColor:
 * colors.border` call sites) and renders identically on web and native.
 */
const sidebarBorders = StyleSheet.create({
  /** Right edge of the persistent rail / expanded panel + the drawer panel. */
  railEdge: {
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
  },
  /** Horizontal divider between sidebar sections (header → body, body → footer). */
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  /** Thin separator between groups inside the account popover menu. */
  menuSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
});

/**
 * Sliver of viewport kept to the right of the mobile overlay drawer so the
 * panel never spans the full width on the narrowest phones and the underlying
 * screen always peeks through behind the dimming scrim.
 */
const MOBILE_DRAWER_EDGE_GAP = 56;

/**
 * Dimming scrim painted over the whole viewport behind the mobile overlay
 * drawer. Matches the `overlayColor` of the inbox app's `front`-type
 * `expo-router/drawer` (`@react-navigation/drawer`) so the two apps share the
 * same slide-in-over-content feel.
 */
const MOBILE_DRAWER_SCRIM = 'rgba(0, 0, 0, 0.3)';

/**
 * Slide / fade duration (ms) for the mobile overlay drawer. Mirrors the
 * default transition timing of `@react-navigation/drawer`'s `front` drawer
 * that the inbox app relies on.
 */
const MOBILE_DRAWER_DURATION = 250;

/**
 * Pressable that participates in Reanimated layout (entering/exiting)
 * transitions — used for the fade-in scrim behind the mobile overlay drawer.
 * Created once at module scope to keep the animated wrapper stable.
 */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface NavEntry {
  key: string;
  icon: LucideIcon;
  iconActive: LucideIcon;
  label: string;
  route: string;
  shortcut?: string;
}

interface FolderEntry {
  id: string;
  name: string;
  color: string;
  icon: string;
  propertyCount: number;
  latestImages?: string[];
}

interface RecentEntry {
  id: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  /** Sortable timestamp (milliseconds since epoch). */
  timestamp: number;
}

interface DateGroup {
  label: string;
  items: RecentEntry[];
}

const isToday = (timestamp: number): boolean => {
  const date = new Date(timestamp);
  const now = new Date();
  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  );
};

const isYesterday = (timestamp: number): boolean => {
  const date = new Date(timestamp);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return (
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear()
  );
};

const groupByDate = (
  items: RecentEntry[],
  labels: { today: string; yesterday: string; earlier: string },
): DateGroup[] => {
  const today: RecentEntry[] = [];
  const yesterday: RecentEntry[] = [];
  const earlier: RecentEntry[] = [];

  for (const item of items) {
    if (isToday(item.timestamp)) {
      today.push(item);
    } else if (isYesterday(item.timestamp)) {
      yesterday.push(item);
    } else {
      earlier.push(item);
    }
  }

  const groups: DateGroup[] = [];
  if (today.length > 0) groups.push({ label: labels.today, items: today });
  if (yesterday.length > 0)
    groups.push({ label: labels.yesterday, items: yesterday });
  if (earlier.length > 0)
    groups.push({ label: labels.earlier, items: earlier });
  return groups;
};

const TERMS_URL =
  'https://oxy.so/company/transparency/policies/terms-of-service';
const PRIVACY_URL = 'https://oxy.so/company/transparency/policies/privacy';

/**
 * Render the Homiio logo as the sidebar header brand mark. The icon-only
 * variant keeps the rail width tight; the expanded variant adds breathing
 * room before the collapse button.
 */
const SidebarBrand = React.memo(function SidebarBrand({
  onPress,
}: {
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Homiio"
      className="p-1 mx-0.5 shrink-0 rounded-xl hover:bg-muted items-center justify-center"
    >
      <LogoIcon size={26} color={colors.primaryColor} />
    </Pressable>
  );
});

export function SideBar() {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const { t } = useTranslation();
  const { width } = useWindowDimensions();

  const isSidebarVisible = useIsScreenNotMobile();
  const isLargeScreen = width >= LARGE_SCREEN_MIN_WIDTH;

  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebarCollapsed = useUIStore((s) => s.toggleSidebarCollapsed);
  const mobileDrawerOpen = useUIStore((s) => s.mobileDrawerOpen);
  const closeMobileDrawer = useUIStore((s) => s.closeMobileDrawer);
  const savedFoldersOpen = useUIStore((s) => s.savedFoldersOpen);
  const setSavedFoldersOpen = useUIStore((s) => s.setSavedFoldersOpen);
  const recentPropertiesOpen = useUIStore((s) => s.recentPropertiesOpen);
  const setRecentPropertiesOpen = useUIStore((s) => s.setRecentPropertiesOpen);

  const { mode } = useRentalMode();
  const { canAccessRoommates } = useProfile();
  const { isHost } = useHostStatus();
  const { isAuthenticated, user, logout } = useOxy();

  const { savedProperties, folders } = useSavedPropertiesContext();
  const { properties: recentProperties, removeProperty } = useRecentlyViewed();

  // Only honor the user-chosen collapsed state on screens wide enough to
  // expand again — below 768px we always render the expanded layout.
  const isCollapsed = isLargeScreen && sidebarCollapsed;

  /* --------------------------------------------------------------
     Derived nav entries — mode-aware secondary item
     -------------------------------------------------------------- */
  const navEntries = React.useMemo<NavEntry[]>(() => {
    const entries: NavEntry[] = [
      {
        key: 'home',
        icon: Home,
        iconActive: Home,
        label: t('sidebar.navigation.home'),
        route: '/',
      },
      {
        key: 'search',
        icon: Search,
        iconActive: Search,
        label: t('sidebar.navigation.explore'),
        route: '/search',
      },
    ];

    // Mode-dependent secondary nav: Applications for long-term tenants,
    // Stays for vacation bookings. Both require auth.
    if (isAuthenticated) {
      if (mode === 'long_term') {
        entries.push({
          key: 'applications',
          icon: FileText,
          iconActive: FileText,
          label: t('sidebar.navigation.applications', {
            defaultValue: 'My applications',
          }),
          route: '/applications',
        });
      } else {
        entries.push({
          key: 'stays',
          icon: BedDouble,
          iconActive: BedDouble,
          label: t('sidebar.navigation.stays', { defaultValue: 'Stays' }),
          route: '/stays',
        });
      }
    }

    entries.push({
      key: 'profile',
      icon: User,
      iconActive: User,
      label: t('sidebar.navigation.profile'),
      route: '/profile',
    });

    entries.push({
      key: 'tips',
      icon: Lightbulb,
      iconActive: Lightbulb,
      label: t('sidebar.navigation.tips', { defaultValue: 'Tips' }),
      route: '/tips',
    });

    if (canAccessRoommates) {
      entries.push({
        key: 'roommates',
        icon: Users,
        iconActive: Users,
        label: t('sidebar.navigation.roommates'),
        route: '/roommates',
      });
    }

    if (isHost) {
      entries.push({
        key: 'host-calendar',
        icon: CalendarClock,
        iconActive: CalendarClock,
        label: t('sidebar.navigation.hostCalendar', {
          defaultValue: 'Host calendar',
        }),
        route: '/host/calendar',
      });
    }

    return entries;
  }, [t, isAuthenticated, mode, canAccessRoommates, isHost]);

  /* --------------------------------------------------------------
     Folders — exclude default folder + empty folders, max 5
     -------------------------------------------------------------- */
  const folderEntries = React.useMemo<FolderEntry[]>(() => {
    const safeFolders = Array.isArray(folders) ? folders : [];
    const safeProps = Array.isArray(savedProperties) ? savedProperties : [];

    return safeFolders
      .filter((folder) => !folder.isDefault && (folder.propertyCount ?? 0) > 0)
      .map((folder) => {
        const folderProperties = safeProps.filter(
          (property) => property.folderId === folder._id,
        );
        const latestImages = [...folderProperties]
          .sort((a, b) => {
            const aTs = new Date(
              a.savedAt ?? a.updatedAt ?? a.createdAt,
            ).getTime();
            const bTs = new Date(
              b.savedAt ?? b.updatedAt ?? b.createdAt,
            ).getTime();
            return bTs - aTs;
          })
          .slice(0, 2)
          .map((property) => {
            const firstImage = Array.isArray(property.images)
              ? property.images[0]
              : undefined;
            if (typeof firstImage === 'string') return firstImage;
            if (
              firstImage &&
              typeof firstImage === 'object' &&
              'url' in firstImage
            ) {
              return firstImage.url;
            }
            return undefined;
          })
          .filter((url): url is string => Boolean(url));

        return {
          id: folder._id,
          name: folder.name,
          color: folder.color ?? colors.primaryColor,
          icon: folder.icon ?? 'folder',
          propertyCount: folder.propertyCount ?? 0,
          latestImages: latestImages.length > 0 ? latestImages : undefined,
        };
      })
      .slice(0, 5);
  }, [folders, savedProperties]);

  /* --------------------------------------------------------------
     Recently viewed properties — max 10, sorted recent-first
     -------------------------------------------------------------- */
  const recentEntries = React.useMemo<RecentEntry[]>(() => {
    const result: RecentEntry[] = [];
    for (const property of recentProperties ?? []) {
      if (!property) continue;
      const id = property._id ?? property.id;
      if (!id) continue;

      const firstImage = Array.isArray(property.images)
        ? property.images[0]
        : undefined;
      const imageUrl =
        typeof firstImage === 'string'
          ? firstImage
          : firstImage &&
              typeof firstImage === 'object' &&
              'url' in firstImage
            ? firstImage.url
            : undefined;

      const title = getPropertyTitle(property, 'short');
      const subtitle = property.address?.cityName
        ? property.address.regionName
          ? `${property.address.cityName}, ${property.address.regionName}`
          : property.address.cityName
        : undefined;

      // Properties with no timestamp are treated as the most recent and sort
      // first. Using MAX_SAFE_INTEGER (instead of the impure `Date.now()`)
      // keeps this pure during render while preserving the "newest-first"
      // ordering for entries that lack both `updatedAt` and `createdAt`.
      const timestamp = property.updatedAt
        ? new Date(property.updatedAt).getTime()
        : property.createdAt
          ? new Date(property.createdAt).getTime()
          : Number.MAX_SAFE_INTEGER;

      result.push({ id, title, subtitle, imageUrl, timestamp });
    }
    return result.sort((a, b) => b.timestamp - a.timestamp).slice(0, 10);
  }, [recentProperties]);

  const dateGroups = React.useMemo(
    () =>
      groupByDate(recentEntries, {
        today: t('sidebar.recent.today', { defaultValue: 'Today' }),
        yesterday: t('sidebar.recent.yesterday', {
          defaultValue: 'Yesterday',
        }),
        earlier: t('sidebar.recent.earlier', { defaultValue: 'Earlier' }),
      }),
    [recentEntries, t],
  );

  const activeRecentId = React.useMemo(() => {
    const match = pathname.match(/^\/properties\/([^/]+)/);
    return match ? match[1] : null;
  }, [pathname]);

  /* --------------------------------------------------------------
     Auth / display helpers
     -------------------------------------------------------------- */
  const displayName = React.useMemo(() => {
    if (!user) return t('common.user', { defaultValue: 'User' });
    if (typeof user.name === 'string') return user.name;
    return (
      user.name?.full ||
      user.name?.first ||
      user.username ||
      t('common.user', { defaultValue: 'User' })
    );
  }, [user, t]);

  const avatarSource = React.useMemo<string | undefined>(() => {
    if (!user) return undefined;
    const candidate = (user as { avatar?: unknown }).avatar;
    return typeof candidate === 'string' ? candidate : undefined;
  }, [user]);

  /* --------------------------------------------------------------
     Handlers
     -------------------------------------------------------------- */
  const handleNavigate = React.useCallback(
    (route: string) => {
      // Dismiss the mobile overlay drawer on any navigation so the
      // destination screen isn't hidden behind it. No-op on large screens
      // where the drawer is never open.
      closeMobileDrawer();
      if (pathname !== route) router.push(route);
    },
    [pathname, router, closeMobileDrawer],
  );

  const handleHome = React.useCallback(() => handleNavigate('/'), [handleNavigate]);
  const handleSettings = React.useCallback(
    () => handleNavigate('/settings'),
    [handleNavigate],
  );
  const handleProfile = React.useCallback(
    () => handleNavigate('/profile'),
    [handleNavigate],
  );
  const handleInbox = React.useCallback(
    () => handleNavigate('/inbox'),
    [handleNavigate],
  );
  const handleAddProperty = React.useCallback(
    () => handleNavigate('/properties/create'),
    [handleNavigate],
  );
  const handleSaved = React.useCallback(
    () => handleNavigate('/saved'),
    [handleNavigate],
  );

  const handleSignIn = React.useCallback(() => showSignInModal(), []);
  const handleRegister = React.useCallback(() => showSignInModal(), []);

  const handleSignOut = React.useCallback(() => {
    webAlert(t('settings.signOut'), t('settings.signOutMessage'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('settings.signOut'),
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/');
        },
      },
    ]);
  }, [t, logout, router]);

  const handleRemoveRecent = React.useCallback(
    (id: string) => {
      void removeProperty(id);
    },
    [removeProperty],
  );

  const handleSelectRecent = React.useCallback(() => {
    // RecentPropertyItem handles navigation internally.
  }, []);

  const toggleSavedFolders = React.useCallback(
    () => setSavedFoldersOpen(!savedFoldersOpen),
    [savedFoldersOpen, setSavedFoldersOpen],
  );

  const toggleRecentProperties = React.useCallback(
    () => setRecentPropertiesOpen(!recentPropertiesOpen),
    [recentPropertiesOpen, setRecentPropertiesOpen],
  );

  const handleOpenTerms = React.useCallback(() => {
    void Linking.openURL(TERMS_URL);
  }, []);

  const handleOpenPrivacy = React.useCallback(() => {
    void Linking.openURL(PRIVACY_URL);
  }, []);

  /* --------------------------------------------------------------
     Below the sidebar breakpoint the native bottom tab bar (the `(tabs)`
     group's `NativeTabs`) takes over primary navigation and the sidebar
     becomes an on-demand slide-in overlay drawer. Nothing is rendered
     inline at this breakpoint — the expanded content is rendered through
     Bloom's root Portal at the bottom of this component so it overlays the
     whole viewport.
     -------------------------------------------------------------- */
  const isMobile = !isSidebarVisible;

  /* ==============================================================
     COLLAPSED LAYOUT (icon-only rail, 48px wide) — large screens only
     ============================================================== */
  if (!isMobile && isCollapsed) {
    return (
      <View
        className="flex flex-col bg-background items-center"
        style={[
          sidebarBorders.railEdge,
          { width: COLLAPSED_WIDTH },
          Platform.OS === 'web'
            ? ({
                position: 'sticky',
                top: 0,
                alignSelf: 'flex-start',
                height: '100vh',
                maxHeight: '100vh',
              } as object)
            : { flex: 1, height: '100%' },
        ]}
      >
        <View className="h-14 items-center justify-center shrink-0">
          <SidebarBrand onPress={handleHome} />
        </View>

        <View className="flex flex-col items-center gap-1 py-1 shrink-0">
          {navEntries.map((entry) => (
            <NavItem
              key={entry.key}
              icon={entry.icon}
              iconActive={entry.iconActive}
              label={entry.label}
              onPress={() => handleNavigate(entry.route)}
              isActive={pathname === entry.route}
              collapsed
            />
          ))}
        </View>

        <View className="mx-2 w-8 my-1" style={sidebarBorders.divider} />

        <View className="flex flex-col items-center gap-1 py-1 shrink-0">
          <NavItem
            icon={Bookmark}
            iconActive={Bookmark}
            label={t('sidebar.navigation.saved')}
            onPress={handleSaved}
            isActive={pathname.startsWith('/saved')}
            collapsed
          />
        </View>

        <View style={{ flex: 1 }} />

        <View className="flex flex-col items-center gap-2 p-2 pt-1 shrink-0">
          <Pressable
            onPress={toggleSidebarCollapsed}
            accessibilityRole="button"
            accessibilityLabel={t('sidebar.expand', {
              defaultValue: 'Expand sidebar',
            })}
            className="h-10 w-10 rounded-xl items-center justify-center hover:bg-muted active:bg-muted/80"
          >
            <ChevronsRight size={18} color={colors.primaryDark_2} />
          </Pressable>
          {isAuthenticated ? (
            <Pressable
              onPress={handleProfile}
              accessibilityRole="button"
              accessibilityLabel={displayName}
              className="rounded-full h-10 w-10 items-center justify-center"
            >
              <Avatar source={avatarSource} name={displayName} size={32} />
            </Pressable>
          ) : (
            <Pressable
              onPress={handleSignIn}
              accessibilityRole="button"
              accessibilityLabel={t('sidebar.actions.signIn')}
              className="h-10 w-10 rounded-full items-center justify-center"
              style={{ backgroundColor: `${colors.primaryColor}1A` }}
            >
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: '700',
                  color: colors.primaryColor,
                }}
              >
                {(
                  t('sidebar.actions.signIn', { defaultValue: 'Sign in' })[0] ??
                  'S'
                ).toUpperCase()}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  /* ==============================================================
     EXPANDED LAYOUT (240px wide)
     ============================================================== */
  const header = (
    <View className="flex flex-col shrink-0">
      <View className="h-14 flex-row items-center shrink-0 px-2">
        <SidebarBrand onPress={handleHome} />
        {isMobile ? (
          <View className="ms-auto shrink-0">
            <Pressable
              onPress={closeMobileDrawer}
              accessibilityRole="button"
              accessibilityLabel={t('sidebar.close', {
                defaultValue: 'Close menu',
              })}
              className="h-10 w-10 rounded-xl items-center justify-center hover:bg-muted active:bg-muted/80"
            >
              <X size={20} color={colors.primaryDark_2} />
            </Pressable>
          </View>
        ) : isLargeScreen ? (
          <View className="ms-auto shrink-0">
            <Pressable
              onPress={toggleSidebarCollapsed}
              accessibilityRole="button"
              accessibilityLabel={t('sidebar.collapse', {
                defaultValue: 'Collapse sidebar',
              })}
              className="h-10 w-10 rounded-xl items-center justify-center hover:bg-muted active:bg-muted/80"
            >
              <ChevronsLeft size={18} color={colors.primaryDark_2} />
            </Pressable>
          </View>
        ) : null}
      </View>

      <View className="shrink-0 px-2 pb-1">
        <ModeToggle />
      </View>

      <View className="shrink-0">
        {navEntries.map((entry) => (
          <NavItem
            key={entry.key}
            icon={entry.icon}
            iconActive={entry.iconActive}
            label={entry.label}
            onPress={() => handleNavigate(entry.route)}
            isActive={pathname === entry.route}
            shortcut={entry.shortcut}
          />
        ))}
      </View>

      <View className="mx-2 my-1" style={sidebarBorders.divider} />
    </View>
  );

  const middle = (
    <>
      <SectionHeader
        label={t('sidebar.savedProperties.title', {
          defaultValue: 'Saved folders',
        })}
        isOpen={savedFoldersOpen}
        onToggle={toggleSavedFolders}
        action={
          <Pressable
            onPress={handleSaved}
            accessibilityRole="button"
            accessibilityLabel={t('sidebar.savedProperties.viewAll', {
              defaultValue: 'View all',
            })}
            className="h-6 w-6 items-center justify-center rounded-md hover:bg-muted"
          >
            <ChevronRight size={14} color={colors.primaryDark_2} />
          </Pressable>
        }
      />
      {savedFoldersOpen && (
        <View className="px-1.5">
          {folderEntries.length === 0 ? (
            <View className="px-3 py-3">
              <Text
                style={{ fontSize: 12, color: colors.primaryDark_2 }}
                numberOfLines={2}
              >
                {t('sidebar.savedProperties.empty', {
                  defaultValue: 'No saved folders yet',
                })}
              </Text>
            </View>
          ) : (
            folderEntries.map((folder) => (
              <FolderRow
                key={folder.id}
                id={folder.id}
                name={folder.name}
                color={folder.color}
                icon={folder.icon}
                propertyCount={folder.propertyCount}
                latestImages={folder.latestImages}
              />
            ))
          )}
        </View>
      )}

      <SectionHeader
        label={t('sidebar.recent.title', { defaultValue: 'Recently viewed' })}
        isOpen={recentPropertiesOpen}
        onToggle={toggleRecentProperties}
      />
      {recentPropertiesOpen && (
        <View className="px-1.5">
          {recentEntries.length === 0 ? (
            <View className="px-3 py-3">
              <Text
                style={{ fontSize: 12, color: colors.primaryDark_2 }}
                numberOfLines={2}
              >
                {t('sidebar.recent.empty', {
                  defaultValue: 'Properties you view will appear here',
                })}
              </Text>
            </View>
          ) : (
            dateGroups.map((group) => (
              <View key={group.label}>
                <DateSeparator label={group.label} />
                {group.items.map((item) => (
                  <RecentPropertyItem
                    key={item.id}
                    id={item.id}
                    title={item.title}
                    subtitle={item.subtitle}
                    imageUrl={item.imageUrl}
                    isActive={item.id === activeRecentId}
                    onSelect={handleSelectRecent}
                    onRemove={handleRemoveRecent}
                  />
                ))}
              </View>
            ))
          )}
        </View>
      )}
    </>
  );

  const footer = (
    <View className="flex flex-col gap-2 shrink-0 p-2 pt-1 w-full">
      {isAuthenticated ? (
        <Menu
          renderer={renderers.Popover}
          rendererProps={{ placement: 'top' }}
        >
          <MenuTrigger>
            <View
              accessibilityLabel="Account menu"
              accessibilityRole="button"
              className="rounded-full h-10 w-10 p-1 items-center justify-center"
            >
              <Avatar source={avatarSource} name={displayName} size={32} />
            </View>
          </MenuTrigger>
          <MenuOptions
            customStyles={{
              optionsContainer: {
                borderRadius: 12,
                padding: 6,
                minWidth: 220,
              },
            }}
          >
            {Platform.OS === 'web' && (
              <View className="flex-row items-center gap-2.5 px-2 py-2">
                <Avatar
                  source={avatarSource}
                  name={displayName}
                  size={36}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={{
                      fontSize: 13,
                      fontWeight: '600',
                      color: colors.primaryDark,
                    }}
                    numberOfLines={1}
                  >
                    {displayName}
                  </Text>
                  {user?.username ? (
                    <Text
                      style={{
                        fontSize: 11,
                        color: colors.primaryDark_2,
                      }}
                      numberOfLines={1}
                    >
                      @{user.username}
                    </Text>
                  ) : null}
                </View>
              </View>
            )}
            {Platform.OS === 'web' && (
              <View className="my-1 mx-1" style={sidebarBorders.menuSeparator} />
            )}
            <MenuOption onSelect={handleAddProperty}>
              <View className="flex-row items-center gap-2 py-1.5 px-2">
                <PlusCircle size={16} color={colors.primaryDark} />
                <Text style={{ fontSize: 13, color: colors.primaryDark }}>
                  {t('sidebar.actions.addProperty')}
                </Text>
              </View>
            </MenuOption>
            <MenuOption onSelect={handleProfile}>
              <View className="flex-row items-center gap-2 py-1.5 px-2">
                <UserCircle size={16} color={colors.primaryDark} />
                <Text style={{ fontSize: 13, color: colors.primaryDark }}>
                  {t('sidebar.menu.account', { defaultValue: 'Account' })}
                </Text>
              </View>
            </MenuOption>
            <MenuOption onSelect={handleInbox}>
              <View className="flex-row items-center gap-2 py-1.5 px-2">
                <Mail size={16} color={colors.primaryDark} />
                <Text style={{ fontSize: 13, color: colors.primaryDark }}>
                  {t('sidebar.menu.inbox', {
                    defaultValue: 'Inbox',
                  })}
                </Text>
              </View>
            </MenuOption>
            <MenuOption onSelect={handleSettings}>
              <View className="flex-row items-center gap-2 py-1.5 px-2">
                <Settings size={16} color={colors.primaryDark} />
                <Text style={{ fontSize: 13, color: colors.primaryDark }}>
                  {t('sidebar.navigation.settings')}
                </Text>
              </View>
            </MenuOption>
            <View className="my-1 mx-1" style={sidebarBorders.menuSeparator} />
            <MenuOption onSelect={handleOpenTerms}>
              <View className="flex-row items-center gap-2 py-1.5 px-2">
                <FileText size={16} color={colors.primaryDark_2} />
                <Text style={{ fontSize: 13, color: colors.primaryDark_2 }}>
                  {t('sidebar.menu.terms', {
                    defaultValue: 'Terms of service',
                  })}
                </Text>
              </View>
            </MenuOption>
            <MenuOption onSelect={handleOpenPrivacy}>
              <View className="flex-row items-center gap-2 py-1.5 px-2">
                <ShieldCheck size={16} color={colors.primaryDark_2} />
                <Text style={{ fontSize: 13, color: colors.primaryDark_2 }}>
                  {t('sidebar.menu.privacy', {
                    defaultValue: 'Privacy policy',
                  })}
                </Text>
              </View>
            </MenuOption>
            <View className="my-1 mx-1" style={sidebarBorders.menuSeparator} />
            <MenuOption onSelect={handleSignOut}>
              <View className="flex-row items-center gap-2 py-1.5 px-2">
                <LogOut size={16} color={colors.busy} />
                <Text style={{ fontSize: 13, color: colors.busy }}>
                  {t('settings.signOut')}
                </Text>
              </View>
            </MenuOption>
          </MenuOptions>
        </Menu>
      ) : (
        <View className="gap-2 w-full">
          <Button
            onPress={handleSignIn}
            variant="primary"
            size="medium"
            style={{ borderRadius: 999, width: '100%' }}
            icon={<LogIn size={16} color={colors.primaryLight} />}
            iconPosition="left"
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: '600',
                color: colors.primaryLight,
              }}
            >
              {t('sidebar.actions.signIn')}
            </Text>
          </Button>
          <Button
            onPress={handleRegister}
            variant="secondary"
            size="medium"
            style={{ borderRadius: 999, width: '100%' }}
            icon={<UserPlus size={16} color={colors.primaryDark} />}
            iconPosition="left"
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: '600',
                color: colors.primaryDark,
              }}
            >
              {t('sidebar.actions.signUp')}
            </Text>
          </Button>
          {Platform.OS === 'web' && (
            <View className="flex-row items-center justify-center gap-1 mt-1">
              <Pressable onPress={handleOpenPrivacy}>
                <Text
                  style={{
                    fontSize: 10,
                    color: colors.primaryDark_2,
                    textDecorationLine: 'underline',
                  }}
                >
                  {t('sidebar.menu.privacy', {
                    defaultValue: 'Privacy policy',
                  })}
                </Text>
              </Pressable>
              <Text style={{ fontSize: 10, color: colors.primaryDark_2 }}>
                ·
              </Text>
              <Pressable onPress={handleOpenTerms}>
                <Text
                  style={{
                    fontSize: 10,
                    color: colors.primaryDark_2,
                    textDecorationLine: 'underline',
                  }}
                >
                  {t('sidebar.menu.terms', {
                    defaultValue: 'Terms of service',
                  })}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </View>
  );

  /* ==============================================================
     MOBILE OVERLAY DRAWER (small screens)
     Mirrors the inbox app's `front`-type `expo-router/drawer`: the panel
     slides in from the left over the current screen and a full-viewport
     dimming scrim sits behind it as a tap-to-dismiss target. Mounted only
     while open so it occupies no layout when closed (the native bottom tab
     bar drives navigation at this breakpoint). One responsive component —
     the same nav content is reused; only the chrome differs from the rail.
     ============================================================== */
  if (isMobile) {
    // Cap the panel width to the viewport so it never overflows on the
    // narrowest phones, leaving a tap-target sliver of scrim on the right.
    const drawerWidth = Math.min(EXPANDED_WIDTH, width - MOBILE_DRAWER_EDGE_GAP);
    const slideIn = SlideInLeft.duration(MOBILE_DRAWER_DURATION).easing(
      Easing.out(Easing.cubic),
    );
    const slideOut = SlideOutLeft.duration(MOBILE_DRAWER_DURATION).easing(
      Easing.in(Easing.cubic),
    );

    // Rendered through Bloom's root Portal so the overlay escapes the layout
    // scroll container and covers the whole viewport — the same way the inbox
    // app's `front` drawer overlays the entire screen. The Portal host stays
    // mounted while on mobile so Reanimated can play the exit (slide-out +
    // fade) when `mobileDrawerOpen` flips to false; only the scrim + panel
    // mount/unmount. `box-none` lets touches pass through when closed.
    return (
      <Portal>
        <View
          className="flex-row"
          style={StyleSheet.absoluteFill}
          pointerEvents="box-none"
        >
          {mobileDrawerOpen && (
            <>
              <AnimatedPressable
                entering={FadeIn.duration(MOBILE_DRAWER_DURATION)}
                exiting={FadeOut.duration(MOBILE_DRAWER_DURATION)}
                accessibilityRole="button"
                accessibilityLabel={t('sidebar.close', {
                  defaultValue: 'Close menu',
                })}
                onPress={closeMobileDrawer}
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: MOBILE_DRAWER_SCRIM },
                ]}
              />
              <Animated.View
                entering={slideIn}
                exiting={slideOut}
                style={[{ width: drawerWidth }, sidebarBorders.railEdge]}
                className="h-full bg-background"
              >
                <BaseSidebar header={header} footer={footer}>
                  {middle}
                </BaseSidebar>
              </Animated.View>
            </>
          )}
        </View>
      </Portal>
    );
  }

  return (
    <View
      style={[{ width: EXPANDED_WIDTH }, sidebarBorders.railEdge]}
      className="h-full"
    >
      <BaseSidebar header={header} footer={footer}>
        {middle}
      </BaseSidebar>
    </View>
  );
}

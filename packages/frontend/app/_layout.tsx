import type React from 'react';
import { useState, useCallback, useMemo, useSyncExternalStore } from 'react';
import { Platform, View, AppState } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { preventNativeSplashAutoHide, useHideNativeSplashWhenReady } from '@oxy.so/expo-splash';
import { Slot, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useHomiioSidebarProps } from '@/components/SideBar';
import { RightBar, RIGHT_BAR_WIDTH, useHasRightBar } from '@/components/RightBar';
import { HomiioBottomBar } from '@/components/HomiioBottomBar';
import { useUIStore } from '@/store/uiStore';
import { AppShell } from '@oxy.so/bloom/app-shell';
import { ConnectionStatusToasts } from '@oxy.so/bloom/connection-status';
import {
  setupNotifications,
  requestNotificationPermissions,
  scheduleDemoNotification,
} from '@/utils/notifications';
import i18n, { use as i18nUse, init as i18nInit } from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import enUS from '@/locales/en.json';

import AppSplashScreen from '@/components/AppSplashScreen';
import ErrorBoundary from '@/components/ErrorBoundary';
import { ProfileProvider } from '@/context/ProfileContext';
import { SavedPropertiesProvider } from '@/context/SavedPropertiesContext';
import { BottomSheetProvider } from '@/context/BottomSheetContext';
import { AskAgentProvider } from '@/context/AskAgentProvider';
import { RentalModeProvider } from '@/context/RentalModeContext';
import { NotificationProvider } from '@/context/NotificationContext';
import { OxyProvider, useAccountColor, useOxy } from '@oxy.so/services/ui/client';
import { BloomProvider } from '@oxy.so/bloom/provider';
import { useNavigationTheme, useTheme, webLocalStorage } from '@oxy.so/bloom/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ImageResolverProvider, type ImageResolver } from '@oxy.so/bloom/image-resolver';
import { PortalProvider, PortalOutlet } from '@oxy.so/bloom/portal';
import { expoRouterScrollAdapter } from '@oxy.so/bloom/scroll/expo-router';
import '../styles/global.css';
import { OXY_BASE_URL, OXY_CLIENT_ID } from '@/config';
import { QueryClient, onlineManager, focusManager } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import { logger } from '@/utils/logger';
import { bindApiToOxy } from '@/utils/api';
import { clearRetiredStorage } from '@/utils/retiredStorage';
import { observeInferredScope } from '@/hooks/useLocationScope';
import {
  isSupportedLanguage,
  setStoredLanguage,
  SUPPORTED_LANGUAGE_CODES,
} from '@/utils/languagePreference';

i18nUse(initReactI18next);

const i18nReady = i18nInit({
  // Only the fallback language is registered up front. Every other locale is
  // loaded on first use by `setStoredLanguage` (utils/localeResources*), which on
  // web keeps eleven locale files out of the JavaScript bundle.
  resources: {
    'en-US': { translation: enUS },
  },
  lng: 'en-US',
  fallbackLng: 'en-US',
  interpolation: { escapeValue: false },
}).catch((error: unknown) => {
  logger.warn('Failed to initialize i18n:', error);
});

// NATIVE ONLY: hold the OS splash so it stays visible until the app has finished
// loading fonts + running init, then hide it once `appIsReady` flips (via
// `useHideNativeSplashWhenReady`). This makes the native OS splash the SINGLE
// splash on native — Homiio's logo centered on the dark brand background with the
// Oxy symbol pinned to the bottom (configured by `@oxy.so/expo-splash` in
// app.config.js). The custom `AppSplashScreen` React overlay is gated to web
// only. No-op on web (the shared helper guards `Platform.OS === 'web'`).
preventNativeSplashAutoHide();

// Bloom owns the theme (system / light / dark) and persists the person's choice.
// `webLocalStorage` is undefined on native, where AsyncStorage takes over.
const THEME_PERSIST_KEY = 'homiio.bloom.theme';
const THEME_STORAGE = webLocalStorage ?? AsyncStorage;

// TanStack Query follows the device: NetInfo drives `onlineManager` (refetch on
// reconnect) and AppState drives `focusManager` (refetch on foreground). Both are
// app-lifetime subscriptions owned by the managers themselves, so they are wired
// once here rather than from a component.
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => {
    setOnline(Boolean(state.isConnected && state.isInternetReachable !== false));
  }),
);
focusManager.setEventListener((setFocused) => {
  const subscription = AppState.addEventListener('change', (status) => {
    setFocused(status === 'active');
  });
  return () => subscription.remove();
});

/**
 * The app's ONE QueryClient, handed to `OxyProvider`, which provides it.
 *
 * Given none, `OxyProvider` creates and provides a client of its own — and it
 * did, nested inside a second client this layout used to create, so every query
 * ran on the SDK's client while this file's cached nothing (Oxy ADR 0004: a
 * supplied client becomes THE client, never nested under another). The defaults
 * are the ones the app actually ran with under the SDK: offline-first, and a
 * retry only for a failure another attempt can change — a 404 or a 401 answers
 * the same the third time.
 *
 * Module scope rather than component state so code outside React can observe
 * the cache: `observeInferredScope` commits the first inferred location scope
 * where the inference queries land. Subscribing does no I/O and starts no
 * timer, so importing this module stays inert for static rendering and tests.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'offlineFirst',
      retry: (failureCount, error) => failureCount < 2 && isRetriable(error),
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
    },
    mutations: {
      networkMode: 'offlineFirst',
    },
  },
});
observeInferredScope(queryClient);

/** A transport failure, a timeout, a rate limit or a server error. */
function isRetriable(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== 'number') return true;
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * One-time app bootstrap, started at module load: set up notifications (native
 * only), then mark initialization complete. On web completion starts the custom
 * JS splash fade; on native it flips `appIsReady` (via the readiness gate in
 * `RootLayout`), which hides the held OS splash. A failure is logged and still
 * completes, so the app never hangs on the splash.
 *
 * Completion is a tiny external store read with `useSyncExternalStore`.
 */
let bootstrapComplete = false;
const bootstrapListeners = new Set<() => void>();

async function bootstrapApp() {
  // The welcome notification is translated, so i18n goes first.
  await i18nReady;
  if (Platform.OS === 'web') return;
  await setupNotifications();
  const hasPermission = await requestNotificationPermissions();
  if (hasPermission && __DEV__) {
    await scheduleDemoNotification();
  }
}

// Off the splash's path: nothing waits on it, and a failure costs only a stale key.
clearRetiredStorage().catch((error: unknown) => {
  logger.warn('Failed to clear retired device storage:', error);
});

bootstrapApp()
  .catch((error: unknown) => {
    logger.warn('Failed to set up notifications:', error);
  })
  .finally(() => {
    bootstrapComplete = true;
    for (const listener of bootstrapListeners) listener();
  });

function subscribeBootstrap(listener: () => void) {
  bootstrapListeners.add(listener);
  return () => {
    bootstrapListeners.delete(listener);
  };
}
const getBootstrapComplete = () => bootstrapComplete;
// Server (static web) render always shows the splash, matching the client's
// first render before hydration.
const getServerBootstrapComplete = () => false;

/**
 * App-wide media chokepoint for Bloom `Avatar`/image components.
 *
 * Registers a single `ImageResolverProvider` whose resolver turns an Oxy file
 * id (plus optional rendition variant) into the canonical Oxy media/signed
 * URL via `oxyServices.assets.publicUrl` — the ONE place a media URL is built.
 * Any Bloom surface that renders `Avatar source={<fileId>} variant="thumb"`
 * gets correctly-resolved media for free; components never construct media URLs
 * themselves.
 */
function MediaResolverProvider({ children }: { children: React.ReactNode }) {
  const { oxyServices } = useOxy();
  // Homiio's own API client follows the provider's session (see `utils/api`).
  // Bound during render, before any child can issue a request.
  bindApiToOxy(oxyServices);
  const resolver = useMemo<ImageResolver>(
    () => (id: string, variant?: string) => {
      if (!id) return undefined;
      return oxyServices.assets.publicUrl(id, variant);
    },
    [oxyServices],
  );
  return <ImageResolverProvider value={resolver}>{children}</ImageResolverProvider>;
}

/**
 * The frame is Bloom's `AppShell` with `panels`: the sidebar in flow from `lg`
 * and a drawer below it, the route's right rail as the `aside`, Bloom's
 * `BottomBar` while the sidebar is a drawer — and the routes made of PANELS the
 * shell frames (the gutter on all four sides, full-bleed below `lg`). Which
 * panels is the routes' own business: `app/(pages)/_layout.tsx` makes every
 * page one reading panel, and `/explore` renders two (results and a map).
 *
 * `scroll="page"` for every route: each page is a Bloom `Screen` whose
 * `ScreenScrollView` scrolls the document on web and is the scroller on native.
 * Explore needs no mode of its own — its panels are one viewport tall and each
 * scrolls itself, so the document has nothing to scroll.
 */
function AppFrame() {
  // The Oxy account colour: the one place it is applied to Bloom's theme.
  useAccountColor();
  const sidebar = useHomiioSidebarProps();
  const drawerOpen = useUIStore((s) => s.mobileDrawerOpen);
  const openMobileDrawer = useUIStore((s) => s.openMobileDrawer);
  const closeMobileDrawer = useUIStore((s) => s.closeMobileDrawer);
  const onDrawerOpenChange = useCallback(
    (open: boolean) => (open ? openMobileDrawer() : closeMobileDrawer()),
    [openMobileDrawer, closeMobileDrawer],
  );
  const hasRightBar = useHasRightBar();

  return (
    <AppShell
      variant="feed"
      panels
      scroll="page"
      sidebar={sidebar}
      drawer="reveal"
      drawerOpen={drawerOpen}
      onDrawerOpenChange={onDrawerOpenChange}
      header={null}
      contentWidth={1800}
      navigationAlign="content"
      navigationGap={8}
      gutter={8}
      aside={hasRightBar ? <RightBar /> : null}
      asideWidth={RIGHT_BAR_WIDTH}
      asideFrom="lg"
      asideCollapse="hidden"
      bottomBar={<HomiioBottomBar />}
    >
      <Slot />
    </AppShell>
  );
}

/**
 * Hands Bloom's resolved theme to everything outside Bloom: React Navigation's
 * theme (navigator backgrounds, native tabs, headers) and the status bar. Both
 * follow Bloom's mode, never the OS — `style="auto"` read the OS appearance and
 * showed light status-bar text over a light app on a phone in dark mode.
 */
function BloomNavigationTheme({ children }: { children: React.ReactNode }) {
  const navTheme = useNavigationTheme();
  const { isDark } = useTheme();
  return (
    <ThemeProvider value={navTheme}>
      {children}
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  // `startFade` is fully derived from initialization completing — there is no
  // other trigger — so we keep a single source of truth and derive the fade
  // flag instead of syncing it in an effect (which caused cascading renders).
  const initializationComplete = useSyncExternalStore(
    subscribeBootstrap,
    getBootstrapComplete,
    getServerBootstrapComplete,
  );
  const [fadeComplete, setFadeComplete] = useState(false);
  const startFade = initializationComplete;

  // --- Splash Fade Handler (WEB only) ---
  // The custom `AppSplashScreen` fades out on web once init completes; its
  // `onFadeComplete` records that the fade finished. On native this callback
  // never fires (no custom overlay is rendered), which is why native readiness
  // must NOT depend on it (see the readiness gate below).
  const handleSplashFadeComplete = useCallback(() => {
    setFadeComplete(true);
  }, []);

  // Readiness gate — DERIVED, for the same reason `startFade` above is.
  // - WEB keeps the fade-gated flow: the custom <AppSplashScreen> renders, fades
  //   out when init completes, and its `onFadeComplete` sets `fadeComplete`, so
  //   web readiness = init complete AND the custom splash finished fading.
  // - NATIVE renders NO custom splash (the held OS splash covers the screen), so
  //   `onFadeComplete` never fires; native readiness = init complete ONLY, else
  //   the OS splash would hang forever.
  //
  // This was a `useState` latched by an effect. The latch could never differ
  // from the expression: bootstrap completion and `setFadeComplete` each only
  // ever go to `true` and neither is ever reset, so once the
  // condition holds it holds forever. Deriving it drops a render — the splash
  // used to persist for one extra commit while the effect caught up.
  const appIsReady =
    Platform.OS === 'web' ? initializationComplete && fadeComplete : initializationComplete;

  // NATIVE ONLY: once ready, hide the held OS splash. The shared helper is a
  // no-op on web (the OS splash was never held; the custom overlay handles the
  // transition there).
  useHideNativeSplashWhenReady(appIsReady);

  return (
    <View className="flex-1">
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <GestureHandlerRootView className="flex-1">
          <BloomProvider
            defaultMode="system"
            defaultColorPreset="yellow"
            persistKey={THEME_PERSIST_KEY}
            storage={THEME_STORAGE}
            scrollAdapter={expoRouterScrollAdapter}
            onFontsLoading={Platform.OS === 'web' ? <AppSplashScreen /> : null}
          >
            <BloomNavigationTheme>
              {!appIsReady ? (
                // WEB: the custom splash covers font-load + init and fades out; its
                // `onFadeComplete` gates `appIsReady`. NATIVE renders null here — the
                // held OS splash is on top, so nothing underneath needs to paint.
                Platform.OS === 'web' ? (
                  <AppSplashScreen
                    startFade={startFade}
                    onFadeComplete={handleSplashFadeComplete}
                  />
                ) : null
              ) : (
                <RentalModeProvider>
                  <OxyProvider
                    baseURL={OXY_BASE_URL}
                    clientId={OXY_CLIENT_ID}
                    queryClient={queryClient}
                    accountQueries={{ roots: [], memoryOnlyRoots: ['savedSearches'] }}
                    language={{
                      supportedLocales: SUPPORTED_LANGUAGE_CODES,
                      fallbackLocale: 'en-US',
                      onChange: (locale) => {
                        if (!isSupportedLanguage(locale)) return;
                        return setStoredLanguage(locale);
                      },
                      onError: (error, locale) => {
                        logger.warn('Failed to follow the Oxy-resolved language', locale, error);
                      },
                    }}
                  >
                    {/*
                  Renders nothing itself — it just pushes to the toast store
                  that `OxyProvider`'s own `<ToastOutlet />` renders. Mounted
                  here (inside `BloomProvider` for theme, inside `OxyProvider`
                  for the toast host) so a lost connection surfaces as a
                  toast instead of a per-screen banner.
                */}
                    <ConnectionStatusToasts />
                    <MediaResolverProvider>
                      <ProfileProvider>
                        <SavedPropertiesProvider>
                          <NotificationProvider>
                            <I18nextProvider i18n={i18n}>
                              <BottomSheetProvider>
                                <View className="flex-1">
                                  <PortalProvider>
                                    <ErrorBoundary>
                                      <AskAgentProvider>
                                        <AppFrame />
                                      </AskAgentProvider>
                                    </ErrorBoundary>
                                    {/*
                                Root overlay outlet. `AppShell`'s navigation
                                drawer renders here through Bloom's Portal so
                                the panel and its backdrop cover the whole
                                viewport. Placed last so it sits above all app
                                chrome.
                              */}
                                    <PortalOutlet />
                                  </PortalProvider>
                                </View>
                              </BottomSheetProvider>
                            </I18nextProvider>
                          </NotificationProvider>
                        </SavedPropertiesProvider>
                      </ProfileProvider>
                    </MediaResolverProvider>
                  </OxyProvider>
                </RentalModeProvider>
              )}
            </BloomNavigationTheme>
          </BloomProvider>
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </View>
  );
}

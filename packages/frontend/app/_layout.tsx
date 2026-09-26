import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Platform,
  View,
  AppState,
  AppStateStatus,
  useWindowDimensions,
  type ViewStyle,
} from 'react-native';
import {
  SafeAreaProvider,
  initialWindowMetrics,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { preventNativeSplashAutoHide, useHideNativeSplashWhenReady } from '@oxy.so/expo-splash';
import { Slot, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';
import { useHomiioSidebarProps, type HomiioSidebarProps } from '@/components/SideBar';
import { SIDEBAR_IN_FLOW_FROM } from '@/components/SideBar/dimensions';
import { RightBar, RIGHT_BAR_WIDTH, useHasRightBar } from '@/components/RightBar';
import { SindiPanel } from '@/components/sindi/SindiPanel';
import { useSindiPanelLayout } from '@/components/sindi/sindiPanelLayout';
import { InAppShellContext, useIsScreenHeaderMounted } from '@/components/Header';
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
import { MenuProvider } from 'react-native-popup-menu';

import AppSplashScreen from '@/components/AppSplashScreen';
import ErrorBoundary from '@/components/ErrorBoundary';
import { ProfileProvider } from '@/context/ProfileContext';
import { SavedPropertiesProvider } from '@/context/SavedPropertiesContext';
import { BottomSheetProvider } from '@/context/BottomSheetContext';
import { MapStateProvider } from '@/context/MapStateContext';
import { SearchModeProvider } from '@/context/SearchModeContext';
import { RentalModeProvider } from '@/context/RentalModeContext';
import { NotificationProvider } from '@/context/NotificationContext';
import { OxyProvider, useOxy } from '@oxy.so/services';
import { BloomProvider } from '@oxy.so/bloom/provider';
import { ImageResolverProvider, type ImageResolver } from '@oxy.so/bloom/image-resolver';
import { PortalProvider, PortalOutlet } from '@oxy.so/bloom/portal';
import '../styles/global.css';
import { OXY_BASE_URL, OXY_CLIENT_ID } from '@/config';
import { QueryClient, QueryClientProvider, onlineManager, focusManager } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import { logger } from '@/utils/logger';
import { bindApiToOxy } from '@/utils/api';
import {
  isSupportedLanguage,
  setStoredLanguage,
  SUPPORTED_LANGUAGE_CODES,
} from '@/utils/languagePreference';

i18nUse(initReactI18next);

i18nInit({
  // Only the fallback language is registered up front. Every other locale is
  // loaded on first use by `setStoredLanguage` (utils/localeResources*), which on
  // web keeps eleven locale files out of the JavaScript bundle.
  resources: {
    'en-US': { translation: enUS },
  },
  lng: 'en-US',
  fallbackLng: 'en-US',
  interpolation: { escapeValue: false },
})
  .catch((error: unknown) => {
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
  return (
    <ImageResolverProvider value={resolver}>{children}</ImageResolverProvider>
  );
}

/** A header that draws nothing: the page (or nothing at all) owns the menu button. */
const NO_SHELL_HEADER = <></>;

/**
 * The page frame is Bloom's `AppShell`: the sidebar in flow from `lg` (1024)
 * and an overlay drawer below it, the route's right rail as the `aside`, and
 * the routed screen as the content. Everything below chooses its props.
 *
 * ONE scroll owner per surface and NO page-level `ScrollView`:
 * - Web: `scroll="document"` — the document scrolls, the rail and aside are
 *   sticky. `/explore` is `scroll="fixed"` instead: one `100dvh` screen where
 *   nothing scrolls, so the explore surface pins its map and scrolls only its
 *   results list.
 * - Native tablets (>= 500): `scroll="fixed"` everywhere. Native has no
 *   document, and `document`/`container` would wrap every screen in the shell's
 *   `ScrollView` on top of the screen's own — a double scroller.
 * - Native phones: the `(tabs)` `NativeTabs` navigator owns the screen, so
 *   `<Slot/>` renders full-bleed and each screen's own scroll view is the owner.
 *   `AppShell` is mounted beside it in a zero-size box purely for its drawer
 *   (portaled to the root `PortalOutlet`), which home's hero menu button opens.
 *
 * The drawer's open state is `uiStore.mobileDrawerOpen`, so screens and the
 * sidebar's own navigation (which closes it) share one switch.
 *
 * The menu button: a screen `Header` renders `AppShellMenuButton` itself; a
 * screen without one gets `AppShell`'s default header, which below `lg` is
 * that button alone. Home below 500 draws its own in the hero.
 *
 * The aside: the open Sindi panel from `lg`, otherwise the route's right rail
 * (if it has one). Between 500 and `lg` the panel is an overlay, mounted as the
 * shell's `overlay` and rendering nothing outside that tier.
 */
function AppFrame() {
  const isScreenNotMobile = useIsScreenNotMobile();
  const pathname = usePathname() || '/';
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const sidebar = useHomiioSidebarProps();
  const drawerOpen = useUIStore((s) => s.mobileDrawerOpen);
  const openMobileDrawer = useUIStore((s) => s.openMobileDrawer);
  const closeMobileDrawer = useUIStore((s) => s.closeMobileDrawer);
  const onDrawerOpenChange = useCallback(
    (open: boolean) => (open ? openMobileDrawer() : closeMobileDrawer()),
    [openMobileDrawer, closeMobileDrawer],
  );
  const hasRightBar = useHasRightBar();
  const sindiPanel = useSindiPanelLayout();
  const screenHeaderMounted = useIsScreenHeaderMounted();

  const isNative = Platform.OS !== 'web';
  const railInFlow = width >= SIDEBAR_IN_FLOW_FROM;

  // Native: keep the rail clear of the status bar and home indicator. The
  // in-flow rail stretches in the shell's row; the drawer's fills its column.
  const nativeSidebar = useMemo<HomiioSidebarProps>(() => {
    const safeArea: ViewStyle = { marginTop: insets.top, marginBottom: insets.bottom, height: undefined };
    return {
      ...sidebar,
      style: railInFlow
        ? { ...safeArea, alignSelf: 'stretch' }
        : { ...safeArea, flex: 1, minHeight: 0 },
    };
  }, [sidebar, insets.top, insets.bottom, railInFlow]);

  if (isNative && !isScreenNotMobile) {
    return (
      <>
        <Slot />
        <View pointerEvents="none" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
          <AppShell
            sidebar={nativeSidebar}
            header={NO_SHELL_HEADER}
            drawerOpen={drawerOpen}
            onDrawerOpenChange={onDrawerOpenChange}
            scroll="fixed"
          />
        </View>
      </>
    );
  }

  const isExploreRoute = pathname === '/explore' || pathname.startsWith('/explore/');
  const pageDrawsMenuButton = screenHeaderMounted || (pathname === '/' && !isScreenNotMobile);

  return (
    <InAppShellContext.Provider value>
      <AppShell
        sidebar={isNative ? nativeSidebar : sidebar}
        drawer="overlay"
        drawerOpen={drawerOpen}
        onDrawerOpenChange={onDrawerOpenChange}
        header={pageDrawsMenuButton ? NO_SHELL_HEADER : undefined}
        aside={
          sindiPanel.docked ? <SindiPanel placement="aside" /> : hasRightBar ? <RightBar /> : null
        }
        asideWidth={sindiPanel.docked ? sindiPanel.width : RIGHT_BAR_WIDTH}
        asideFrom="lg"
        asideCollapse="hidden"
        scroll={isNative || isExploreRoute ? 'fixed' : 'document'}
        overlay={<SindiPanel placement="overlay" />}
      >
        <Slot />
      </AppShell>
    </InAppShellContext.Provider>
  );
}


export default function RootLayout() {

  // `startFade` is fully derived from initialization completing — there is no
  // other trigger — so we keep a single source of truth and derive the fade
  // flag instead of syncing it in an effect (which caused cascading renders).
  const [initializationComplete, setInitializationComplete] = useState(false);
  const [fadeComplete, setFadeComplete] = useState(false);
  const startFade = initializationComplete;

  const queryClient = useMemo(() => new QueryClient({
    defaultOptions: {
      queries: {
        retry: 2,
        staleTime: 1000 * 60 * 5,  // 5 min — reduces duplicate fetches
        gcTime: 1000 * 60 * 30,    // 30 min — keeps data in cache longer
        refetchOnReconnect: true,
        refetchOnWindowFocus: false, // Disable to prevent unnecessary refetches
      },
    },
  }), []);

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
  // from the expression: `setInitializationComplete` and `setFadeComplete` are
  // each only ever called with `true` and neither is ever reset, so once the
  // condition holds it holds forever. Deriving it drops a render — the splash
  // used to persist for one extra commit while the effect caught up.
  const appIsReady =
    Platform.OS === 'web' ? initializationComplete && fadeComplete : initializationComplete;

  // NATIVE ONLY: once ready, hide the held OS splash. The shared helper is a
  // no-op on web (the OS splash was never held; the custom overlay handles the
  // transition there).
  useHideNativeSplashWhenReady(appIsReady);


  useEffect(() => {
    // React Query online manager using NetInfo
    const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
      onlineManager.setOnline(Boolean(state.isConnected && state.isInternetReachable !== false));
    });

    // React Query focus manager using AppState
    const onAppStateChange = (status: AppStateStatus) => {
      focusManager.setFocused(status === 'active');
    };
    const appStateSub = AppState.addEventListener('change', onAppStateChange);

    return () => {
      unsubscribeNetInfo();
      appStateSub.remove();
    };
  }, []);

  // One-time app bootstrap: set up notifications (native only), then mark
  // initialization complete. On web this starts the custom JS splash fade; on
  // native it flips `appIsReady` (via the readiness gate) which hides the held OS
  // splash. The completion state is set in an async continuation (after `await`)
  // and guarded by `active` so it never runs synchronously within the effect or
  // after unmount.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (Platform.OS !== 'web') {
          await setupNotifications();
          const hasPermission = await requestNotificationPermissions();
          if (hasPermission && __DEV__) {
            await scheduleDemoNotification();
          }
        }
        if (active) {
          setInitializationComplete(true);
        }
      } catch (error: unknown) {
        logger.warn('Failed to set up notifications:', error);
        if (active) {
          setInitializationComplete(true);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);


  return (
    <View className="flex-1">
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <GestureHandlerRootView className="flex-1">
          {/*
            Pin Bloom to the YELLOW preset in LIGHT mode. `mode="light"` stops Bloom
            from following the OS into dark — Homiio's static `colors.ts` is a
            light-only palette, so following the OS produced a light-static /
            dark-Bloom mismatch. This provider is the single source of truth for
            theme tokens; `@oxy.so/services` 8.1.2 no longer wraps its children in
            an internal BloomThemeProvider. `BloomProvider` mounts it for us,
            together with the rest of Bloom's app-wide state (haptics, scroll
            restoration, tab-bar minimize progress) so none of them can end up
            at a different depth. `imageResolver` is not passed here: Homiio's
            resolver needs `useOxy()`, so it stays its own provider below.
          */}
          <BloomProvider mode="light" colorPreset="yellow" fonts onFontsLoading={Platform.OS === 'web' ? <AppSplashScreen /> : null}>
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
              <QueryClientProvider client={queryClient}>
                <RentalModeProvider>
                <OxyProvider
                  baseURL={OXY_BASE_URL}
                  clientId={OXY_CLIENT_ID}
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
                            <MenuProvider>
                              <PortalProvider>
                                <ErrorBoundary>
                                  <MapStateProvider>
                                    <SearchModeProvider>
                                      <AppFrame />
                                    </SearchModeProvider>
                                  </MapStateProvider>
                                  <StatusBar style="auto" />
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
                            </MenuProvider>
                          </BottomSheetProvider>
                        </I18nextProvider>
                      </NotificationProvider>
                    </SavedPropertiesProvider>
                  </ProfileProvider>
                  </MediaResolverProvider>
                </OxyProvider>
                </RentalModeProvider>
              </QueryClientProvider>
          )}
          </BloomProvider>
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </View>
  );
}

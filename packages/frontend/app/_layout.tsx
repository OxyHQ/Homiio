import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Platform, View, StyleSheet, AppState, AppStateStatus, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import { Slot, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';
import { SideBar } from '@/components/SideBar';
import { RightBar } from '@/components/RightBar';
import { colors } from '@/styles/colors';
import { Toaster } from '@/lib/sonner';
import {
  setupNotifications,
  requestNotificationPermissions,
  scheduleDemoNotification,
} from '@/utils/notifications';
import i18n, { use as i18nUse, init as i18nInit } from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import enUS from '@/locales/en.json';
import esES from '@/locales/es.json';
import caES from '@/locales/ca-ES.json';
import itIT from '@/locales/it.json';
import { MenuProvider } from 'react-native-popup-menu';

import AppSplashScreen from '@/components/AppSplashScreen';
import ErrorBoundary from '@/components/ErrorBoundary';
import { ProfileProvider } from '@/context/ProfileContext';
import { SavedPropertiesProvider } from '@/context/SavedPropertiesContext';
import { BottomSheetProvider } from '@/context/BottomSheetContext';
import { LayoutScrollProvider } from '@/context/LayoutScrollContext';
import { MapStateProvider } from '@/context/MapStateContext';
import { SearchModeProvider } from '@/context/SearchModeContext';
import { RentalModeProvider } from '@/context/RentalModeContext';
import { NotificationProvider } from '@/context/NotificationContext';
import { OxyProvider } from '@oxyhq/services';
import { BloomThemeProvider } from '@oxyhq/bloom';
import {
  Provider as PortalProvider,
  Outlet as PortalOutlet,
} from '@oxyhq/bloom/portal';
import '../styles/global.css';
import { OXY_BASE_URL } from '@/config';
import { QueryClient, QueryClientProvider, onlineManager, focusManager } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import { logger } from '@/utils/logger';

i18nUse(initReactI18next);

i18nInit({
  resources: {
    'en-US': { translation: enUS },
    'es-ES': { translation: esES },
    'ca-ES': { translation: caES },
    'it-IT': { translation: itIT },
  },
  lng: 'en-US',
  fallbackLng: 'en-US',
  interpolation: { escapeValue: false },
})
  .catch((error: unknown) => {
  });



export default function RootLayout() {
  const [appIsReady, setAppIsReady] = useState(false);
  // `startFade` is fully derived from initialization completing — there is no
  // other trigger — so we keep a single source of truth and derive the fade
  // flag instead of syncing it in an effect (which caused cascading renders).
  const [initializationComplete, setInitializationComplete] = useState(false);
  const startFade = initializationComplete;
  const isScreenNotMobile = useIsScreenNotMobile();
  const pathname = usePathname() || '/';

  /**
   * On native phones the `(tabs)` group owns the screen container via
   * `NativeTabs` (a navigator that renders the platform tab bar — `UITabBar` /
   * `BottomNavigationView`). A navigator must directly own its screens, so on
   * this branch we render `<Slot/>` without the outer `Animated.ScrollView` or
   * `RightBar`, and let the native bar replace the old JS `BottomBar`. `SideBar`
   * still mounts so its on-demand overlay drawer (opened from screen headers via
   * the UI store) keeps working. Web and wide native screens keep the original
   * persistent SideBar + content + RightBar shell.
   */
  const useNativeTabBar = Platform.OS !== 'web' && !isScreenNotMobile;

  /**
   * The explore screen (`/explore`) is a FIXED-VIEWPORT app screen, not a
   * document that page-scrolls: its map is pinned full-height on the right and
   * only the results list scrolls on the left (Airbnb-2026). On web/wide it must
   * therefore render OUTSIDE the page-level `Animated.ScrollView` so the page
   * itself never scrolls — otherwise scrolling drags the map along with the
   * list. We gate on `/explore` and only take the fixed shell when the
   * persistent shell is in use (web or wide native) — the native tab-bar branch
   * is untouched. (The legacy `/search` path is a redirect to `/explore`, so it
   * never needs the fixed viewport itself.)
   *
   * Derived from `usePathname()` (no effect): `startsWith('/explore/')` also
   * covers `/explore/<query>` so deep-linked searches get the same fixed viewport.
   */
  const isExploreRoute = pathname === '/explore' || pathname.startsWith('/explore/');
  const useFixedViewport = !useNativeTabBar && isExploreRoute;

  const styles = useMemo(() => StyleSheet.create({
    container: {
      ...(isScreenNotMobile ? {
      } : {
        flex: 1,
      }),
      width: '100%',
      marginHorizontal: 'auto',
      flexDirection: isScreenNotMobile ? 'row' : 'column',
    },
    mainContent: {
      maxWidth: 1800,
      marginHorizontal: isScreenNotMobile ? 'auto' : 0,
      justifyContent: 'space-between',
      flexDirection: isScreenNotMobile ? 'row' : 'column',
      flex: 1,
    },
    mainContentWrapper: {
      flex: isScreenNotMobile ? 2.2 : 1,
      ...(isScreenNotMobile ? {
        borderRightWidth: StyleSheet.hairlineWidth,
        borderRightColor: colors.border,
      } : {}),
      backgroundColor: colors.primaryLight,
    },
    // --- Fixed-viewport shell (explore route) ---
    // A non-scrolling page: the shell is clamped to the viewport height and
    // hides overflow, so each region (SideBar / Slot / RightBar) owns its own
    // internal scroll. `100dvh` (the dynamic viewport unit — accounts for mobile
    // browser chrome, with `100vh` as the inherited fallback on engines without
    // it) and `overflow:'hidden'` are web-only CSS values absent from RN's
    // `ViewStyle`, so the web block is typed as a whole — mirroring the existing
    // web-only style casts in `SearchResultsView`/`RightBar`.
    fixedShell: Platform.select<ViewStyle>({
      web: {
        height: '100dvh',
        overflow: 'hidden',
        width: '100%',
        marginHorizontal: 'auto',
        flexDirection: 'row',
      } as unknown as ViewStyle,
      default: {
        flex: 1,
        width: '100%',
        flexDirection: 'row',
      },
    }) as ViewStyle,
    // Main region of the fixed shell: a full-height row holding the Slot
    // (results surface) and the RightBar. Fills the space between SideBar and
    // the viewport edge and never grows past it (`overflow:'hidden'`).
    fixedMain: Platform.select<ViewStyle>({
      web: {
        flex: 1,
        minWidth: 0,
        height: '100%',
        overflow: 'hidden',
        maxWidth: 1800,
        flexDirection: 'row',
        justifyContent: 'space-between',
      } as unknown as ViewStyle,
      default: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        justifyContent: 'space-between',
        maxWidth: 1800,
      },
    }) as ViewStyle,
    // The Slot wrapper inside the fixed shell. Mirrors `mainContentWrapper`'s
    // brand-light surface + right hairline, but is height-bounded so the
    // explore surface (its own sticky top bar + split row) can size to it and
    // scroll only its list column.
    fixedSlotWrapper: Platform.select<ViewStyle>({
      web: {
        flex: 1,
        minWidth: 0,
        height: '100%',
        overflow: 'hidden',
        borderRightWidth: StyleSheet.hairlineWidth,
        borderRightColor: colors.border,
        backgroundColor: colors.primaryLight,
      } as unknown as ViewStyle,
      default: {
        flex: 1,
        minWidth: 0,
        borderRightWidth: StyleSheet.hairlineWidth,
        borderRightColor: colors.border,
        backgroundColor: colors.primaryLight,
      },
    }) as ViewStyle,
    // The RightBar column inside the fixed shell: a full-height right rail that
    // scrolls internally if its widgets overflow (the page no longer scrolls).
    fixedRightColumn: Platform.select<ViewStyle>({
      web: {
        height: '100%',
        overflow: 'auto',
      } as unknown as ViewStyle,
      default: {},
    }) as ViewStyle,
  }), [isScreenNotMobile]);
  const layoutScrollY = useSharedValue(0);
  const layoutScrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      layoutScrollY.value = event.contentOffset.y;
    },
  });
  const layoutScrollContextValue = useMemo(
    () => ({ scrollY: layoutScrollY }),
    [layoutScrollY],
  );
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

  // --- Splash Fade Handler ---
  const handleSplashFadeComplete = useCallback(() => {
    setAppIsReady(true);
  }, []);

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

  // One-time app bootstrap: set up notifications (native only), hide the native
  // splash, then mark initialization complete to start the JS splash fade. The
  // completion state is set in an async continuation (after `await`) and guarded
  // by `active` so it never runs synchronously within the effect or after
  // unmount.
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
        await SplashScreen.hideAsync();
        if (active) {
          setInitializationComplete(true);
        }
      } catch (error: unknown) {
        logger.warn('Failed to set up notifications:', error);
      }
    })();
    return () => {
      active = false;
    };
  }, []);


  return (
    <View style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          {/*
            Pin Bloom to the YELLOW preset in LIGHT mode. `mode="light"` stops Bloom
            from following the OS into dark — Homiio's static `colors.ts` is a
            light-only palette, so following the OS produced a light-static /
            dark-Bloom mismatch. This provider owns the splash screen + font
            loading (both render before OxyProvider mounts). The same props are
            passed to OxyProvider below so its internal BloomThemeProvider writes
            identical CSS vars instead of clobbering them with its `oxy`/`system`
            defaults — see OxyProvider's note that any outer provider is shadowed.
          */}
          <BloomThemeProvider mode="light" colorPreset="yellow" fonts onFontsLoading={<AppSplashScreen />}>
          {!appIsReady ? (
            <AppSplashScreen
              startFade={startFade}
              onFadeComplete={handleSplashFadeComplete}
            />
          ) : (
              <QueryClientProvider client={queryClient}>
                <RentalModeProvider>
                <OxyProvider baseURL={OXY_BASE_URL} themeMode="light" colorPreset="yellow">
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
                                      {useNativeTabBar ? (
                                        /*
                                          Native phones: the `(tabs)` group's
                                          `NativeTabs` navigator owns the screen
                                          container, so `<Slot/>` is rendered
                                          directly (no outer scroll view / right
                                          rail). `SideBar` stays mounted for its
                                          Portal overlay drawer. The platform tab
                                          bar replaces the old JS `BottomBar`.
                                          Screens that read `LayoutScrollContext`
                                          fall back to a local `scrollY` when the
                                          provider is absent.
                                        */
                                        <>
                                          <SideBar />
                                          <Slot />
                                        </>
                                      ) : useFixedViewport ? (
                                        /*
                                          Explore route (web/wide): a FIXED-VIEWPORT
                                          app screen. The shell is clamped to the
                                          viewport height with `overflow:'hidden'`,
                                          so the page itself never scrolls — the
                                          explore surface pins its map full-height
                                          and scrolls only its results list. Same
                                          left→right arrangement as the scrolling
                                          shell (SideBar · Slot · RightBar) but
                                          WITHOUT the outer `Animated.ScrollView`.
                                          We still provide `LayoutScrollContext`
                                          (with the shared, here-unscrolled
                                          `scrollY`) so consumers that read it —
                                          `Header`/feed/detail — never crash; the
                                          explore surface uses its own sticky top
                                          bar and doesn't depend on page scroll.
                                        */
                                        <LayoutScrollProvider value={layoutScrollContextValue}>
                                          <View style={styles.fixedShell}>
                                            <SideBar />
                                            <View style={styles.fixedMain}>
                                              <View style={styles.fixedSlotWrapper}>
                                                <Slot />
                                              </View>
                                              <View style={styles.fixedRightColumn}>
                                                <RightBar />
                                              </View>
                                            </View>
                                          </View>
                                        </LayoutScrollProvider>
                                      ) : (
                                        <LayoutScrollProvider value={layoutScrollContextValue}>
                                          <Animated.ScrollView
                                            contentContainerStyle={styles.container}
                                            style={{ flex: 1 }}
                                            onScroll={layoutScrollHandler}
                                            scrollEventThrottle={16}
                                          >
                                            <SideBar />
                                            <View style={styles.mainContent}>
                                              <View style={styles.mainContentWrapper}>
                                                <Slot />
                                              </View>
                                              <RightBar />
                                            </View>
                                          </Animated.ScrollView>
                                        </LayoutScrollProvider>
                                      )}
                                    </SearchModeProvider>
                                  </MapStateProvider>
                                  <StatusBar style="auto" />
                                  <Toaster
                                    position="bottom-center"
                                    swipeToDismissDirection="left"
                                    offset={15}
                                  />
                                </ErrorBoundary>
                                {/*
                                  Root overlay outlet. The mobile navigation
                                  drawer (SideBar's small-screen branch) renders
                                  here via Bloom's Portal so its slide-in panel
                                  and dimming scrim cover the whole viewport —
                                  mirroring the inbox app's `front` drawer that
                                  overlays the entire screen. Placed last so it
                                  sits above all app chrome.
                                */}
                                <PortalOutlet />
                              </PortalProvider>
                            </MenuProvider>
                          </BottomSheetProvider>
                        </I18nextProvider>
                      </NotificationProvider>
                    </SavedPropertiesProvider>
                  </ProfileProvider>
                </OxyProvider>
                </RentalModeProvider>
              </QueryClientProvider>
          )}
          </BloomThemeProvider>
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </View>
  );
}

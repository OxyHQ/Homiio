import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Platform, View, StyleSheet, AppState, AppStateStatus } from 'react-native';
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
import { useKeyboardVisibility } from '@/hooks/useKeyboardVisibility';
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
import { BottomBar } from '@/components/BottomBar';
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
  const [splashState, setSplashState] = useState({
    initializationComplete: false,
    startFade: false,
  });
  const isScreenNotMobile = useIsScreenNotMobile();
  const pathname = usePathname() || '/';

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
        borderLeftWidth: 0.5,
        borderRightWidth: 0.5,
        borderColor: colors.border,
      } : {}),
      backgroundColor: colors.primaryLight,
    },
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

  // --- Keyboard State ---
  const keyboardVisible = useKeyboardVisibility();

  const initializeApp = useCallback(async () => {
    try {
      if (Platform.OS !== 'web') {
        await setupNotifications();
        const hasPermission = await requestNotificationPermissions();
        if (hasPermission && __DEV__) {
          await scheduleDemoNotification();
        }
      }
      setSplashState((prev) => ({ ...prev, initializationComplete: true }));
      await SplashScreen.hideAsync();
    } catch (error: unknown) {
      logger.warn('Failed to set up notifications:', error);
    }
  }, []);

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

  useEffect(() => {
    initializeApp();
  }, [initializeApp]);

  useEffect(() => {
    if (splashState.initializationComplete && !splashState.startFade) {
      setSplashState((prev) => ({ ...prev, startFade: true }));
    }
  }, [splashState.initializationComplete, splashState.startFade]);

  return (
    <View style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <BloomThemeProvider colorPreset="blue" fonts onFontsLoading={<AppSplashScreen />}>
          {!appIsReady ? (
            <AppSplashScreen
              startFade={splashState.startFade}
              onFadeComplete={handleSplashFadeComplete}
            />
          ) : (
              <QueryClientProvider client={queryClient}>
                <RentalModeProvider>
                <OxyProvider baseURL={OXY_BASE_URL}>
                  <ProfileProvider>
                    <SavedPropertiesProvider>
                      <NotificationProvider>
                        <I18nextProvider i18n={i18n}>
                          <BottomSheetProvider>
                            <MenuProvider>
                              <ErrorBoundary>
                                <MapStateProvider>
                                  <SearchModeProvider>
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
                                  </SearchModeProvider>
                                </MapStateProvider>
                                <StatusBar style="auto" />
                                <Toaster
                                  position="bottom-center"
                                  swipeToDismissDirection="left"
                                  offset={15}
                                />
                                {!isScreenNotMobile && !keyboardVisible && <BottomBar />}
                              </ErrorBoundary>
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

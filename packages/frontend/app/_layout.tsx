// --- 1. Organized Imports ---
import React, { useEffect, useState, useCallback, useMemo, createContext } from 'react';
import { Keyboard, Platform, View, StyleSheet } from 'react-native';
import {
  SafeAreaProvider,
  initialWindowMetrics,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Slot } from 'expo-router';
import { useMediaQuery } from 'react-responsive';
import { StatusBar } from 'expo-status-bar';
import { SideBar } from '@/components/SideBar';
import { RightBar } from '@/components/RightBar';
import { colors } from '@/styles/colors';
import { useSEO } from '@/hooks/useDocumentTitle';
import { Toaster } from '@/lib/sonner';
import {
  setupNotifications,
  requestNotificationPermissions,
  scheduleDemoNotification,
} from '@/utils/notifications';
import i18n from 'i18next';
import { initReactI18next, I18nextProvider, useTranslation } from 'react-i18next';
import enUS from '@/locales/en.json';
import esES from '@/locales/es.json';
import caES from '@/locales/ca-ES.json';
import itIT from '@/locales/it.json';
import { BottomBar } from '@/components/BottomBar';
import { MenuProvider } from 'react-native-popup-menu';

import AppSplashScreen from '@/components/AppSplashScreen';
import LoadingTopSpinner from '@/components/LoadingTopSpinner';
import ErrorBoundary from '@/components/ErrorBoundary';
import { ProfileProvider } from '@/context/ProfileContext';
import { SavedPropertiesProvider } from '@/context/SavedPropertiesContext';
import { BottomSheetProvider } from '@/context/BottomSheetContext';
import { OxyProvider, OxyServices } from '@oxyhq/services';
import { generateWebsiteStructuredData, injectStructuredData } from '@/utils/structuredData';
import { PostHogProvider } from 'posthog-react-native';
import '../styles/global.css';

// Oxy context for bottom sheet content
export const OxyContext = createContext<{
  oxyServices: OxyServices | null;
  activeSessionId: string | null;
}>({
  oxyServices: null,
  activeSessionId: null,
});

// --- 2. i18n Initialization ---
i18n
  .use(initReactI18next)
  .init({
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
    console.error('Failed to initialize i18n:', error);
  });

// --- 3. Styles (outside component) ---
const getStyles = (isScreenNotMobile: boolean, insets: any) =>
  StyleSheet.create({
    container: {
      maxWidth: 1600,
      width: '100%',
      paddingHorizontal: isScreenNotMobile ? 10 : 0,
      marginHorizontal: 'auto',
      justifyContent: 'space-between',
      flexDirection: isScreenNotMobile ? 'row' : 'column',
      ...(!isScreenNotMobile && {
        flex: 1,
      }),
    },
    mainContentWrapper: {
      flex: isScreenNotMobile ? 2.2 : 1,
      backgroundColor: colors.primaryLight,
    },
    contentContainer: {
      flex: 1,
      alignItems: 'center',
    },
  });

// --- 4. RootLayout Component ---
export default function RootLayout() {
  const [appIsReady, setAppIsReady] = useState(false);
  const [splashState, setSplashState] = useState({
    initializationComplete: false,
    startFade: false,
  });
  const { i18n } = useTranslation();
  const isScreenNotMobile = useMediaQuery({ minWidth: 500 });
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => getStyles(isScreenNotMobile, insets), [isScreenNotMobile, insets]);

  // --- Font Loading ---
  const [loaded] = useFonts({
    'Cereal-Light': require('@/assets/fonts/Cereal/Cereal_W_Lt.otf'),
    'Cereal-Book': require('@/assets/fonts/Cereal/Cereal_W_Bk.otf'),
    'Cereal-Black': require('@/assets/fonts/Cereal/Cereal_W_Blk.otf'),
    'Cereal-Medium': require('@/assets/fonts/Cereal/Cereal_W_Md.otf'),
    'Cereal-ExtraBold': require('@/assets/fonts/Cereal/Cereal_W_XBd.otf'),
    'Cereal-Bold': require('@/assets/fonts/Cereal/Cereal_W_Bd.otf'),
    // ... keep Inter and Phudu fonts for fallback or legacy
    'Inter-Black': require('@/assets/fonts/inter/Inter-Black.otf'),
    'Inter-Bold': require('@/assets/fonts/inter/Inter-Bold.otf'),
    'Inter-ExtraBold': require('@/assets/fonts/inter/Inter-ExtraBold.otf'),
    'Inter-ExtraLight': require('@/assets/fonts/inter/Inter-ExtraLight.otf'),
    'Inter-Light': require('@/assets/fonts/inter/Inter-Light.otf'),
    'Inter-Medium': require('@/assets/fonts/inter/Inter-Medium.otf'),
    'Inter-Regular': require('@/assets/fonts/inter/Inter-Regular.otf'),
    'Inter-SemiBold': require('@/assets/fonts/inter/Inter-SemiBold.otf'),
    'Inter-Thin': require('@/assets/fonts/inter/Inter-Thin.otf'),
    'Phudu-Thin': require('@/assets/fonts/Phudu-VariableFont_wght.ttf'),
    'Phudu-Regular': require('@/assets/fonts/Phudu-VariableFont_wght.ttf'),
    'Phudu-Medium': require('@/assets/fonts/Phudu-VariableFont_wght.ttf'),
    'Phudu-SemiBold': require('@/assets/fonts/Phudu-VariableFont_wght.ttf'),
    'Phudu-Bold': require('@/assets/fonts/Phudu-VariableFont_wght.ttf'),
  });

  // --- Keyboard State ---
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // --- SEO and Structured Data (Web only) ---
  useSEO({
    title: 'Ethical Housing Platform',
    description:
      'Find your ethical home with transparent rentals, fair agreements, and verified properties. Join Homiio for a better housing experience.',
    keywords:
      'housing, rental, property, ethical housing, transparent rentals, verified properties, fair agreements',
    type: 'website',
  });
  useEffect(() => {
    if (Platform.OS === 'web') {
      const websiteData = generateWebsiteStructuredData();
      injectStructuredData(websiteData);
    }
  }, []);

  // --- OxyServices Memoization ---
  const oxyServices = useMemo(
    () =>
      new OxyServices({
        baseURL:
          process.env.NODE_ENV === 'production'
            ? 'https://api.oxy.so'
            : 'http://192.168.86.44:3001',
      }),
    [],
  );

  // --- App Initialization ---
  const initializeApp = useCallback(async () => {
    try {
      if (loaded) {
        await setupNotifications();
        const hasPermission = await requestNotificationPermissions();
        if (hasPermission) {
          await scheduleDemoNotification();
        }
        setSplashState((prev) => ({ ...prev, initializationComplete: true }));
        await SplashScreen.hideAsync();
      }
    } catch (error) {
      console.warn('Failed to set up notifications:', error);
    }
  }, [loaded]);

  // --- Splash Fade Handler ---
  const handleSplashFadeComplete = useCallback(() => {
    setAppIsReady(true);
  }, []);

  // --- Effects: App Initialization, Body Styling ---
  useEffect(() => {
    initializeApp();
  }, [initializeApp]);

  // --- Effects: Splash Fade Trigger ---
  useEffect(() => {
    if (loaded && splashState.initializationComplete && !splashState.startFade) {
      setSplashState((prev) => ({ ...prev, startFade: true }));
    }
  }, [loaded, splashState.initializationComplete, splashState.startFade]);

  // --- Main Render ---
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <GestureHandlerRootView>
        {!appIsReady ? (
          <AppSplashScreen
            startFade={splashState.startFade}
            onFadeComplete={handleSplashFadeComplete}
          />
        ) : (
          <PostHogProvider
            apiKey="phc_wRxFcPEaeeRHAKoMi4gzleLdNE9Ny4JEwYe8Z5h3soO"
            options={{
              host: 'https://us.i.posthog.com',
              enableSessionReplay: true,
            }}
            autocapture
          >
            <OxyProvider
              oxyServices={oxyServices}
              initialScreen="SignIn"
              autoPresent={false}
              onClose={() => console.log('Sheet closed')}
              onAuthStateChange={(user) =>
                console.log('Auth state changed:', user?.username || 'logged out')
              }
              storageKeyPrefix="oxy_example"
              theme="light"
            >
              <ProfileProvider>
                <SavedPropertiesProvider>
                  <I18nextProvider i18n={i18n}>
                    <BottomSheetProvider>
                      <MenuProvider>
                        <ErrorBoundary>
                          <View style={styles.container}>
                            <SideBar />
                            <View style={styles.mainContentWrapper}>
                              <LoadingTopSpinner
                                showLoading={false}
                                size={20}
                                style={{ paddingBottom: 0 }}
                              />
                              <Slot />
                            </View>
                            <RightBar />
                          </View>
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
                </SavedPropertiesProvider>
              </ProfileProvider>
            </OxyProvider>
          </PostHogProvider>
        )}
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { ScrollView, Keyboard, LogBox, Platform } from "react-native";
import * as SplashScreen from 'expo-splash-screen';
import { Provider } from 'react-redux';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from "expo-font";
import { Slot } from 'expo-router';
import store from '@/store/store';
import { useMediaQuery } from 'react-responsive'
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";
import { SideBar } from '@/components/SideBar';
import { RightBar } from '@/components/RightBar';
import { colors } from '@/styles/colors';
import { useColorScheme } from "@/hooks/useColorScheme";
import { useDocumentTitle, useSEO } from "@/hooks/useDocumentTitle";
import { Toaster } from '@/lib/sonner';
import {
  setupNotifications,
  requestNotificationPermissions,
  scheduleDemoNotification,
} from "@/utils/notifications";
import i18n from "i18next";
import { initReactI18next, I18nextProvider, useTranslation } from "react-i18next";
import enUS from "@/locales/en.json";
import esES from "@/locales/es.json";
import caES from "@/locales/ca-ES.json";
import { View, StyleSheet, } from 'react-native';
import { BottomBar } from "@/components/BottomBar";
import { initialWindowMetrics } from 'react-native-safe-area-context';
import { MenuProvider } from 'react-native-popup-menu';
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import WebSplashScreen from "@/components/WebSplashScreen";
import LoadingTopSpinner from "@/components/LoadingTopSpinner";
import ErrorBoundary from '@/components/ErrorBoundary';
import { ProfileProvider } from '@/context/ProfileContext';
import { OxyLogo, OxyProvider, OxyServices, OxySignInButton, useOxy } from '@oxyhq/services';
import { generateWebsiteStructuredData, injectStructuredData } from '@/utils/structuredData';

import "../styles/global.css";

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

i18n.use(initReactI18next).init({
  resources: {
    "en-US": { translation: enUS },
    "es-ES": { translation: esES },
    "ca-ES": { translation: caES },
  },
  lng: "en-US",
  fallbackLng: "en-US",
  interpolation: {
    escapeValue: false,
  },
}).catch(error => {
  console.error("Failed to initialize i18n:", error);
});

export default function RootLayout() {
  const [appIsReady, setAppIsReady] = useState(false);
  const [splashState, setSplashState] = useState({
    initializationComplete: false,
    startFade: false
  });
  const { i18n } = useTranslation();
  const colorScheme = useColorScheme();

  // Set default document title and SEO for web
  useSEO({
    title: 'Ethical Housing Platform',
    description: 'Find your ethical home with transparent rentals, fair agreements, and verified properties. Join Homiio for a better housing experience.',
    keywords: 'housing, rental, property, ethical housing, transparent rentals, verified properties, fair agreements',
    type: 'website'
  });

  // Inject website structured data
  useEffect(() => {
    if (Platform.OS === 'web') {
      const websiteData = generateWebsiteStructuredData();
      injectStructuredData(websiteData);
    }
  }, []);

  // Initialize OxyServices - memoize to prevent recreation
  const oxyServices = useMemo(() => new OxyServices({
    baseURL: process.env.NODE_ENV === 'production'
      ? 'https://api.oxy.so'
      : 'http://localhost:3001',
  }), []);

  // Handle user authentication - memoized callback
  const handleAuthenticated = useCallback((user: any) => {
    console.log('User authenticated:', user);
    // We'll just log the authentication event here
    // The bottom sheet will be closed by the OxyProvider internally
  }, []);

  const [loaded] = useFonts({
    "Inter-Black": require("@/assets/fonts/inter/Inter-Black.otf"),
    "Inter-Bold": require("@/assets/fonts/inter/Inter-Bold.otf"),
    "Inter-ExtraBold": require("@/assets/fonts/inter/Inter-ExtraBold.otf"),
    "Inter-ExtraLight": require("@/assets/fonts/inter/Inter-ExtraLight.otf"),
    "Inter-Light": require("@/assets/fonts/inter/Inter-Light.otf"),
    "Inter-Medium": require("@/assets/fonts/inter/Inter-Medium.otf"),
    "Inter-Regular": require("@/assets/fonts/inter/Inter-Regular.otf"),
    "Inter-SemiBold": require("@/assets/fonts/inter/Inter-SemiBold.otf"),
    "Inter-Thin": require("@/assets/fonts/inter/Inter-Thin.otf"),
    "Phudu": require("@/assets/fonts/Phudu-VariableFont_wght.ttf"),
  });

  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Optimized initialization function
  const initializeApp = useCallback(async () => {
    try {
      if (loaded) {
        await setupNotifications();
        const hasPermission = await requestNotificationPermissions();

        if (hasPermission) {
          await scheduleDemoNotification();
        }

        // Single state update instead of multiple
        setSplashState(prev => ({ ...prev, initializationComplete: true }));
        await SplashScreen.hideAsync();
      }
    } catch (error) {
      console.warn("Failed to set up notifications:", error);
    }
  }, [loaded]);

  // Memoized splash fade completion handler
  const handleSplashFadeComplete = useCallback(() => {
    setAppIsReady(true);
  }, []);

  useEffect(() => {
    initializeApp();

    // Change overflow style to visible only on web
    if (typeof document !== 'undefined') {
      document.body.style.overflow = 'visible';
      document.body.style.backgroundColor = colors.COLOR_BACKGROUND;
    }
  }, [initializeApp]);

  // Start fade immediately when everything is loaded
  useEffect(() => {
    if (loaded && splashState.initializationComplete && !splashState.startFade) {
      setSplashState(prev => ({ ...prev, startFade: true }));
    }
  }, [loaded, splashState.initializationComplete, splashState.startFade]);

  const isScreenNotMobile = useMediaQuery({ minWidth: 500 })

  // Memoize styles to prevent recreation - MUST be before any conditional returns
  const styles = useMemo(() => StyleSheet.create({
    container: {
      maxWidth: 1800,
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
      marginVertical: isScreenNotMobile ? 20 : 0,
      flex: isScreenNotMobile ? 2.2 : 1,
      backgroundColor: colors.primaryLight,
      borderRadius: isScreenNotMobile ? 35 : 0,
    },
    contentContainer: {
      flex: 1,
      alignItems: 'center',
    },
  }), [isScreenNotMobile]);

  if (!loaded) {
    return null;
  }

  if (!appIsReady) {
    // check if we are in web
    if (Platform.OS === 'web') {
      return <WebSplashScreen onFadeComplete={handleSplashFadeComplete} startFade={splashState.startFade} />;
    } else {
      return null;
    }
  }

  return (
    <OxyProvider
      oxyServices={oxyServices}
      initialScreen="SignIn"
      autoPresent={false} // Don't auto-present, we'll control it with the button
      onClose={() => console.log('Sheet closed')}
      onAuthenticated={handleAuthenticated}
      onAuthStateChange={(user) => console.log('Auth state changed:', user?.username || 'logged out')}
      storageKeyPrefix="oxy_example" // Prefix for stored auth tokens
      theme="light"
    >
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <Provider store={store}>
          <I18nextProvider i18n={i18n}>
            <MenuProvider>
              <ErrorBoundary>
                <ProfileProvider>
                  <View style={styles.container}>
                    <SideBar />
                    <View style={styles.mainContentWrapper}>
                      <LoadingTopSpinner showLoading={false} size={20} style={{ paddingBottom: 0, }} />
                      <Slot />
                    </View>
                    <RightBar />
                  </View>
                  <StatusBar style="auto" />
                  <Toaster position="bottom-center" swipeToDismissDirection="left" offset={15} />
                  {!isScreenNotMobile && !keyboardVisible && <BottomBar />}
                </ProfileProvider>
              </ErrorBoundary>
            </MenuProvider>
          </I18nextProvider>
        </Provider>
      </SafeAreaProvider>
    </OxyProvider>
  );
}
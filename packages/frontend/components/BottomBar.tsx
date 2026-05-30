import { StyleSheet, View, Pressable, ViewStyle, Platform } from 'react-native';
import {
  Home,
  HomeActive,
  Search,
  SearchActive,
  Bookmark,
  BookmarkActive,
  SindiIcon,
} from '@/assets/icons';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { useRouter, usePathname } from 'expo-router';
import React, { useMemo, useCallback } from 'react';
import { Avatar } from '@oxyhq/bloom/avatar';
import { showSignInModal, useOxy } from '@oxyhq/services';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SindiIconActive } from '@/assets/icons/sindi-icon';
import { useRentalMode } from '@/context/RentalModeContext';

export const BottomBar = () => {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const { isAuthenticated } = useOxy();
  const { mode: rentalMode } = useRentalMode();
  const insets = useSafeAreaInsets();

  // Mode-specific secondary tab. Homiio is primarily a long-term flat rental
  // platform (Idealista/Fotocasa), so the default mode surfaces the user's
  // pipeline of tenant applications. Vacation mode surfaces bookings (Stays).
  const showApplicationsTab = isAuthenticated && rentalMode === 'long_term';
  const showStaysTab = isAuthenticated && rentalMode === 'vacation';

  // Normalize current pathname to one of our tab routes
  const activeRoute = useMemo<
    '/' | '/search' | '/saved' | '/sindi' | '/applications' | '/stays'
  >(() => {
    if (pathname === '/' || pathname === '') return '/';
    if (pathname.startsWith('/search') || pathname.startsWith('/properties')) return '/search';
    if (pathname.startsWith('/saved')) return '/saved';
    if (pathname.startsWith('/sindi')) return '/sindi';
    if (pathname.startsWith('/applications')) return '/applications';
    if (pathname.startsWith('/stays') || pathname.startsWith('/reservations')) return '/stays';
    return '/';
  }, [pathname]);

  const handlePress = useCallback((route: typeof activeRoute) => {
    if (route !== activeRoute) router.push(route);
  }, [router, activeRoute]);

  const styles = StyleSheet.create({
    bottomBar: {
      width: '100%',
      height: 60 + insets.bottom,
      backgroundColor: colors.white,
      flexDirection: 'row',
      justifyContent: 'space-around',
      alignItems: 'center',
      borderTopWidth: 1,
      borderTopColor: colors.COLOR_BLACK_LIGHT_6,
      elevation: 8,
      paddingBottom: insets.bottom,
      ...Platform.select({
        web: {
          position: 'sticky',
          bottom: 0,
          left: 0,
          height: 60,
          paddingBottom: 0,
        },
      }),
    } as ViewStyle,
    tab: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 10,
    },
    active: {
      borderRadius: 30,
    },
  });

  return (
    <View style={styles.bottomBar}>
      <Pressable
        onPress={() => handlePress('/')}
        style={[styles.tab, activeRoute === '/' && styles.active]}
      >
        {activeRoute === '/' ? (
          <HomeActive size={28} color={colors.primaryColor} />
        ) : (
          <Home size={28} color={colors.COLOR_BLACK} />
        )}
      </Pressable>
      <Pressable
        onPress={() => handlePress('/search')}
        style={[styles.tab, activeRoute === '/search' && styles.active]}
      >
        {activeRoute === '/search' ? (
          <SearchActive size={28} color={colors.primaryColor} />
        ) : (
          <Search size={28} color={colors.COLOR_BLACK} />
        )}
      </Pressable>
      <Pressable
        onPress={() => handlePress('/sindi')}
        style={[styles.tab, activeRoute === '/sindi' && styles.active]}
      >
        {activeRoute === '/sindi' ? (
          <SindiIconActive size={28} color={colors.primaryColor} />
        ) : (
          <SindiIcon size={28} color={colors.COLOR_BLACK} />
        )}
      </Pressable>
      <Pressable
        onPress={() => handlePress('/saved')}
        style={[styles.tab, activeRoute === '/saved' && styles.active]}
      >
        {activeRoute === '/saved' ? (
          <BookmarkActive size={28} color={colors.primaryColor} />
        ) : (
          <Bookmark size={28} color={colors.COLOR_BLACK} />
        )}
      </Pressable>
      {/* Applications tab — applicant pipeline in long-term mode (default). */}
      {showApplicationsTab && (
        <Pressable
          onPress={() => handlePress('/applications')}
          style={[styles.tab, activeRoute === '/applications' && styles.active]}
          accessibilityLabel="Applications"
        >
          <Ionicons
            name={activeRoute === '/applications' ? 'document-text' : 'document-text-outline'}
            size={28}
            color={activeRoute === '/applications' ? colors.primaryColor : colors.COLOR_BLACK}
          />
        </Pressable>
      )}
      {/* Stays tab — booking dashboard in vacation mode. */}
      {showStaysTab && (
        <Pressable
          onPress={() => handlePress('/stays')}
          style={[styles.tab, activeRoute === '/stays' && styles.active]}
          accessibilityLabel="Stays"
        >
          <Ionicons
            name={activeRoute === '/stays' ? 'bed' : 'bed-outline'}
            size={28}
            color={activeRoute === '/stays' ? colors.primaryColor : colors.COLOR_BLACK}
          />
        </Pressable>
      )}
      <View style={styles.tab}>
        <Avatar onPress={() => showSignInModal()} />
      </View>
    </View>
  );
};

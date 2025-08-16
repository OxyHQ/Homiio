import { StyleSheet, View, Pressable, ViewStyle, Platform } from 'react-native';
import {
  Home,
  HomeActive,
  Search,
  SearchActive,
  Bookmark,
  BookmarkActive,
  SindiIcon,
  Gear,
  GearActive,
} from '@/assets/icons';
import { colors } from '@/styles/colors';
import { useRouter, usePathname } from 'expo-router';
import React from 'react';
import Avatar from './Avatar';
import { useOxy } from '@oxyhq/services';
import { useHasRentalProperties } from '@/hooks/useLeaseQueries';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SindiIconActive } from '@/assets/icons/sindi-icon';

export const BottomBar = () => {
  const router = useRouter();
  const [activeRoute, setActiveRoute] = React.useState('/');
  const pathname = usePathname();
  const { showBottomSheet, hideBottomSheet } = useOxy();
  const { hasRentalProperties, isLoading } = useHasRentalProperties();
  const insets = useSafeAreaInsets();

  const handlePress = (
    route: '/' | '/properties' | '/saved' | '/sindi' | '/contracts' | '/profile',
  ) => {
    setActiveRoute(route);
    router.push(route);
  };

  const styles = StyleSheet.create({
    bottomBar: {
      width: '100%',
      height: 60 + insets.bottom,
      backgroundColor: '#ffffff',
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
        onPress={() => handlePress('/properties')}
        style={[styles.tab, activeRoute === '/properties' && styles.active]}
      >
        {activeRoute === '/properties' ? (
          <SearchActive size={28} color={colors.primaryColor} />
        ) : (
          <Search size={28} color={colors.COLOR_BLACK} />
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
      {/* Only show contracts tab if user has rental properties */}
      {hasRentalProperties && (
        <Pressable
          onPress={() => handlePress('/contracts')}
          style={[styles.tab, activeRoute === '/contracts' && styles.active]}
        >
          {/* No custom contract icon found, fallback to Gear/GearActive for demo */}
          {activeRoute === '/contracts' ? (
            <GearActive size={28} color={colors.primaryColor} />
          ) : (
            <Gear size={28} color={colors.COLOR_BLACK} />
          )}
        </Pressable>
      )}
      <View style={styles.tab}>
        <Avatar onPress={() => showBottomSheet?.('SignIn')} />
      </View>
    </View>
  );
};

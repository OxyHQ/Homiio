import React from 'react';
import {
  Dimensions,
  Platform,
  Text,
  View,
  ViewStyle,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useMediaQuery } from 'react-responsive';
import { useTranslation } from 'react-i18next';
import { SideBarItem } from './SideBarItem';
import { colors } from '@/styles/colors';
import { Button } from '@/components/SideBar/Button';
import { Logo } from '@/components/Logo';
import { Home, HomeActive } from '@/assets/icons/home-icon';
import { Bookmark, BookmarkActive } from '@/assets/icons/bookmark-icon';
import { Gear, GearActive } from '@/assets/icons/gear-icon';
import { Hashtag, HashtagActive } from '@/assets/icons/hashtag-icon';
import { Search, SearchActive } from '@/assets/icons/search-icon';
import { Compose } from '@/assets/icons/compose-icon';
import { Ionicons } from '@expo/vector-icons';
import { OxySignInButton, useOxy } from '@oxyhq/services';
import { SindiIcon, SindiIconActive } from '@/assets/icons';
import { ProfileIcon, ProfileIconActive } from '@/assets/icons/profile-icon';
import { webAlert } from '@/utils/api';
import { phuduFontWeights } from '@/styles/fonts';
import { useProfile } from '@/context/ProfileContext';

const IconComponent = Ionicons as any;

const WindowHeight = Dimensions.get('window').height;

export function SideBar() {
  const { t } = useTranslation();
  const router = useRouter();
  const { primaryProfile, isLoading } = useProfile();

  const { isAuthenticated, user, showBottomSheet, logout } = useOxy();

  // Only show roommates for personal profiles and when profile data is loaded
  // If still loading profiles, don't show roommates to avoid flickering
  const isPersonalProfile = !isLoading && primaryProfile?.profileType === 'personal';

  const handleSignOut = () => {
    webAlert(t('settings.signOut'), t('settings.signOutMessage'), [
      {
        text: t('cancel'),
        style: 'cancel',
      },
      {
        text: t('settings.signOut'),
        style: 'destructive',
        onPress: async () => {
          try {
            await logout();
            router.replace('/');
          } catch (error) {
            console.error('Logout failed:', error);
          }
        },
      },
    ]);
  };

  const sideBarData: {
    title: string;
    icon: React.ReactNode;
    iconActive: React.ReactNode;
    route: string;
  }[] = [
    {
      title: t('sidebar.navigation.home'),
      icon: <Home color={colors.COLOR_BLACK} />,
      iconActive: <HomeActive />,
      route: '/',
    },
    {
      title: t('sidebar.navigation.search'),
      icon: <Search color={colors.COLOR_BLACK} />,
      iconActive: <SearchActive />,
      route: '/search',
    },
    {
      title: t('sidebar.navigation.saved'),
      icon: <Bookmark color={colors.COLOR_BLACK} />,
      iconActive: <BookmarkActive />,
      route: '/saved',
    },
    {
      title: t('sidebar.navigation.sindi'),
      icon: <SindiIcon size={24} color={colors.COLOR_BLACK} />,
      iconActive: <SindiIconActive size={24} color={colors.primaryColor} />,
      route: '/sindi',
    },

    {
      title: t('sidebar.navigation.profile'),
      icon: <ProfileIcon size={24} color={colors.COLOR_BLACK} />,
      iconActive: <ProfileIconActive size={24} color={colors.primaryColor} />,
      route: '/profile',
    },

    // Only show roommates for personal profiles
    ...(isPersonalProfile
      ? [
          {
            title: t('sidebar.navigation.roommates'),
            icon: <Hashtag color={colors.COLOR_BLACK} />,
            iconActive: <HashtagActive />,
            route: '/roommates',
          },
        ]
      : []),
    {
      title: t('sidebar.navigation.settings'),
      icon: <Gear color={colors.COLOR_BLACK} />,
      iconActive: <GearActive />,
      route: '/settings',
    },
  ];

  const pathname = usePathname();
  const isSideBarVisible = useMediaQuery({ minWidth: 500 });
  const isFullSideBar = useMediaQuery({ minWidth: 1266 });

  if (!isSideBarVisible) return null;

  if (isSideBarVisible) {
    return (
      <View
        style={[
          styles.container,
          {
            alignItems: isFullSideBar ? 'flex-start' : 'center',
            paddingEnd: !isFullSideBar ? 10 : 0,
            width: isFullSideBar ? 350 : 60,
          },
        ]}
      >
        <View style={styles.content}>
          <Logo />
          {!user?.id && (
            <View style={styles.heroSection}>
              {isFullSideBar && <Text style={styles.heroTagline}>{t('sidebar.hero.tagline')}</Text>}
              {!isAuthenticated && (
                <View style={styles.authButtonsContainer}>
                  <TouchableOpacity
                    style={styles.signUpButton}
                    onPress={() => showBottomSheet?.('SignUp')}
                  >
                    <Text style={styles.signUpButtonText}>{t('sidebar.actions.signUp')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.signInButton}
                    onPress={() => showBottomSheet?.('SignIn')}
                  >
                    <Text style={styles.signInButtonText}>{t('sidebar.actions.signIn')}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
          {user && user.id && (
            <View style={styles.navigationSection}>
              {sideBarData.map(({ title, icon, iconActive, route }) => {
                return (
                  <SideBarItem
                    href={route}
                    key={title}
                    icon={pathname === route ? iconActive : icon}
                    text={title}
                    isActive={pathname === route}
                  />
                );
              })}
              <Button
                href="/properties/create"
                renderText={({ state }) =>
                  state === 'desktop' ? (
                    <Text style={styles.addPropertyButtonText}>
                      {t('sidebar.actions.addProperty')}
                    </Text>
                  ) : null
                }
                renderIcon={({ state }) =>
                  state === 'tablet' ? <Compose size={24} color={colors.primaryLight} /> : null
                }
                containerStyle={({ state }) => ({
                  ...styles.addPropertyButton,
                  height: state === 'desktop' ? 47 : 50,
                  width: state === 'desktop' ? 220 : 50,
                  ...(state === 'desktop' ? {} : styles.addPropertyButtonTablet),
                })}
              />
            </View>
          )}
        </View>
        <View style={styles.spacer}></View>
        <View style={styles.footer}>
          {user && user.id ? (
            <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
              <IconComponent name="log-out-outline" size={20} color={colors.COLOR_BLACK} />
              {isFullSideBar && <Text style={styles.signOutText}>{t('settings.signOut')}</Text>}
            </TouchableOpacity>
          ) : (
            <OxySignInButton />
          )}
          {isFullSideBar && <Text style={styles.brandName}>{t('sidebar.footer.brandName')}</Text>}
        </View>
      </View>
    );
  } else {
    return null;
  }
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 20,
    height: WindowHeight,
    ...(Platform.select({
      web: {
        position: 'sticky' as any,
      },
    }) as ViewStyle),
    top: 0,
  },
  content: {
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  heroSection: {
    marginTop: 16,
  },
  heroTagline: {
    color: colors.COLOR_BLACK,
    fontSize: 25,
    fontWeight: 'bold',
    fontFamily: 'Phudu',
    flexWrap: 'wrap',
    textAlign: 'left',
    maxWidth: 200,
    lineHeight: 30,
  },
  authButtonsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
    gap: 10,
  },
  signUpButton: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.COLOR_BLACK,
    borderRadius: 25,
    paddingHorizontal: 15,
    paddingVertical: 8,
  },
  signUpButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    fontFamily: 'Phudu',
  },
  signInButton: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primaryColor,
    borderRadius: 25,
    paddingHorizontal: 15,
    paddingVertical: 8,
  },
  signInButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    fontFamily: 'Phudu',
  },
  navigationSection: {
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  addPropertyButton: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primaryColor,
    borderRadius: 100,
    display: 'flex',
  },
  addPropertyButtonTablet: {
    alignSelf: 'center',
  },
  addPropertyButtonText: {
    color: 'white',
    fontSize: 17,
    fontWeight: 'bold',
    textAlign: 'center',
    margin: 'auto',
    fontFamily: 'Phudu',
  },
  spacer: {
    flex: 1,
  },
  footer: {
    flexDirection: 'column',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    width: '100%',
  },
  brandName: {
    marginTop: 8,
    fontSize: 14,
    color: colors.COLOR_BLACK,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.primaryLight,
    marginBottom: 8,
  },
  signOutText: {
    marginLeft: 8,
    fontSize: 14,
    color: colors.COLOR_BLACK,
    fontWeight: '500',
  },
  title: {
    fontSize: 24,
    fontFamily: phuduFontWeights.bold,
    color: colors.primaryDark,
    marginBottom: 16,
  },
  menuItemText: {
    fontSize: 16,
    fontFamily: phuduFontWeights.medium,
    color: colors.primaryDark,
    marginLeft: 12,
  },
  footerText: {
    fontSize: 14,
    fontFamily: phuduFontWeights.regular,
    color: colors.primaryDark_2,
    textAlign: 'center',
  },
});

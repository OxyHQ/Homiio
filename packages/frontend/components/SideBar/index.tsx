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
import { Pressable } from 'react-native-web-hover';
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
import { useOxy } from '@oxyhq/services';
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
        icon: <SindiIcon size={20} color={colors.COLOR_BLACK} />,
        iconActive: <SindiIconActive size={20} color={colors.primaryColor} />,
        route: '/sindi',
      },

      {
        title: t('sidebar.navigation.profile'),
        icon: <ProfileIcon size={20} color={colors.COLOR_BLACK} />,
        iconActive: <ProfileIconActive size={20} color={colors.primaryColor} />,
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
  const [isExpanded, setIsExpanded] = React.useState(false);
  const hoverCollapseTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const handleHoverIn = React.useCallback(() => {
    if (hoverCollapseTimeout.current) {
      clearTimeout(hoverCollapseTimeout.current);
      hoverCollapseTimeout.current = null;
    }
    setIsExpanded(true);
  }, []);

  const handleHoverOut = React.useCallback(() => {
    if (hoverCollapseTimeout.current) {
      clearTimeout(hoverCollapseTimeout.current);
    }
    hoverCollapseTimeout.current = setTimeout(() => setIsExpanded(false), 200);
  }, []);

  if (!isSideBarVisible) return null;

  if (isSideBarVisible) {
    return (
      <Pressable
        {...({ onHoverIn: handleHoverIn, onHoverOut: handleHoverOut } as any)}
        style={[
          styles.container,
          {
            width: isExpanded ? 240 : 60,
            ...(Platform.select({
              web: {
                transition: 'width 220ms cubic-bezier(0.2, 0, 0, 1)',
                willChange: 'width',
              },
            }) as ViewStyle),
          },
        ]}
      >
        <View style={styles.inner}>
          <View style={styles.headerSection}>
            <Logo />
            {!user?.id && (
              <View style={styles.heroSection}>
                {isExpanded && (
                  <Text style={styles.heroTagline}>{t('sidebar.hero.tagline')}</Text>
                )}
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
          </View>

          {user && user.id && (
            <View style={styles.navigationSection}>
              {sideBarData.map(({ title, icon, iconActive, route }) => (
                <SideBarItem
                  href={route}
                  key={title}
                  icon={pathname === route ? iconActive : icon}
                  text={title}
                  isActive={pathname === route}
                  isExpanded={isExpanded}
                  onHoverExpand={handleHoverIn}
                />
              ))}

              <Button
                href="/properties/create"
                renderText={({ state }) =>
                  isExpanded && state === 'desktop' ? (
                    <Text style={styles.addPropertyButtonText}>
                      {t('sidebar.actions.addProperty')}
                    </Text>
                  ) : null
                }
                renderIcon={() =>
                  isExpanded ? null : <Compose size={20} color={colors.primaryLight} />
                }
                containerStyle={() => ({
                  ...styles.addPropertyButton,
                  height: 40,
                  width: isExpanded ? '100%' : 36,
                  alignSelf: isExpanded ? 'stretch' : 'center',
                })}
              />
            </View>
          )}

          <View style={styles.footer}>
            {user && user.id ? (
              <SideBarItem
                isActive={false}
                icon={<IconComponent name="log-out-outline" size={20} color={colors.COLOR_BLACK} />}
                text={t('settings.signOut')}
                isExpanded={isExpanded}
                onHoverExpand={handleHoverIn}
                onPress={handleSignOut}
              />
            ) : (
              <SideBarItem
                isActive={false}
                icon={<IconComponent name="log-in-outline" size={20} color={colors.COLOR_BLACK} />}
                text={t('sidebar.actions.signIn')}
                isExpanded={isExpanded}
                onHoverExpand={handleHoverIn}
                onPress={() => showBottomSheet?.('SignIn')}
              />
            )}
          </View>
        </View>
      </Pressable>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'transparent',
    paddingVertical: 12,
    paddingHorizontal: 12,
    height: WindowHeight,
    ...(Platform.select({
      web: {
        position: 'sticky' as any,
        overflow: 'hidden',
      },
    }) as ViewStyle),
    top: 0,
  },
  inner: {
    flex: 1,
    width: '100%',
    justifyContent: 'flex-start',
    alignItems: 'stretch',
  },
  headerSection: {
    marginBottom: 8,
  },
  content: {
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    width: '100%',
  },
  heroSection: {
    marginTop: 8,
  },
  heroTagline: {
    color: colors.COLOR_BLACK,
    fontSize: 20,
    fontWeight: 'bold',
    fontFamily: 'Phudu',
    flexWrap: 'wrap',
    textAlign: 'left',
    maxWidth: 200,
    lineHeight: 24,
  },
  authButtonsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 12,
    gap: 8,
  },
  signUpButton: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.COLOR_BLACK,
    borderRadius: 25,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  signUpButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
    fontFamily: 'Phudu',
  },
  signInButton: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primaryColor,
    borderRadius: 25,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  signInButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
    fontFamily: 'Phudu',
  },
  navigationSection: {
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    width: '100%',
    marginTop: 8,
    gap: 2,
  },
  addPropertyButton: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primaryColor,
    borderRadius: 100,
    display: 'flex',
    alignSelf: 'stretch',
    marginTop: 4,
  },
  addPropertyButtonTablet: {
    alignSelf: 'center',
  },
  addPropertyButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    margin: 'auto',
    fontFamily: 'Phudu',
  },
  footer: {
    flexDirection: 'column',
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    width: '100%',
    marginTop: 'auto',
  },
  // removed brandName style (bottom text removed)
  // removed custom signOut styles; using SideBarItem for consistency
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


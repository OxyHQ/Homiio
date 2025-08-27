import React from 'react';
import {
  Dimensions,
  Platform,
  Text,
  View,
  ViewStyle,
  StyleSheet,
} from 'react-native';
import { Pressable } from 'react-native-web-hover';
import { usePathname, useRouter } from 'expo-router';
import { useMediaQuery } from 'react-responsive';
import { useTranslation } from 'react-i18next';
import { SideBarItem } from './SideBarItem';
import { SavedPropertyItem } from './SavedPropertyItem';
import { SavedFolderItem } from './SavedFolderItem';
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
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';

const IconComponent = Ionicons as any;

const WindowHeight = Dimensions.get('window').height;

export function SideBar() {
  const { t } = useTranslation();
  const router = useRouter();
  const { canAccessRoommates } = useProfile();
  const { isAuthenticated: _isAuthenticated, user, showBottomSheet, logout } = useOxy();

  // Use SavedPropertiesContext for consistent state with SaveButton
  const { savedProperties, folders, isLoading: savedLoading } = useSavedPropertiesContext();

  // Get all saved items (folders and properties) ordered by recency
  const recentSavedItems = React.useMemo(() => {
    const allItems: {
      type: 'folder' | 'property';
      id: string;
      name: string;
      subtitle?: string;
      color?: string;
      icon?: string;
      propertyCount?: number;
      imageUrl?: string;
      latestImages?: string[];
      href: string;
      timestamp: number;
    }[] = [];

    const savedProps = Array.isArray(savedProperties) ? savedProperties : [];
    const savedFolders = Array.isArray(folders) ? folders : [];

    // Add folders with their most recent activity (excluding default folder)
    savedFolders.forEach((folder: any) => {
      // Skip the default folder
      if (folder.isDefault) return;

      // Get properties saved to this folder
      const folderProperties = savedProps.filter((property: any) =>
        property.folderId === folder._id
      );

      // Get the most recently saved property in this folder
      const mostRecentProperty = folderProperties
        .sort((a: any, b: any) =>
          new Date((b as any).savedAt || b.updatedAt || b.createdAt).getTime() -
          new Date((a as any).savedAt || a.updatedAt || a.createdAt).getTime()
        )[0];

      const latestImages = folderProperties
        .sort((a: any, b: any) =>
          new Date((b as any).savedAt || b.updatedAt || b.createdAt).getTime() -
          new Date((a as any).savedAt || a.updatedAt || a.createdAt).getTime()
        )
        .slice(0, 2)
        .map((property: any) => property.images?.[0]?.url)
        .filter(Boolean);

      // Use the timestamp of the most recently saved property, or fall back to folder's timestamp
      const folderTimestamp = mostRecentProperty
        ? new Date((mostRecentProperty as any).savedAt || mostRecentProperty.updatedAt || mostRecentProperty.createdAt).getTime()
        : new Date(folder.updatedAt || folder.createdAt).getTime();

      allItems.push({
        type: 'folder',
        id: folder._id,
        name: folder.name,
        color: folder.color,
        icon: folder.icon,
        propertyCount: folder.propertyCount || 0,
        href: `/saved/${folder._id}`,
        latestImages,
        timestamp: folderTimestamp,
      });
    });

    // Add properties (including those in default folder, excluding those in custom folders)
    savedProps.forEach((property: any) => {
      // Get the default folder
      const defaultFolder = savedFolders.find((folder: any) => folder.isDefault);

      // Skip properties that are saved to custom folders (but allow default folder)
      if (property.folderId && property.folderId !== defaultFolder?._id) return;

      allItems.push({
        type: 'property',
        id: property._id || property.id,
        name: property.title || `${property.type} in ${property.address?.city || 'Unknown'}`,
        subtitle: property.address?.city ? `${property.address.city}, ${property.address.state || ''}` : 'Location not specified',
        imageUrl: property.images?.[0]?.url,
        href: `/properties/${property._id || property.id}`,
        timestamp: new Date((property as any).savedAt || property.updatedAt || property.createdAt).getTime(),
      });
    });

    // Sort all items by timestamp (most recent first) and take the first 5
    return allItems
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5);
  }, [savedProperties, folders]);

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

      // Viewings entry
      {
        title: t('viewings.title', { defaultValue: 'Viewings' }) as string,
        icon: <IconComponent name="calendar-outline" size={20} color={colors.COLOR_BLACK} />,
        iconActive: <IconComponent name="calendar" size={20} color={colors.primaryColor} />,
        route: '/viewings',
      },

      // Only show roommates for personal profiles
      ...(canAccessRoommates
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
            padding: 6,
            ...(Platform.select({
              web: {
                transition: 'width 220ms cubic-bezier(0.2, 0, 0, 1)',
                willChange: 'width',
              },
            }) as ViewStyle),
            ...(pathname === '/search' ? {
              shadowColor: colors.primaryDark,
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.25,
              shadowRadius: 3.84,
              elevation: 5,
            } : {}),
          },
        ]}
      >
        <View style={styles.inner}>
          <View style={styles.headerSection}>
            <Logo />
          </View>
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

            <View style={styles.addPropertyButtonContainer}>
              <Button
                href="/properties/create"
                renderText={() => (
                  <Text style={[
                    styles.addPropertyButtonText,
                    {
                      opacity: isExpanded ? 1 : 0,
                      width: isExpanded ? 'auto' : 0,
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      ...(Platform.select({
                        web: {
                          transition: 'opacity 220ms cubic-bezier(0.2, 0, 0, 1), width 220ms cubic-bezier(0.2, 0, 0, 1)',
                          willChange: 'opacity, width',
                        },
                      }) as any),
                    }
                  ]}>
                    {t('sidebar.actions.addProperty')}
                  </Text>
                )}
                renderIcon={() => (
                  <View style={{
                    opacity: isExpanded ? 0 : 1,
                    position: isExpanded ? 'absolute' : 'relative',
                    left: isExpanded ? '50%' : 'auto',
                    top: isExpanded ? '50%' : 'auto',
                    transform: isExpanded ? 'translate(-50%, -50%)' : 'none',
                    ...(Platform.select({
                      web: {
                        transition: 'opacity 220ms cubic-bezier(0.2, 0, 0, 1)',
                        willChange: 'opacity',
                      },
                    }) as any),
                  }}>
                    <Compose size={20} color={colors.primaryLight} />
                  </View>
                )}
                containerStyle={() => ({
                  ...styles.addPropertyButton,
                  height: isExpanded ? 40 : 48,
                  width: isExpanded ? '100%' : 48,
                  alignSelf: isExpanded ? 'stretch' : 'center',
                  ...(Platform.select({
                    web: {
                      transition: 'width 220ms cubic-bezier(0.2, 0, 0, 1), height 220ms cubic-bezier(0.2, 0, 0, 1)',
                      willChange: 'width, height',
                    },
                  }) as ViewStyle),
                })}
              />
            </View>
          </View>

          {/* Recently Saved Section */}
          {user && user.id && (
            <View style={styles.recentlySavedSection}>
              <Text style={[
                styles.sectionTitle,
                {
                  opacity: isExpanded ? 1 : 0,
                  ...(Platform.select({
                    web: {
                      transition: 'opacity 220ms cubic-bezier(0.2, 0, 0, 1)',
                      willChange: 'opacity',
                    },
                  }) as any),
                }
              ]}>
                {t('sidebar.savedProperties.title', { defaultValue: 'Saved Properties' })}
              </Text>
              <View style={styles.recentlySavedList}>
                {recentSavedItems.map((item, _index) => {
                  if (item.type === 'folder') {
                    // Only show folder if it has properties
                    if (!item.propertyCount || item.propertyCount === 0) return null;
                    return (
                      <SavedFolderItem
                        key={item.id}
                        name={item.name}
                        color={item.color || '#000000'}
                        icon={item.icon || 'folder'}
                        propertyCount={item.propertyCount || 0}
                        href={item.href}
                        isExpanded={isExpanded}
                        onHoverExpand={handleHoverIn}
                        latestImages={item.latestImages}
                      />
                    );
                  } else {
                    return (
                      <SavedPropertyItem
                        key={item.id}
                        imageUrl={item.imageUrl || ''}
                        title={item.name}
                        subtitle={item.subtitle || ''}
                        href={item.href}
                        isExpanded={isExpanded}
                        onHoverExpand={handleHoverIn}
                      />
                    );
                  }
                })}
                {recentSavedItems.filter(item => item.type !== 'folder' || (item.propertyCount && item.propertyCount > 0)).length === 0 && !savedLoading && isExpanded && (
                  <View style={styles.emptyRecentlySaved}>
                    <Text style={styles.emptyRecentlySavedText}>
                      {t('sidebar.savedProperties.empty', { defaultValue: 'No saved properties or folders' })}
                    </Text>
                  </View>
                )}
              </View>
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
    backgroundColor: colors.primaryLight,
    padding: 12,
    ...(Platform.select({
      web: {
        position: 'sticky' as any,
        overflow: 'hidden',
        height: '100vh' as any,
        cursor: 'initial',
      },
      default: {
        height: WindowHeight,
      },
    }) as ViewStyle),
    top: 0,
    zIndex: 1000,
  },
  inner: {
    flex: 1,
    width: '100%',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
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
    alignItems: 'flex-start',
    width: '100%',
    marginTop: 8,
    gap: 2,
    paddingLeft: 0,
    paddingRight: 0,
  },
  addPropertyButton: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primaryColor,
    borderRadius: 100,
    display: 'flex',
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  addPropertyButtonContainer: {
    minHeight: 60,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addPropertyButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    margin: 0,
    fontFamily: 'Phudu',
  },
  footer: {
    flexDirection: 'column',
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    width: '100%',
    marginTop: 'auto',
  },
  recentlySavedSection: {
    marginTop: 20,
    marginBottom: 20,
    width: '100%',
    ...(Platform.select({
      web: {
        transition: 'all 220ms cubic-bezier(0.2, 0, 0, 1)',
        willChange: 'margin',
      },
    }) as any),
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primaryDark,
    marginBottom: 4,
    paddingHorizontal: 8,
    fontFamily: 'Phudu',
    ...(Platform.select({
      web: {
        whiteSpace: 'nowrap',
      },
    }) as any),
  },
  recentlySavedList: {
    width: '100%',
    ...(Platform.select({
      web: {
        transition: 'gap 220ms cubic-bezier(0.2, 0, 0, 1)',
        willChange: 'gap',
      },
    }) as any),
  },
  emptyRecentlySaved: {
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyRecentlySavedText: {
    fontSize: 12,
    color: colors.primaryDark_2,
    fontFamily: 'Phudu',
    textAlign: 'center',
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


import React, { useContext } from 'react'
import { Dimensions, Platform, Text, View, ViewStyle, TouchableOpacity, StyleSheet } from 'react-native'
import { usePathname } from 'expo-router';
import { useMediaQuery } from 'react-responsive'
import { useTranslation } from "react-i18next";
import { SideBarItem } from './SideBarItem'
import { colors } from '@/styles/colors'
import { Button } from '@/components/SideBar/Button'
import { Logo } from '@/components/Logo'
import { Home, HomeActive } from '@/assets/icons/home-icon'
import { Bookmark, BookmarkActive } from '@/assets/icons/bookmark-icon';
import { Gear, GearActive } from '@/assets/icons/gear-icon';
import { Hashtag, HashtagActive } from '@/assets/icons/hashtag-icon';
import { Search, SearchActive } from '@/assets/icons/search-icon';
import { Compose } from '@/assets/icons/compose-icon';
import { Ionicons } from '@expo/vector-icons';
import { OxySignInButton, useOxy } from '@oxyhq/services';
import { SindiIcon } from '@/assets/icons';

const IconComponent = Ionicons as any;

const WindowHeight = Dimensions.get('window').height;

export function SideBar() {
    const { t } = useTranslation();

    const { isAuthenticated, user, showBottomSheet } = useOxy();

    const sideBarData: { title: string; icon: React.ReactNode, iconActive: React.ReactNode, route: string }[] = [
        {
            title: t("sidebar.navigation.home"),
            icon: <Home color={colors.COLOR_BLACK} />,
            iconActive: <HomeActive />,
            route: '/',
        },
        {
            title: t("sidebar.navigation.saved"),
            icon: <Bookmark color={colors.COLOR_BLACK} />,
            iconActive: <BookmarkActive />,
            route: '/saved',
        },
        {
            title: t("sidebar.navigation.sindi"),
            icon: <SindiIcon size={24} color={colors.COLOR_BLACK} />,
            iconActive: <SindiIcon size={24} color={colors.primaryColor} />,
            route: '/sindi',
        },
        {
            title: t("sidebar.navigation.contracts"),
            icon: <View><IconComponent name="document-text-outline" size={24} color={colors.COLOR_BLACK} /></View>,
            iconActive: <View><IconComponent name="document-text" size={24} color={colors.primaryColor} /></View>,
            route: '/contracts',
        },
        {
            title: t("sidebar.navigation.profile"),
            icon: <View><IconComponent name="person-outline" size={24} color={colors.COLOR_BLACK} /></View>,
            iconActive: <View><IconComponent name="person" size={24} color={colors.primaryColor} /></View>,
            route: '/profile',
        },
        {
            title: t("sidebar.navigation.payments"),
            icon: <View><IconComponent name="card-outline" size={24} color={colors.COLOR_BLACK} /></View>,
            iconActive: <View><IconComponent name="card" size={24} color={colors.primaryColor} /></View>,
            route: '/payments',
        },
        {
            title: t("sidebar.navigation.roommates"),
            icon: <Hashtag color={colors.COLOR_BLACK} />,
            iconActive: <HashtagActive />,
            route: '/roommates',
        },
        {
            title: t("sidebar.navigation.settings"),
            icon: <Gear color={colors.COLOR_BLACK} />,
            iconActive: <GearActive />,
            route: '/settings',
        },
    ]

    const pathname = usePathname()
    const isSideBarVisible = useMediaQuery({ minWidth: 500 })
    const isFullSideBar = useMediaQuery({ minWidth: 1266 })
    const isRightBarVisible = useMediaQuery({ minWidth: 990 })

    if (!isSideBarVisible) return null

    if (isSideBarVisible) {
        return (
            <View
                style={[
                    styles.container,
                    {
                        alignItems: isFullSideBar ? 'flex-start' : 'center',
                        paddingEnd: !isFullSideBar ? 10 : 0,
                        width: isFullSideBar ? 360 : 60,
                    }
                ]}>
                <View style={styles.content}>
                    <Logo />
                    {!user?.id && (
                        <View style={styles.heroSection}>
                            {isFullSideBar && (
                                <Text style={styles.heroTagline}>
                                    {t("sidebar.hero.tagline")}
                                </Text>
                            )}
                            {!isAuthenticated && (
                                <View style={styles.authButtonsContainer}>
                                    <TouchableOpacity
                                        style={styles.signUpButton}
                                        onPress={() => showBottomSheet?.('SignUp')}
                                    >
                                        <Text style={styles.signUpButtonText}>{t("sidebar.actions.signUp")}</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={styles.signInButton}
                                        onPress={() => showBottomSheet?.('SignIn')}
                                    >
                                        <Text style={styles.signInButtonText}>{t("sidebar.actions.signIn")}</Text>
                                    </TouchableOpacity>
                                </View>
                            )}
                        </View>
                    )}
                    {user && user.id && (
                        <View style={styles.navigationSection}>
                            {
                                sideBarData.map(({ title, icon, iconActive, route }) => {
                                    return <SideBarItem href={route} key={title}
                                        icon={pathname === route ? iconActive : icon}
                                        text={title}
                                        isActive={pathname === route} />
                                })}
                            <Button
                                href="/properties/create"
                                renderText={({ state }) =>
                                    state === 'desktop' ? (
                                        <Text style={styles.addPropertyButtonText}>
                                            {t("sidebar.actions.addProperty")}
                                        </Text>
                                    ) : null
                                }
                                renderIcon={({ state }) =>
                                    state === 'tablet' ? (
                                        <Compose size={24} color={colors.primaryLight} />
                                    ) : null
                                }
                                containerStyle={({ state }) => ({
                                    ...styles.addPropertyButton,
                                    height: state === 'desktop' ? 47 : 50,
                                    width: state === 'desktop' ? 220 : 50,
                                    ...(state === 'desktop'
                                        ? {}
                                        : styles.addPropertyButtonTablet),
                                })}
                            />
                        </View>)}
                </View>
                <View style={styles.spacer}></View>
                <View style={styles.footer}>
                    <OxySignInButton />
                    {isFullSideBar && (<Text style={styles.brandName}>{t("sidebar.footer.brandName")}</Text>)}
                </View>
            </View>
        )
    } else {
        return null
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
    },
    addPropertyButtonTablet: {
        alignSelf: 'center',
    },
    addPropertyButtonText: {
        color: 'white',
        fontSize: 17,
        fontWeight: 'bold',
        textAlign: 'center',
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
});

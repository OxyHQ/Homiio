import React, { useContext } from 'react'
import { Dimensions, Platform, Text, View, ViewStyle, TouchableOpacity } from 'react-native'
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

const IconComponent = Ionicons as any;

const WindowHeight = Dimensions.get('window').height;

export function SideBar() {
    const { t } = useTranslation();
    const state = {
        userId: null,
    }

    const { isAuthenticated, user, showBottomSheet } = useOxy();

    const sideBarData: { title: string; icon: React.ReactNode, iconActive: React.ReactNode, route: string }[] = [
        {
            title: 'Home',
            icon: <Home color={colors.COLOR_BLACK} />,
            iconActive: <HomeActive />,
            route: '/',
        },
        {
            title: t("Saved"),
            icon: <Bookmark color={colors.COLOR_BLACK} />,
            iconActive: <BookmarkActive />,
            route: '/saved',
        },
        {
            title: t("Contracts"),
            icon: <View><IconComponent name="document-text-outline" size={24} color={colors.COLOR_BLACK} /></View>,
            iconActive: <View><IconComponent name="document-text" size={24} color={colors.primaryColor} /></View>,
            route: '/contracts',
        },
        {
            title: t("Profile"),
            icon: <View><IconComponent name="person-outline" size={24} color={colors.COLOR_BLACK} /></View>,
            iconActive: <View><IconComponent name="person" size={24} color={colors.primaryColor} /></View>,
            route: '/profile',
        },
        {
            title: t("Payments"),
            icon: <View><IconComponent name="card-outline" size={24} color={colors.COLOR_BLACK} /></View>,
            iconActive: <View><IconComponent name="card" size={24} color={colors.primaryColor} /></View>,
            route: '/payments',
        },
        {
            title: t("Roommates"),
            icon: <Hashtag color={colors.COLOR_BLACK} />,
            iconActive: <HashtagActive />,
            route: '/roommates',
        },
        {
            title: t("Settings"),
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
                style={
                    {
                        paddingVertical: 20,
                        height: WindowHeight,
                        paddingHorizontal: isFullSideBar ? 20 : 0,
                        alignItems: isFullSideBar ? 'flex-end' : 'center',
                        paddingEnd: !isFullSideBar ? 10 : 0,
                        width: isFullSideBar ? 360 : 60,
                        ...Platform.select({
                            web: {
                                position: 'sticky',
                            },
                        }),
                        top: 0,
                    } as ViewStyle
                }>
                <View
                    style={{
                        justifyContent: 'center',
                        alignItems: 'flex-start',
                    }}>
                    <Logo />
                    {!state.userId && (
                        <View>
                            {isFullSideBar && (
                                <Text
                                    style={{
                                        color: colors.COLOR_BLACK,
                                        fontSize: 25,
                                        fontWeight: 'bold',
                                        fontFamily: 'Phudu',
                                        flexWrap: 'wrap',
                                        textAlign: 'left',
                                        maxWidth: 200,
                                        lineHeight: 30,
                                    }}
                                >{t("Find your ethical home")}</Text>
                            )}
                            {!isAuthenticated && (
                                <View
                                    style={{
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        marginVertical: 20,
                                        gap: 10,
                                    }}
                                >
                                    <TouchableOpacity
                                        style={{
                                            justifyContent: 'center',
                                            alignItems: 'center',
                                            backgroundColor: colors.COLOR_BLACK,
                                            borderRadius: 25,
                                            paddingHorizontal: 15,
                                            paddingVertical: 8,
                                        }}
                                        onPress={() => showBottomSheet?.('SignUp')}
                                    >
                                        <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>{t("Sign Up")}</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={{
                                            justifyContent: 'center',
                                            alignItems: 'center',
                                            backgroundColor: colors.primaryColor,
                                            borderRadius: 25,
                                            paddingHorizontal: 15,
                                            paddingVertical: 8,
                                        }}
                                        onPress={() => showBottomSheet?.('SignIn')}
                                    >
                                        <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>{t("Sign In")}</Text>
                                    </TouchableOpacity>
                                </View>
                            )}
                        </View>
                    )}
                    {user && user.id && (
                        <View style={{
                            justifyContent: 'center',
                            alignItems: 'flex-start',
                        }}>
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
                                        <Text style={{
                                            color: 'white',
                                            fontSize: 17,
                                            fontWeight: 'bold',
                                            textAlign: 'center'
                                        }}>
                                            Add Property
                                        </Text>
                                    ) : null
                                }
                                renderIcon={({ state }) =>
                                    state === 'tablet' ? (
                                        <Compose size={24} color={colors.primaryLight} />
                                    ) : null
                                }
                                containerStyle={({ state }) => ({
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    backgroundColor: colors.primaryColor,
                                    borderRadius: 100,
                                    height: state === 'desktop' ? 47 : 50,
                                    width: state === 'desktop' ? 220 : 50,
                                    ...(state === 'desktop'
                                        ? {}
                                        : {
                                            alignSelf: 'center',
                                        }),
                                })}
                            />
                        </View>)}
                </View>
                <View style={{ flex: 1, }}></View>
                <View style={{ flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: '100%' }}>
                    <OxySignInButton />
                    <Text>Homio - Ethical Housing Platform</Text>
                </View>
            </View>
        )
    } else {
        return null
    }
}

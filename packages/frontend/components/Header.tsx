import React, { useEffect, useState } from 'react';
import {
    StyleSheet,
    View,
    ViewStyle,
    Platform,
} from 'react-native'
import { Pressable } from 'react-native'
import { Ionicons } from "@expo/vector-icons";
import { colors } from '@/styles/colors'
import { useRouter } from 'expo-router'
import { ReactNode } from 'react'
import { phuduFontWeights } from '@/styles/fonts';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from './ThemedText';

const IconComponent = Ionicons as any;

interface Props {
    style?: ViewStyle
    options?: {
        title?: string
        titlePosition?: 'left' | 'center'
        subtitle?: string
        showBackButton?: boolean
        leftComponents?: ReactNode[]
        rightComponents?: ReactNode[]
    }
}

export const Header: React.FC<Props> = ({ options }) => {
    const router = useRouter();
    const [isSticky, setIsSticky] = useState(false);
    const [canGoBack, setCanGoBack] = useState(false);
    const insets = useSafeAreaInsets();

    const titlePosition = options?.titlePosition || 'left';

    useEffect(() => {
        // Check if we can go back
        setCanGoBack(router.canGoBack());
    }, [router]);

    useEffect(() => {
        if (Platform.OS === 'web') {
            const handleScroll = () => {
                if (window.scrollY > 20) {
                    setIsSticky(true);
                } else {
                    setIsSticky(false);
                }
            };

            window.addEventListener('scroll', handleScroll);
            return () => {
                window.removeEventListener('scroll', handleScroll);
            };
        }
    }, []);

    return (
        <View style={[styles.topRow, isSticky && styles.stickyHeader, {
            minHeight: 60 + insets.top
        }]}>
            <View style={[styles.contentContainer, { paddingTop: insets.top }]}>
                <View style={styles.leftContainer}>
                    {options?.showBackButton && canGoBack && (
                        <Pressable onPress={() => router.back()} style={styles.backButton}>
                            <IconComponent name="arrow-back" size={24} color={colors.COLOR_BLACK} />
                        </Pressable>
                    )}
                    {options?.leftComponents?.map((component, index) => (
                        <React.Fragment key={index}>{component}</React.Fragment>
                    ))}
                    {titlePosition === 'left' && (
                        <View>
                            {options?.title && (
                                <ThemedText style={[styles.topRowText, { fontFamily: phuduFontWeights.bold }, options?.subtitle && { fontSize: 14 }]}>
                                    {options.title}
                                </ThemedText>
                            )}
                            {options?.subtitle && (
                                <ThemedText style={styles.subtitleText}>{options.subtitle}</ThemedText>
                            )}
                        </View>
                    )}
                </View>
                {titlePosition === 'center' && (
                    <View style={styles.centerContainer}>
                        {options?.title && (
                            <ThemedText style={[styles.topRowText, { fontFamily: phuduFontWeights.bold }, options?.subtitle && { fontSize: 14 }]}>
                                {options.title}
                            </ThemedText>
                        )}
                        {options?.subtitle && (
                            <ThemedText style={styles.subtitleText}>{options.subtitle}</ThemedText>
                        )}
                    </View>
                )}
                <View style={styles.rightContainer}>
                    {options?.rightComponents?.map((component, index) => (
                        <React.Fragment key={index}>{component}</React.Fragment>
                    ))}
                </View>
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        width: '100%',
        paddingBottom: 10,
    },
    topRow: {
        borderBottomWidth: 0.01,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
        position: 'relative',
        ...Platform.select({
            web: {
                position: 'sticky',
            },
            default: {
                shadowColor: colors.COLOR_BLACK,
                shadowOffset: {
                    width: 0,
                    height: 2,
                },
                shadowOpacity: 0.1,
                shadowRadius: 3,
                elevation: 3,
            },
        }),
        top: 0,
        backgroundColor: colors.primaryLight,
        zIndex: 100,
    } as ViewStyle,
    contentContainer: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 15,
        paddingTop: Platform.select({
            web: 5,
            default: 12,
        }),
        paddingBottom: Platform.select({
            web: 5,
            default: 4,
        }),
    },
    topRowText: {
        fontSize: 20,
        color: colors.COLOR_BLACK,
        fontWeight: '800',
        paddingStart: 1,
    },
    subtitleText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        fontWeight: '400',
    },
    startContainer: {
        borderRadius: 100,
        padding: 10,
    },
    backButton: {
        marginRight: 10,
    },
    leftContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        gap: 10,
    },
    centerContainer: {
        flex: 1,
        alignItems: 'center',
    },
    rightContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        justifyContent: 'flex-end',
        gap: 10,
    },
    stickyHeader: {
        borderTopEndRadius: 0,
        borderTopStartRadius: 0,
    },
})

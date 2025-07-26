import { StyleSheet, View, Pressable, Text, ViewStyle, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, usePathname } from 'expo-router';
import React from 'react';
import Avatar from './Avatar';
import { useOxy } from '@oxyhq/services';
import { SindiIcon } from '@/assets/icons';
import { useHasRentalProperties } from '@/hooks/useLeaseQueries';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const BottomBar = () => {
    const router = useRouter();
    const [activeRoute, setActiveRoute] = React.useState('/');
    const pathname = usePathname();
    const { showBottomSheet, hideBottomSheet } = useOxy();
    const { hasRentalProperties, isLoading } = useHasRentalProperties();
    const insets = useSafeAreaInsets();

    const handlePress = (route: '/' | '/properties' | '/saved' | '/sindi' | '/contracts' | '/profile') => {
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
            borderTopColor: '#eeeeee',
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
            <Pressable onPress={() => handlePress('/')} style={[styles.tab, activeRoute === '/' && styles.active]}>
                <Ionicons name={activeRoute === '/' ? "home" : "home-outline"} size={28} color={activeRoute === '/' ? "#4E67EB" : "#000"} />
            </Pressable>
            <Pressable onPress={() => handlePress('/properties')} style={[styles.tab, activeRoute === '/properties' && styles.active]}>
                <Ionicons name={activeRoute === '/properties' ? "search" : "search-outline"} size={28} color={activeRoute === '/properties' ? "#4E67EB" : "#000"} />
            </Pressable>
            <Pressable onPress={() => handlePress('/saved')} style={[styles.tab, activeRoute === '/saved' && styles.active]}>
                <Ionicons name={activeRoute === '/saved' ? "bookmark" : "bookmark-outline"} size={28} color={activeRoute === '/saved' ? "#4E67EB" : "#000"} />
            </Pressable>
            <Pressable onPress={() => handlePress('/sindi')} style={[styles.tab, activeRoute === '/sindi' && styles.active]}>
                <SindiIcon size={28} color={activeRoute === '/sindi' ? "#4E67EB" : "#000"} />
            </Pressable>
            {/* Only show contracts tab if user has rental properties */}
            {hasRentalProperties && (
                <Pressable onPress={() => handlePress('/contracts')} style={[styles.tab, activeRoute === '/contracts' && styles.active]}>
                    <Ionicons name={activeRoute === '/contracts' ? "document-text" : "document-text-outline"} size={28} color={activeRoute === '/contracts' ? "#4E67EB" : "#000"} />
                </Pressable>
            )}
            <View style={styles.tab}>
                <Avatar onPress={() => showBottomSheet?.('SignIn')} />
            </View>
        </View>
    );
};
import React from 'react'
import { View, StyleSheet, Platform } from "react-native";
import { useMediaQuery } from 'react-responsive'
import { colors } from '../styles/colors'
import { SearchBar } from './SearchBar'
import { usePathname } from "expo-router";
import { WidgetManager } from './widgets';

export function RightBar() {
    const isRightBarVisible = useMediaQuery({ minWidth: 990 });
    const pathname = usePathname();

    // Determine which screen we're on based on the pathname
    const getScreenId = () => {
        if (pathname === '/') return 'home';
        if (pathname === '/properties') return 'properties';
        if (pathname.startsWith('/properties/') && pathname !== '/properties/my' && pathname !== '/properties/saved') return 'property-details';
        if (pathname === '/properties/saved') return 'saved-properties';
        if (pathname === '/profile' || pathname.startsWith('/profile/')) return 'profile';
        if (pathname === '/contracts' || pathname.startsWith('/contracts/')) return 'contracts';
        if (pathname === '/payments' || pathname.startsWith('/payments/')) return 'payments';
        if (pathname === '/messages' || pathname.startsWith('/messages/')) return 'messages';
        return 'home'; // Default to home
    };

    if (!isRightBarVisible) return null;

    return (
        <View style={styles.container}>
            <SearchBar />
            <WidgetManager screenId={getScreenId()} />
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        width: 350,
        paddingStart: 20,
        flexDirection: 'column',
        gap: 20,
        ...Platform.select({
            web: {
                position: 'sticky' as any,
                top: 50,
                bottom: 20,
            },
        }),
    },
});

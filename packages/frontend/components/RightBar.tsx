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
        if (pathname === '/search') return 'search';
        if (pathname.startsWith('/search/')) return 'search-results';
        return 'home'; // Default to home
    };

    // Extract property information from URL
    const getPropertyInfo = () => {
        // Extract property ID from property details page
        if (pathname.startsWith('/properties/') && pathname !== '/properties/my' && pathname !== '/properties/saved') {
            const pathParts = pathname.split('/');
            const propertyId = pathParts[2]; // /properties/[id]

            if (propertyId && propertyId !== 'my' && propertyId !== 'saved' && propertyId !== 'eco' && propertyId !== 'type' && propertyId !== 'city') {
                return { propertyId };
            }
        }

        // Extract city information from city properties page
        if (pathname.startsWith('/properties/city/')) {
            const pathParts = pathname.split('/');
            const cityId = pathParts[3]; // /properties/city/[id]

            if (cityId) {
                // You could fetch city details here or pass the city ID
                return {
                    city: cityId,
                    state: 'Unknown', // This would come from city data
                    neighborhoodName: 'Downtown' // This would come from city data
                };
            }
        }

        return {};
    };

    const isSearchScreen = pathname === '/search' || pathname.startsWith('/search/');
    const propertyInfo = getPropertyInfo();

    if (!isRightBarVisible) return null;

    return (
        <View style={styles.container}>
            <SearchBar hideFilterIcon={isSearchScreen} />
            <WidgetManager
                screenId={getScreenId()}
                propertyId={propertyInfo.propertyId}
                neighborhoodName={propertyInfo.neighborhoodName}
                city={propertyInfo.city}
                state={propertyInfo.state}
            />
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

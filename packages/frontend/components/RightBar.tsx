import React, { useMemo } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { usePathname } from 'expo-router';
import { WidgetManager } from './widgets';
import { useIsRightBarVisible } from '@/hooks/useOptimizedMediaQuery';
import { useSearchMode } from '@/context/SearchModeContext';

// Global form data store for create property screen
let createPropertyFormData: any = null;

// Function to update form data (will be called from create property screen)
export const updateCreatePropertyFormData = (formData: any) => {
  createPropertyFormData = formData;
};

export const RightBar = React.memo(function RightBar() {
  const isRightBarVisible = useIsRightBarVisible();
  const pathname = usePathname() || '/';

  // Get search mode with fallback for backward compatibility
  let isMapMode = true; // Default to true for backward compatibility
  try {
    const searchMode = useSearchMode();
    isMapMode = searchMode.isMapMode;
  } catch (error) {
    // Context not available, use default
  }

  // Memoize screen ID calculation
  const screenId = useMemo(() => {
    if (pathname === '/') return 'home';
    if (pathname === '/properties') return 'properties';
    if (pathname === '/properties/create') return 'create-property';
    if (
      pathname.startsWith('/properties/') &&
      pathname !== '/properties/my' &&
      pathname !== '/properties/saved'
    )
      return 'property-details';
    if (pathname === '/properties/saved') return 'saved-properties';
    if (pathname === '/profile' || pathname.startsWith('/profile/')) return 'profile';
    if (pathname === '/contracts' || pathname.startsWith('/contracts/')) return 'contracts';
    if (pathname === '/payments' || pathname.startsWith('/payments/')) return 'payments';
    if (pathname === '/messages' || pathname.startsWith('/messages/')) return 'messages';
    if (pathname === '/search') return 'search';
    if (pathname.startsWith('/search/')) return 'search-results';
    return 'home'; // Default to home
  }, [pathname]);

  // Memoize search screen check
  const isSearchScreen = useMemo(() =>
    pathname === '/search' || pathname.startsWith('/search/'),
    [pathname]
  );

  // Memoize property information extraction
  const propertyInfo = useMemo(() => {
    // Extract property ID from property details page
    if (
      pathname.startsWith('/properties/') &&
      pathname !== '/properties/my' &&
      pathname !== '/properties/saved'
    ) {
      const pathParts = pathname.split('/');
      const propertyId = pathParts[2]; // /properties/[id]

      if (
        propertyId &&
        propertyId !== 'my' &&
        propertyId !== 'saved' &&
        propertyId !== 'eco' &&
        propertyId !== 'type' &&
        propertyId !== 'city'
      ) {
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
          neighborhoodName: 'Downtown', // This would come from city data
        };
      }
    }

    return {};
  }, [pathname]);

  // Memoize styles
  const containerStyle = useMemo(() => [
    styles.container,
    isSearchScreen && isMapMode && styles.fixedContainer
  ], [isSearchScreen, isMapMode]);

  const stickyWidgetsContainerStyle = useMemo(() => [
    styles.stickyWidgetsContainer
  ], []);

  if (!isRightBarVisible) return null;

  return (
    <View style={containerStyle}>
      {/* Sticky Widgets Container */}
      <View style={stickyWidgetsContainerStyle}>
        <WidgetManager
          screenId={screenId}
          propertyId={propertyInfo.propertyId}
          neighborhoodName={propertyInfo.neighborhoodName}
          city={propertyInfo.city}
          state={propertyInfo.state}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    width: 350,
    flexDirection: 'column',
  },
  fixedContainer: {
    ...Platform.select({
      web: {
        position: 'fixed' as any,
        top: 0,
        right: 20,
        zIndex: 1000,
        overflowY: 'auto' as any,
        height: '100vh' as any,
        pointerEvents: 'none' as any,
      },
    }),
  },
  stickyWidgetsContainer: {
    gap: 10,
    position: 'sticky' as any,
    top: 0,
    zIndex: 10,
    paddingVertical: 20,
    pointerEvents: 'none' as any,
  },
});

import React, { useMemo } from 'react';
import { View, Platform, type ViewStyle } from 'react-native';
import { usePathname } from 'expo-router';
import { WidgetManager } from './widgets';
import {
  useIsRightBarVisible,
  useIsLargeDesktop,
} from '@/hooks/useOptimizedMediaQuery';
import { useUIStore } from '@/store/uiStore';

export const RightBar = React.memo(function RightBar() {
  const isRightBarVisible = useIsRightBarVisible();
  const isLargeDesktop = useIsLargeDesktop();
  const sindiPanelOpen = useUIStore((s) => s.sindiPanelOpen);
  const pathname = usePathname() || '/';

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
    if (pathname === '/explore') return 'explore';
    if (pathname.startsWith('/explore/')) return 'explore-results';
    return 'home'; // Default to home
  }, [pathname]);

  // Memoize property information extraction
  const propertyInfo = useMemo<{ propertyId?: string; city?: string }>(() => {
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
        // Only the city identifier is available from the route. State and
        // neighborhood are intentionally omitted so downstream widgets fall
        // back to their own data sources rather than rendering placeholders.
        return { city: cityId };
      }
    }

    return {};
  }, [pathname]);

  if (!isRightBarVisible) return null;
  // Drop the 4th column while the Sindi panel is docked, unless the screen is
  // large-desktop (>= 1440) where all four columns fit.
  if (sindiPanelOpen && !isLargeDesktop) return null;

  // Web sticky pin — RN style system has no sticky utility that survives
  // react-native-web cleanly for this rail; keep the numeric sticky object.
  const stickyStyle =
    Platform.OS === 'web'
      ? ({
          position: 'sticky',
          // Keep the column at its content height so sticky pins while the
          // center feed scrolls (default flex stretch would stretch to the row).
          alignSelf: 'flex-start',
          top: 0,
        } as unknown as ViewStyle)
      : undefined;

  return (
    <View className="w-[350px] flex-col px-4 pt-4 gap-4" style={stickyStyle}>
      <WidgetManager
        screenId={screenId}
        propertyId={propertyInfo.propertyId}
        city={propertyInfo.city}
      />
    </View>
  );
});

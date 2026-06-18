import React, { useMemo } from 'react';
import { View, StyleSheet, Platform, ViewStyle } from 'react-native';
import { usePathname } from 'expo-router';
import { WidgetManager } from './widgets';
import { colors } from '@/styles/colors';
import {
  useIsRightBarVisible,
  useIsLargeDesktop,
} from '@/hooks/useOptimizedMediaQuery';
import { useUIStore } from '@/store/uiStore';
import { useSearchMode } from '@/context/SearchModeContext';

export const RightBar = React.memo(function RightBar() {
  const isRightBarVisible = useIsRightBarVisible();
  const isLargeDesktop = useIsLargeDesktop();
  const sindiPanelOpen = useUIStore((s) => s.sindiPanelOpen);
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

  return (
    <View style={styles.container}>
      {/* Sticky Widgets Container */}
      <View style={styles.stickyWidgetsContainer}>
        <WidgetManager
          screenId={screenId}
          propertyId={propertyInfo.propertyId}
          city={propertyInfo.city}
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
      // RN-Web supports CSS-only values (`fixed`, `overflowY`, `100vh`) that are
      // absent from RN's ViewStyle, so the web block is typed as a whole.
      web: {
        position: 'fixed',
        top: 0,
        right: 20,
        zIndex: 1000,
        overflowY: 'auto',
        height: '100vh',
        pointerEvents: 'none',
      } as unknown as ViewStyle,
    }),
  },
  // One continuous flat panel on the app background — no border/shadow/card.
  // The WidgetManager owns the section rhythm (per-section vertical padding +
  // hairline dividers), so the rail itself adds no extra vertical padding that
  // would double the first/last section's breathing room.
  stickyWidgetsContainer: {
    backgroundColor: colors.background,
    position: 'sticky',
    top: 0,
    zIndex: 10,
    pointerEvents: 'none',
  } as unknown as ViewStyle,
});

import React from 'react';
import {
  View,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface BaseSidebarProps {
  /** Fixed header at top (logo + collapse toggle, mode toggle). */
  header: React.ReactNode;
  /** Scrollable middle content (nav items + sections). */
  children: React.ReactNode;
  /** Fixed footer at bottom (user menu / sign-in). */
  footer: React.ReactNode;
  /** Optional callback for scroll events (e.g. paginated history). */
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}

/**
 * Sidebar shell: fixed header / scrollable middle / fixed footer with
 * safe-area insets and a hairline border separating the middle from the footer.
 */
export const BaseSidebar = React.memo(function BaseSidebar({
  header,
  children,
  footer,
  onScroll,
}: BaseSidebarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View className="relative w-full overflow-hidden flex-1 flex-col bg-background">
      <View
        className="flex flex-none flex-col"
        style={{ paddingTop: insets.top }}
      >
        {header}
      </View>

      <ScrollView
        className="flex min-h-0 w-full flex-1 flex-col"
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>

      <View
        className="mt-auto w-full min-w-0 border-t border-border flex-col items-center justify-center"
        style={{ paddingBottom: insets.bottom }}
      >
        {footer}
      </View>
    </View>
  );
});

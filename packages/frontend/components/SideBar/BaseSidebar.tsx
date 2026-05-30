import React from 'react';
import {
  Platform,
  View,
  ScrollView,
  StyleSheet,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/styles/colors';

/**
 * Hairline divider above the footer. Drawn with an explicit Bloom token at
 * `StyleSheet.hairlineWidth` (not the `border-border` color class) so it
 * resolves to the same subtle, flat line on web and native — the
 * `--border` CSS variable behind `border-border` doesn't reliably reach the
 * native runtime and a full `borderWidth: 1` reads as a hard black rule.
 */
const styles = StyleSheet.create({
  footerDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});

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
    <View
      className="relative w-full overflow-hidden flex-col bg-background"
      style={
        Platform.OS === 'web'
          ? ({
              position: 'sticky',
              top: 0,
              alignSelf: 'flex-start',
              height: '100vh',
              maxHeight: '100vh',
            } as object)
          : { flex: 1, height: '100%' }
      }
    >
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
        className="mt-auto w-full min-w-0 flex-col items-center justify-center"
        style={[styles.footerDivider, { paddingBottom: insets.bottom }]}
      >
        {footer}
      </View>
    </View>
  );
});

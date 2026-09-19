import React, { ReactNode, createContext, useContext, useLayoutEffect, useSyncExternalStore } from 'react';
import { Platform, type ViewStyle } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';

interface Props {
  options?: {
    title?: string;
    subtitle?: string;
    showBackButton?: boolean;
    leftComponents?: ReactNode[];
    rightComponents?: ReactNode[];
    transparent?: boolean;
    scrollThreshold?: number;
  };
  scrollY?: SharedValue<number>;
}

/** Web stacking of the bar over screen content (StickyPropertyHeader sits at 1001). */
const HEADER_Z_INDEX_WEB = 1000;
const HEADER_Z_INDEX_NATIVE = 100;

/**
 * `true` below the layout's `AppShell`. Native phones render screens outside
 * any shell (NativeTabs own the screen), and `AppShellMenuButton` throws
 * there, so the header only offers the drawer when this says it can.
 */
export const InAppShellContext = createContext(false);

/*
 * How many `Header`s are mounted. The layout reads it to decide whether the
 * page draws its own menu button: with a `Header` the button lives in it; a
 * screen without one gets `AppShell`'s default header, which is that button
 * alone. Counted rather than listed by route so a screen adopting `Header`
 * needs no layout change.
 */
let mountedHeaders = 0;
const headerListeners = new Set<() => void>();

function subscribeToHeaders(listener: () => void): () => void {
  headerListeners.add(listener);
  return () => {
    headerListeners.delete(listener);
  };
}

function setMountedHeaders(next: number): void {
  mountedHeaders = next;
  headerListeners.forEach((listener) => listener());
}

/** Whether any screen `Header` is mounted right now. */
export function useIsScreenHeaderMounted(): boolean {
  return useSyncExternalStore(
    subscribeToHeaders,
    () => mountedHeaders > 0,
    () => false,
  );
}

/**
 * The app's screen header: a thin adapter over Bloom `PageHeader` that keeps
 * the `options` API every screen already passes.
 *
 * - Scroll-linked paint (border, shadow, `transparent` background/title) is
 *   PageHeader's: `scrollY` when the screen owns a scroll container, otherwise
 *   the document scroll on web.
 * - Sticky at `top: 0` on web: `AppShell` scrolls the document and draws no
 *   band above the content, so there is nothing to clear.
 * - While `AppShell`'s sidebar is a drawer (below `lg`), `AppShellMenuButton`
 *   leads the bar; it renders nothing while the rail sits in flow.
 * - The back button renders only when requested AND there is history to pop.
 */
export const Header: React.FC<Props> = ({ options, scrollY }) => {
  const router = useRouter();
  const { t } = useTranslation();
  const inAppShell = useContext(InAppShellContext);
  // A pure read of navigation state, not synced through an effect.
  const canGoBack = router.canGoBack();

  // Layout effect: the layout swaps its fallback header out before paint, so
  // the page never flashes two menu buttons.
  useLayoutEffect(() => {
    setMountedHeaders(mountedHeaders + 1);
    return () => setMountedHeaders(mountedHeaders - 1);
  }, []);

  const left = (options?.leftComponents ?? []).filter(Boolean);
  const right = (options?.rightComponents ?? []).filter(Boolean);

  const containerStyle: ViewStyle =
    Platform.OS === 'web'
      ? { top: 0, zIndex: HEADER_Z_INDEX_WEB }
      : { zIndex: HEADER_Z_INDEX_NATIVE };

  const leading =
    inAppShell || left.length > 0 ? (
      <>
        {inAppShell ? <AppShellMenuButton accessibilityLabel={t('sidebar.open')} /> : null}
        {left.map((component, index) => (
          <React.Fragment key={index}>{component}</React.Fragment>
        ))}
      </>
    ) : undefined;

  return (
    <PageHeader
      presentation="bar"
      title={options?.title || undefined}
      subtitle={options?.subtitle || undefined}
      titleAlign="center"
      onBack={options?.showBackButton && canGoBack ? () => router.back() : undefined}
      backLabel={t('goBack')}
      leading={leading}
      actions={
        right.length > 0
          ? right.map((component, index) => (
              <React.Fragment key={index}>{component}</React.Fragment>
            ))
          : undefined
      }
      transparent={options?.transparent ?? false}
      // Bloom 3.0 split `transparent` in two: it still fades the bar in with
      // scroll, but holding the title back is now `titleReveal`. A transparent
      // header sits over a hero image that already names the screen, which is
      // exactly the case the old coupled behaviour was for — so restate it.
      titleReveal={options?.transparent ? 'onScroll' : 'always'}
      scrollThreshold={options?.scrollThreshold || undefined}
      scrollY={scrollY}
      style={containerStyle}
    />
  );
};
